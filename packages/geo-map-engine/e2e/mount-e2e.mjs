import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { build, createServer, preview } from "vite";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const listen = { host: "127.0.0.1", port: 0 };

const browser = await chromium.launch({ headless: true });
try {
  // 1. Vite dev server: the runtime is pre-bundled into `.vite/deps`.
  const devServer = await createServer({
    root: packageRoot,
    logLevel: "error",
    // This single-run harness never serves a hot update; disabling Vite's file
    // watcher keeps its Chromium proof independent from host watcher limits.
    server: { ...listen, watch: null },
  });
  try {
    await devServer.listen();
    await runScenario("dev", new URL("e2e/index.html", devServer.resolvedUrls?.local[0]).toString());
  } finally {
    await devServer.close();
  }

  // 2. Production build served statically: the runtime and the worker are
  // hashed assets, which is the hosting shape a consuming application ships.
  const outDir = await mkdtemp(path.join(os.tmpdir(), "geo-mount-e2e-"));
  try {
    await build({
      root: packageRoot,
      logLevel: "error",
      build: { outDir, emptyOutDir: true, rollupOptions: { input: path.join(packageRoot, "e2e/index.html") } },
    });
    const previewServer = await preview({ root: packageRoot, logLevel: "error", build: { outDir }, preview: listen });
    try {
      await runScenario("preview", new URL("e2e/index.html", previewServer.resolvedUrls?.local[0]).toString());
    } finally {
      await previewServer.close();
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
} finally {
  await browser.close();
}

async function runScenario(mode, pageUrl) {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.stack ?? error.message));

  await page.goto(pageUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__mountReady === true).catch((error) => {
    // A map that never loads (e.g. a missing MapLibre worker) only surfaces in
    // the browser console; keep it in the failure instead of a bare timeout.
    throw new Error(`[${mode}] ${error.message}\nErreurs navigateur:\n${browserErrors.join("\n")}`);
  });

  // The running module workers must come from the explicitly configured asset,
  // served as executable JavaScript (no HTML fallback, no missing hashed file).
  const workerUrls = page.workers().map((worker) => worker.url());
  assert.ok(
    workerUrls.length > 0 && workerUrls.every((url) => /maplibre-gl-worker[^/]*\.mjs/.test(url)),
    `[${mode}] workers MapLibre inattendus: ${JSON.stringify(workerUrls)}`,
  );
  const workerResponses = [];
  for (const url of new Set(workerUrls)) {
    const response = await page.request.get(url);
    workerResponses.push({ url, status: response.status(), contentType: response.headers()["content-type"] ?? "" });
  }
  for (const response of workerResponses) {
    assert.equal(response.status, 200, `[${mode}] worker MapLibre: ${JSON.stringify(response)}`);
    assert.match(response.contentType, /javascript/, `[${mode}] MIME worker: ${JSON.stringify(response)}`);
  }

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
  await page.close();
  console.log(`mount e2e [${mode}] OK — worker ${workerResponses.map((r) => `${r.status} ${r.contentType} ${r.url}`).join(", ")}`);
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
