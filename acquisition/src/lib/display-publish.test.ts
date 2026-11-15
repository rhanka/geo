import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { displayMirrorFreshness } from "@sentropic/geo/display/index.js";
import { S3Store } from "@sentropic/geo/storage/index.js";

import { displayPublishFailures, publishDisplayAfterWrite } from "./display-publish.js";
import { BUCKET, putBytes } from "./s3.js";
import { attachGeometryProof, proofFromFetched, putServedZoneAdditive, putServedZoneGeojson } from "./zonage-proof.js";

/** Minimal in-memory S3 (Put/Get/Head/List), ETag = write counter. */
class MemS3 {
  readonly objects = new Map<string, { body: Buffer; etag: string }>();
  readonly sent: string[] = [];
  failPutsUnder: string | undefined;
  #writes = 0;

  async send(command: { constructor: { name: string }; input: Record<string, unknown> }): Promise<unknown> {
    const name = command.constructor.name;
    const input = command.input;
    const key = String(input["Key"] ?? "");
    this.sent.push(`${name} ${key}`);
    const notFound = (): Error => Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    switch (name) {
      case "PutObjectCommand": {
        if (this.failPutsUnder !== undefined && key.startsWith(this.failPutsUnder)) {
          throw Object.assign(new Error("AccessDenied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
        }
        const raw = input["Body"] as string | Uint8Array | AsyncIterable<Uint8Array>;
        let body: Buffer;
        if (typeof raw === "string" || raw instanceof Uint8Array) body = Buffer.from(raw);
        else {
          // A streamed body (S3Store.putFile): drain it.
          const chunks: Buffer[] = [];
          for await (const c of raw) chunks.push(Buffer.from(c));
          body = Buffer.concat(chunks);
        }
        const etag = `"m${++this.#writes}"`;
        this.objects.set(key, { body, etag });
        return { ETag: etag };
      }
      case "GetObjectCommand": {
        const o = this.objects.get(key);
        if (!o) throw notFound();
        return { Body: Readable.from([o.body]), ETag: o.etag };
      }
      case "HeadObjectCommand": {
        const o = this.objects.get(key);
        if (!o) throw notFound();
        return { ETag: o.etag, ContentLength: o.body.byteLength };
      }
      case "ListObjectsV2Command": {
        const prefix = String(input["Prefix"] ?? "");
        return { Contents: [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((Key) => ({ Key })) };
      }
      default:
        throw new Error(`MemS3: unsupported ${name}`);
    }
  }
}

const SQUARE = [
  [-73.12, 45.12],
  [-73.11, 45.12],
  [-73.11, 45.13],
  [-73.12, 45.12],
];

function lots(n: number): string {
  return JSON.stringify({
    type: "FeatureCollection",
    features: Array.from({ length: n }, (_, i) => ({
      type: "Feature",
      id: `lot-${i}`,
      geometry: { type: "Polygon", coordinates: [SQUARE] },
      properties: { i },
    })),
  });
}

function zonage() {
  const proof = proofFromFetched({
    url: "https://data.example.org/zones.geojson",
    type: "geojson-officiel",
    method: "natif",
    reliability: "directe",
    bytes: "source bytes",
    retrievedAt: "2026-07-22T12:00:00Z",
  });
  return attachGeometryProof(
    {
      type: "FeatureCollection" as const,
      features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [SQUARE] }, properties: { zone_code: "R-1" } }],
    },
    proof,
    { url: "https://data.example.org/zones.geojson", level: "documented" },
  );
}

const storeOf = (s3: MemS3): S3Store => new S3Store({ bucket: BUCKET, prefix: "normalized", client: s3 as never });

beforeEach(() => vi.stubEnv("GEO_DISPLAY_PUBLISH", "1"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("publication-time display mirror (writer hook)", () => {
  it("putServedZoneGeojson publishes the zonage mirror: present and current", async () => {
    const s3 = new MemS3();
    const key = "normalized/ca-qc-zonage/qc-zonage-alpha.geojson";
    await putServedZoneGeojson(s3 as never, key, zonage());

    expect(s3.objects.has(`normalized/_display/qc-zonage-alpha/current.json`)).toBe(true);
    const state = await displayMirrorFreshness(storeOf(s3), "qc-zonage-alpha", "ca-qc-zonage/qc-zonage-alpha.geojson");
    expect(state.fresh).toBe(true);
  });

  it("putServedZoneAdditive re-publishes after a provenance stamp", async () => {
    const s3 = new MemS3();
    const key = "normalized/ca-qc-zonage/qc-zonage-alpha.geojson";
    const served = zonage();
    await putServedZoneGeojson(s3 as never, key, served);
    const before = s3.objects.get("normalized/_display/qc-zonage-alpha/current.json")!.etag;

    const stamped = JSON.parse(JSON.stringify(served)) as typeof served;
    (stamped.features[0]!.properties as Record<string, unknown>)["zone_source_level"] = "historical-verified";
    await putServedZoneAdditive(s3 as never, key, stamped as never, { allowedProps: ["zone_source_url", "zone_source_level"], backup: false });

    expect(s3.objects.get("normalized/_display/qc-zonage-alpha/current.json")!.etag).not.toBe(before);
    expect((await displayMirrorFreshness(storeOf(s3), "qc-zonage-alpha", "ca-qc-zonage/qc-zonage-alpha.geojson")).fresh).toBe(true);
  });

  it("putBytes publishes a lots collection, using the meta datasetId as the served id", async () => {
    const s3 = new MemS3();
    await putBytes(s3 as never, "normalized/qc-cadastre-lots/rawdon.meta.json", JSON.stringify({ datasetId: "qc-lots-rawdon" }), "application/json");
    await putBytes(s3 as never, "normalized/qc-cadastre-lots/rawdon.geojson", lots(3), "application/geo+json");
    expect((await displayMirrorFreshness(storeOf(s3), "qc-lots-rawdon", "qc-cadastre-lots/rawdon.geojson")).fresh).toBe(true);
  });

  it("a meta written after its GeoJSON still publishes the served id", async () => {
    const s3 = new MemS3();
    await putBytes(s3 as never, "normalized/qc-cadastre-lots/alma.geojson", lots(2), "application/geo+json");
    expect(s3.objects.has("normalized/_display/qc-lots-alma/current.json")).toBe(false); // id = "alma" then
    await putBytes(s3 as never, "normalized/qc-cadastre-lots/alma.meta.json", JSON.stringify({ datasetId: "qc-lots-alma" }), "application/json");
    expect((await displayMirrorFreshness(storeOf(s3), "qc-lots-alma", "qc-cadastre-lots/alma.geojson")).fresh).toBe(true);
  });

  it("sends nothing extra for writes outside the served root or non-GeoJSON keys", async () => {
    const s3 = new MemS3();
    await putBytes(s3 as never, "capture/_runs/x/body.geojson", "{}", "application/geo+json");
    await putBytes(s3 as never, "normalized/qc-lots/qc-lots-x.stats.json", "{}", "application/json");
    expect(s3.sent).toEqual(["PutObjectCommand capture/_runs/x/body.geojson", "PutObjectCommand normalized/qc-lots/qc-lots-x.stats.json"]);
  });

  it("a failed mirror build never fails the exact write; it is logged and recorded", async () => {
    const s3 = new MemS3();
    s3.failPutsUnder = "normalized/_display/";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(putBytes(s3 as never, "normalized/qc-lots/qc-lots-beta.geojson", lots(1), "application/geo+json")).resolves.toBeUndefined();
    expect(s3.objects.has("normalized/qc-lots/qc-lots-beta.geojson")).toBe(true);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("DISPLAY_MIRROR_PUBLISH_FAILED"))).toBe(true);
    expect(displayPublishFailures().some((f) => f.status === "failed" && f.collection === "qc-lots-beta")).toBe(true);
  });

  it("also publishes the vector tile archive of the collection (GEO_TILES_PUBLISH=0 turns that step off)", async () => {
    const s3 = new MemS3();
    await putBytes(s3 as never, "normalized/qc-lots/qc-lots-gamma.geojson", lots(2), "application/geo+json");
    expect(s3.objects.has("normalized/_tiles/qc-lots-gamma/current.json")).toBe(true);
    const current = JSON.parse(s3.objects.get("normalized/_tiles/qc-lots-gamma/current.json")!.body.toString()) as { version: string; features: number };
    expect(current.features).toBe(2);
    expect(s3.objects.has(`normalized/_tiles/qc-lots-gamma/${current.version}/qc-lots-gamma.pmtiles`)).toBe(true);

    vi.stubEnv("GEO_TILES_PUBLISH", "0");
    const off = new MemS3();
    await putBytes(off as never, "normalized/qc-lots/qc-lots-gamma.geojson", lots(2), "application/geo+json");
    expect(off.objects.has("normalized/_display/qc-lots-gamma/current.json")).toBe(true);
    expect([...off.objects.keys()].some((k) => k.startsWith("normalized/_tiles/"))).toBe(false);
  });

  it("a failed tile build never fails the exact write nor the mirror; it is logged and recorded", async () => {
    const s3 = new MemS3();
    s3.failPutsUnder = "normalized/_tiles/";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await putBytes(s3 as never, "normalized/qc-lots/qc-lots-delta.geojson", lots(1), "application/geo+json");
    expect(s3.objects.has("normalized/_display/qc-lots-delta/current.json")).toBe(true);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("TILES_ARCHIVE_PUBLISH_FAILED"))).toBe(true);
    expect(displayPublishFailures().some((f) => f.collection === "qc-lots-delta" && f.tiles?.status === "failed")).toBe(true);
  });

  it("GEO_DISPLAY_PUBLISH=0 turns the hook off", async () => {
    vi.stubEnv("GEO_DISPLAY_PUBLISH", "0");
    const s3 = new MemS3();
    expect(await publishDisplayAfterWrite(s3 as never, "normalized/qc-lots/qc-lots-x.geojson", BUCKET)).toBeUndefined();
    expect(s3.sent).toEqual([]);
  });
});
