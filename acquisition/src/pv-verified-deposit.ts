/**
 * pv-verified-deposit.ts — dépose un manifest PV `registry/qc-pv/<slug>/index.json`
 * À PARTIR D'UNE LISTE D'ENTRÉES DÉJÀ VÉRIFIÉES par un humain-dans-la-boucle, pour
 * les municipalités dont l'index PV est RÉEL mais que la garde-fou automatique
 * français des autres runners (pv-gonet-run / pv-obscura-run / pv-dom-deposit,
 * toutes basées sur `PV_DOC_RE` / `PV_DATE_RE` francophones) ne sait PAS reconnaître —
 * typiquement les municipalités ANGLOPHONES du Québec (ex. Grosse-Île, Îles-de-la-
 * Madeleine : « MINUTES of a regular sitting of the council of the Municipality of
 * Grosse Ile ») dont les PDF sont hébergés sous des URL opaques (Wix `_files/ugd/…`)
 * sans mot-clé « procès-verbal » ni date française.
 *
 * NON une porte dérobée à l'anti-invention — c'est le MÊME contrat, mais la preuve
 * « isRealPv » est apportée par l'opérateur (lecture du texte du PDF via
 * `pdf-page-text.ts` : le document dit littéralement « MINUTES of a … sitting of the
 * council ») au lieu d'une heuristique regex, ET :
 *   1. CHAQUE URL fournie est RE-VÉRIFIÉE VIVANTE ici (HEAD ; repli GET Range 0-0 sur
 *      403/405/501/erreur). Une URL non-vivante (≠2xx) est REJETÉE, jamais déposée.
 *   2. Le script n'invente AUCUNE URL : il ne fait que vérifier+déposer les entrées
 *      RÉELLES d'un fichier d'entrées (ancres réellement présentes sur l'index live).
 *   3. Si 0 entrée vivante → aucun dépôt (skip justifié).
 * Le manifest documente sa provenance (`_note`, `_verification`) en clair.
 *
 * Format manifest = celui de pv-gonet-run.ts / pv-discover-unlisted.ts
 * (registry/qc-pv/<slug>/index.json), pour que `coverage-reconcile.ts` marque pv=done.
 *
 * USAGE :
 *   # probe (vérifie les URL vivantes, n'écrit RIEN) :
 *   npx tsx acquisition/src/pv-verified-deposit.ts \
 *     --slug grosse-ile \
 *     --pv-index-url https://www.mungi.ca/minutes-1 \
 *     --entries work/pv-verified/grosse-ile.entries.json
 *   # dépôt S3 :
 *   npx tsx acquisition/src/pv-verified-deposit.ts --slug grosse-ile \
 *     --pv-index-url https://www.mungi.ca/minutes-1 \
 *     --entries work/pv-verified/grosse-ile.entries.json --deposit
 *
 * Le fichier --entries est un JSON : Array<{ url, title?, publishedAt?, contentType? }>.
 */
import { readFileSync } from "node:fs";

import { PV_USER_AGENT } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";
import { s3Client, putBytes, exists } from "./lib/s3.js";

interface InputEntry {
  readonly url: string;
  readonly title?: string;
  readonly publishedAt?: string;
  readonly contentType?: string;
}
interface ManifestEntry {
  readonly url: string;
  readonly title?: string;
  readonly publishedAt?: string;
  readonly contentType: string;
}

interface Args {
  readonly slug: string;
  readonly pvIndexUrl: string;
  readonly entriesFile: string;
  readonly deposit: boolean;
  readonly force: boolean;
  readonly timeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  return {
    slug: get("slug") ?? "",
    pvIndexUrl: get("pv-index-url") ?? "",
    entriesFile: get("entries") ?? "",
    deposit: has("deposit"),
    force: has("force"),
    timeoutMs: Number(get("timeout-ms") ?? "15000"),
  };
}

function manifestKey(slug: string): string {
  return `registry/qc-pv/${slug}/index.json`;
}

function contentTypeFor(url: string, fallback?: string): string {
  if (/\.pdf(?:[?#].*)?$/i.test(url)) return "application/pdf";
  if (/\.docx?(?:[?#].*)?$/i.test(url)) return "application/msword";
  if (/\.odt(?:[?#].*)?$/i.test(url)) return "application/vnd.oasis.opendocument.text";
  return fallback ?? "application/octet-stream";
}

/**
 * Live check: HEAD first; on 403/405/501/network error, retry a 1-byte ranged GET
 * (many CDN/handlers reject HEAD but serve GET). Returns the resolved content-type
 * when available. A link is "live" only on a final 2xx.
 */
async function headLive(
  url: string,
  timeoutMs: number,
): Promise<{ live: boolean; status: number; contentType?: string }> {
  const req = async (method: "HEAD" | "GET"): Promise<Response | null> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method,
        redirect: "follow",
        signal: ac.signal,
        headers: {
          "user-agent": PV_USER_AGENT,
          ...(method === "GET" ? { range: "bytes=0-0" } : {}),
        },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const head = await req("HEAD");
  if (head && head.ok) {
    return { live: true, status: head.status, contentType: head.headers.get("content-type") ?? undefined };
  }
  const headStatus = head?.status ?? -1;
  if (head === null || [403, 405, 501, 400].includes(headStatus)) {
    const get = await req("GET");
    if (get && (get.ok || get.status === 206)) {
      return { live: true, status: get.status, contentType: get.headers.get("content-type") ?? undefined };
    }
    return { live: false, status: get?.status ?? headStatus };
  }
  return { live: false, status: headStatus };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug || !args.pvIndexUrl || !args.entriesFile) {
    console.error("usage: --slug SLUG --pv-index-url URL --entries FILE.json [--deposit] [--force]");
    process.exit(2);
  }

  const input = JSON.parse(readFileSync(args.entriesFile, "utf8")) as InputEntry[];
  if (!Array.isArray(input) || input.length === 0) {
    console.error(`[verified-deposit] ${args.entriesFile}: aucune entrée`);
    process.exit(2);
  }

  const key = manifestKey(args.slug);
  const s3 = args.deposit ? s3Client() : null;
  if (s3 && !args.force && (await exists(s3, key))) {
    console.error(`[verified-deposit] ${args.slug}: manifest déjà présent (${key}) — skip (utiliser --force)`);
    return;
  }

  const seen = new Set<string>();
  const kept: ManifestEntry[] = [];
  let checked = 0;
  let live = 0;
  for (const e of input) {
    if (!e.url || seen.has(e.url)) continue;
    seen.add(e.url);
    checked++;
    const r = await headLive(e.url, args.timeoutMs);
    if (!r.live) {
      console.error(`  DEAD [${r.status}] ${e.url}`);
      continue;
    }
    live++;
    kept.push({
      url: e.url,
      ...(e.title ? { title: e.title } : {}),
      ...(e.publishedAt ? { publishedAt: e.publishedAt } : {}),
      contentType: contentTypeFor(e.url, e.contentType ?? r.contentType),
    });
    console.error(`  LIVE [${r.status}] ${e.title ?? e.url}`);
  }

  if (kept.length === 0) {
    console.error(`[verified-deposit] ${args.slug}: 0 entrée vivante → aucun dépôt`);
    return;
  }

  const manifest = {
    _note:
      "PV index déposé par pv-verified-deposit.ts (opérateur humain-dans-la-boucle). " +
      "Chaque entrée est une ancre RÉELLE de la page d'index PV live, dont le contenu a " +
      "été confirmé « procès-verbal / MINUTES of a sitting of the council » par lecture du " +
      "PDF (pdf-page-text.ts), et RE-vérifiée vivante (HEAD/GET 2xx) au dépôt. Aucune " +
      "fabrication ; les convocations/avis/ordres-du-jour ont été exclus.",
    _verification: { method: "human-verified+head-live", checked, live },
    _generatedAt: new Date().toISOString(),
    slug: args.slug,
    sourceId: `proces-verbaux-${args.slug}`,
    pvIndexUrl: args.pvIndexUrl,
    discoveryTrack: "operator-verified" as const,
    windowDays: 183,
    userAgent: PV_USER_AGENT,
    count: kept.length,
    entries: kept,
  };

  console.error(
    `[verified-deposit] ${args.slug}: ${kept.length}/${checked} PV vivants @ ${args.pvIndexUrl}`,
  );
  if (s3 && args.deposit) {
    await putBytes(s3, key, JSON.stringify(manifest, null, 2) + "\n", "application/json");
    console.error(`  → s3://sentropic-geo/${key}`);
  } else {
    console.error("  (probe — aucun dépôt ; ajouter --deposit pour écrire)");
    console.log(JSON.stringify(manifest, null, 2));
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
