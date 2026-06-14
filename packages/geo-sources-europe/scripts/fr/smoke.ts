/**
 * Smoke test: serve the produced fr-* normalized data through the OGC API and
 * assert the collections + items endpoints work. Run with `tsx scripts/smoke.ts`.
 */

import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp, FileProvider } from "@sentropic/geo-api";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const dataDir = join(repoRoot, "data", "normalized");

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main(): Promise<void> {
  const provider = new FileProvider(dataDir);
  const app = createApp(provider);

  // /collections
  const collRes = await app.request("http://localhost/collections");
  assert(collRes.status === 200, `/collections status ${collRes.status}`);
  const coll = (await collRes.json()) as { collections: Array<{ id: string }> };
  const ids = coll.collections.map((c) => c.id);
  console.log("[smoke] collections:", ids.join(", "));
  assert(ids.includes("fr-regions"), "fr-regions in collections");
  assert(ids.includes("fr-departements"), "fr-departements in collections");

  // /collections/fr-regions/items?limit=2
  const itemsRes = await app.request(
    "http://localhost/collections/fr-regions/items?limit=2",
  );
  assert(itemsRes.status === 200, `items status ${itemsRes.status}`);
  const items = (await itemsRes.json()) as {
    numberReturned?: number;
    features: Array<{ properties: { geoId?: string; name?: string } }>;
  };
  console.log("[smoke] fr-regions numberReturned:", items.numberReturned);
  assert(items.features.length === 2, `expected 2 features, got ${items.features.length}`);
  for (const f of items.features) {
    assert(typeof f.properties.geoId === "string", "feature has geoId");
    assert(typeof f.properties.name === "string", "feature has name");
    console.log("[smoke]   feature:", f.properties.geoId, "-", f.properties.name);
  }

  console.log("[smoke] OK — /collections and /collections/fr-regions/items?limit=2 served 200.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
