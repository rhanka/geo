import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assertGeometryProof, assertServedZoneGeojson, attachGeometryProof, carryForwardServedZoneProperties, isRealGeometryUrl, isServedZoneKey, proofFromFetched, putServedZoneAdditive, putServedZoneGeojson, putServedZoneGeojsonIfMatch, sameGeometryProof } from "./zonage-proof.js";
import { copyObject, putBytes } from "./s3.js";

describe("served zonage geometry proof", () => {
  it("requires a real HTTP acquisition URL and carries fetch hash", () => {
    expect(isRealGeometryUrl("s3://bucket/a")).toBe(false);
    expect(isRealGeometryUrl("/tmp/a.geojson")).toBe(false);
    const proof = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "source bytes", retrievedAt: "2026-07-22T12:00:00Z" });
    const fc: any = attachGeometryProof({ type: "FeatureCollection", features: [{ properties: { zone_code: "R-1" } }] }, proof);
    expect(fc.proof?.geometry_source.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect((fc.features[0]!.properties!.proof as any).geometry_source.url).toBe(proof.url);
  });
  it("fails closed when proof URL is not HTTP", () => expect(() => proofFromFetched({ url: "method:t2", type: "pdf-zonage", method: "georeference", reliability: "georeferencee", bytes: "x" })).toThrow(/real HTTP/));
  it("rejects object storage by host LABEL, not by substring", () => {
    // Notre stockage : jamais une source amont.
    expect(isRealGeometryUrl("https://s3.amazonaws.com/bucket/zones.geojson")).toBe(false);
    expect(isRealGeometryUrl("https://s3-eu-west-1.amazonaws.com/bucket/z.geojson")).toBe(false);
    expect(isRealGeometryUrl("https://bucket.s3.amazonaws.com/z.geojson")).toBe(false);
    // Régression : `services3.arcgis.com` CONTIENT "s3." et était refusé — la
    // source SIG publique la moins chère pour une preuve v2 l'était donc aussi.
    expect(isRealGeometryUrl("https://services3.arcgis.com/x/ArcGIS/rest/services/Zonage/FeatureServer/0/query?f=geojson")).toBe(true);
    expect(isRealGeometryUrl("https://services1.arcgis.com/x/ArcGIS/rest/services/Z/FeatureServer/0/query")).toBe(true);
  });
  it("rejects unsupported or incoherent runtime proof values", () => {
    const base = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "x", retrievedAt: "2026-07-22T12:00:00Z" });
    expect(() => assertGeometryProof({ ...base, type: "invented" })).toThrow(/invalid geometry/);
    expect(() => assertGeometryProof({ ...base, reliability: "georeferencee" })).toThrow(/invalid geometry/);
    expect(() => assertGeometryProof({ ...base, retrieved_at: "not-a-date" })).toThrow(/invalid geometry/);
    expect(() => assertGeometryProof({ ...base, retrieved_at: "2026-07-22" })).toThrow(/invalid geometry/);
  });
  it("requires feature proof to match the exact collection proof", () => {
    const a = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "a", retrievedAt: "2026-07-22T12:00:00Z" });
    const b = { ...a, sha256: `sha256:${"b".repeat(64)}` as const };
    expect(sameGeometryProof(a, a)).toBe(true);
    expect(sameGeometryProof(a, b)).toBe(false);
  });
  it("recognizes only exact flat or mirrored nested served keys", () => {
    expect(isServedZoneKey("normalized/ca-qc-zonage/qc-zonage-alpha.geojson")).toBe(true);
    expect(isServedZoneKey("normalized/ca-qc-zonage/qc-zonage-alpha/qc-zonage-alpha.geojson")).toBe(true);
    expect(isServedZoneKey("normalized/ca-qc-zonage/qc-zonage-alpha.contour-auto-preclip.geojson")).toBe(false);
    expect(isServedZoneKey("normalized/ca-qc-zonage/qc-zonage-alpha/qc-zonage-beta.geojson")).toBe(false);
  });
  it("rejects empty collections and mismatched feature proof before S3", () => {
    const p = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "x", retrievedAt: "2026-07-22T12:00:00Z" });
    expect(() => assertServedZoneGeojson("normalized/ca-qc-zonage/qc-zonage-alpha.geojson", attachGeometryProof({ type: "FeatureCollection", features: [] }, p))).toThrow(/empty/);
    const fc: any = attachGeometryProof({ type: "FeatureCollection", features: [{ properties: {} }] }, p);
    fc.features[0].properties.proof.geometry_source.sha256 = `sha256:${"c".repeat(64)}`;
    expect(() => assertServedZoneGeojson("normalized/ca-qc-zonage/qc-zonage-alpha.geojson", fc)).toThrow(/differs/);
  });
  it("blocks generic put/copy bypasses and sends only a validated served write", async () => {
    const sent: unknown[] = [];
    const s3 = { send: async (command: unknown) => { sent.push(command); return {}; } } as any;
    const key = "normalized/ca-qc-zonage/qc-zonage-alpha.geojson";
    await expect(putBytes(s3, key, "{}", "application/geo+json")).rejects.toThrow(/direct served/);
    await expect(copyObject(s3, "backup.geojson", key)).rejects.toThrow(/destination proof/);
    expect(sent).toHaveLength(0);
    const p = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "x", retrievedAt: "2026-07-22T12:00:00Z" });
    const fc = attachGeometryProof({ type: "FeatureCollection" as const, features: [{ properties: { zone_code: "R-1" } }] }, p);
    // This is a first deposit: the loss gate must not read a non-existent object.
    const { s3: freshS3, sent: freshSent } = fakeS3(null, { missing: true });
    await putServedZoneGeojson(freshS3, key, fc);
    expect(freshSent.filter((c) => c.name === PUT)).toHaveLength(1);
  });

  it("refuses a geometry replacement that drops existing enrichment keys before S3 write", async () => {
    const p = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "x", retrievedAt: "2026-07-22T12:00:00Z" });
    const served = attachGeometryProof({
      type: "FeatureCollection" as const,
      features: [{ geometry: { type: "Point", coordinates: [0, 0] }, properties: { zone_code: "R-1", reglement_numero: "123", hauteur_max_value: 12 } }],
    }, p);
    const replacement = attachGeometryProof({
      type: "FeatureCollection" as const,
      features: [{ geometry: { type: "Point", coordinates: [1, 1] }, properties: { zone_code: "R-1" } }],
    }, p);
    const { s3, sent } = fakeS3(served);

    await expect(putServedZoneGeojson(s3, KEY, replacement)).rejects.toThrow(/would remove served property key\(s\): hauteur_max_value, reglement_numero/);
    expect(sent.some((c) => c.name === PUT)).toBe(false);
  });

  it("allows a geometry replacement when the existing property-key contract is retained", async () => {
    const p = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "x", retrievedAt: "2026-07-22T12:00:00Z" });
    const served = attachGeometryProof({
      type: "FeatureCollection" as const,
      features: [{ geometry: { type: "Point", coordinates: [0, 0] }, properties: { zone_code: "R-1", reglement_numero: "123" } }],
    }, p);
    const replacement = attachGeometryProof({
      type: "FeatureCollection" as const,
      features: [{ geometry: { type: "Point", coordinates: [1, 1] }, properties: { zone_code: "R-1", reglement_numero: "123" } }],
    }, p);
    const { s3, sent } = fakeS3(served);

    await putServedZoneGeojson(s3, KEY, replacement);
    expect(sent.filter((c) => c.name === PUT)).toHaveLength(1);
  });

  it("uses the preflight ETag as a compare-and-swap for a served replacement", async () => {
    const p = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "x", retrievedAt: "2026-07-22T12:00:00Z" });
    const served = attachGeometryProof({
      type: "FeatureCollection" as const,
      features: [{ geometry: { type: "Point", coordinates: [0, 0] }, properties: { zone_code: "R-1" } }],
    }, p);
    const replacement = attachGeometryProof({
      type: "FeatureCollection" as const,
      features: [{ geometry: { type: "Point", coordinates: [1, 1] }, properties: { zone_code: "R-1" } }],
    }, p);
    const { s3, sent } = fakeS3(served, { etag: "\"etag-before\"" });

    await putServedZoneGeojsonIfMatch(s3, KEY, replacement, "\"etag-before\"");

    const put = sent.find((command) => command.name === PUT)!;
    expect(put.input.IfMatch).toBe("\"etag-before\"");
  });

  it("refuses a served replacement when the ETag changed before validation", async () => {
    const p = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "x", retrievedAt: "2026-07-22T12:00:00Z" });
    const served = attachGeometryProof({
      type: "FeatureCollection" as const,
      features: [{ geometry: { type: "Point", coordinates: [0, 0] }, properties: { zone_code: "R-1" } }],
    }, p);
    const replacement = attachGeometryProof({
      type: "FeatureCollection" as const,
      features: [{ geometry: { type: "Point", coordinates: [1, 1] }, properties: { zone_code: "R-1" } }],
    }, p);
    const { s3, sent } = fakeS3(served, { etag: "\"etag-after\"" });

    await expect(putServedZoneGeojsonIfMatch(s3, KEY, replacement, "\"etag-before\"")).rejects.toThrow(/ETag changed before validation/);
    expect(sent.some((command) => command.name === PUT)).toBe(false);
  });

  it("carries old-only properties only to freshly acquired features with the same zone code", () => {
    const incoming = [
      { properties: { zone_code: "R-1", kind: "fresh" } },
      { properties: { zone_code: "C-2", kind: "fresh" } },
    ];
    const result = carryForwardServedZoneProperties(
      incoming,
      [{ properties: { zone_code: "r 1", reglement_numero: "123", kind: "old" } }],
      (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
    );

    expect(result).toEqual({ matched: 1, unmatched: 1 });
    expect(incoming[0]!.properties).toEqual({ zone_code: "R-1", reglement_numero: "123", kind: "fresh" });
    expect(incoming[1]!.properties).toEqual({ zone_code: "C-2", kind: "fresh" });
  });
  // ── P0 regression: the "safe" deposit route used to accept a served collection
  // whose features carried NO source stamp at all (proof v2 only). Every served
  // feature must state its source; only an EXPLICIT null is an acceptable "none".
  it("refuses a deposit whose feature has no zone_source_url field at all", async () => {
    const { s3, sent } = fakeS3(null, { missing: true });
    const p = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "x", retrievedAt: "2026-07-22T12:00:00Z" });
    const fc: any = attachGeometryProof({ type: "FeatureCollection", features: [{ properties: { zone_code: "R-1" } }] }, p);
    delete fc.features[0].properties.zone_source_url;
    expect(() => assertServedZoneGeojson(KEY, fc)).toThrow(/carries no "zone_source_url"/);
    await expect(putServedZoneGeojson(s3, KEY, fc)).rejects.toThrow(/carries no "zone_source_url"/);
    expect(sent.some((c) => c.name === PUT)).toBe(false);
  });

  it("accepts an EXPLICIT null zone_source_url with a valid level (honest null, never a fabricated URL)", async () => {
    const { s3, sent } = fakeS3(null, { missing: true });
    const p = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "x", retrievedAt: "2026-07-22T12:00:00Z" });
    const fc = attachGeometryProof({ type: "FeatureCollection" as const, features: [{ properties: { zone_code: "R-1" } }] }, p, { url: null, level: "orphan" });
    expect((fc.features[0]!.properties as any).zone_source_url).toBeNull();
    await putServedZoneGeojson(s3, KEY, fc);
    expect(sent.filter((c) => c.name === PUT)).toHaveLength(1);
  });

  it("refuses a zone_source_level outside the served vocabulary (and a missing one)", async () => {
    const { s3, sent } = fakeS3(null);
    const p = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "x", retrievedAt: "2026-07-22T12:00:00Z" });
    const fc: any = attachGeometryProof({ type: "FeatureCollection", features: [{ properties: { zone_code: "R-1" } }] }, p);
    fc.features[0].properties.zone_source_level = "directe"; // proof reliability, NOT a source level
    expect(() => assertServedZoneGeojson(KEY, fc)).toThrow(/outside the served vocabulary/);
    await expect(putServedZoneGeojson(s3, KEY, fc)).rejects.toThrow(/outside the served vocabulary/);
    delete fc.features[0].properties.zone_source_level;
    expect(() => assertServedZoneGeojson(KEY, fc)).toThrow(/carries no "zone_source_level"/);
    // the stamping helper itself fails closed on an invented level / fabricated URL
    expect(() => attachGeometryProof({ type: "FeatureCollection" as const, features: [{ properties: {} }] }, p, { url: null, level: "invented" as any })).toThrow(/outside the served vocabulary/);
    expect(() => attachGeometryProof({ type: "FeatureCollection" as const, features: [{ properties: {} }] }, p, { url: "s3://bucket/a", level: "documented" })).toThrow(/real http\(s\) URL or an explicit null/);
    expect(sent.some((c) => c.name === PUT)).toBe(false);
  });

  it("refuses a zone_source_url that is not a real http(s) URL", () => {
    const p = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "x", retrievedAt: "2026-07-22T12:00:00Z" });
    const fc: any = attachGeometryProof({ type: "FeatureCollection", features: [{ properties: {} }] }, p);
    fc.features[0].properties.zone_source_url = "method:t2-serve-vision";
    expect(() => assertServedZoneGeojson(KEY, fc)).toThrow(/must be a real http\(s\) URL or an explicit null/);
  });

  it("stamps the proved acquisition URL by default so producers cannot deposit unsourced", () => {
    const p = proofFromFetched({ url: "https://data.example.org/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", bytes: "x", retrievedAt: "2026-07-22T12:00:00Z" });
    const fc: any = attachGeometryProof({ type: "FeatureCollection", features: [{ properties: { zone_code: "R-1" } }] }, p);
    expect(fc.features[0].properties.zone_source_url).toBe(p.url);
    expect(fc.features[0].properties.zone_source_level).toBe("documented");
    // an upstream explicit stamp is never silently overwritten
    const kept: any = attachGeometryProof({ type: "FeatureCollection", features: [{ properties: { zone_source_url: null, zone_source_level: "legacy-traceable" } }] }, p);
    expect(kept.features[0].properties.zone_source_url).toBeNull();
    expect(kept.features[0].properties.zone_source_level).toBe("legacy-traceable");
  });

  it("keeps raw S3 object writes confined to the generic helper and proof gate", () => {
    const root = resolve(import.meta.dirname, "..");
    const token = ["PutObject", "Command"].join("");
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [],
    );
    const users = walk(root)
      // Test doubles dispatch on command class names; only production sources
      // can introduce an S3 writer that bypasses the two guarded helpers.
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) => readFileSync(file, "utf8").includes(token))
      .map((file) => relative(root, file).replaceAll("\\", "/"))
      .sort();
    expect(users).toEqual(["lib/s3.ts", "lib/zonage-proof.ts"]);
  });
});

/** Minimal S3 double: dispatches on command class name, records every send, and
 *  serves `servedObj` for GetObject. Lets us prove the additive gate without S3. */
function fakeS3(servedObj: unknown, opts: { missing?: boolean; etag?: string } = {}) {
  const sent: Array<{ name: string; input: any }> = [];
  const s3 = {
    send: async (command: any) => {
      const name = command.constructor.name;
      sent.push({ name, input: command.input });
      if (name === "HeadObjectCommand") {
        if (opts.missing) { const e: any = new Error("nf"); e.name = "NotFound"; e.$metadata = { httpStatusCode: 404 }; throw e; }
        return opts.etag ? { ETag: opts.etag } : {};
      }
      if (name === "GetObjectCommand") return { Body: [Buffer.from(JSON.stringify(servedObj))] };
      return {};
    },
  } as any;
  return { s3, sent };
}

const KEY = "normalized/ca-qc-zonage/qc-zonage-alpha.geojson";
// Built by join so the forbidden raw-write token never appears verbatim in this
// file (the guard test above forbids it outside lib/s3.ts and lib/zonage-proof.ts).
const PUT = ["PutObject", "Command"].join("");
const COPY = ["CopyObject", "Command"].join("");
const LEGACY_ARTIFACT_URI = "s3://sentropic-geo/normalized/ca-qc-zonage/qc-zonage-alpha.geojson";
const PUBLIC_ARTIFACT_URL = "https://data.example.org/zoning/alpha.geojson";
const PROOF_SHA256 = `sha256:${"a".repeat(64)}` as const;
const twoFeatures = () => ({
  type: "FeatureCollection" as const,
  features: [
    { geometry: { type: "Point", coordinates: [0, 0] }, properties: { zone_code: "R-1" } },
    { geometry: { type: "Point", coordinates: [1, 1] }, properties: { zone_code: "C-2" } },
  ],
});
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** A v1 envelope that records the exact captured bytes it describes. */
const legacyProof = (sha256 = PROOF_SHA256) => ({
  schema_version: "1.0",
  status: "complete",
  sources: {
    geometry: {
      status: "available",
      artifact_uri: LEGACY_ARTIFACT_URI,
      upstream_uri: null,
      sha256,
    },
    regulation: { status: "unavailable", artifact_uri: null, upstream_uri: null },
  },
  zone: null,
  gaps: [],
});

/** A v1 envelope whose SHA-256 member is truly absent, not null or empty. */
const legacyProofWithoutSha256 = () => ({
  schema_version: "1.0",
  status: "complete",
  sources: {
    geometry: {
      status: "available",
      artifact_uri: LEGACY_ARTIFACT_URI,
      upstream_uri: null,
    },
    regulation: { status: "unavailable", artifact_uri: null, upstream_uri: null },
  },
  zone: null,
  gaps: [],
});

const proofArtifactUriSubstitution = (sha256 = PROOF_SHA256, replacementUrl = PUBLIC_ARTIFACT_URL) => ([{
  artifactUri: LEGACY_ARTIFACT_URI,
  replacementUrl,
  sha256,
}] as const);

const proofArtifactUriAndSha256Stamp = (sha256 = PROOF_SHA256, replacementUrl = PUBLIC_ARTIFACT_URL) => ([{
  artifactUri: LEGACY_ARTIFACT_URI,
  replacementUrl,
  sha256,
}] as const);

describe("additive served-zone provenance write", () => {
  it("stamps whitelisted props, preserves geometry, and backs up before writing", async () => {
    const served = twoFeatures();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    for (const f of incoming.features) { f.properties.zone_source_url = "https://data.example.org/z.geojson"; f.properties.zone_source_level = "directe"; }
    const r = await putServedZoneAdditive(s3, KEY, incoming, { allowedProps: ["zone_source_url", "zone_source_level"] });
    expect(r.features).toBe(2);
    const names = sent.map((c) => c.name);
    // backup (CopyObject) precedes the PutObject write.
    expect(names.indexOf(COPY)).toBeGreaterThanOrEqual(0);
    expect(names.indexOf(COPY)).toBeLessThan(names.indexOf(PUT));
    const put = sent.find((c) => c.name === PUT)!;
    expect(put.input.Key).toBe(KEY);
    expect(put.input.ContentType).toBe("application/geo+json");
    const body = JSON.parse(put.input.Body);
    expect(body.features[0].properties.zone_source_url).toBe("https://data.example.org/z.geojson");
    expect(body.features[0].geometry).toEqual(served.features[0].geometry);
  });

  it("refuses a geometry change — the proof gate stays intact on this path", async () => {
    const served = twoFeatures();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    incoming.features[0].geometry.coordinates = [9, 9];
    await expect(putServedZoneAdditive(s3, KEY, incoming)).rejects.toThrow(/geometry differs/);
    expect(sent.some((c) => c.name === PUT)).toBe(false);
  });

  it("refuses a feature count / order change", async () => {
    const served = twoFeatures();
    const { s3 } = fakeS3(served);
    const incoming: any = clone(served);
    incoming.features.push({ geometry: { type: "Point", coordinates: [2, 2] }, properties: {} });
    await expect(putServedZoneAdditive(s3, KEY, incoming)).rejects.toThrow(/feature count changed/);
  });

  it("refuses a change to any non-provenance property", async () => {
    const served = twoFeatures();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    incoming.features[0].properties.zone_code = "MUTATED";
    incoming.features[0].properties.zone_source_url = "https://data.example.org/z.geojson";
    await expect(putServedZoneAdditive(s3, KEY, incoming, { allowedProps: ["zone_source_url", "zone_source_level"] })).rejects.toThrow(/non-provenance property/);
    expect(sent.some((c) => c.name === PUT)).toBe(false);
  });

  it("refuses to create a served collection (target must already exist)", async () => {
    const served = twoFeatures();
    const { s3 } = fakeS3(served, { missing: true });
    await expect(putServedZoneAdditive(s3, KEY, clone(served))).rejects.toThrow(/refuse to create/);
  });

  it("refuses to widen the whitelist beyond provenance metadata keys", async () => {
    const served = twoFeatures();
    const { s3 } = fakeS3(served);
    await expect(putServedZoneAdditive(s3, KEY, clone(served), { allowedProps: ["not_a_provenance_key"] })).rejects.toThrow(/widen the whitelist/);
  });

  it("refuses a non-served key outright", async () => {
    const served = twoFeatures();
    const { s3 } = fakeS3(served);
    await expect(putServedZoneAdditive(s3, "normalized/ca-qc-zonage/qc-zonage-alpha.contour-auto-preclip.geojson", clone(served))).rejects.toThrow(/not a served zonage key/);
  });

  // ── P0 regression: the additive path compared features only, so a caller could
  // FORGE the collection-level proof (fc.proof.geometry_source.url) while keeping
  // the genuine per-feature proof, through the door advertised as "safe".
  it("refuses a forged collection proof on the additive path", async () => {
    const served: any = clone(twoFeatures());
    const geometrySource = { url: "https://sig.officiel.example/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", retrieved_at: "2026-07-22T12:00:00Z", sha256: `sha256:${"a".repeat(64)}` };
    served.proof = { schema_version: "2.0", geometry_source: geometrySource };
    for (const f of served.features) f.properties.proof = { schema_version: "2.0", geometry_source: { ...geometrySource } };
    const { s3, sent } = fakeS3(served);
    const forged: any = clone(served);
    forged.proof.geometry_source.url = "https://forged.example/other.geojson";
    forged.features[0].properties.zone_source_url = "https://sig.officiel.example/zones.geojson";
    await expect(putServedZoneAdditive(s3, KEY, forged, { allowedProps: ["zone_source_url", "zone_source_level"] })).rejects.toThrow(/top-level collection member "proof" differs/);
    expect(sent.some((c) => c.name === PUT)).toBe(false);
    expect(sent.some((c) => c.name === COPY)).toBe(false);
  });

  it("accepts only an attested v1 artifact_uri substitution, preserving proof, geometry, and feature count", async () => {
    const served: any = clone(twoFeatures());
    for (const feature of served.features) feature.properties.proof = legacyProof();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    for (const feature of incoming.features) {
      feature.properties.proof.sources.geometry.artifact_uri = PUBLIC_ARTIFACT_URL;
    }

    const result = await putServedZoneAdditive(s3, KEY, incoming, {
      allowProofArtifactUriSubstitution: proofArtifactUriSubstitution(),
    });

    expect(result.features).toBe(served.features.length);
    const body = JSON.parse(sent.find((command) => command.name === PUT)!.input.Body);
    expect(body.features.map((feature: any) => feature.geometry)).toEqual(served.features.map((feature: any) => feature.geometry));
    expect(body.features).toHaveLength(served.features.length);
    expect(body.features.map((feature: any) => feature.properties.proof.sources.geometry)).toEqual(
      served.features.map((feature: any) => ({ ...feature.properties.proof.sources.geometry, artifact_uri: PUBLIC_ARTIFACT_URL })),
    );
  });

  it("keeps the legacy proof immutable when the explicit substitution option is absent", async () => {
    const served: any = clone(twoFeatures());
    for (const feature of served.features) feature.properties.proof = legacyProof();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    for (const feature of incoming.features) feature.properties.proof.sources.geometry.artifact_uri = PUBLIC_ARTIFACT_URL;

    await expect(putServedZoneAdditive(s3, KEY, incoming)).rejects.toThrow(/non-provenance property "proof"/);
    expect(sent.some((command) => command.name === PUT)).toBe(false);
  });

  it("refuses an artifact_uri substitution whose envelope SHA-256 is not the manifest attestation", async () => {
    const served: any = clone(twoFeatures());
    for (const feature of served.features) feature.properties.proof = legacyProof(`sha256:${"b".repeat(64)}`);
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    for (const feature of incoming.features) feature.properties.proof.sources.geometry.artifact_uri = PUBLIC_ARTIFACT_URL;

    await expect(putServedZoneAdditive(s3, KEY, incoming, {
      allowProofArtifactUriSubstitution: proofArtifactUriSubstitution(),
    })).rejects.toThrow();
    expect(sent.some((command) => command.name === PUT)).toBe(false);
  });

  it("refuses an artifact_uri substitution that changes the attested envelope SHA-256", async () => {
    const served: any = clone(twoFeatures());
    for (const feature of served.features) feature.properties.proof = legacyProof();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    for (const feature of incoming.features) {
      feature.properties.proof.sources.geometry.artifact_uri = PUBLIC_ARTIFACT_URL;
      feature.properties.proof.sources.geometry.sha256 = `sha256:${"b".repeat(64)}`;
    }

    await expect(putServedZoneAdditive(s3, KEY, incoming, {
      allowProofArtifactUriSubstitution: proofArtifactUriSubstitution(),
    })).rejects.toThrow(/non-provenance property "proof"/);
    expect(sent.some((command) => command.name === PUT)).toBe(false);
  });

  it("restores a missing v1 SHA-256 only together with its attested public artifact URL", async () => {
    const served: any = clone(twoFeatures());
    for (const feature of served.features) feature.properties.proof = legacyProofWithoutSha256();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    for (const feature of incoming.features) {
      feature.properties.proof.sources.geometry.artifact_uri = PUBLIC_ARTIFACT_URL;
      feature.properties.proof.sources.geometry.sha256 = PROOF_SHA256;
    }

    const result = await putServedZoneAdditive(s3, KEY, incoming, {
      allowProofArtifactUriAndSha256Stamp: proofArtifactUriAndSha256Stamp(),
    });

    expect(result.features).toBe(served.features.length);
    const body = JSON.parse(sent.find((command) => command.name === PUT)!.input.Body);
    expect(body.features.map((feature: any) => feature.geometry)).toEqual(served.features.map((feature: any) => feature.geometry));
    expect(body.features.map((feature: any) => feature.properties.proof.sources.geometry)).toEqual(
      served.features.map((feature: any) => ({
        ...feature.properties.proof.sources.geometry,
        artifact_uri: PUBLIC_ARTIFACT_URL,
        sha256: PROOF_SHA256,
      })),
    );
  });

  it("refuses a missing-SHA stamp unless it also replaces the artifact URI", async () => {
    const served: any = clone(twoFeatures());
    for (const feature of served.features) feature.properties.proof = legacyProofWithoutSha256();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    for (const feature of incoming.features) feature.properties.proof.sources.geometry.sha256 = PROOF_SHA256;

    await expect(putServedZoneAdditive(s3, KEY, incoming, {
      allowProofArtifactUriAndSha256Stamp: proofArtifactUriAndSha256Stamp(),
    })).rejects.toThrow(/non-provenance property "proof"/);
    expect(sent.some((command) => command.name === PUT)).toBe(false);
  });

  it("refuses a missing-SHA restoration when the served envelope already has a SHA-256", async () => {
    const served: any = clone(twoFeatures());
    for (const feature of served.features) feature.properties.proof = legacyProof();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    for (const feature of incoming.features) {
      feature.properties.proof.sources.geometry.artifact_uri = PUBLIC_ARTIFACT_URL;
      feature.properties.proof.sources.geometry.sha256 = PROOF_SHA256;
    }

    await expect(putServedZoneAdditive(s3, KEY, incoming, {
      allowProofArtifactUriAndSha256Stamp: proofArtifactUriAndSha256Stamp(),
    })).rejects.toThrow(/non-provenance property "proof"/);
    expect(sent.some((command) => command.name === PUT)).toBe(false);
  });

  it("refuses an artifact_uri substitution to a non-HTTPS URL", async () => {
    const served: any = clone(twoFeatures());
    for (const feature of served.features) feature.properties.proof = legacyProof();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    for (const feature of incoming.features) feature.properties.proof.sources.geometry.artifact_uri = "http://data.example.org/zoning/alpha.geojson";

    await expect(putServedZoneAdditive(s3, KEY, incoming, {
      allowProofArtifactUriSubstitution: proofArtifactUriSubstitution(PROOF_SHA256, "http://data.example.org/zoning/alpha.geojson"),
    })).rejects.toThrow();
    expect(sent.some((command) => command.name === PUT)).toBe(false);
  });

  // Une query string etait refusee. La regle etait une prudence de FORME, et
  // elle rendait la classe de sources la plus nombreuse inattestable : un
  // endpoint ArcGIS nu sert une PAGE HTML, la geometrie n'est atteignable que
  // par `/query?...f=geojson`. Le garde n'admettait donc que l'URL qui NE sert
  // PAS les octets attestes. Ce qui est protege est la propriete, pas la forme.
  it("accepts an attested substitution to the ArcGIS query URL that actually served the bytes", async () => {
    const served: any = clone(twoFeatures());
    for (const feature of served.features) feature.properties.proof = legacyProof();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    const queryUrl = "https://services2.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson";
    for (const feature of incoming.features) feature.properties.proof.sources.geometry.artifact_uri = queryUrl;

    await putServedZoneAdditive(s3, KEY, incoming, {
      allowProofArtifactUriSubstitution: proofArtifactUriSubstitution(PROOF_SHA256, queryUrl),
    });
    expect(sent.some((command) => command.name === PUT)).toBe(true);
  });

  // Le fragment n'est JAMAIS transmis au serveur : il ne peut pas faire partie
  // de ce qui a produit les octets, donc le laisser suggererait qu'il compte.
  it("refuses an artifact_uri substitution to a URL carrying a fragment", async () => {
    const served: any = clone(twoFeatures());
    for (const feature of served.features) feature.properties.proof = legacyProof();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    const fragmentUrl = "https://data.example.org/zoning/alpha.geojson?f=geojson#layer-3";
    for (const feature of incoming.features) feature.properties.proof.sources.geometry.artifact_uri = fragmentUrl;

    await expect(putServedZoneAdditive(s3, KEY, incoming, {
      allowProofArtifactUriSubstitution: proofArtifactUriSubstitution(PROOF_SHA256, fragmentUrl),
    })).rejects.toThrow();
    expect(sent.some((command) => command.name === PUT)).toBe(false);
  });

  // Un secret publie dans une preuve fuite, et l'URL n'est alors pas rejouable
  // par le tiers a qui on la donne.
  it("refuses an artifact_uri substitution to a URL carrying credentials", async () => {
    const served: any = clone(twoFeatures());
    for (const feature of served.features) feature.properties.proof = legacyProof();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    const credentialUrl = "https://user:secret@data.example.org/zoning/alpha.geojson?f=geojson";
    for (const feature of incoming.features) feature.properties.proof.sources.geometry.artifact_uri = credentialUrl;

    await expect(putServedZoneAdditive(s3, KEY, incoming, {
      allowProofArtifactUriSubstitution: proofArtifactUriSubstitution(PROOF_SHA256, credentialUrl),
    })).rejects.toThrow();
    expect(sent.some((command) => command.name === PUT)).toBe(false);
  });

  it("refuses every proof modification other than the attested artifact_uri substitution", async () => {
    const served: any = clone(twoFeatures());
    for (const feature of served.features) feature.properties.proof = legacyProof();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    for (const feature of incoming.features) {
      feature.properties.proof.sources.geometry.artifact_uri = PUBLIC_ARTIFACT_URL;
      feature.properties.proof.status = "partial";
    }

    await expect(putServedZoneAdditive(s3, KEY, incoming, {
      allowProofArtifactUriSubstitution: proofArtifactUriSubstitution(),
    })).rejects.toThrow();
    expect(sent.some((command) => command.name === PUT)).toBe(false);
  });

  it("refuses any other top-level member difference (added, removed or changed)", async () => {
    const served: any = clone(twoFeatures());
    served.name = "qc-zonage-alpha";
    const { s3 } = fakeS3(served);
    const dropped: any = clone(served);
    delete dropped.name;
    await expect(putServedZoneAdditive(s3, KEY, dropped)).rejects.toThrow(/top-level collection member "name" differs/);
    const added: any = clone(served);
    added.crs = { type: "name", properties: { name: "EPSG:4326" } };
    await expect(putServedZoneAdditive(s3, KEY, added)).rejects.toThrow(/top-level collection member "crs" differs/);
  });

  it("still accepts a whitelisted provenance change when top-level members are identical", async () => {
    const served: any = clone(twoFeatures());
    served.proof = { schema_version: "2.0", geometry_source: { url: "https://sig.officiel.example/zones.geojson", type: "geojson-officiel", method: "natif", reliability: "directe", retrieved_at: "2026-07-22T12:00:00Z", sha256: `sha256:${"a".repeat(64)}` } };
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    // key order intentionally shuffled: the compare is canonical-JSON tolerant per key
    incoming.proof = { geometry_source: { ...served.proof.geometry_source }, schema_version: "2.0" };
    for (const f of incoming.features) f.properties.zone_source_level = "documented";
    const r = await putServedZoneAdditive(s3, KEY, incoming, { allowedProps: ["zone_source_url", "zone_source_level"] });
    expect(r.features).toBe(2);
    const body = JSON.parse(sent.find((c) => c.name === PUT)!.input.Body);
    expect(body.features[0].properties.zone_source_level).toBe("documented");
    expect(body.proof.geometry_source.url).toBe("https://sig.officiel.example/zones.geojson");
  });

  // Promotion v1 -> v2 : la preuve est deja ouvrable et hachable, il lui manque
  // seulement l'instant mesure par une capture. 124 collections servies sont
  // dans cet etat, et c'est le seul chemin pour faire monter le KPI strict.
  describe("capture attestation (v1 -> v2)", () => {
    const HTTPS = "https://data.example.org/zoning/alpha.geojson";
    const AT = "2026-07-28T12:00:00.000Z";
    const v1Proof = () => ({
      schema_version: "1.0",
      sources: { geometry: { status: "available", artifact_uri: HTTPS, sha256: PROOF_SHA256 } },
    });

    it("adds only retrieved_at when the refetched SHA-256 confirms the served one", async () => {
      const served: any = clone(twoFeatures());
      for (const feature of served.features) feature.properties.proof = v1Proof();
      const { s3, sent } = fakeS3(served);
      const incoming: any = clone(served);
      for (const feature of incoming.features) feature.properties.proof.sources.geometry.retrieved_at = AT;

      await putServedZoneAdditive(s3, KEY, incoming, {
        allowProofCaptureAttestation: [{ artifactUri: HTTPS, sha256: PROOF_SHA256, retrievedAt: AT }],
      });
      expect(sent.some((command) => command.name === PUT)).toBe(true);
    });

    // Un SHA qui change signifie que le document EN LIGNE a bouge depuis la
    // preuve. L'absorber en ecrivant le nouveau effacerait ce fait.
    it("refuses when the attestation carries a different SHA-256 than the served one", async () => {
      const served: any = clone(twoFeatures());
      for (const feature of served.features) feature.properties.proof = v1Proof();
      const { s3, sent } = fakeS3(served);
      const incoming: any = clone(served);
      const other = `sha256:${"c".repeat(64)}` as const;
      for (const feature of incoming.features) {
        feature.properties.proof.sources.geometry.retrieved_at = AT;
        feature.properties.proof.sources.geometry.sha256 = other;
      }

      await expect(putServedZoneAdditive(s3, KEY, incoming, {
        allowProofCaptureAttestation: [{ artifactUri: HTTPS, sha256: other, retrievedAt: AT }],
      })).rejects.toThrow();
      expect(sent.some((command) => command.name === PUT)).toBe(false);
    });

    it("refuses to replace a retrieved_at that is already present", async () => {
      const served: any = clone(twoFeatures());
      for (const feature of served.features) {
        feature.properties.proof = v1Proof();
        feature.properties.proof.sources.geometry.retrieved_at = "2026-01-01T00:00:00.000Z";
      }
      const { s3, sent } = fakeS3(served);
      const incoming: any = clone(served);
      for (const feature of incoming.features) feature.properties.proof.sources.geometry.retrieved_at = AT;

      await expect(putServedZoneAdditive(s3, KEY, incoming, {
        allowProofCaptureAttestation: [{ artifactUri: HTTPS, sha256: PROOF_SHA256, retrievedAt: AT }],
      })).rejects.toThrow();
      expect(sent.some((command) => command.name === PUT)).toBe(false);
    });

    it("refuses an attestation whose retrieved_at is not an ISO timestamp", async () => {
      const served: any = clone(twoFeatures());
      for (const feature of served.features) feature.properties.proof = v1Proof();
      const { s3, sent } = fakeS3(served);
      const incoming: any = clone(served);
      for (const feature of incoming.features) feature.properties.proof.sources.geometry.retrieved_at = "2026-07-28";

      await expect(putServedZoneAdditive(s3, KEY, incoming, {
        allowProofCaptureAttestation: [{ artifactUri: HTTPS, sha256: PROOF_SHA256, retrievedAt: "2026-07-28" }],
      })).rejects.toThrow();
      expect(sent.some((command) => command.name === PUT)).toBe(false);
    });

    it("refuses to change the artifact_uri under cover of a capture attestation", async () => {
      const served: any = clone(twoFeatures());
      for (const feature of served.features) feature.properties.proof = v1Proof();
      const { s3, sent } = fakeS3(served);
      const incoming: any = clone(served);
      for (const feature of incoming.features) {
        feature.properties.proof.sources.geometry.retrieved_at = AT;
        feature.properties.proof.sources.geometry.artifact_uri = "https://data.example.org/zoning/other.geojson";
      }

      await expect(putServedZoneAdditive(s3, KEY, incoming, {
        allowProofCaptureAttestation: [{ artifactUri: HTTPS, sha256: PROOF_SHA256, retrievedAt: AT }],
      })).rejects.toThrow();
      expect(sent.some((command) => command.name === PUT)).toBe(false);
    });
  });

  it("can skip the backup when explicitly disabled", async () => {
    const served = twoFeatures();
    const { s3, sent } = fakeS3(served);
    const incoming: any = clone(served);
    for (const f of incoming.features) f.properties.zone_geometry_status = "clean";
    await putServedZoneAdditive(s3, KEY, incoming, { allowedProps: ["zone_geometry_status"], backup: false });
    expect(sent.some((c) => c.name === COPY)).toBe(false);
    expect(sent.some((c) => c.name === PUT)).toBe(true);
  });
});
