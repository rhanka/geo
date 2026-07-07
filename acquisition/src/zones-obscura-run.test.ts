import { describe, expect, it } from "vitest";

import {
  isNumericMuniValue,
  muniWhereClause,
  normMuniCode,
  resolveMuniValueToTargetSlug,
  resolveMuniValueToSlug,
  validateExplicitZoneField,
} from "./zones-obscura-run.js";

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
