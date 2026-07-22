import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assertGeometryProof, assertServedZoneGeojson, attachGeometryProof, isRealGeometryUrl, isServedZoneKey, proofFromFetched, putServedZoneGeojson, sameGeometryProof } from "./zonage-proof.js";
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
