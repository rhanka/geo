/**
 * pv-worklist-headprobe.ts — durcit une worklist de capture AVANT soumission au
 * cluster : ne conserve que les URL réellement VIVANTES et NON bloquées par
 * robots.txt, pour ne pas gaspiller de pods sur des liens morts.
 *
 * Motivation (vague 2, 2026-08-16) : la découverte web enregistre des ancres
 * documentaires sans télécharger le document ; certaines sont périmées (404) ou
 * interdites par robots. La capture cluster perdait alors ~75 % des URL. Ce
 * runner sonde chaque URL en amont :
 *   - robots.txt (même UA que la capture, PV_USER_AGENT) : disallowed ⇒ classé
 *     `capture_bound_robots` (le PV EXISTE mais la capture polie ne peut pas le
 *     prendre — c'est un UNKNOWN capture-bound, JAMAIS un N-A) ;
 *   - liveness : requête HEAD (repli GET Range: bytes=0-0 si HEAD refusé) ;
 *     2xx/206 ⇒ `live` (soumis), sinon `dead` (écarté).
 *
 * LECTURE SEULE : HEAD/robots uniquement, aucun octet de document conservé,
 * aucun dépôt S3, aucune capture. Émet une worklist filtrée (URL vivantes) et un
 * rapport de classification par municipalité.
 *
 * Usage :
 *   NODE_OPTIONS=--dns-result-order=ipv4first \
 *   npx tsx acquisition/src/pv-worklist-headprobe.ts \
 *     --worklist work/coverage/pv-decouverte-...-capture-lot-0001.json \
 *     --out work/coverage/pv-worklist-headprobe-<UTC>.json \
 *     --out-capture-worklist work/coverage/pv-decouverte-...-capture-lot-0001-live.json \
 *     [--timeout-ms 15000] [--delay-ms 300]
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  PV_USER_AGENT,
  type PvFetchLike,
} from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";
import { RobotsCache } from "../../packages/qc-sources/src/sources/robots-txt.js";
import { parseCaptureWorklist } from "../../packages/qc-sources/src/capture/index.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function insideCoverage(path: string, name: string): string {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${COVERAGE}/`) || !absolute.endsWith(".json")) {
    throw new Error(`--${name} doit être un JSON sous work/coverage`);
  }
  return absolute;
}

function compactError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, " ").trim().slice(0, 300);
}

type UrlClass = "live" | "dead" | "capture_bound_robots";

interface UrlVerdict {
  readonly url: string;
  readonly class: UrlClass;
  readonly status: number | null;
  readonly content_type: string | null;
  readonly error: string | null;
}

async function probeLiveness(
  url: string,
  fetchImpl: PvFetchLike,
  timeoutMs: number,
): Promise<{ status: number | null; contentType: string | null; error: string | null }> {
  const attempt = async (method: "HEAD" | "GET"): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { "User-Agent": PV_USER_AGENT };
      if (method === "GET") headers.Range = "bytes=0-0";
      return await (fetchImpl as unknown as typeof fetch)(url, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let response = await attempt("HEAD");
    // Beaucoup de serveurs municipaux rejettent HEAD (403/405/501) tout en
    // servant le GET : on retente une fois en GET borné à un octet.
    if (response.status === 403 || response.status === 405 || response.status === 501) {
      await response.body?.cancel();
      response = await attempt("GET");
    }
    const contentType = response.headers.get("content-type");
    await response.body?.cancel();
    return { status: response.status, contentType, error: null };
  } catch (error) {
    return { status: null, contentType: null, error: compactError(error) };
  }
}

function isLive(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

async function main(): Promise<void> {
  const worklistArg = arg("worklist");
  const outArg = arg("out");
  const outWorklistArg = arg("out-capture-worklist");
  if (!worklistArg || !outArg || !outWorklistArg) {
    throw new Error("--worklist, --out et --out-capture-worklist sont requis");
  }
  const worklistPath = resolve(ROOT, worklistArg);
  const outPath = insideCoverage(outArg, "out");
  const outWorklistPath = insideCoverage(outWorklistArg, "out-capture-worklist");
  if (existsSync(outPath)) throw new Error(`artefact déjà présent: ${outPath}`);
  if (existsSync(outWorklistPath)) throw new Error(`artefact déjà présent: ${outWorklistPath}`);
  const timeoutMs = Number(arg("timeout-ms") ?? "15000");
  const delayMs = Number(arg("delay-ms") ?? "300");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) throw new Error("--timeout-ms >= 1000 requis");
  if (!Number.isInteger(delayMs) || delayMs < 0) throw new Error("--delay-ms >= 0 requis");

  const targets = parseCaptureWorklist(JSON.parse(readFileSync(worklistPath, "utf8")));
  const fetchImpl = globalThis.fetch as unknown as PvFetchLike;
  const robots = new RobotsCache({ fetchImpl, userAgent: PV_USER_AGENT, timeoutMs });

  const municipalities: Array<{
    slug: string;
    source: string;
    total: number;
    live: number;
    dead: number;
    capture_bound_robots: number;
    urls: UrlVerdict[];
  }> = [];
  const liveTargets: Array<{ slug: string; source: string; urls: string[] }> = [];

  for (const target of targets) {
    const verdicts: UrlVerdict[] = [];
    const liveUrls: string[] = [];
    for (const url of target.urls) {
      let verdict: UrlVerdict;
      let allowed = true;
      try {
        allowed = await robots.isAllowed(url);
      } catch {
        allowed = true; // robots injoignable = permissif (comme pv-index-run)
      }
      if (!allowed) {
        verdict = { url, class: "capture_bound_robots", status: null, content_type: null, error: null };
      } else {
        const probe = await probeLiveness(url, fetchImpl, timeoutMs);
        verdict = {
          url,
          class: isLive(probe.status) ? "live" : "dead",
          status: probe.status,
          content_type: probe.contentType,
          error: probe.error,
        };
        if (verdict.class === "live") liveUrls.push(url);
      }
      verdicts.push(verdict);
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
    municipalities.push({
      slug: target.slug,
      source: target.source,
      total: target.urls.length,
      live: verdicts.filter((v) => v.class === "live").length,
      dead: verdicts.filter((v) => v.class === "dead").length,
      capture_bound_robots: verdicts.filter((v) => v.class === "capture_bound_robots").length,
      urls: verdicts,
    });
    if (liveUrls.length > 0) liveTargets.push({ slug: target.slug, source: target.source, urls: liveUrls });
    process.stderr.write(
      `[headprobe] ${target.slug}: live=${liveUrls.length}/${target.urls.length} robots=${verdicts.filter((v) => v.class === "capture_bound_robots").length}\n`,
    );
  }

  const report = {
    contract: "pv-worklist-headprobe/v1",
    generated_at: new Date().toISOString(),
    read_only: true,
    input_worklist: worklistPath.slice(ROOT.length + 1),
    user_agent: PV_USER_AGENT,
    summary: {
      municipalities_in: targets.length,
      municipalities_with_live_url: liveTargets.length,
      urls_total: municipalities.reduce((s, m) => s + m.total, 0),
      urls_live: municipalities.reduce((s, m) => s + m.live, 0),
      urls_dead: municipalities.reduce((s, m) => s + m.dead, 0),
      urls_capture_bound_robots: municipalities.reduce((s, m) => s + m.capture_bound_robots, 0),
    },
    municipalities,
  };

  const writeAtomic = (path: string, value: unknown): void => {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tmp, path);
  };
  writeAtomic(outPath, report);
  writeAtomic(outWorklistPath, liveTargets);
  process.stdout.write(`${JSON.stringify({ ...report.summary, out: outPath.slice(ROOT.length + 1), live_worklist: outWorklistPath.slice(ROOT.length + 1) }, null, 2)}\n`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
