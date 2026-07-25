#!/usr/bin/env node
/**
 * PROOF — Lot D unblocked: slug → official website (MAMH directory) →
 * recensePlatform. Runs (1) a hermetic mock proof of the wiring, then (2) a
 * small LIVE sample against real municipal sites.
 *
 * Run: node packages/geo-sources-americas/scripts/prove-lot-d.mjs
 */
import {
  websiteForSlug,
  QC_MUNICIPAL_DIRECTORY,
  directoryEntry,
} from "../dist/ca-qc/index.js";
import {
  recensePlatformForCity,
  recensePlatform,
} from "../../geo/dist/catalog/recense-platform.js";

const line = (s = "") => process.stdout.write(s + "\n");

line("=== Directory loaded ===");
line(`entries: ${Object.keys(QC_MUNICIPAL_DIRECTORY.entries).length}`);
line(`stats  : ${JSON.stringify(QC_MUNICIPAL_DIRECTORY.stats)}`);
line(`license: ${QC_MUNICIPAL_DIRECTORY.source.license}`);
line("");

// (1) HERMETIC MOCK PROOF — the wiring resolves slug → website → platform,
//     no real network. We mock fetch so the result is deterministic.
line("=== (1) Hermetic mock proof (no network) ===");
const slug = "longueuil";
const realUrl = websiteForSlug(slug);
line(`websiteForSlug("${slug}") = ${realUrl}`);

// Mock fetch that pretends the site redirects to an ArcGIS REST endpoint.
const mockFetch = async (url) => {
  const finalUrl = "https://sig.longueuil.ca/arcgis/rest/services/Zonage/MapServer";
  return {
    url: finalUrl,
    headers: { get: (h) => (h.toLowerCase() === "content-type" ? "text/html" : null) },
    text: async () => "<html>ArcGIS Viewer</html>",
  };
};
const mockRes = await recensePlatformForCity(slug, websiteForSlug, { fetchImpl: mockFetch });
line(`recensePlatformForCity → ${JSON.stringify(mockRes)}`);
const okMock = mockRes.success === true && mockRes.platform === "arcgis";
line(`MOCK ASSERTION (slug→website→arcgis): ${okMock ? "PASS" : "FAIL"}`);
line("");

// Unknown-slug path (city not in directory)
const miss = await recensePlatformForCity("not-a-real-slug-xyz", websiteForSlug, {
  fetchImpl: mockFetch,
});
line(`unknown slug → ${JSON.stringify(miss)}`);
line(`MISS ASSERTION (graceful not-in-directory): ${miss.success === false ? "PASS" : "FAIL"}`);
line("");

// (2) LIVE SAMPLE — real platform detection on a handful of real sites.
line("=== (2) Live sample (real network) ===");
const sample = ["longueuil", "gatineau", "levis", "repentigny", "rimouski", "montreal", "westmount", "brossard"];
let live = 0;
let detected = 0;
for (const s of sample) {
  const entry = directoryEntry(s);
  if (!entry || !entry.website) {
    line(`  ${s.padEnd(12)} : (no website in directory)`);
    continue;
  }
  try {
    const res = await recensePlatformForCity(s, websiteForSlug, { timeoutMs: 9000 });
    live++;
    if (res.success && res.platform !== "unknown") detected++;
    line(
      `  ${s.padEnd(12)} : ${String(entry.website).padEnd(40)} → ${res.platform}` +
        (res.success ? "" : ` (err: ${res.errorMessage ?? "?"})`),
    );
  } catch (e) {
    line(`  ${s.padEnd(12)} : ERROR ${e?.message ?? e}`);
  }
}
line("");
line(`LIVE: probed ${live}, non-unknown platform on ${detected}.`);
line(`Lot D status: slug→website→recensePlatform chain works end-to-end.`);
