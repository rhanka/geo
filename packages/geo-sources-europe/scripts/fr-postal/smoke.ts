/**
 * Smoke test: serve the produced fr-codes-postaux normalized data through the
 * OGC API and assert the collections + items endpoints work for a null-geometry
 * referential collection. Run with `tsx scripts/smoke.ts`.
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
  assert(ids.includes("fr-codes-postaux"), "fr-codes-postaux in collections");

  // /collections/fr-codes-postaux/items?limit=2
  const itemsRes = await app.request(
    "http://localhost/collections/fr-codes-postaux/items?limit=2",
  );
  assert(itemsRes.status === 200, `items status ${itemsRes.status}`);
  const items = (await itemsRes.json()) as {
    numberReturned?: number;
    features: Array<{
      geometry: unknown;
      properties: { geoId?: string; postalCode?: string; inseeCode?: string; communeName?: string };
    }>;
  };
  console.log("[smoke] fr-codes-postaux numberReturned:", items.numberReturned);
  assert(items.features.length === 2, `expected 2 features, got ${items.features.length}`);
  for (const f of items.features) {
    assert(f.geometry === null, "feature geometry is null");
    assert(typeof f.properties.postalCode === "string", "feature has postalCode");
    assert(typeof f.properties.inseeCode === "string", "feature has inseeCode");
    assert(typeof f.properties.geoId === "string", "feature has geoId");
    console.log(
      "[smoke]   feature:",
      f.properties.geoId,
      "-",
      f.properties.postalCode,
      "→",
      f.properties.inseeCode,
      `(${f.properties.communeName ?? "?"})`,
    );
  }

  console.log(
    "[smoke] OK — /collections and /collections/fr-codes-postaux/items?limit=2 served 200.",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
