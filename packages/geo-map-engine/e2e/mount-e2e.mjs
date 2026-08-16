import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { createServer } from "vite";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  root: packageRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
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
  assert.deepEqual(browserErrors, [], browserErrors.join("\n"));

  await page.evaluate(() => window.__mountE2e.handle.destroy());
} finally {
  await browser?.close();
  await server.close();
}
