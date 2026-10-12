import { describe, expect, it, vi } from "vitest";
import { ensureMaplibreWorker, type MaplibreWorkerApi } from "./maplibre-worker.js";

function fakeMaplibre(initial = ""): MaplibreWorkerApi & { url: string } {
  const api = {
    url: initial,
    getWorkerUrl: () => api.url,
    setWorkerUrl: (url: string) => {
      api.url = url;
    },
  };
  return api;
}

describe("ensureMaplibreWorker", () => {
  it("sets the bundled worker URL when MapLibre has none (MapLibre 6 default is empty)", async () => {
    const maplibre = fakeMaplibre();
    await ensureMaplibreWorker(maplibre, async () => "/assets/maplibre-gl-worker-abc.mjs");
    expect(maplibre.url).toBe("/assets/maplibre-gl-worker-abc.mjs");
  });

  it("keeps an application-provided worker URL and never loads the bundled one", async () => {
    const maplibre = fakeMaplibre("https://cdn.example/worker.mjs");
    const load = vi.fn(async () => "/assets/other.mjs");
    await ensureMaplibreWorker(maplibre, load);
    expect(maplibre.url).toBe("https://cdn.example/worker.mjs");
    expect(load).not.toHaveBeenCalled();
  });

  it("does not overwrite a URL set while the bundled one was loading", async () => {
    const maplibre = fakeMaplibre();
    await ensureMaplibreWorker(maplibre, async () => {
      maplibre.setWorkerUrl("/app/worker.mjs");
      return "/assets/late.mjs";
    });
    expect(maplibre.url).toBe("/app/worker.mjs");
  });

  it("resolves the real bundled worker asset through Vite's ?url import", async () => {
    const maplibre = fakeMaplibre();
    await ensureMaplibreWorker(maplibre);
    expect(maplibre.url).toMatch(/maplibre-gl-worker.*\.mjs/);
  });
});
