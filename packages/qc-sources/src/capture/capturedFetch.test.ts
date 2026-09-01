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
  type CaptureRequestInit,
} from "./capturedFetch.js";
import {
  assertCasKeyMatchesBytes,
  assertCasKeyMatchesSha256,
  assertCaptureWritableKey,
  CAPTURE_LANES,
  buildCaptureRunId,
  captureProofFields,
  captureRunKeys,
  CaptureManifestLineSchema,
  isCaptureWritableKey,
  parseManifestJsonl,
  redactCaptureLog,
  redactUrlForManifest,
} from "./manifest.js";
import { captureWorklist } from "./worklist.js";

// ─────────────────────────────────────────────────────────────────────────────
// Doubles de test
// ─────────────────────────────────────────────────────────────────────────────

/** Faux stockage objet : une Map. Journalise chaque PUT pour les assertions. */
function fakeStore(): CaptureObjectStore & {
  objects: Map<string, { body: Uint8Array | string; contentType?: string }>;
  puts: string[];
  heads: string[];
  copies: Array<{ source: string; destination: string }>;
  deletes: string[];
} {
  const objects = new Map<string, { body: Uint8Array | string; contentType?: string }>();
  const puts: string[] = [];
  const heads: string[] = [];
  const copies: Array<{ source: string; destination: string }> = [];
  const deletes: string[] = [];
  return {
    objects,
    puts,
    heads,
    copies,
    deletes,
    head: async (key) => {
      heads.push(key);
      return objects.has(key);
    },
    put: async (key, body, contentType) => {
      puts.push(key);
      objects.set(key, { body, ...(contentType !== undefined ? { contentType } : {}) });
    },
    putStream: async (key, body, contentType) => {
      puts.push(key);
      const chunks: Uint8Array[] = [];
      for await (const chunk of body) chunks.push(chunk);
      const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      objects.set(key, { body: bytes, ...(contentType !== undefined ? { contentType } : {}) });
    },
    copy: async (source, destination) => {
      copies.push({ source, destination });
      const object = objects.get(source);
      if (!object) throw new Error(`source de copie absente: ${source}`);
      objects.set(destination, { ...object });
    },
    delete: async (key) => {
      deletes.push(key);
      objects.delete(key);
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

function streamingHttpResponse(opts: {
  body: readonly Uint8Array[];
  headers?: Record<string, string>;
}): CaptureHttpResponse {
  return {
    status: 200,
    ok: true,
    headers: headersOf(opts.headers ?? {}),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of opts.body) controller.enqueue(chunk);
        controller.close();
      },
    }),
    arrayBuffer: async () => {
      throw new Error("arrayBuffer must not be called by the streaming capture path");
    },
  };
}

/** Répond selon une table URL → réponse ; enregistre les URL réellement appelées. */
function fakeFetch(
  table: Record<string, CaptureHttpResponse | (() => Promise<CaptureHttpResponse>)>,
): CaptureFetchLike & { calls: string[]; inits: Array<CaptureRequestInit | undefined> } {
  const calls: string[] = [];
  const inits: Array<CaptureRequestInit | undefined> = [];
  const impl = async (url: string, init?: CaptureRequestInit): Promise<CaptureHttpResponse> => {
    calls.push(url);
    inits.push(init);
    const hit = table[url];
    if (!hit) throw new Error(`fakeFetch: URL non prévue ${url}`);
    return typeof hit === "function" ? hit() : hit;
  };
  return Object.assign(impl, { calls, inits });
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

  it("accepts the dedicated constraints capture lane", () => {
    expect(CAPTURE_LANES).toContain("constraints");
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
    expect(() => assertCasKeyMatchesSha256(good, sha256Hex(body))).not.toThrow();
    expect(() => assertCasKeyMatchesSha256(good, "0".repeat(64))).toThrow(/clé CAS mensongère/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Succès
// ─────────────────────────────────────────────────────────────────────────────

describe("capturedFetch — succès", () => {
  it("injecte l'UA du run, sans écraser un header User-Agent explicite", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://exemple.qc.ca/zones.geojson";
    const fetchImpl = fakeFetch({
      [url]: httpResponse({ body: GEOJSON, headers: { "content-type": "application/json" } }),
    });

    await capturedFetch(url, undefined, { run, source: "zones-arcgis", fetchImpl });
    await capturedFetch(url, { headers: { "User-Agent": "caller-configured/1.0" } }, {
      run,
      source: "zones-arcgis",
      fetchImpl,
    });

    expect(fetchImpl.inits[0]?.headers?.["user-agent"]).toBe(run.userAgent);
    expect(fetchImpl.inits[1]?.headers?.["User-Agent"]).toBe("caller-configured/1.0");
  });

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

  it("pompe un gros corps en flux vers un spool de run puis promeut le CAS sans arrayBuffer", async () => {
    const store = fakeStore();
    const run = newRun(store, "reglement-20260726T120000Z-0");
    const url = "https://ville.example/reglements/urbanisme.pdf";
    const chunks = [
      new TextEncoder().encode("%PDF-1.7 "),
      new Uint8Array(32 * 1024).fill(0x61),
      new TextEncoder().encode(" fin"),
    ];
    const response = streamingHttpResponse({
      body: chunks,
      headers: { "content-type": "application/pdf" },
    });

    const res = await capturedFetch(url, undefined, {
      run,
      source: "reglement-mrc",
      lane: "reglement",
      retainBody: false,
      fetchImpl: fakeFetch({ [url]: response }),
    });

    const expected = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      expected.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const casKey = `raw/reglement-mrc/cas/${sha256Hex(expected)}.pdf`;
    expect(res).toMatchObject({ ok: true, bytes: null });
    expect(res.line).toMatchObject({
      bytes: expected.byteLength,
      sha256: `sha256:${sha256Hex(expected)}`,
      storage_key: casKey,
      dedup: false,
      error: null,
    });
    expect(store.copies).toHaveLength(1);
    expect(store.copies[0]).toMatchObject({ destination: casKey });
    expect(store.copies[0]!.source).toMatch(
      /^capture\/_runs\/reglement-20260726T120000Z-0\/spool\/[0-9a-f-]+\.body$/,
    );
    expect(store.deletes).toEqual([store.copies[0]!.source]);
    expect(store.objects.has(store.copies[0]!.source)).toBe(false);
    expect(Array.from(store.objects.get(casKey)!.body as Uint8Array)).toEqual(Array.from(expected));
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

  it("répare le sidecar absent d'un CAS dédupliqué", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://mrc-a.qc.ca/certificat.pdf";
    const pdf = "%PDF-1.7 déjà présent";
    const casKey = `raw/reglement-mrc/cas/${sha256Hex(new TextEncoder().encode(pdf))}.pdf`;
    // Simule le crash exactement entre le PUT du CAS et celui du sidecar.
    store.objects.set(casKey, { body: new TextEncoder().encode(pdf), contentType: "application/pdf" });

    const res = await capturedFetch(url, undefined, {
      run,
      source: "reglement-mrc",
      fetchImpl: fakeFetch({ [url]: httpResponse({ body: pdf, headers: { "content-type": "application/pdf" } }) }),
    });

    expect(res.line.dedup).toBe(true);
    expect(store.puts.filter((key) => key === casKey)).toHaveLength(0);
    expect(store.puts).toContain(`${casKey}.meta.json`);
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
    const sidecar = [...store.objects.entries()].find(([key]) => key.endsWith(".meta.json"));
    expect(JSON.stringify(sidecar?.[1].body)).not.toContain("SECRET123");
    // Une URL rédigée n'est pas re-téléchargeable ⇒ pas de preuve v2.
    expect(() => captureProofFields(res.line)).toThrow(/NE PEUT PAS servir de preuve v2/);
  });

  it("redactUrlForManifest laisse intacte une URL sans secret", () => {
    const u = "https://geoserver.geocentralis.com/geoserver/ows?service=WFS&typeName=evb%3Ax";
    expect(redactUrlForManifest(u)).toEqual({ url: u, redacted: false });
  });

  it("rédige aussi un token OAuth porté par le fragment", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://exemple.qc.ca/zones#access_token=fragment-secret&state=ok";
    const res = await capturedFetch(url, undefined, {
      run,
      source: "zones-wfs",
      fetchImpl: fakeFetch({ [url]: httpResponse({ body: GEOJSON, headers: { "content-type": "application/json" } }) }),
    });
    const persisted = JSON.stringify(res.line);
    expect(persisted).not.toContain("fragment-secret");
    expect(res.line.redacted).toBe(true);
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

  it("un dry-run sans CAS durable ne produit AUCUNE preuve", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://exemple.qc.ca/dry.json";
    const res = await capturedFetch(url, undefined, {
      run,
      source: "zones-wfs",
      store: false,
      fetchImpl: fakeFetch({ [url]: httpResponse({ body: GEOJSON, headers: { "content-type": "application/json" } }) }),
    });
    expect(res.line.sha256).not.toBeNull();
    expect(res.line.storage_key).toBeNull();
    expect(() => captureProofFields(res.line)).toThrow(/CAS durables/);
  });

  it("rédige les URL et affectations secrètes avant persistance dans run.log", () => {
    const raw = [
      "GET https://exemple.qc.ca/a?token=super-secret API_KEY=top-secret status=200",
      "Authorization: Bearer header-secret",
      "Cookie: session=cookie-secret; other=also-secret",
      '{"token":"json-secret"}',
    ].join("\n");
    const redacted = redactCaptureLog(raw);
    expect(redacted).not.toContain("super-secret");
    expect(redacted).not.toContain("top-secret");
    expect(redacted).not.toContain("header-secret");
    expect(redacted).not.toContain("cookie-secret");
    expect(redacted).not.toContain("json-secret");
    expect(redacted).toContain("<redacted>");
  });

  it("rédige une erreur de transport avant de la déposer dans le manifeste", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const url = "https://exemple.qc.ca/zones?token=url-secret";
    const fetchImpl: CaptureFetchLike = async () => {
      throw new Error("Authorization: Bearer transport-secret; token=error-secret");
    };
    const res = await capturedFetch(url, undefined, { run, source: "zones-wfs", fetchImpl });
    const persisted = JSON.stringify(res.line);
    expect(persisted).not.toContain("url-secret");
    expect(persisted).not.toContain("transport-secret");
    expect(persisted).not.toContain("error-secret");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Worklist — l'entrée générique des Jobs cluster
// ─────────────────────────────────────────────────────────────────────────────

describe("captureWorklist", () => {
  it("traite un lot séquentiellement, conserve succès + 404 et dépose le log de run", async () => {
    const store = fakeStore();
    const run = newRun(store);
    const okUrl = "https://services3.arcgis.com/abc/zones?f=geojson";
    const missingUrl = "https://ville.qc.ca/absent.json";
    const result = await captureWorklist({
      run,
      targets: [
        { slug: "mont-saint-hilaire", source: "zones-arcgis", urls: [okUrl] },
        { slug: "saint-frederic", source: "zones-arcgis", urls: [missingUrl] },
      ],
      delayMs: 0,
      wait: async () => undefined,
      fetchImpl: fakeFetch({
        [okUrl]: httpResponse({ body: GEOJSON, headers: { "content-type": "application/json" } }),
        [missingUrl]: httpResponse({ status: 404 }),
      }),
    });
    await run.finish(0);

    expect(result).toEqual({ selectedTargets: 2, attempted: 2, succeeded: 1, failed: 1, durable: 1 });
    const lines = parseManifestJsonl(String(store.objects.get(run.keys.manifest)!.body));
    expect(lines).toHaveLength(2);
    expect(lines[0]!.storage_key).toMatch(/^raw\/zones-arcgis\/cas\//);
    expect(lines[1]).toMatchObject({ http_status: 404, sha256: null, storage_key: null });
    expect(store.puts.every((key) => key.startsWith("raw/") || key.startsWith("capture/_runs/"))).toBe(true);
    expect(String(store.objects.get(run.keys.log)!.body)).toMatch(/capture-worklist.*done/);
  });
});
