import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assertGeometryProof, assertServedZoneGeojson, attachGeometryProof, isRealGeometryUrl, isServedZoneKey, proofFromFetched, putServedZoneAdditive, putServedZoneGeojson, sameGeometryProof } from "./zonage-proof.js";
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
    await putServedZoneGeojson(s3, key, fc);
    expect(sent).toHaveLength(1);
  });
  it("keeps raw S3 object writes confined to the generic helper and proof gate", () => {
    const root = resolve(import.meta.dirname, "..");
    const token = ["PutObject", "Command"].join("");
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [],
    );
    const users = walk(root)
      .filter((file) => readFileSync(file, "utf8").includes(token))
      .map((file) => relative(root, file).replaceAll("\\", "/"))
      .sort();
    expect(users).toEqual(["lib/s3.ts", "lib/zonage-proof.ts"]);
  });
});

/** Minimal S3 double: dispatches on command class name, records every send, and
 *  serves `servedObj` for GetObject. Lets us prove the additive gate without S3. */
function fakeS3(servedObj: unknown, opts: { missing?: boolean } = {}) {
  const sent: Array<{ name: string; input: any }> = [];
  const s3 = {
    send: async (command: any) => {
      const name = command.constructor.name;
      sent.push({ name, input: command.input });
      if (name === "HeadObjectCommand") {
        if (opts.missing) { const e: any = new Error("nf"); e.name = "NotFound"; e.$metadata = { httpStatusCode: 404 }; throw e; }
        return {};
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
const twoFeatures = () => ({
  type: "FeatureCollection" as const,
  features: [
    { geometry: { type: "Point", coordinates: [0, 0] }, properties: { zone_code: "R-1" } },
    { geometry: { type: "Point", coordinates: [1, 1] }, properties: { zone_code: "C-2" } },
  ],
});
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

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
