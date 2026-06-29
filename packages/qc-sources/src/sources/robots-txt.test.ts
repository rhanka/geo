import { describe, it, expect } from "vitest";

import {
  parseRobotsTxt,
  isPathAllowed,
  crawlDelaySec,
  RobotsCache,
} from "./robots-txt.js";
import { PV_USER_AGENT, type PvFetchLike } from "./proces-verbaux-generic.js";

// ─────────────────────────────────────────────────────────────────────────────
// parseRobotsTxt + isPathAllowed (pure)
// ─────────────────────────────────────────────────────────────────────────────

describe("parseRobotsTxt", () => {
  it("parses a wildcard group with Disallow + Crawl-delay", () => {
    const r = parseRobotsTxt(
      "User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nCrawl-delay: 3\n",
    );
    expect(r.groups).toHaveLength(1);
    const g = r.groups[0]!;
    expect(g.agent).toBe("*");
    expect(g.crawlDelaySec).toBe(3);
    expect(g.rules).toEqual([
      { type: "disallow", path: "/wp-admin/" },
      { type: "allow", path: "/wp-admin/admin-ajax.php" },
    ]);
  });

  it("ignores comments and blank lines, parses Sitemap as a no-op", () => {
    const r = parseRobotsTxt(
      "# comment\n\nUser-agent: *\nDisallow: /private/\n\nSitemap: https://x.qc.ca/sitemap.xml\n",
    );
    expect(r.groups[0]!.rules).toEqual([{ type: "disallow", path: "/private/" }]);
  });

  it("groups rules under multiple consecutive User-agent lines", () => {
    const r = parseRobotsTxt(
      "User-agent: Googlebot\nUser-agent: radar-immobilier\nDisallow: /secret/\n",
    );
    const agents = r.groups.map((g) => g.agent).sort();
    expect(agents).toEqual(["googlebot", "radar-immobilier"]);
    for (const g of r.groups) {
      expect(g.rules).toEqual([{ type: "disallow", path: "/secret/" }]);
    }
  });
});

describe("isPathAllowed", () => {
  const wpAdmin = parseRobotsTxt("User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n");

  it("blocks a disallowed prefix", () => {
    expect(isPathAllowed(wpAdmin, "/wp-admin/options.php")).toBe(false);
  });

  it("allows a content page outside the disallow prefix", () => {
    expect(isPathAllowed(wpAdmin, "/urbanisme")).toBe(true);
  });

  it("honours a more-specific Allow over a broader Disallow (longest match)", () => {
    expect(isPathAllowed(wpAdmin, "/wp-admin/admin-ajax.php")).toBe(true);
  });

  it("treats an empty Disallow value as no restriction (full access)", () => {
    const empty = parseRobotsTxt("User-agent: *\nDisallow:\n");
    expect(isPathAllowed(empty, "/anything")).toBe(true);
  });

  it("prefers a UA-specific group over the wildcard group", () => {
    const r = parseRobotsTxt(
      "User-agent: *\nDisallow: /\n\nUser-agent: radar-immobilier\nDisallow:\n",
    );
    // wildcard blocks everything, but our specific group allows everything
    expect(isPathAllowed(r, "/urbanisme", PV_USER_AGENT)).toBe(true);
    // a different UA falls back to the wildcard (blocked)
    expect(isPathAllowed(r, "/urbanisme", "SomeOtherBot/1.0")).toBe(false);
  });

  it("supports * wildcard and $ end-anchor in patterns", () => {
    const r = parseRobotsTxt("User-agent: *\nDisallow: /*.pdf$\n");
    expect(isPathAllowed(r, "/docs/grille.pdf")).toBe(false);
    expect(isPathAllowed(r, "/docs/grille.pdf?v=2")).toBe(true); // query after .pdf ⇒ not end-anchored
  });
});

describe("crawlDelaySec", () => {
  it("returns the declared crawl-delay for the applicable group", () => {
    const r = parseRobotsTxt("User-agent: *\nCrawl-delay: 10\n");
    expect(crawlDelaySec(r)).toBe(10);
  });
  it("returns null when none is declared", () => {
    const r = parseRobotsTxt("User-agent: *\nDisallow: /x/\n");
    expect(crawlDelaySec(r)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RobotsCache (injected fetch, no network)
// ─────────────────────────────────────────────────────────────────────────────

function textResponse(body: string, status = 200, contentType = "text/plain"): Awaited<ReturnType<PvFetchLike>> {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe("RobotsCache", () => {
  it("respects a Disallow rule and allows other paths, fetching robots.txt once per origin", async () => {
    let robotsHits = 0;
    const fetchImpl: PvFetchLike = async (url) => {
      if (url.endsWith("/robots.txt")) {
        robotsHits++;
        return textResponse("User-agent: *\nDisallow: /craft/\nCrawl-delay: 2\n");
      }
      return textResponse("ok");
    };
    const cache = new RobotsCache({ fetchImpl, log: () => {} });

    expect(await cache.isAllowed("https://x.qc.ca/craft/secret")).toBe(false);
    expect(await cache.isAllowed("https://x.qc.ca/urbanisme")).toBe(true);
    expect(await cache.crawlDelayMs("https://x.qc.ca/urbanisme")).toBe(2000);
    // second + third query to same origin must not re-fetch robots.txt
    expect(robotsHits).toBe(1);
  });

  it("defaults to ALLOW when robots.txt is 404 (absent), and logs why", async () => {
    const logs: string[] = [];
    const fetchImpl: PvFetchLike = async () => textResponse("Not Found", 404, "text/html");
    const cache = new RobotsCache({ fetchImpl, log: (m) => logs.push(m) });
    expect(await cache.isAllowed("https://capsante.qc.ca/urbanisme")).toBe(true);
    expect(await cache.statusFor("https://capsante.qc.ca/urbanisme")).toBe("absent");
    expect(logs.some((l) => /permissive/.test(l))).toBe(true);
  });

  it("defaults to ALLOW when robots.txt fetch throws (network/timeout)", async () => {
    const fetchImpl: PvFetchLike = async () => {
      throw new Error("ECONNRESET");
    };
    const cache = new RobotsCache({ fetchImpl, log: () => {} });
    expect(await cache.isAllowed("https://x.qc.ca/urbanisme")).toBe(true);
    expect(await cache.statusFor("https://x.qc.ca/urbanisme")).toBe("error");
  });

  it("treats an HTML 200 page served for /robots.txt as absent (permissive)", async () => {
    const fetchImpl: PvFetchLike = async () =>
      textResponse("<!DOCTYPE html><html>oops</html>", 200, "text/html; charset=utf-8");
    const cache = new RobotsCache({ fetchImpl, log: () => {} });
    expect(await cache.isAllowed("https://x.qc.ca/urbanisme")).toBe(true);
    expect(await cache.statusFor("https://x.qc.ca/urbanisme")).toBe("absent");
  });
});
