/**
 * pv-mdq-run.ts — lane MUNICIPALITÉS-DU-QUÉBEC (portail mutualisé des petites munis).
 *
 * Beaucoup de très petites municipalités QC n'ont pas de site propre : elles sont
 * hébergées sur le portail mutualisé `municipalites-du-quebec.ca|.com`, dont la page
 * `<slug>/proces-verbaux.php` n'est qu'un GABARIT VIDE (« Aucun fichier ») : la liste
 * réelle est injectée par jQuery (`js/pdf-scan-procesverbaux.js`) depuis un endpoint
 * JSON — `<slug>/scan.procesverbaux.inc.php` — qui renvoie l'ARBORESCENCE réelle du
 * dossier `pdf_procesverbaux/` (fichiers + sous-dossiers par année).
 *
 * D'où l'échec de TOUTES les voies existantes sur ces munis :
 *   - `pv-discover-unlisted.ts` : ne connaît que le motif `…/<slug>/pdf_procesverbaux/`
 *     (listing de répertoire — autoindex désactivé) et jamais `proces-verbaux.php`, et
 *     ne voit aucun `href=….pdf` dans le gabarit vide            → not found
 *   - `pv-site-probe.ts` (ancres statiques)                       → docsPV=0
 *   - `pv-obscura-run.ts` (rendu passif)                          → no-pv-rendered
 *
 * VOIE RÉELLE, 100% SERVER-SIDE (aucun chromium) :
 *   1. `<host>/<alias>/scan.procesverbaux.inc.php` → JSON réel de l'arborescence.
 *   2. aplatissement récursif → fichiers `.pdf` réellement listés par le portail.
 *   3. émission des PAIRES {href,text} consommées par `pv-dom-deposit.ts --pairs-file`,
 *      qui applique la garde-fou PV partagée + le gate HEAD-live + le dépôt manifest S3.
 *
 * ALIAS DE SLUG : le portail utilise ses propres slugs (`st-thuribe` vs notre
 * `saint-thuribe`) et ignore nos suffixes de désambiguïsation (`--maria-chapdelaine`).
 * On essaie donc, pour chaque muni, une courte liste d'alias RÉELS et on retient le
 * premier hôte/alias qui répond un JSON valide. Aucun alias n'est « inventé » comme
 * résultat : sans réponse JSON 200, la muni est simplement rapportée sans paire.
 *
 * ANTI-INVENTION : chaque href émis correspond à un fichier réellement présent dans le
 * JSON servi par le portail (HTTP 200) ; la vivacité de chaque PDF est re-vérifiée en
 * HEAD par `pv-dom-deposit.ts` avant tout dépôt. 0 fichier → 0 paire → aucun dépôt.
 *
 * USAGE :
 *   npx tsx acquisition/src/pv-mdq-run.ts --slugs bonsecours,saint-thuribe --out-dir /tmp/s
 *   # puis, par slug avec paires > 0 :
 *   npx tsx acquisition/src/pv-dom-deposit.ts --slug bonsecours \
 *     --pv-index-url https://municipalites-du-quebec.ca/bonsecours/proces-verbaux.php \
 *     --pairs-file /tmp/s/bonsecours.pairs.json --deposit
 *
 * Options :
 *   --slugs a,b,c        munis à sonder (nos slugs de couverture).
 *   --out-dir DIR        dossier des `<slug>.pairs.json` (défaut : cwd).
 *   --max-files N        plafond de PV par muni, les PLUS RÉCENTS d'abord (défaut 80 ;
 *                        0 = aucun plafond). Tout écrêtage est journalisé (jamais muet).
 *   --delay-ms MS        délai entre requêtes (défaut 800).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { PV_USER_AGENT } from "../../packages/qc-sources/src/sources/proces-verbaux-generic.js";

const HOSTS = ["https://municipalites-du-quebec.ca", "https://municipalites-du-quebec.com"];
const SCAN_ENDPOINT = "scan.procesverbaux.inc.php";
const PV_INDEX_PAGE = "proces-verbaux.php";

interface Args {
  slugs: string[];
  outDir: string;
  maxFiles: number;
  delayMs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string, d = ""): string => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? (argv[i + 1] ?? d) : d;
  };
  return {
    slugs: (get("slugs") || "").split(",").map((s) => s.trim()).filter(Boolean),
    outDir: get("out-dir", process.cwd()),
    maxFiles: Number(get("max-files", "80")),
    delayMs: Number(get("delay-ms", "800")),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Alias RÉELS du portail pour un slug de couverture. Le portail préfixe « st-/ste- »
 * et ignore nos suffixes de désambiguïsation `--x`. On ne garde que des variantes
 * plausibles, chacune vérifiée par une vraie réponse JSON avant usage.
 */
function slugAliases(slug: string): string[] {
  const base = slug.split("--")[0] ?? slug;
  const out = new Set<string>([slug, base]);
  for (const s of [slug, base]) {
    if (s.startsWith("saint-")) out.add(`st-${s.slice("saint-".length)}`);
    if (s.startsWith("sainte-")) out.add(`ste-${s.slice("sainte-".length)}`);
    if (s.startsWith("st-")) out.add(`saint-${s.slice("st-".length)}`);
    if (s.startsWith("ste-")) out.add(`sainte-${s.slice("ste-".length)}`);
  }
  return [...out];
}

async function getJson(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "User-Agent": PV_USER_AGENT,
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "fr-CA,fr;q=0.9",
      },
    });
    const body = await r.text();
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: -1, body: e instanceof Error ? e.name : "err" };
  } finally {
    clearTimeout(timer);
  }
}

interface ScanNode {
  name?: string;
  type?: string;
  path?: string;
  items?: ScanNode[];
}

/** Aplatit récursivement l'arbre du portail → fichiers PDF réels (name+path). */
function flattenPdfs(node: ScanNode, out: Array<{ name: string; path: string }> = []): Array<{ name: string; path: string }> {
  if (node.type === "file" && typeof node.path === "string" && /\.pdf$/i.test(node.path)) {
    out.push({ name: node.name ?? node.path, path: node.path });
  }
  for (const child of node.items ?? []) flattenPdfs(child, out);
  return out;
}

interface SlugResult {
  slug: string;
  status: string;
  pairs: number;
  host?: string;
  alias?: string;
  pvIndexUrl?: string;
  out?: string;
  note?: string;
}

async function runSlug(slug: string, args: Args): Promise<SlugResult> {
  for (const host of HOSTS) {
    for (const alias of slugAliases(slug)) {
      await sleep(args.delayMs);
      const url = `${host}/${alias}/${SCAN_ENDPOINT}`;
      const r = await getJson(url);
      if (!r.ok || !r.body.trim().startsWith("{")) continue;

      let tree: ScanNode;
      try {
        tree = JSON.parse(r.body) as ScanNode;
      } catch {
        continue;
      }

      const files = flattenPdfs(tree);
      if (files.length === 0) {
        // Portail réel mais dossier PV VIDE (cas fréquent : section jamais alimentée).
        return { slug, status: "portal-empty", pairs: 0, host, alias, note: "0 PDF dans l'arbre servi" };
      }

      // Les noms sont préfixés ISO (`2026-04-09 …`) → tri décroissant = plus récents d'abord.
      files.sort((a, b) => b.name.localeCompare(a.name));
      const capped = args.maxFiles > 0 ? files.slice(0, args.maxFiles) : files;
      if (capped.length < files.length) {
        console.error(`    [cap] ${slug}: ${files.length} PV servis → ${capped.length} retenus (--max-files ${args.maxFiles}, plus récents)`);
      }

      const pairs = capped.map((f) => ({
        href: `${host}/${alias}/${encodeURI(f.path)}`,
        text: f.name.replace(/\.pdf$/i, ""),
      }));

      const pvIndexUrl = `${host}/${alias}/${PV_INDEX_PAGE}`;
      const outFile = join(args.outDir, `${slug}.pairs.json`);
      writeFileSync(
        outFile,
        JSON.stringify(
          {
            home: pvIndexUrl,
            _note:
              "Paires PV réelles moissonnées par pv-mdq-run.ts (endpoint JSON réel " +
              `${SCAN_ENDPOINT} du portail municipalites-du-quebec). Aucune URL fabriquée. ` +
              "Dépôt (garde-fou PV + HEAD-live + manifest S3) par pv-dom-deposit.ts --pairs-file.",
            _generatedAt: new Date().toISOString(),
            slug,
            portalHost: host,
            portalAlias: alias,
            pvIndexUrl,
            filesServed: files.length,
            n: pairs.length,
            pairs,
          },
          null,
          2,
        ) + "\n",
      );

      return {
        slug,
        status: "pairs-ok",
        pairs: pairs.length,
        host,
        alias,
        pvIndexUrl,
        out: outFile,
        note: `servis=${files.length}`,
      };
    }
  }
  return { slug, status: "not-on-portal", pairs: 0 };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.slugs.length === 0) {
    console.error("usage: --slugs a,b,c [--out-dir DIR] [--max-files N] [--delay-ms MS]");
    process.exit(2);
  }
  console.error(`[pv-mdq] villes=${args.slugs.length} maxFiles=${args.maxFiles}`);
  const results: SlugResult[] = [];
  for (const [i, slug] of args.slugs.entries()) {
    const r = await runSlug(slug, args);
    results.push(r);
    const tag = r.status === "pairs-ok" ? "OK " : "---";
    console.error(
      `${tag} [${i + 1}/${args.slugs.length}] ${slug}: ${r.status} pairs=${r.pairs}` +
        `${r.alias ? ` (alias=${r.alias})` : ""}${r.note ? ` ${r.note}` : ""}`,
    );
  }
  const ok = results.filter((r) => r.status === "pairs-ok");
  console.error(`\n=== pairs-ok=${ok.length}/${results.length} : ${ok.map((r) => `${r.slug}(${r.pairs})`).join(", ") || "—"}`);
  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
