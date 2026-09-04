/**
 * Tests du factory reglement-doc : la dérivation d'URI bucket-root (pure) et le
 * chargement du registre de serving (Store in-memory, sans réseau).
 */
import { describe, it, expect } from "vitest";

import {
  loadReglementRegistry,
  makeReglementProvider,
  reglementStoreUri,
  REGLEMENT_REGISTRY_KEY,
} from "./make-reglement-provider.js";
import type { ByteStream, PutOptions, Store } from "../../storage/index.js";

/** Store in-memory minimal. */
class MemStore implements Store {
  readonly #m = new Map<string, Uint8Array>();
  seed(key: string, text: string): void {
    this.#m.set(key, new TextEncoder().encode(text));
  }
  async put(key: string, body: Uint8Array | string, _opts?: PutOptions): Promise<void> {
    this.#m.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body);
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    return this.#m.get(key);
  }
  async getStream(key: string): Promise<ByteStream | undefined> {
    const b = this.#m.get(key);
    return b === undefined ? undefined : (async function* () { yield b; })();
  }
  async has(key: string): Promise<boolean> {
    return this.#m.has(key);
  }
  async list(prefix?: string): Promise<string[]> {
    const ks = [...this.#m.keys()];
    return prefix ? ks.filter((k) => k.startsWith(prefix)) : ks;
  }
}

describe("reglementStoreUri", () => {
  it("dérive le bucket-root d'un data-URI s3 (hors préfixe normalized)", () => {
    expect(reglementStoreUri("s3://sentropic-geo/normalized", undefined)).toBe("s3://sentropic-geo");
    expect(reglementStoreUri("s3://sentropic-geo", undefined)).toBe("s3://sentropic-geo");
  });

  it("data-location fs (répertoire) → undefined (serving règlement OFF)", () => {
    expect(reglementStoreUri("fs:./data/normalized", undefined)).toBeUndefined();
    expect(reglementStoreUri("./data/normalized", undefined)).toBeUndefined();
  });

  it("override explicite GEO_REGLEMENT_URI prime sur la dérivation", () => {
    expect(reglementStoreUri("s3://sentropic-geo/normalized", "s3://autre-bucket")).toBe(
      "s3://autre-bucket",
    );
    expect(reglementStoreUri("fs:./data", "fs:/srv/reglement")).toBe("fs:/srv/reglement");
  });
});

describe("loadReglementRegistry", () => {
  it("parse le registre présent", async () => {
    const store = new MemStore();
    store.seed(
      REGLEMENT_REGISTRY_KEY,
      JSON.stringify({
        "sainte-martine": {
          source: "reglement-doc",
          sha256: `sha256:${"a".repeat(64)}`,
          source_url: "https://sainte-martine.ca/reg.pdf",
          retrieved_at: "2026-09-04T04:00:00.000Z",
          numero: "2019-342",
          ville: "Sainte-Martine",
          date_adoption: "2019-10-01",
          licence: "public",
        },
      }),
    );
    const reg = await loadReglementRegistry(store);
    expect(Object.keys(reg)).toEqual(["sainte-martine"]);
    expect(reg["sainte-martine"]!.numero).toBe("2019-342");
  });

  it("registre absent → vide (jamais fabriqué)", async () => {
    expect(await loadReglementRegistry(new MemStore())).toEqual({});
  });

  it("registre malformé → vide (fail-safe)", async () => {
    const store = new MemStore();
    store.seed(REGLEMENT_REGISTRY_KEY, "{ pas du json");
    expect(await loadReglementRegistry(store)).toEqual({});
  });
});

describe("makeReglementProvider", () => {
  it("data-location fs sans GEO_REGLEMENT_URI → undefined (OGC intact)", async () => {
    expect(await makeReglementProvider("./data/normalized", undefined)).toBeUndefined();
  });
});
