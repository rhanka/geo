/**
 * normes-dryrun-sweep — balaye un shard de slugs avec le SEUL gate décisif à $0 :
 * `zonage-norms-run.ts --route auto --dry-run --budget-usd 0`.
 *
 * Pourquoi le runner et pas une heuristique maison : lui seul applique le VRAI
 * routeur (native / zoneheader / multizone / ocr) et la VRAIE cross-validation SIG.
 * Une sonde textuelle indépendante se trompe dans les deux sens — mesuré :
 *   - faux POSITIF : un règlement qui ne fait que MENTIONNER sa grille (« la grille
 *     des spécifications (Annexe 1) est un tableau qui… ») matche les marqueurs
 *     titre alors que la grille vit dans un PDF frère absent (courcelles : 12 pages
 *     de prose, $0.08 payés pour 0 zone) ;
 *   - faux NÉGATIF : une grille une-zone-par-page n'aligne aucune ligne à ≥6 codes,
 *     donc tout détecteur « ligne de grille » la déclare vide — alors que la route
 *     zoneheader en sort 132 zones à $0 (oka).
 * En dry-run + budget 0 le runner ne dépose rien et ne facture rien : le verdict est
 * gratuit et il est CELUI qui décidera au vrai run.
 *
 * Pour chaque slug il essaie chaque PDF stagé sous work/zonage-norms/<slug>/ et
 * retient le meilleur (overlap SIG décroissant, puis zones). Sortie triée par
 * overlap : la tête de liste = les dépôts à faire, le reste = preuve d'échec.
 *
 * 0 dépôt, 0 écriture, 0 $ (chaque run est borné par --budget-usd 0).
 *   npx tsx acquisition/src/normes-dryrun-sweep.ts --slugs a,b,c [--json]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const NORMS_DIR = join(REPO, "work", "zonage-norms");
const RUNNER = join(HERE, "zonage-norms-run.ts");

function get(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (k: string) => process.argv.includes(`--${k}`);

interface Row {
  slug: string;
  pdf: string;
  route: string;
  zones: number;
  sigCodes: number;
  overlap: number;
  recoupSig: number;
  verdict: string;
}

function dryRun(slug: string, pdf: string): Row {
  const r = spawnSync(
    "npx",
    [
      "tsx", RUNNER,
      "--slug", slug,
      "--pdf", pdf,
      "--source-url", "non-disponible",
      "--route", "auto",
      "--dry-run",
      "--budget-usd", "0",
      "--no-manifest",
    ],
    { encoding: "utf8", cwd: REPO, maxBuffer: 256 * 1024 * 1024, timeout: 300_000 },
  );
  const out = `${r.stdout ?? ""}`;
  const rel = pdf.replace(`${REPO}/`, "");

  // Le JSON du runner est le dernier objet de stdout ; les lignes [route]/[crossval]
  // vont sur stderr. On lit le JSON, avec repli sur les logs si le run a coupé tôt.
  let parsed: any = null;
  const start = out.indexOf("{");
  if (start >= 0) {
    try {
      parsed = JSON.parse(out.slice(start));
    } catch {
      /* run tronqué */
    }
  }
  const err = `${r.stderr ?? ""}`;
  const routeM = err.match(/\[route\]\s+(\w[\w-]*)/);
  const cv = err.match(/\[crossval\].*?sig=(\d+)\s+extracted=(\d+)\s+overlap=(\d+).*?recoupSig=(\d+)%/);

  return {
    slug,
    pdf: rel,
    route: parsed?.route ?? routeM?.[1] ?? "?",
    zones: parsed?.zones ?? Number(cv?.[2] ?? 0),
    sigCodes: parsed?.crossval?.sigZoneCodes ?? Number(cv?.[1] ?? 0),
    overlap: parsed?.crossval?.overlap ?? Number(cv?.[3] ?? 0),
    recoupSig: parsed?.crossval?.recoupSig ?? Number(cv?.[4] ?? 0),
    verdict: parsed?.reason ?? (parsed?.dryRun ? "dry-run ok" : "no-json"),
  };
}

function slugPdfs(slug: string): string[] {
  const dir = join(NORMS_DIR, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).map((f) => join(dir, f));
}

function main(): void {
  const slugs = (get("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) throw new Error("required: --slugs a,b,c");
  const rows: Row[] = [];

  for (const slug of slugs) {
    const pdfs = slugPdfs(slug);
    if (!pdfs.length) {
      console.error(`# ${slug}: aucun PDF stagé`);
      continue;
    }
    let best: Row | null = null;
    for (const pdf of pdfs) {
      const row = dryRun(slug, pdf);
      console.error(
        `# ${slug} ${row.pdf.split("/").pop()} → route=${row.route} zones=${row.zones} sig=${row.sigCodes} overlap=${row.overlap}`,
      );
      if (!best || row.overlap > best.overlap || (row.overlap === best.overlap && row.zones > best.zones)) {
        best = row;
      }
    }
    if (best) rows.push(best);
  }

  rows.sort((a, b) => b.overlap - a.overlap || b.zones - a.zones);

  if (has("json")) {
    console.log(JSON.stringify({ rows }, null, 2));
    return;
  }
  console.log("slug\troute\tzones\tsig\toverlap\trecoupSig\tpdf");
  for (const r of rows) {
    console.log(`${r.slug}\t${r.route}\t${r.zones}\t${r.sigCodes}\t${r.overlap}\t${r.recoupSig}%\t${r.pdf}`);
  }
  const deposable = rows.filter((r) => r.overlap > 0 && r.zones >= 3).length;
  console.error(`# dryrun-sweep: ${deposable}/${rows.length} slugs DÉPOSABLES (overlap>0 & zones>=3) — prouvé à $0`);
}

main();
