import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { createServer } from "vite";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  root: packageRoot,
  logLevel: "error",
  // This single-run harness never serves a hot update; disabling Vite's file
  // watcher keeps its Chromium proof independent from host watcher limits.
  server: { host: "127.0.0.1", port: 0, watch: null },
});

let browser;
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  assert.ok(url, "Vite n'a pas exposé d'URL locale");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.stack ?? error.message));

  await page.goto(new URL("e2e/index.html", url).toString(), { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__mountReady === true);

  const host = await page.locator("#map-host").boundingBox();
  assert.ok(host, "Le host MapLibre est absent");

  // These calls cross the public handle, whose implementation calls the real
  // MapLibre queryRenderedFeatures on the rendered Chromium map.
  const initialHandleResult = await page.evaluate(() => ({
    hits: window.__mountE2e.handle.queryRenderedFeatures(),
    densityBoundary: window.__mountE2e.handle.getFeatureBoundary("layers/density", "density-1"),
  }));

  // Centre du polygone, puis son bord ouest. Les mouvements passent par le
  // handler d'hover du mount, qui appelle la vraie queryRenderedFeatures de MapLibre.
  await page.mouse.move(host.x + 480, host.y + 320);
  await page.mouse.click(host.x + 480, host.y + 320);
  for (const delta of [-1, 0, 1]) {
    await page.mouse.move(host.x + 276 + delta, host.y + 320);
  }

  const result = await page.evaluate(() => {
    const canvas = document.querySelector("#map-host canvas");
    return {
      renderedLayerIds: window.__mountE2e.observedRenderedLayerIds.flat(),
      hoverHits: window.__mountE2e.observedHoverHits,
      selectHits: window.__mountE2e.observedSelectHits,
      canvasDataUrlLength: canvas?.toDataURL("image/png").length ?? 0,
    };
  });

  assert.deepEqual(
    new Set(["layers/density", "layers/density::outline", "layers/signals"])
      .difference(new Set(result.renderedLayerIds)),
    new Set(),
    `Sous-couches absentes de queryRenderedFeatures: ${JSON.stringify(result)}`,
  );
  assert.ok(
    result.hoverHits.some((hit) => hit?.layerId === "layers/signals"),
    `Hover MapLibre signal absent: ${JSON.stringify(result.hoverHits)}`,
  );
  assert.ok(
    result.hoverHits.some((hit) => hit?.layerId === "layers/density"),
    `Hover MapLibre densité absent: ${JSON.stringify(result.hoverHits)}`,
  );
  assert.equal(result.selectHits.at(-1)?.layerId, "layers/signals");
  assert.ok(result.canvasDataUrlLength > 1_000, "Frame canvas MapLibre vide");
  assert.ok(
    initialHandleResult.hits.some((hit) => (
      hit.layerId === "layers/density" &&
      hit.featureId === "density-1" &&
      hit.properties.density === 12
    )),
    `Hit densité renderer-neutre absent: ${JSON.stringify(initialHandleResult.hits)}`,
  );
  assert.ok(
    initialHandleResult.hits.some((hit) => (
      hit.layerId === "layers/signals" &&
      hit.featureId === "signal-1" &&
      hit.properties.size === 8
    )),
    `Hit signal renderer-neutre absent: ${JSON.stringify(initialHandleResult.hits)}`,
  );
  assertBoundsClose(initialHandleResult.densityBoundary, {
    west: -71.57,
    south: 46.76,
    east: -71.43,
    north: 46.84,
  });

  // The imperative namespace is applied after the first rendered frame, then
  // a declarative update removes `layers/signals`. A surviving visible sync
  // hit proves the `layers/` reconciler did not traverse `sync/`.
  await page.evaluate(() => window.__mountE2e.syncAndReconcile());
  await page.waitForFunction(() => window.__mountE2e.handle.queryRenderedFeatures().some((hit) => (
    hit.layerId === "sync/alerts" && hit.featureId === "alert-1"
  )));
  const afterSyncHits = await page.evaluate(() => window.__mountE2e.handle.queryRenderedFeatures());
  assert.ok(
    afterSyncHits.some((hit) => (
      hit.layerId === "sync/alerts" &&
      hit.featureId === "alert-1" &&
      hit.properties.severity === "high"
    )),
    `Couche sync non rendue ou non isolée: ${JSON.stringify(afterSyncHits)}`,
  );
  assert.ok(
    !afterSyncHits.some((hit) => hit.layerId === "layers/signals"),
    `La réconciliation déclarative a conservé une couche retirée: ${JSON.stringify(afterSyncHits)}`,
  );
  assert.deepEqual(browserErrors, [], browserErrors.join("\n"));

  await page.evaluate(() => window.__mountE2e.handle.destroy());
} finally {
  await browser?.close();
  await server.close();
}

function assertBoundsClose(actual, expected) {
  assert.ok(actual, "Limites de la feature rendue absentes");
  for (const [key, expectedValue] of Object.entries(expected)) {
    assert.ok(
      // MapLibre returns the rendered tile geometry, whose integer extent is
      // dequantized back to CRS84 coordinates. The boundary must remain close
      // to the source geometry without pretending those coordinates are exact.
      Math.abs(actual[key] - expectedValue) < 1e-4,
      `Borne ${key} inattendue: ${JSON.stringify(actual)}`,
    );
  }
}
