import { describe, expect, it } from "vitest";

import { selectVerifiableSlugs } from "./qa-geo-internal-167-extract.js";

const A_SHA256 = `sha256:${"a".repeat(64)}`;
const B_SHA256 = `sha256:${"b".repeat(64)}`;
const C_SHA256 = `sha256:${"c".repeat(64)}`;

describe("qa geo internal 167 extract", () => {
  it("filters empty rows and deterministically sorts and deduplicates URL receipts", () => {
    expect(selectVerifiableSlugs({
      rows: [
        {
          slug: "zeta",
          verifiable_https_sha256_cases: [{ url: "https://example.test/zeta", sha256: C_SHA256 }],
        },
        { slug: "excluded", verifiable_https_sha256_cases: [] },
        {
          slug: "alpha",
          verifiable_https_sha256_cases: [
            { url: "https://example.test/z", sha256: B_SHA256 },
            { url: "https://example.test/a", sha256: A_SHA256 },
            { url: "https://example.test/z", sha256: B_SHA256 },
          ],
        },
      ],
    })).toEqual([
      {
        slug: "alpha",
        urls: [
          { url: "https://example.test/a", sha256: A_SHA256 },
          { url: "https://example.test/z", sha256: B_SHA256 },
        ],
      },
      { slug: "zeta", urls: [{ url: "https://example.test/zeta", sha256: C_SHA256 }] },
    ]);
  });
});
