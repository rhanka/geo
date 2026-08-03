import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  isNumericMuniValue,
  isNumericZonageBypass,
  muniWhereClause,
  normMuniCode,
  NUMERIC_ZONAGE_MAX_DISTINCT,
  proofFromGonetCapture,
  resolveMuniValueToTargetSlug,
  resolveMuniValueToSlug,
  validateExplicitZoneField,
} from "./zones-obscura-run.js";
import {
  capturedFetch,
  CaptureRun,
  type CaptureHttpResponse,
  type CaptureObjectStore,
} from "../../packages/qc-sources/src/capture/index.js";

// Registre + crosswalk minimalistes reproduisant les 2 agrégats MRC réels.
const CODE_TO_SLUG = new Map<string, string>([
  ["13005", "degelis"],
  ["13100", "saint-athanase"],
  ["13073", "temiscouata-sur-le-lac"],
]);
const SLUG_SET = new Set<string>([
  "degelis", "saint-athanase", "temiscouata-sur-le-lac",
  "melbourne", "cleveland", "saint-francois-xavier-de-brompton",
  "saint-sebastien--le-granit",
]);

const feats = (field: string, values: Array<string | number | null>): Array<{ properties: Record<string, unknown> }> =>
  values.map((v) => ({ properties: { [field]: v } }));

function inMemoryStore(): CaptureObjectStore {
  return { head: async () => false, put: async () => undefined };
}

function responseFromBytes(bytes: Uint8Array): CaptureHttpResponse {
  return {
    status: 200,
    ok: true,
    url: "https://www.goazimut.com/container/resource-proxy/proxy.jsp?https://maps.example.test/MapServer/7/query?f=geojson",
    headers: { get: (name: string): string | null => name.toLowerCase() === "content-type" ? "application/geo+json" : null },
    arrayBuffer: async (): Promise<ArrayBuffer> => {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return copy.buffer;
    },
  };
}

describe("zones-obscura — preuve GoNet v2", () => {
  it("hashes received bytes rather than a JSON re-serialization", async () => {
    // Whitespace and key order are deliberately not what JSON.stringify emits.
    const received = new TextEncoder().encode('{\n  "zone": "R-1",\n  "meta": { "b": 2, "a": 1 }\n}\n');
    const url = "https://www.goazimut.com/container/resource-proxy/proxy.jsp?https://maps.example.test/MapServer/7/query?f=geojson";
    const run = new CaptureRun({
      runId: "zones-20260726T120000Z-test",
      lane: "zones",
      store: inMemoryStore(),
      userAgent: "sentropic-geo/0.1",
      viaObscura: true,
      echo: null,
    });
    const captured = await capturedFetch(url, undefined, {
      run,
      source: "zones-gonet",
      slugs: ["sutton"],
      fetchImpl: async (): Promise<CaptureHttpResponse> => responseFromBytes(received),
    });

    const proof = proofFromGonetCapture(captured.line);
    const receivedHash = `sha256:${createHash("sha256").update(received).digest("hex")}`;
    const oldReserializedHash = `sha256:${createHash("sha256").update(JSON.stringify(JSON.parse(new TextDecoder().decode(received)))).digest("hex")}`;

    expect(proof.sha256).toBe(receivedHash);
    expect(proof.sha256).not.toBe(oldReserializedHash);
    expect(captured.line.sha256).toBe(receivedHash);
  });
});

describe("zones-obscura --muni-field resolver (code MAMH ⊕ nom)", () => {
  it("detecte un discriminant numerique (CODE_MUN)", () => {
    expect(isNumericMuniValue("13005")).toBe(true);
    expect(isNumericMuniValue("13005.0")).toBe(true);
    expect(isNumericMuniValue("Melbourne")).toBe(false);
  });

  it("normalise un code (trim + suffixe decimal ArcGIS)", () => {
    expect(normMuniCode("13005.0")).toBe("13005");
    expect(normMuniCode(13100)).toBe("13100");
    expect(normMuniCode(" 13073 ")).toBe("13073");
  });

  it("resout un CODE_MUN numerique via le crosswalk MAMH (Temiscouata)", () => {
    expect(resolveMuniValueToSlug("13005", CODE_TO_SLUG, SLUG_SET)).toBe("degelis");
    expect(resolveMuniValueToSlug("13100", CODE_TO_SLUG, SLUG_SET)).toBe("saint-athanase");
  });

  it("rejette (null) un code absent du crosswalk — jamais devine", () => {
    expect(resolveMuniValueToSlug("99999", CODE_TO_SLUG, SLUG_SET)).toBeNull();
    expect(resolveMuniValueToSlug("", CODE_TO_SLUG, SLUG_SET)).toBeNull();
  });

  it("resout un nom MUN (strip-prefixe) vers le slug canonique (VSF)", () => {
    expect(resolveMuniValueToSlug("Melbourne", CODE_TO_SLUG, SLUG_SET)).toBe("melbourne");
    expect(resolveMuniValueToSlug("Saint-François-Xavier-de-Brompton", CODE_TO_SLUG, SLUG_SET)).toBe("saint-francois-xavier-de-brompton");
  });

  it("distingue Canton de X et Ville de X quand le registre porte le slug complet", () => {
    // Mecanisme "nom complet d'abord" : evite l'effondrement Canton/Ville en meme slug.
    const slugs = new Set<string>(["shefford", "canton-de-shefford"]);
    // 'Canton de Shefford' → slug complet 'canton-de-shefford' present → prefere-le
    expect(resolveMuniValueToSlug("Canton de Shefford", CODE_TO_SLUG, slugs)).toBe("canton-de-shefford");
    // 'Ville de Shefford' → 'ville-de-shefford' absent → repli strip-prefixe → 'shefford'
    expect(resolveMuniValueToSlug("Ville de Shefford", CODE_TO_SLUG, slugs)).toBe("shefford");
  });

  it("resout un nom court vers le slug cible desambiguise par MRC", () => {
    const target = { slug: "saint-sebastien--le-granit", name: "Saint-Sébastien", mrc: "Le Granit", lat: 45.78, lon: -70.98 };
    expect(resolveMuniValueToSlug("Saint-Sébastien", CODE_TO_SLUG, SLUG_SET)).toBeNull();
    expect(resolveMuniValueToTargetSlug("Saint-Sébastien", target, CODE_TO_SLUG, SLUG_SET)).toBe("saint-sebastien--le-granit");
  });

  it("construit une clause WHERE numerique non-quotee, nom quotee (anti-injection)", () => {
    expect(muniWhereClause("CODE_MUN", "13005")).toBe("CODE_MUN=13005");
    expect(muniWhereClause("CODE_MUN", "13005.0")).toBe("CODE_MUN=13005");
    expect(muniWhereClause("MUN", "Melbourne")).toBe("MUN='Melbourne'");
    expect(muniWhereClause("MUN", "L'Ange-Gardien")).toBe("MUN='L''Ange-Gardien'");
  });

  it("quote un code numerique porte par un champ de type STRING (ex. Antoine-Labelle code)", () => {
    // esriFieldTypeString portant '79088' : ArcGIS renvoie 400 sans quotes.
    expect(muniWhereClause("code", "79088", true)).toBe("code='79088'");
    expect(muniWhereClause("code", "79088.0", true)).toBe("code='79088'");
    // fieldIsString=false (defaut) conserve le comportement champ numerique.
    expect(muniWhereClause("code", "79088", false)).toBe("code=79088");
  });
});

describe("zones-obscura --zone-field gate anti-invention (value-based)", () => {
  it("accepte un champ code-zone REEL lettre+numerote (Temiscouata ZONE)", () => {
    const v = validateExplicitZoneField(feats("ZONE", ["EAA-3", "EF-2", "EAB-12", "EAF-6", "EF-1"]), "ZONE");
    expect(v.ok).toBe(true);
    expect(v.stats.distinct).toBe(5);
  });

  it("accepte le champ Sect de VSF (R-4 / MIX-1 / P-2)", () => {
    const v = validateExplicitZoneField(feats("Sect", ["R-4", "R-2", "P-2", "MIX-1", "R-3"]), "Sect");
    expect(v.ok).toBe(true);
  });

  it("accepte le champ ID de Ville-de-Québec collé <n°zone><usage> (21703Mc / 53091Hb)", () => {
    const v = validateExplicitZoneField(feats("ID", ["21703Mc", "53091Hb", "22230Pa", "22301Rb", "53089Ha"]), "ID");
    expect(v.ok).toBe(true);
    expect(v.stats.distinct).toBe(5);
  });

  it("rejette un champ AFFECTATION (TYPE_ZONE = usage en prose)", () => {
    const v = validateExplicitZoneField(feats("TYPE_ZONE", ["Agricole dynamique", "Forestier", "Agroforestier", "Publique"]), "TYPE_ZONE");
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("affectation");
  });

  it("rejette un prefixe categorie NU sans numero (ZONE_ = R/P/MIX)", () => {
    const v = validateExplicitZoneField(feats("ZONE_", ["R", "P", "MIX", "C", "I"]), "ZONE_");
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("affectation");
  });

  it("rejette un champ technique interdit (OBJECTID)", () => {
    const v = validateExplicitZoneField(feats("OBJECTID", [101, 205, 309]), "OBJECTID");
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("interdit");
  });

  it("rejette des entiers sequentiels 1..N (id technique deguise)", () => {
    const v = validateExplicitZoneField(feats("CODE", [1, 2, 3, 4, 5]), "CODE");
    expect(v.ok).toBe(false);
  });

  it("rejette < 3 codes distincts", () => {
    const v = validateExplicitZoneField(feats("ZONE", ["C-1", "C-1", "H-2"]), "ZONE");
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("<3 codes distincts");
  });

  it("rejette zone_code null > 50%", () => {
    const v = validateExplicitZoneField(feats("ZONE", ["C-1", "H-2", "I-3", null, null, null, ""]), "ZONE");
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("null >50%");
  });
});

describe("isNumericZonageBypass — zonage NUMÉRIQUE légitime vs cadastre", () => {
  it("bypass un Num_zone numerique sur couche titree Zonage (cardinalite zonage)", () => {
    // Cas reel saint-pie/saint-jude : field Num_zone, titre Zonage, codes 512/402/103...
    expect(isNumericZonageBypass("Num_zone", "Zonage", 106)).toBe(true);
    expect(isNumericZonageBypass("No_zone", "Zonage municipal", 40)).toBe(true);
  });

  it("REJETTE un champ numerique a cardinalite cadastre (milliers de lots)", () => {
    // Garde anti-cadastre : un role/cadastre porte des milliers de lots distincts.
    expect(isNumericZonageBypass("Num_zone", "Zonage", NUMERIC_ZONAGE_MAX_DISTINCT + 1)).toBe(false);
    expect(isNumericZonageBypass("No_zone", "Zonage", 3000)).toBe(false);
  });

  it("REJETTE quand le titre de couche n'est pas du zonage (cadastre/matrice/affectation)", () => {
    expect(isNumericZonageBypass("Num_zone", "Cadastre", 100)).toBe(false);
    expect(isNumericZonageBypass("Num_zone", "Matrice graphique", 100)).toBe(false);
    expect(isNumericZonageBypass("Num_zone", "Affectation du sol", 100)).toBe(false);
  });

  it("REJETTE quand le champ n'est pas un identifiant de zone (OBJECTID, champ technique)", () => {
    expect(isNumericZonageBypass("OBJECTID", "Zonage", 100)).toBe(false);
    expect(isNumericZonageBypass("Shape_Area", "Zonage", 100)).toBe(false);
  });

  it("REJETTE en dessous de 3 codes distincts", () => {
    expect(isNumericZonageBypass("Num_zone", "Zonage", 2)).toBe(false);
  });
});
