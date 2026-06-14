/**
 * Smoke test for the acquired ca-provinces data, exercised through the real
 * OGC API – Features app + FileProvider over data/normalized.
 *
 * Run from the repo root:  node packages/geo-source-ca/scripts/smoke.mjs
 * Exits non-zero on any failed assertion.
 */

import { createApp, FileProvider } from "@sentropic/geo-api";

function assert(cond, msg) {
  if (!cond) {
    console.error(`SMOKE FAIL: ${msg}`);
    process.exit(1);
  }
  console.error(`ok: ${msg}`);
}

const app = createApp(new FileProvider("data/normalized"));

// /collections — ca-provinces present.
const collectionsRes = await app.request("/collections");
assert(collectionsRes.status === 200, `/collections → 200 (got ${collectionsRes.status})`);
const collections = await collectionsRes.json();
const ids = collections.collections.map((c) => c.id);
assert(ids.includes("ca-provinces"), `/collections includes ca-provinces (got ${ids.join(", ")})`);

// /collections/ca-provinces/items?limit=2 — features with geoId/name/iso.
const itemsRes = await app.request("/collections/ca-provinces/items?limit=2");
assert(itemsRes.status === 200, `items → 200 (got ${itemsRes.status})`);
const items = await itemsRes.json();
assert(items.type === "FeatureCollection", "items body is a FeatureCollection");
assert(items.numberMatched === 13, `numberMatched === 13 (got ${items.numberMatched})`);
assert(items.features.length === 2, `returned 2 features (got ${items.features.length})`);

for (const f of items.features) {
  const p = f.properties;
  assert(typeof p.geoId === "string" && p.geoId.startsWith("ca/province/"), `feature has geoId (${p.geoId})`);
  assert(typeof p.name === "string" && p.name.length > 0, `feature has name (${p.name})`);
  assert(typeof p.iso === "string" && /^CA-[A-Z]{2}$/.test(p.iso), `feature has ISO 3166-2 iso (${p.iso})`);
  assert(p.country === "CA", "feature country === CA");
  assert(["province", "territory"].includes(p.level), `feature level province|territory (${p.level})`);
}

console.error("SMOKE PASS");
