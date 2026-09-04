/**
 * Tests des routes de téléchargement de règlement (`/reglement/:slug` +
 * `/reglement/:slug.meta.json`), pilotées via `app.request(...)` contre un
 * {@link StoreReglementDocProvider} sur un Store in-memory. Couvre : la méta
 * proof-v2, le téléchargement PDF (Content-Disposition attachment + octets
 * exacts), le licence-gate restreint (link-only, jamais d'octets) et les 404.
 */
import { describe, it, expect } from "vitest";

import { createApp } from "./app.js";
import type { FeatureProvider } from "./provider.js";
import {
  StoreReglementDocProvider,
  type ReglementDocRegistry,
} from "./reglement-provider.js";
import type { ByteStream, PutOptions, Store } from "../storage/index.js";

const ORIGIN = "http://localhost";

/** FeatureProvider vide — la surface OGC n'est pas testée ici. */
const emptyFeatureProvider: FeatureProvider = {
  async listCollections() {
    return [];
  },
  async getCollection() {
    return undefined;
  },
  async getItems() {
    return undefined;
  },
  async getItem() {
    return undefined;
  },
};

/** Store in-memory minimal (Map clé→octets). */
class MemStore implements Store {
  readonly #m = new Map<string, Uint8Array>();
  seed(key: string, bytes: Uint8Array): void {
    this.#m.set(key, bytes);
  }
  async put(key: string, body: Uint8Array | string, _opts?: PutOptions): Promise<void> {
    this.#m.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body);
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    return this.#m.get(key);
  }
  async getStream(key: string): Promise<ByteStream | undefined> {
    const bytes = this.#m.get(key);
    if (bytes === undefined) return undefined;
    return (async function* () {
      yield bytes;
    })();
  }
  async has(key: string): Promise<boolean> {
    return this.#m.has(key);
  }
  async list(prefix?: string): Promise<string[]> {
    const keys = [...this.#m.keys()];
    return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
  }
}

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nSainte-Martine 2019-342 zonage\n%%EOF");
const HEX = "a".repeat(64);
const SHA = `sha256:${HEX}`;

function makeApp() {
  const store = new MemStore();
  store.seed(`raw/reglement-doc/cas/${HEX}.pdf`, PDF_BYTES);
  const registry: ReglementDocRegistry = {
    "sainte-martine": {
      source: "reglement-doc",
      sha256: SHA,
      ext: "pdf",
      source_url:
        "https://sainte-martine.ca/wp-content/uploads/2020/10/2019-342-Reglement-zonage.pdf",
      retrieved_at: "2026-09-04T04:00:00.000Z",
      numero: "2019-342",
      ville: "Sainte-Martine",
      date_adoption: "2019-10-01",
      licence: "public",
    },
    "ville-restreinte": {
      source: "reglement-doc",
      sha256: `sha256:${"b".repeat(64)}`,
      source_url: "https://exemple.qc.ca/reglement.pdf",
      retrieved_at: "2026-09-04T04:00:00.000Z",
      numero: "R-1",
      ville: "Ville Restreinte",
      date_adoption: null,
      licence: "restricted",
    },
  };
  return createApp(emptyFeatureProvider, [], new StoreReglementDocProvider(store, registry));
}

describe("reglement download routes", () => {
  it("GET /reglement/:slug.meta.json → proof-v2 + identité + licence", async () => {
    const res = await makeApp().request(`${ORIGIN}/reglement/sainte-martine.meta.json`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["slug"]).toBe("sainte-martine");
    expect(body["numero"]).toBe("2019-342");
    expect(body["ville"]).toBe("Sainte-Martine");
    expect(body["downloadable"]).toBe(true);
    expect(body["licence"]).toBe("public");
    expect((body["proof"] as Record<string, unknown>)["sha256"]).toBe(SHA);
    expect((body["proof"] as Record<string, unknown>)["source_url"]).toContain("sainte-martine");
  });

  it("GET /reglement/:slug (public) → PDF attachment + octets exacts", async () => {
    const res = await makeApp().request(`${ORIGIN}/reglement/sainte-martine`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="2019-342.pdf"');
    expect(res.headers.get("x-reglement-sha256")).toBe(SHA);
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf).toEqual(PDF_BYTES);
  });

  it("GET /reglement/:slug restreint → 409 link-only (source_url, jamais d'octets)", async () => {
    const res = await makeApp().request(`${ORIGIN}/reglement/ville-restreinte`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("LinkOnly");
    expect(body["licence"]).toBe("restricted");
    expect(body["source_url"]).toContain("exemple");
    expect(res.headers.get("content-type") ?? "").not.toContain("application/pdf");
  });

  it("GET /reglement/:slug.meta.json restreint → downloadable=false", async () => {
    const res = await makeApp().request(`${ORIGIN}/reglement/ville-restreinte.meta.json`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["downloadable"]).toBe(false);
    expect(body["licence"]).toBe("restricted");
  });

  it("GET /reglement/:slug inconnu → 404", async () => {
    const res = await makeApp().request(`${ORIGIN}/reglement/inconnu`);
    expect(res.status).toBe(404);
  });

  it("sans ReglementDocProvider injecté → route absente (404)", async () => {
    const res = await createApp(emptyFeatureProvider, []).request(`${ORIGIN}/reglement/sainte-martine`);
    expect(res.status).toBe(404);
  });
});
