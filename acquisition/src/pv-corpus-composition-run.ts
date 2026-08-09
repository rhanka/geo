/**
 * pv-corpus-composition-run.ts — DE QUOI est fait le corpus PV ?
 *
 * Le KPI PV compte 65 854 « documents », un ordre de grandeur au-dessus des
 * ~6 000 procès-verbaux attendus. Avant de lancer des jours de capture cluster,
 * il faut savoir ce que ce dénominateur contient RÉELLEMENT : un index
 * `registry/qc-pv/<slug>/index.json` liste ce qui a été trouvé sur la page des
 * séances, ce qui peut inclure la page elle-même, des ordres du jour, des
 * annexes — et des PV remontant à des années.
 *
 * Capturer 65 854 URL dont une part n'est pas un PV coûterait du cluster pour
 * conserver du bruit ET gonflerait un KPI sur un dénominateur faux. Cette passe
 * mesure la composition pour que le périmètre soit CHOISI, pas subi.
 *
 * Ne classe QUE sur ce qui est observable dans l'URL et le titre : extension,
 * millésime en quatre chiffres. Tout le reste est `indetermine` — on ne devine
 * pas la nature d'un document qu'on n'a pas lu.
 *
 * Lecture seule stricte. N'écrit qu'un rapport sous work/coverage/.
 *
 * Usage :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/pv-corpus-composition-run.ts
 */
import { writeFileSync } from "node:fs";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";

interface Entry { url?: unknown; title?: unknown }

/** Année plausible pour un PV municipal québécois publié en ligne. */
const YEAR_MIN = 1990;
const YEAR_MAX = 2026;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Extension de fichier lue sur le CHEMIN de l'URL, jamais sur la query : un
 * `?download=1.pdf` ne fait pas d'une page un PDF.
 */
function extensionOf(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return "url_invalide";
  }
  const match = /\.([a-z0-9]{1,5})$/i.exec(path);
  return match ? match[1]!.toLowerCase() : "sans_extension";
}

/**
 * Millésime pris dans l'URL PUIS dans le titre. Une URL peut porter plusieurs
 * nombres de quatre chiffres (`20260112`, un id, un no de règlement) : on ne
 * retient que ceux qui tombent dans une plage plausible, et on prend le PLUS
 * RÉCENT — un chemin `/2026/archives-2019/…` décrit un document de 2019 rangé
 * en 2026 aussi souvent que l'inverse, donc ce choix est déclaré, pas neutre.
 */
function yearOf(url: string, title: string | null): number | null {
  const years: number[] = [];
  for (const source of [url, title ?? ""]) {
    for (const match of source.matchAll(/(?:19|20)\d{2}/g)) {
      const year = Number.parseInt(match[0], 10);
      if (year >= YEAR_MIN && year <= YEAR_MAX) years.push(year);
    }
  }
  if (years.length === 0) return null;
  return Math.max(...years);
}

function bump(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

async function main(): Promise<void> {
  const s3 = s3Client();
  const keys = (await listObjectEntries(s3, "registry/qc-pv/"))
    .map((entry) => entry.key)
    .filter((key) => key.endsWith("/index.json"));

  const byExtension = new Map<string, number>();
  const byYear = new Map<string, number>();
  const distinctUrls = new Set<string>();
  let indexesRead = 0;
  let indexesUnreadable = 0;
  let entriesTotal = 0;
  let selfReferencing = 0;

  for (const key of keys) {
    let parsed: unknown;
    try {
      parsed = JSON.parse((await getBytes(s3, key)).toString("utf8"));
    } catch {
      indexesUnreadable += 1;
      continue;
    }
    indexesRead += 1;
    const record = parsed as Record<string, unknown>;
    const indexUrl = str(record["pvIndexUrl"]);
    const entries = Array.isArray(record["entries"]) ? (record["entries"] as Entry[]) : [];
    for (const entry of entries) {
      const url = str(entry.url);
      if (url === null) continue;
      entriesTotal += 1;
      // La page d'index se liste elle-meme : ce n'est pas un document.
      if (indexUrl !== null && url === indexUrl) selfReferencing += 1;
      if (distinctUrls.has(url)) continue;
      distinctUrls.add(url);
      bump(byExtension, extensionOf(url));
      const year = yearOf(url, str(entry.title));
      bump(byYear, year === null ? "indetermine" : String(year));
    }
  }

  const sortDesc = (m: Map<string, number>): Record<string, number> =>
    Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));

  const report = {
    _note: "Composition mesuree du corpus PV. Classement sur l'extension du CHEMIN et le millesime a 4 chiffres le plus recent trouve dans l'URL ou le titre. Aucun document n'est ouvert : la nature reelle (PV, ordre du jour, annexe) n'est PAS mesuree ici.",
    _generatedAt: new Date().toISOString(),
    indexes: { found: keys.length, read: indexesRead, unreadable: indexesUnreadable },
    entries: {
      total_avec_doublons: entriesTotal,
      urls_distinctes: distinctUrls.size,
      auto_referencantes: selfReferencing,
    },
    par_extension: sortDesc(byExtension),
    par_millesime: sortDesc(byYear),
  };

  const path = `work/coverage/pv-corpus-composition-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`;
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, par_millesime: "(voir le rapport)" }, null, 1));
  console.log(`\n-> ${path}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
