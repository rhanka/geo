/**
 * robots.txt fetch + parse + policy — politeness/safety gate for the discovery
 * crawl (see grille-discovery.ts). The PV crawler this discovery infra reuses
 * never consulted robots.txt; before a province-wide grille crawl (~1100 munis)
 * we MUST honour it.
 *
 * Design (kept deliberately small, pure-where-possible, injectable fetch):
 *   - `parseRobotsTxt(text)` — pure parser of the standard fields we act on:
 *     User-agent groups, Disallow / Allow path rules, Crawl-delay. Returns a
 *     typed `RobotsRules`.
 *   - `isPathAllowed(rules, path, userAgent)` — applies the most-specific
 *     matching group (our UA token > "*") with the longest-match Allow/Disallow
 *     precedence the REP describes. Pure.
 *   - `RobotsCache` — fetches and caches `/robots.txt` per ORIGIN (one network
 *     hit per domain), then exposes `isAllowed(url)` and `crawlDelayMs(url)`.
 *
 * PERMISSIVE-ON-FAILURE (standard REP behaviour): if robots.txt is absent (404),
 * times out, or is unreachable, we DEFAULT TO ALLOW and log the reason — a
 * missing robots.txt does not forbid crawling. A robots.txt that is fetched and
 * explicitly Disallows a path IS respected (we never fetch that URL).
 *
 * ANTI-INVENTION: this module only reasons over bytes actually returned by the
 * server for `<origin>/robots.txt`. It never assumes rules that were not served.
 */

import { PV_USER_AGENT, PvSourceFetchError, type PvFetchLike } from "./proces-verbaux-generic.js";

// ─────────────────────────────────────────────────────────────────────────────
// Parsed model
// ─────────────────────────────────────────────────────────────────────────────

/** One Allow/Disallow path rule (verbatim path prefix from robots.txt). */
export interface RobotsRule {
  /** "allow" or "disallow". */
  readonly type: "allow" | "disallow";
  /** The path value as written (may contain `*` and `$` wildcards). */
  readonly path: string;
}

/** The rules + crawl-delay that apply to one user-agent group. */
export interface RobotsGroup {
  /** Lower-cased user-agent token this group targets ("*" for the wildcard). */
  readonly agent: string;
  readonly rules: RobotsRule[];
  /** Crawl-delay in seconds when the group declares one, else null. */
  readonly crawlDelaySec: number | null;
}

/** Full parsed robots.txt. */
export interface RobotsRules {
  readonly groups: RobotsGroup[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser (pure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse robots.txt text into grouped rules.
 *
 * Follows the de-facto REP: consecutive `User-agent:` lines start (or extend) a
 * group; the `Allow`/`Disallow`/`Crawl-delay` lines that follow belong to every
 * agent named since the last non-User-agent directive. Comments (`#…`) and blank
 * lines are ignored. Never throws — a malformed line is skipped.
 */
export function parseRobotsTxt(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  // Agents currently being defined (consecutive User-agent lines share rules).
  let currentAgents: string[] = [];
  // Whether the previous meaningful line was a User-agent (to allow grouping).
  let lastWasAgent = false;
  // Mutable accumulators keyed by agent for the active group block.
  const byAgent = new Map<string, { rules: RobotsRule[]; crawlDelaySec: number | null }>();

  const ensure = (agent: string): { rules: RobotsRule[]; crawlDelaySec: number | null } => {
    let g = byAgent.get(agent);
    if (!g) {
      g = { rules: [], crawlDelaySec: null };
      byAgent.set(agent, g);
      groups.push({ agent, rules: g.rules, crawlDelaySec: g.crawlDelaySec });
    }
    return g;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent" || field === "useragent") {
      const agent = value.toLowerCase();
      if (!agent) continue;
      if (!lastWasAgent) currentAgents = [];
      currentAgents.push(agent);
      ensure(agent);
      lastWasAgent = true;
      continue;
    }

    // Any directive other than User-agent closes the run of agent lines.
    lastWasAgent = false;
    if (currentAgents.length === 0) {
      // Directive before any User-agent — treat as applying to "*" (lenient).
      currentAgents = ["*"];
      ensure("*");
    }

    if (field === "disallow" || field === "allow") {
      for (const agent of currentAgents) {
        ensure(agent).rules.push({ type: field, path: value });
      }
    } else if (field === "crawl-delay" || field === "crawldelay") {
      const sec = Number(value.replace(",", "."));
      if (Number.isFinite(sec) && sec >= 0) {
        for (const agent of currentAgents) ensure(agent).crawlDelaySec = sec;
      }
    }
    // Sitemap / Host / other fields are ignored (not actioned by this crawler).
  }

  // Reconcile the crawl-delay values written through the mutable accumulators
  // back into the immutable group objects (groups[].crawlDelaySec was captured
  // at creation time as null).
  return {
    groups: groups.map((g) => {
      const acc = byAgent.get(g.agent);
      return { agent: g.agent, rules: g.rules, crawlDelaySec: acc?.crawlDelaySec ?? null };
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** Lower-cased product token of a UA string ("radar-immobilier/0.1 (+…)" → "radar-immobilier"). */
function productToken(userAgent: string): string {
  const slash = userAgent.indexOf("/");
  const head = (slash >= 0 ? userAgent.slice(0, slash) : userAgent).trim().toLowerCase();
  return head;
}

/**
 * Pick the group that applies to `userAgent`: the most specific group whose
 * agent token is a (case-insensitive) substring match of our UA product token,
 * else the "*" wildcard group, else null. REP says the single most-specific
 * matching group wins (rules are NOT merged across groups).
 */
function selectGroup(rules: RobotsRules, userAgent: string): RobotsGroup | null {
  const token = productToken(userAgent);
  let best: RobotsGroup | null = null;
  let bestLen = -1;
  let star: RobotsGroup | null = null;
  for (const g of rules.groups) {
    if (g.agent === "*") {
      star = g;
      continue;
    }
    // A group matches when our UA token starts with (or equals) the group token.
    if (token === g.agent || token.startsWith(g.agent)) {
      if (g.agent.length > bestLen) {
        best = g;
        bestLen = g.agent.length;
      }
    }
  }
  return best ?? star;
}

/** Translate a robots path pattern (with `*` and trailing `$`) to a RegExp. */
function patternToRegExp(pattern: string): RegExp {
  let anchored = false;
  let p = pattern;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const escaped = p
    .split("*")
    .map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + escaped + (anchored ? "$" : ""));
}

/** Effective match length of a rule against a path (the literal prefix, wildcards as 0). */
function matchLength(rulePath: string, path: string): number {
  if (rulePath === "") return -1; // empty Disallow ⇒ no restriction; never "matches"
  const re = patternToRegExp(rulePath);
  if (!re.test(path)) return -1;
  // Specificity ≈ the rule path length (REP longest-match precedence).
  return rulePath.replace(/\*/g, "").length;
}

/**
 * Decide whether `path` (the URL path + query, e.g. "/urbanisme") is allowed for
 * `userAgent` under `rules`. REP longest-match precedence: the most specific
 * matching rule wins; on an exact-length tie, Allow wins over Disallow. With no
 * matching rule (or an empty Disallow group), the path is allowed.
 */
export function isPathAllowed(
  rules: RobotsRules,
  path: string,
  userAgent: string = PV_USER_AGENT,
): boolean {
  const group = selectGroup(rules, userAgent);
  if (!group) return true; // no applicable group ⇒ allowed
  let bestLen = -1;
  let bestAllow = true; // default allow
  for (const rule of group.rules) {
    const len = matchLength(rule.path, path);
    if (len < 0) continue;
    if (len > bestLen || (len === bestLen && rule.type === "allow")) {
      bestLen = len;
      bestAllow = rule.type === "allow";
    }
  }
  return bestLen < 0 ? true : bestAllow;
}

/** Crawl-delay (seconds) that applies to `userAgent`, or null when none declared. */
export function crawlDelaySec(
  rules: RobotsRules,
  userAgent: string = PV_USER_AGENT,
): number | null {
  return selectGroup(rules, userAgent)?.crawlDelaySec ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-origin cache (impure: fetches robots.txt once per domain)
// ─────────────────────────────────────────────────────────────────────────────

/** Why a domain ended up permissive-by-default (for honest logging). */
export type RobotsLoadStatus =
  | "loaded" // robots.txt fetched + parsed
  | "absent" // 404 / not found → permissive
  | "error" // network / timeout / non-text → permissive
  | "empty"; // fetched but no actionable rules → permissive

/** One cached origin entry. */
interface RobotsCacheEntry {
  readonly rules: RobotsRules;
  readonly status: RobotsLoadStatus;
  readonly detail?: string;
}

/** Empty (fully permissive) rule-set used when robots.txt is unavailable. */
const PERMISSIVE: RobotsRules = { groups: [] };

/** Options for the RobotsCache. */
export interface RobotsCacheOptions {
  readonly fetchImpl?: PvFetchLike;
  readonly userAgent?: string;
  readonly timeoutMs?: number;
  /** Sink for honest "why permissive" / "blocked" logs (defaults to console.error). */
  readonly log?: (msg: string) => void;
}

const DEFAULT_ROBOTS_TIMEOUT_MS = 10_000;

/**
 * Fetches + caches robots.txt per origin and answers allow/crawl-delay queries.
 * One network hit per domain for the whole crawl; permissive on any failure.
 */
export class RobotsCache {
  private readonly fetchImpl: PvFetchLike;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly log: (msg: string) => void;
  private readonly cache = new Map<string, RobotsCacheEntry>();

  constructor(opts: RobotsCacheOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as PvFetchLike);
    this.userAgent = opts.userAgent ?? PV_USER_AGENT;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_ROBOTS_TIMEOUT_MS;
    this.log = opts.log ?? ((m) => console.error(m));
  }

  /** Origin ("https://host") for a URL, or null if malformed. */
  private originOf(url: string): string | null {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }

  /** Load (or return cached) rules for a URL's origin. */
  async rulesFor(url: string): Promise<RobotsCacheEntry> {
    const origin = this.originOf(url);
    if (!origin) return { rules: PERMISSIVE, status: "error", detail: "malformed url" };
    const hit = this.cache.get(origin);
    if (hit) return hit;

    const robotsUrl = `${origin}/robots.txt`;
    let entry: RobotsCacheEntry;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(robotsUrl, {
        signal: controller.signal,
        headers: { "user-agent": this.userAgent, accept: "text/plain,*/*" },
      });
      if (!res.ok) {
        // 404 (and most 4xx) ⇒ no robots.txt ⇒ permissive (standard REP).
        entry = { rules: PERMISSIVE, status: "absent", detail: `HTTP ${res.status}` };
        this.log(`[robots] ${origin} → permissive (robots.txt HTTP ${res.status})`);
      } else {
        const ct = res.headers.get("content-type") ?? "";
        const text = new TextDecoder("utf-8").decode(new Uint8Array(await res.arrayBuffer()));
        // Some misconfigured sites return an HTML 200 error page for /robots.txt.
        if (/html/i.test(ct) || /^\s*<!doctype|^\s*<html/i.test(text)) {
          entry = { rules: PERMISSIVE, status: "absent", detail: "HTML response (no robots.txt)" };
          this.log(`[robots] ${origin} → permissive (robots.txt is an HTML page)`);
        } else {
          const rules = parseRobotsTxt(text);
          const actionable = rules.groups.some(
            (g) => g.rules.length > 0 || g.crawlDelaySec !== null,
          );
          entry = actionable
            ? { rules, status: "loaded" }
            : { rules, status: "empty" };
          if (!actionable) this.log(`[robots] ${origin} → permissive (no actionable rules)`);
        }
      }
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      const detail =
        e instanceof PvSourceFetchError ? e.message : isAbort ? "timeout" : e instanceof Error ? e.message : String(e);
      entry = { rules: PERMISSIVE, status: "error", detail };
      this.log(`[robots] ${origin} → permissive (robots.txt fetch failed: ${detail})`);
    } finally {
      clearTimeout(timer);
    }

    this.cache.set(origin, entry);
    return entry;
  }

  /** True when `url` may be fetched under the origin's robots.txt for our UA. */
  async isAllowed(url: string): Promise<boolean> {
    const { rules } = await this.rulesFor(url);
    let path: string;
    try {
      const u = new URL(url);
      path = u.pathname + u.search;
    } catch {
      return true; // can't parse ⇒ don't block on robots grounds
    }
    return isPathAllowed(rules, path, this.userAgent);
  }

  /**
   * Crawl-delay for `url`'s origin in MILLISECONDS, or null when none declared.
   * The caller takes the MAX of this and its own --delay-ms politeness floor.
   */
  async crawlDelayMs(url: string): Promise<number | null> {
    const { rules } = await this.rulesFor(url);
    const sec = crawlDelaySec(rules, this.userAgent);
    return sec === null ? null : Math.round(sec * 1000);
  }

  /** Load status for a URL's origin (for honest run-time logging/diagnostics). */
  async statusFor(url: string): Promise<RobotsLoadStatus> {
    return (await this.rulesFor(url)).status;
  }
}
