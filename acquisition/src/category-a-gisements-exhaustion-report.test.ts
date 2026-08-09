import { describe, expect, it } from "vitest";

import {
  CATEGORY_A_GISEMENT_TARGETS,
} from "./category-a-gisements-worklist.js";
import {
  classifyCategoryAAttempt,
} from "./category-a-gisements-exhaustion-report.js";

const lislet = CATEGORY_A_GISEMENT_TARGETS[0]!;

describe("category A exhaustion evidence", () => {
  it("distinguishes the MRC portal from its document centre", () => {
    expect(classifyCategoryAAttempt("https://mrclislet.com/", lislet))
      .toContain("portail_mrc");
    expect(classifyCategoryAAttempt("https://mrclislet.com/documentation/", lislet))
      .toEqual(expect.arrayContaining(["portail_mrc", "centre_documentaire_mrc"]));
  });

  it("classifies CMS, domain CDX and SIG attempts from their called URL", () => {
    expect(classifyCategoryAAttempt(
      "https://www.lislet.com/wp-json/wp/v2/media?search=zonage",
      lislet,
    )).toContain("cms_natif");
    expect(classifyCategoryAAttempt(
      "https://web.archive.org/cdx/search/cdx?url=lislet.com%2F*&matchType=domain",
      lislet,
    )).toContain("wayback_cdx_domaine");
    expect(classifyCategoryAAttempt(
      "https://www.arcgis.com/sharing/rest/search?q=L%27Islet",
      lislet,
    )).toContain("sig");
  });
});
