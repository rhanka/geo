import { describe, expect, it, vi } from "vitest";

import { applyToServed, resolveProv, servedKeys } from "./publish-reglement-provenance.js";

type FeatureCollection = { type: "FeatureCollection"; features: Array<{ geometry: unknown; properties: Record<string, unknown> }> };

function collection(properties: Record<string, unknown>): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [{ geometry: { type: "Point", coordinates: [-73.5, 45.5] }, properties }],
  };
}

function memoryS3(initial: Record<string, FeatureCollection>) {
  const objects = new Map(Object.entries(initial).map(([key, value]) => [key, Buffer.from(JSON.stringify(value))]));
  const s3 = {
    send: vi.fn(async (command: { constructor: { name: string }; input: { Key?: string; Body?: Buffer | Uint8Array | string } }) => {
      const key = command.input.Key;
      if (!key) throw new Error("missing object key");
      if (command.constructor.name === "HeadObjectCommand") {
        if (objects.has(key)) return {};
        throw { name: "NotFound", $metadata: { httpStatusCode: 404 } };
      }
      if (command.constructor.name === "GetObjectCommand") {
        const body = objects.get(key);
        if (!body) throw { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } };
        return { Body: (async function* (): AsyncIterable<Buffer> { yield body; })() };
      }
      if (command.constructor.name === "PutObjectCommand") {
        const body = command.input.Body;
        if (body === undefined) throw new Error("missing object body");
        objects.set(key, Buffer.from(body));
        return {};
      }
      throw new Error(`unexpected ${command.constructor.name}`);
    }),
  };
  return {
    s3,
    read(key: string): FeatureCollection {
      return JSON.parse(objects.get(key)!.toString("utf8")) as FeatureCollection;
    },
  };
}

const current = {
  reglement_numero: "R-2024",
  reglement_millesime: "2024",
  reglement_page_source: "page 1",
  reglement_url: "https://ville.example/reglement.pdf",
};

describe("publish-reglement-provenance", () => {
  it("should add derived ancien provenance to each existing layout without changing current stamps", async () => {
    const [flat, nested] = servedKeys("alpha");
    const store = memoryS3({
      [flat]: collection({ ...current, zone_code: "A-1" }),
      [nested]: collection({ ...current, zone_code: "A-1" }),
    });
    const provenance = resolveProv({}, {
      ...current,
      reglement_ancien_numero: "R-2009",
      reglement_ancien_millesime: 2009,
      reglement_ancien_source: "remplace le Règlement de zonage R-2009",
    });
    expect(provenance.reglement_ancien_millesime).toBeNull();
    expect(provenance.has_ancien).toBe(true);
    const result = await applyToServed(store.s3 as never, "alpha", provenance, { dryRun: false, strip: false });

    expect(result).toEqual({ features: 2, changed: 8 });
    for (const key of [flat, nested]) {
      const properties = store.read(key).features[0]!.properties;
      expect(properties).toMatchObject({
        ...current,
        zone_code: "A-1",
        reglement_ancien_numero: "R-2009",
        reglement_ancien_millesime: null,
        reglement_ancien_source: "remplace le Règlement de zonage R-2009",
        has_ancien: true,
      });
    }
  });

  it("should stamp honest null ancien values when the registry has no ancien", async () => {
    const [, nested] = servedKeys("sans-ancien");
    const store = memoryS3({ [nested]: collection({ ...current, zone_code: "B-2" }) });

    const provenance = resolveProv({}, current);
    expect(provenance.has_ancien).toBe(false);
    await applyToServed(store.s3 as never, "sans-ancien", provenance, { dryRun: false, strip: false });

    expect(store.read(nested).features[0]!.properties).toMatchObject({
      ...current,
      reglement_ancien_numero: null,
      reglement_ancien_millesime: null,
      reglement_ancien_source: null,
      has_ancien: false,
    });
  });

  it("should strip ancien provenance from every existing layout", async () => {
    const [flat, nested] = servedKeys("alpha");
    const ancien = {
      reglement_ancien_numero: "R-2009",
      reglement_ancien_millesime: null,
      reglement_ancien_source: "remplace le Règlement de zonage R-2009",
      has_ancien: true,
    };
    const store = memoryS3({
      [flat]: collection({ ...current, ...ancien }),
      [nested]: collection({ ...current, ...ancien }),
    });

    await applyToServed(store.s3 as never, "alpha", { ...current, ...ancien }, { dryRun: false, strip: true });

    for (const key of [flat, nested]) {
      const properties = store.read(key).features[0]!.properties;
      expect(properties).not.toHaveProperty("reglement_ancien_numero");
      expect(properties).not.toHaveProperty("reglement_ancien_millesime");
      expect(properties).not.toHaveProperty("reglement_ancien_source");
      expect(properties).not.toHaveProperty("has_ancien");
    }
  });
});
