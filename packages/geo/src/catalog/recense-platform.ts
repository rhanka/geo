export type DetectedPlatform = "arcgis" | "ckan" | "jmap" | "gonet" | "pdf" | "unknown";

export interface PlatformDetectionResult {
  success: true;
  slug: string;
  siteUrl: string;
  platform: DetectedPlatform;
  evidence: string;
}

export interface CityNotInDirectoryResult {
  success: false;
  slug: string;
  siteUrl: null;
  platform: "unknown";
  evidence: string;
  errorMessage: string;
}

export interface RecensePlatformOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type WebsiteResolver = (slug: string) => string | null | undefined;

export async function recensePlatformForCity(
  slug: string,
  websiteForSlug: WebsiteResolver,
  opts: RecensePlatformOptions = {},
): Promise<PlatformDetectionResult | CityNotInDirectoryResult> {
  const siteUrl = websiteForSlug(slug);
  if (!siteUrl) {
    return {
      success: false,
      slug,
      siteUrl: null,
      platform: "unknown",
      evidence: "city not found in directory",
      errorMessage: `no website for slug ${slug}`,
    };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const controller = new AbortController();
    const timeout = opts.timeoutMs
      ? setTimeout(() => controller.abort(), opts.timeoutMs)
      : null;
    try {
      const response = await fetchImpl(siteUrl, {
        signal: controller.signal,
      } as RequestInit);
      const text = await response.text().catch(() => "");
      const platform = detectPlatform(`${response.url ?? siteUrl}\n${text}`);
      return {
        success: true,
        slug,
        siteUrl,
        platform,
        evidence: platform === "unknown" ? "no platform signature detected" : `detected ${platform} signature`,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  } catch (error) {
    return {
      success: false,
      slug,
      siteUrl: null,
      platform: "unknown",
      evidence: "platform detection failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function detectPlatform(text: string): DetectedPlatform {
  const hay = text.toLowerCase();
  if (/arcgis|esri|featureserver|mapserver|arcgis\.com|services/.test(hay)) return "arcgis";
  if (/ckan|donneesquebec|donnees\.quebec/.test(hay)) return "ckan";
  if (/jmap|k2geospatial|kheops/.test(hay)) return "jmap";
  if (/gonet|goazimut|azimut|pg solutions|pgsolutions/.test(hay)) return "gonet";
  if (/\.pdf\b|application\/pdf|plan de zonage/.test(hay)) return "pdf";
  return "unknown";
}
