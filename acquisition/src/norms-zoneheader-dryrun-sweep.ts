#!/usr/bin/env tsx
/**
 * norms-zoneheader-dryrun-sweep — $0 sonde de LOT pour le gabarit « fiche-par-zone ».
 *
 * POURQUOI : `norms-sweep-dryrun.ts` (route auto + --auto-grid-page) et
 * `norms-grille-sigmatch-scan.ts` supposent tous deux une grille TRANSPOSÉE
 * (beaucoup de codes par page). Ils sont AVEUGLES au gabarit fiche-par-zone
 * (1 zone par page, bannière « ZONE : <code> ») et rendent un « no grille window
 * proven » qui est un FAUX NÉGATIF. Mesuré : le PDF de
 * `notre-dame-du-bon-conseil--drummond--2` est une fiche-par-zone (H-10, H-11, …)
 * et le sweep auto l'abandonne quand même ; idem `saint-damase--les-maskoutains`
 * dont le PDF est une VRAIE grille transposée. Le complément obligatoire est donc
 * `zonage-norms-run --route zoneheader --dry-run --budget-usd 0`, qui rapporte le
 * nombre de zones lisibles NATIVEMENT (sans un cent de vision).
 *
 * Ne dépose RIEN, ne dépense RIEN (budget-usd 0 ⇒ la vision s'arrête avant tout
 * appel). La source-url est un placeholder : le dry-run n'écrit aucune provenance.
 *
 * `--pairs slug=chemin.pdf,slug2=autre.pdf` force le PDF au lieu de laisser
 * `pickPdf` choisir : indispensable quand un slug porte PLUSIEURS PDF et que le
 * meilleur candidat n'est pas celui que le score de nom de fichier remonte
 * (mesuré : `saint-gedeon/grillesurbain.pdf` et `gaspe/annexe2-grilles-…pdf`
 * portaient la vraie grille alors que `pickPdf` servait le corps du règlement).
 *
 * Usage:
 *   npx tsx acquisition/src/norms-zoneheader-dryrun-sweep.ts --slugs a,b,c [--timeout-s 240]
 *   npx tsx acquisition/src/norms-zoneheader-dryrun-sweep.ts --pairs "slug=work/…/x.pdf,slug2=work/…/y.pdf"
 *   npx tsx acquisition/src/norms-zoneheader-dryrun-sweep.ts --shard 0 --shards 2 [--limit 20]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return def;
}

const REPO = resolve(process.cwd());
const NORMS_DIR = join(REPO, "work", "zonage-norms");

function shardSlugs(shard: number, shards: number): string[] {
  const matrix = JSON.parse(
    readFileSync(join(REPO, "work/coverage/coverage-matrix.json"), "utf8"),
  ) as { cities: Record<string, any> };
  const all: string[] = [];
  for (const [slug, layers] of Object.entries<any>(matrix.cities ?? {})) {
    const z = layers?.zones;
    const n = layers?.normes;
    if (z?.status === "done" && n?.status !== "done") all.push(slug);
  }
  all.sort((a, b) => a.localeCompare(b));
  return all.filter((_, i) => i % shards === shard);
}

/** Biggest / most explicit grille PDF on disk for a slug. */
function pickPdf(slug: string): string | null {
  const dir = join(NORMS_DIR, slug);
  if (!existsSync(dir)) return null;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const pdfs = entries.filter((e) => e.toLowerCase().endsWith(".pdf"));
  if (pdfs.length === 0) return null;
  for (const p of ["annexe-grille.pdf", "annexe-grille-web.pdf", "grille-base.pdf", "grille.pdf"]) {
    if (pdfs.includes(p)) return join(dir, p);
  }
  let best = pdfs[0]!;
  let bestSize = -1;
  for (const p of pdfs) {
    let sz = 0;
    try {
      sz = statSync(join(dir, p)).size;
    } catch {
      /* ignore */
    }
    if (sz > bestSize) {
      best = p;
      bestSize = sz;
    }
  }
  return join(dir, best);
}

function lastJson(out: string): any | null {
  const idx = out.lastIndexOf("\n{");
  const start = idx >= 0 ? idx + 1 : out.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(out.slice(start));
  } catch {
    return null;
  }
}

function main(): void {
  const slugsArg = arg("slugs");
  const shard = arg("shard") !== undefined ? Number(arg("shard")) : undefined;
  const shards = Number(arg("shards", "2"));
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const timeoutS = Number(arg("timeout-s", "240"));
  // ⛔ NE PAS remettre 0 par défaut. `--budget-usd 0` plafonne le nombre de pages à
  // `max(1, floor(budget / coûtParPage))` = 1 — y compris sur le chemin NATIF, qui ne
  // coûte pourtant rien : une sonde « $0 » sur un document multi-pages rend alors
  // « 0 zone » qui est un FAUX NÉGATIF. Mesuré : la même sonde passe de 6 à 55 zones
  // avec 0.05. On garde donc un plancher symbolique ; la vision reste bornée par lui.
  const budgetUsd = arg("budget-usd", "0.05")!;

  // --pairs "slug=chemin.pdf,…" : PDF imposé, pickPdf court-circuité.
  const forced = new Map<string, string>();
  for (const p of (arg("pairs") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = p.indexOf("=");
    if (eq <= 0) {
      console.error(`--pairs: attendu slug=chemin.pdf, reçu "${p}"`);
      process.exit(1);
    }
    forced.set(p.slice(0, eq).trim(), p.slice(eq + 1).trim());
  }

  let slugs: string[];
  if (forced.size) slugs = [...forced.keys()];
  else if (slugsArg) slugs = slugsArg.split(",").map((s) => s.trim()).filter(Boolean);
  else if (shard !== undefined) {
    slugs = shardSlugs(shard, shards);
    if (limit) slugs = slugs.slice(0, limit);
  } else {
    console.error("need --slugs or --shard");
    process.exit(1);
    return;
  }

  const nativeReady: string[] = [];
  const rows: string[] = [];

  for (const slug of slugs) {
    const pdf = forced.get(slug) ?? pickPdf(slug);
    if (!pdf) {
      rows.push(`NO-PDF        ${slug}`);
      continue;
    }
    const r = spawnSync(
      "npx",
      [
        "tsx",
        "acquisition/src/zonage-norms-run.ts",
        "--slug", slug,
        "--pdf", pdf,
        "--source-url", "https://placeholder.invalid/dryrun",
        "--route", "zoneheader",
        "--dry-run",
        "--budget-usd", budgetUsd,
      ],
      { encoding: "utf8", timeout: timeoutS * 1000, maxBuffer: 64 * 1024 * 1024 },
    );
    if (r.error && (r.error as any).code === "ETIMEDOUT") {
      rows.push(`TIMEOUT       ${slug}  ${pdf.replace(REPO + "/", "")}`);
      continue;
    }
    const out = r.stdout ?? "";
    // The runner logs "[zoneheader] native zones=N" and "(loc=<window>)".
    const nativeM = out.match(/native zones=(\d+)/);
    const locM = out.match(/window (\d+)\.\.(\d+) \(loc=([^)]*)\)/);
    const j = lastJson(out);
    const native = nativeM ? Number(nativeM[1]) : 0;
    const loc = locM ? locM[3] : "?";
    const zones = j?.zones ?? 0;
    const tag = native >= 3 ? "NATIVE-READY" : native > 0 ? "native-thin " : "none        ";
    if (native >= 3) nativeReady.push(slug);
    rows.push(
      `${tag}  ${slug}  nativeZones=${native} zones=${zones} loc=${loc} pdf=${pdf.replace(REPO + "/", "")}`,
    );
  }

  console.log("\n===== ZONEHEADER $0 SWEEP =====");
  for (const row of rows) console.log(row);
  console.log(`\nNATIVE-READY (>=3 zones lues nativement): ${nativeReady.join(",") || "(aucun)"}`);
}

main();
