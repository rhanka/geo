/**
 * Tests du CHOKEPOINT DE CAPTURE — faux fetch + faux client de stockage.
 * AUCUN réseau, AUCUNE I/O S3 réelle (le store est une Map en mémoire).
 */
import { describe, expect, it } from "vitest";

import { sha256Hex } from "../RawDocument.js";
import { CaptureRun, type CaptureObjectStore } from "./capture-run.js";
import {
  capturedFetch,
  capturedFetchOrThrow,
  capturedText,
  CapturedFetchError,
  type CaptureFetchLike,
  type CaptureHttpResponse,
} from "./capturedFetch.js";
import {
  assertCasKeyMatchesBytes,
  assertCaptureWritableKey,
  buildCaptureRunId,
  captureProofFields,
  captureRunKeys,
  CaptureManifestLineSchema,
  isCaptureWritableKey,
  parseManifestJsonl,
  redactUrlForManifest,
} from "./manifest.js";

// ─────────────────────────────────────────────────────────────────────────────
// Doubles de test
// ─────────────────────────────────────────────────────────────────────────────

/** Faux stockage objet : une Map. Journalise chaque PUT pour les assertions. */
function fakeStore(): CaptureObjectStore & {
  objects: Map<string, { body: Uint8Array | string; contentType?: string }>;
  puts: string[];
  heads: string[];
} {
  const objects = new Map<string, { body: Uint8Array | string; contentType?: string }>();
  const puts: string[] = [];
  const heads: string[] = [];
  return {
    objects,
    puts,
    heads,
    head: async (key) => {
      heads.push(key);
      return objects.has(key);
    },
    put: async (key, body, contentType) => {
      puts.push(key);
      objects.set(key, { body, ...(contentType !== undefined ? { contentType } : {}) });
    },
  };
}

function headersOf(map: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string): string | null => lower.get(name.toLowerCase()) ?? null };
}

function httpResponse(opts: {
  status?: number;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
  url?: string;
}): CaptureHttpResponse {
  const status = opts.status ?? 200;
  const raw = opts.body ?? "";
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
  return {
    status,
    ok: status >= 200 && status < 300,
    ...(opts.url !== undefined ? { url: opts.url } : {}),
    headers: headersOf(opts.headers ?? {}),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

/** Répond selon une table URL → réponse ; enregistre les URL réellement appelées. */
function fakeFetch(
  table: Record<string, CaptureHttpResponse | (() => Promise<CaptureHttpResponse>)>,
): CaptureFetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = async (url: string): Promise<CaptureHttpResponse> => {
    calls.push(url);
    const hit = table[url];
    if (!hit) throw new Error(`fakeFetch: URL non prévue ${url}`);
    return typeof hit === "function" ? hit() : hit;
  };
  return Object.assign(impl, { calls });
}

function newRun(store: CaptureObjectStore, runId = "zones-20260725T120000Z-0"): CaptureRun {
  return new CaptureRun({
    runId,
    lane: "zones",
    store,
    userAgent: "sentropic-geo/0.1",
    echo: null,
  });
}

const GEOJSON = '{"type":"FeatureCollection","features":[]}';

// ─────────────────────────────────────────────────────────────────────────────
// Identité du run / clés
// ─────────────────────────────────────────────────────────────────────────────

describe("identité du run", () => {
  it("construit un run-id <lane>-<YYYYMMDDTHHMMSSZ>-<shard> triable", () => {
    const id = buildCaptureRunId("zones", { now: new Date("2026-07-25T12:34:56.789Z"), shard: 2 });
    expect(id).toBe("zones-20260725T123456Z-2");
    expect(buildCaptureRunId("normes", { now: new Date("2026-07-25T12:34:56Z") })).toBe(
      "normes-20260725T123456Z-0",
    );
  });

  it("place manifest/log/run.json sous capture/_runs/<run-id>/", () => {
    expect(captureRunKeys("zones-20260725T123456Z-0")).toEqual({
      manifest: "capture/_runs/zones-20260725T123456Z-0/manifest.jsonl",
      log: "capture/_runs/zones-20260725T123456Z-0/run.log",
      header: "capture/_runs/zones-20260725T123456Z-0/run.json",
    });
  });

  it("n'ouvre que les préfixes raw/ et capture/_runs/", () => {
    expect(isCaptureWritableKey("raw/zones-arcgis/cas/" + "a".repeat(64) + ".json")).toBe(true);
    expect(isCaptureWritableKey("capture/_runs/x/manifest.jsonl")).toBe(true);
    expect(isCaptureWritableKey("normalized/ca-qc-zonage/qc-zonage-alma.geojson")).toBe(false);
    expect(() => assertCaptureWritableKey("normalized/ca-qc-zonage/qc-zonage-alma.geojson")).toThrow(
      /hors des préfixes de capture/,
    );
  });

  it("refuse une clé CAS qui ment sur ses octets", () => {
    const body = new TextEncoder().encode(GEOJSON);
    const good = `raw/zones-arcgis/cas/${sha256Hex(body)}.json`;
    expect(() => assertCasKeyMatchesBytes(good, body)).not.toThrow();
    expect(() => assertCasKeyMatchesBytes(`raw/zones-arcgis/cas/${"0".repeat(64)}.json`, body)).toThrow(
      /clé CAS mensongère/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Succès
// ─────────────────────────────────────────────────────────────────────────────

describe("capturedFetch — succès", () => {
  it("dépose les octets en CAS, écrit le .meta.json et journalise une ligne bien formée", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://services5.arcgis.com/abc/FeatureServer/6/query?f=geojson";
    const fetchImpl = fakeFetch({
      [url]: httpResponse({ body: GEOJSON, headers: { "content-type": "application/json" } }),
    });

    const res = await capturedFetch(url, undefined, {
      run,
      source: "zones-arcgis",
      slugs: ["mont-saint-hilaire"],
      fetchImpl,
    });

    expect(res.ok).toBe(true);
    expect(capturedText(res)).toBe(GEOJSON);

    const sha = sha256Hex(new TextEncoder().encode(GEOJSON));
    const casKey = `raw/zones-arcgis/cas/${sha}.json`;
    expect(store.puts).toContain(casKey);
    expect(store.puts).toContain(`${casKey}.meta.json`);

    // La ligne de manifeste porte les 4 faits que rien n'enregistrait jusqu'ici.
    const line = res.line;
    expect(CaptureManifestLineSchema.safeParse(line).success).toBe(true);
    expect(line).toMatchObject({
      run_id: "zones-20260725T120000Z-0",
      lane: "zones",
      source: "zones-arcgis",
      slugs: ["mont-saint-hilaire"],
      url,
      method: "GET",
      attempt: 1,
      http_status: 200,
      redirect_chain: [],
      content_type: "application/json",
      bytes: GEOJSON.length,
      sha256: `sha256:${sha}`,
      storage_key: casKey,
      dedup: false,
      error: null,
      via_obscura: false,
      egress: "direct",
      robots: "unknown",
      redacted: false,
    });
    expect(line.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(line.retrieved_at!)).toBeGreaterThanOrEqual(Date.parse(line.requested_at));

    // Le .meta.json est bien un RawDocumentRecord complet.
    const meta = JSON.parse(String(store.objects.get(`${casKey}.meta.json`)!.body)) as {
      sourceUrl: string;
      sha256: string;
      storageKey: string;
      provenance: { userAgent: string; viaObscura: boolean };
    };
    expect(meta).toMatchObject({
      sourceUrl: url,
      sha256: sha,
      storageKey: casKey,
      provenance: { userAgent: "sentropic-geo/0.1", viaObscura: false },
    });
  });

  it("écrit manifest.jsonl et run.log sous le run, et run.json à la clôture", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://exemple.qc.ca/a.json";
    await capturedFetch(url, undefined, {
      run,
      source: "zones-arcgis",
      fetchImpl: fakeFetch({
        [url]: httpResponse({ body: GEOJSON, headers: { "content-type": "application/json" } }),
      }),
    });
    const header = await run.finish(0);

    const manifest = String(store.objects.get(run.keys.manifest)!.body);
    const lines = parseManifestJsonl(manifest);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.url).toBe(url);
    expect(manifest.endsWith("\n")).toBe(true);

    expect(String(store.objects.get(run.keys.log)!.body)).toMatch(/\[capture\] OK 200 GET/);
    expect(header).toMatchObject({
      run_id: run.runId,
      lane: "zones",
      execution: "local",
      exit_code: 0,
      counts: { attempts: 1, ok: 1, failed: 0, dedup: 0, bytes: GEOJSON.length },
    });
    expect(JSON.parse(String(store.objects.get(run.keys.header)!.body))).toMatchObject({
      run_id: run.runId,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Échecs — la ligne DOIT exister quand même
// ─────────────────────────────────────────────────────────────────────────────

describe("capturedFetch — échecs journalisés", () => {
  it("404 : pas d'octets, pas de clé CAS, mais une ligne qui documente l'épuisement", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://exemple.qc.ca/absent.pdf";
    const res = await capturedFetch(url, undefined, {
      run,
      source: "reglement-mrc",
      lane: "reglement",
      slugs: ["saint-frederic"],
      fetchImpl: fakeFetch({ [url]: httpResponse({ status: 404, headers: { "content-type": "text/html" } }) }),
    });

    expect(res.ok).toBe(false);
    expect(res.bytes).toBeNull();
    expect(res.record).toBeNull();
    expect(store.puts.filter((k) => k.startsWith("raw/"))).toHaveLength(0);
    expect(res.line).toMatchObject({
      lane: "reglement",
      http_status: 404,
      retrieved_at: null,
      sha256: null,
      storage_key: null,
      dedup: null,
      error: "HTTP 404",
    });
    expect(run.manifestLines()).toHaveLength(1);
  });

  it("timeout / DNS : http_status null, erreur normalisée, ligne présente", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://injoignable.qc.ca/zones.json";
    const impl: CaptureFetchLike = async () => {
      const e = new Error("The operation was aborted");
      e.name = "AbortError";
      throw e;
    };
    const res = await capturedFetch(url, undefined, { run, source: "zones-wfs", fetchImpl: impl });

    expect(res.ok).toBe(false);
    expect(res.response).toBeNull();
    expect(res.line).toMatchObject({
      http_status: null,
      retrieved_at: null,
      sha256: null,
      storage_key: null,
      error: "timeout: The operation was aborted",
    });
    expect(parseManifestJsonl(String(store.objects.get(run.keys.manifest)!.body))).toHaveLength(1);
  });

  it("robots.txt disallow : aucun fetch émis, ligne robots=disallowed", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://exemple.qc.ca/prive/zones.json";
    const impl = fakeFetch({});
    const res = await capturedFetch(url, undefined, {
      run,
      source: "zones-arcgis",
      fetchImpl: impl,
      robots: { isAllowed: async () => false },
    });
    expect(impl.calls).toHaveLength(0);
    expect(res.ok).toBe(false);
    expect(res.line).toMatchObject({ robots: "disallowed", error: "robots-disallowed", http_status: null });
  });

  it("capturedFetchOrThrow lance APRÈS avoir journalisé la ligne", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://exemple.qc.ca/403.pdf";
    await expect(
      capturedFetchOrThrow(url, undefined, {
        run,
        source: "reglement-mrc",
        lane: "reglement",
        fetchImpl: fakeFetch({ [url]: httpResponse({ status: 403 }) }),
      }),
    ).rejects.toBeInstanceOf(CapturedFetchError);
    expect(run.manifestLines()).toHaveLength(1);
    expect(run.manifestLines()[0]!.error).toBe("HTTP 403");
  });

  it("plafonne la taille par objet (MAX_BYTES) sans rien déposer", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://exemple.qc.ca/gros.pdf";
    const res = await capturedFetch(url, undefined, {
      run,
      source: "normes-grille",
      lane: "normes",
      maxBytes: 4,
      fetchImpl: fakeFetch({ [url]: httpResponse({ body: "0123456789" }) }),
    });
    expect(res.ok).toBe(false);
    expect(store.puts.filter((k) => k.startsWith("raw/"))).toHaveLength(0);
    expect(res.line.error).toMatch(/^max-bytes-exceeded: 10 > 4$/);
    expect(res.line.bytes).toBe(10);
    expect(res.line.sha256).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Redirections
// ─────────────────────────────────────────────────────────────────────────────

describe("capturedFetch — redirections", () => {
  it("suit les Location et journalise la chaîne", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const a = "http://exemple.qc.ca/zones";
    const b = "https://www.exemple.qc.ca/zones";
    const c = "https://www.exemple.qc.ca/zones.json";
    const impl = fakeFetch({
      [a]: httpResponse({ status: 301, headers: { location: b } }),
      [b]: httpResponse({ status: 302, headers: { location: "/zones.json" } }),
      [c]: httpResponse({ body: GEOJSON, headers: { "content-type": "application/json" }, url: c }),
    });
    const res = await capturedFetch(a, undefined, { run, source: "zones-arcgis", fetchImpl: impl });

    expect(res.ok).toBe(true);
    expect(impl.calls).toEqual([a, b, c]);
    // `url` reste le point d'entrée demandé ; la chaîne dit ce qui a été traversé.
    expect(res.line.url).toBe(a);
    expect(res.line.redirect_chain).toEqual([b, c]);
    expect(res.line.final_url).toBe(c);
    expect(res.line.http_status).toBe(200);
  });

  it("échoue proprement sur une boucle de redirection", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const a = "https://exemple.qc.ca/a";
    const impl = fakeFetch({ [a]: httpResponse({ status: 302, headers: { location: a } }) });
    const res = await capturedFetch(a, undefined, {
      run,
      source: "zones-arcgis",
      fetchImpl: impl,
      maxRedirects: 2,
    });
    expect(res.ok).toBe(false);
    expect(res.line.error).toMatch(/too many redirects/);
    expect(res.line.redirect_chain).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Déduplication CAS
// ─────────────────────────────────────────────────────────────────────────────

describe("capturedFetch — dédup CAS", () => {
  it("HEAD-skip : les mêmes octets ne sont PUT qu'une fois, même depuis 2 URL", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const u1 = "https://mrc-a.qc.ca/certificat.pdf";
    const u2 = "https://mrc-b.qc.ca/copie-certificat.pdf";
    const pdf = "%PDF-1.7 identique";
    const impl = fakeFetch({
      [u1]: httpResponse({ body: pdf, headers: { "content-type": "application/pdf" } }),
      [u2]: httpResponse({ body: pdf, headers: { "content-type": "application/pdf" } }),
    });
    const ctx = { run, source: "reglement-mrc", lane: "reglement" as const, fetchImpl: impl };

    const first = await capturedFetch(u1, undefined, { ...ctx, slugs: ["ville-a"] });
    const second = await capturedFetch(u2, undefined, { ...ctx, slugs: ["ville-b"] });

    const casKey = `raw/reglement-mrc/cas/${sha256Hex(new TextEncoder().encode(pdf))}.pdf`;
    expect(first.line.storage_key).toBe(casKey);
    expect(second.line.storage_key).toBe(casKey);
    expect(first.line.dedup).toBe(false);
    expect(second.line.dedup).toBe(true);
    // Un seul jeu d'octets stocké, mais DEUX lignes de manifeste : le contexte
    // (slug, url, instant) est multivalué, l'identité ne l'est pas.
    expect(store.puts.filter((k) => k === casKey)).toHaveLength(1);
    expect(run.manifestLines()).toHaveLength(2);
    expect(run.manifestLines().map((l) => l.slugs)).toEqual([["ville-a"], ["ville-b"]]);
    // Le sidecar est l'identité de l'objet CAS créé au premier fetch. Il ne
    // devient pas le récit mutable du second fetch : celui-ci vit dans sa ligne
    // de manifeste distincte.
    const sidecar = JSON.parse(String(store.objects.get(`${casKey}.meta.json`)!.body)) as { sourceUrl: string; fetchedAt: string };
    expect(sidecar.sourceUrl).toBe(u1);
    expect(sidecar.fetchedAt).toBe(first.line.retrieved_at);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rédaction des secrets + conversion en preuve v2
// ─────────────────────────────────────────────────────────────────────────────

describe("rédaction et preuve v2", () => {
  it("rédige les paramètres secrets dans le manifeste mais fetch l'URL complète", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://exemple.qc.ca/z.json?token=SECRET123&f=geojson";
    const impl = fakeFetch({
      [url]: httpResponse({ body: GEOJSON, headers: { "content-type": "application/json" } }),
    });
    const res = await capturedFetch(url, undefined, { run, source: "zones-arcgis", fetchImpl: impl });

    expect(impl.calls[0]).toBe(url); // le fetch a bien utilisé l'URL COMPLÈTE
    expect(res.line.url).toBe("https://exemple.qc.ca/z.json?token=%3Credacted%3E&f=geojson");
    expect(res.line.redacted).toBe(true);
    expect(JSON.stringify(res.line)).not.toContain("SECRET123");
    // Une URL rédigée n'est pas re-téléchargeable ⇒ pas de preuve v2.
    expect(() => captureProofFields(res.line)).toThrow(/NE PEUT PAS servir de preuve v2/);
  });

  it("redactUrlForManifest laisse intacte une URL sans secret", () => {
    const u = "https://geoserver.geocentralis.com/geoserver/ows?service=WFS&typeName=evb%3Ax";
    expect(redactUrlForManifest(u)).toEqual({ url: u, redacted: false });
  });

  it("une ligne réussie fournit MÉCANIQUEMENT url + retrieved_at + sha256", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://geoserver.geocentralis.com/geoserver/ows?service=WFS&typeName=evb:pzon";
    const res = await capturedFetch(url, undefined, {
      run,
      source: "zones-wfs",
      fetchImpl: fakeFetch({
        [url]: httpResponse({ body: GEOJSON, headers: { "content-type": "application/json" } }),
      }),
    });
    const fields = captureProofFields(res.line);
    expect(fields.url).toBe(url);
    expect(fields.sha256).toBe(`sha256:${sha256Hex(new TextEncoder().encode(GEOJSON))}`);
    expect(fields.retrieved_at).toBe(res.line.retrieved_at);
    expect(fields.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("un hôte ArcGIS numéroté n'est PAS du stockage objet (label, pas sous-chaîne)", async () => {
    const store = fakeStore();
    const run = newRun(store);
    // `services3.arcgis.com` contient "s3." : le garde anti-stockage-objet le
    // refusait, donc la source SIG publique la moins chère ne pouvait pas
    // produire de preuve v2. Le garde compare désormais les LABELS d'hôte.
    const url = "https://services3.arcgis.com/abc/ArcGIS/rest/services/Zonage/FeatureServer/0/query?f=geojson";
    const res = await capturedFetch(url, undefined, {
      run,
      source: "zones-arcgis",
      fetchImpl: fakeFetch({
        [url]: httpResponse({ body: GEOJSON, headers: { "content-type": "application/json" } }),
      }),
    });
    expect(captureProofFields(res.line).url).toBe(url);
  });

  it("une ligne d'échec ne produit AUCUNE preuve (règle C-2)", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://exemple.qc.ca/404.json";
    const res = await capturedFetch(url, undefined, {
      run,
      source: "zones-wfs",
      fetchImpl: fakeFetch({ [url]: httpResponse({ status: 404 }) }),
    });
    expect(() => captureProofFields(res.line)).toThrow(/aucune preuve v2 dérivable/);
  });
});
