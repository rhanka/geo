/**
 * coverage-cli.ts — orchestrateur du plan de couverture (solution-driven).
 *
 * Sous-commandes :
 *   seed                       construit/écrit work/coverage/coverage-matrix.json
 *                              depuis l'état MESURÉ (cf. coverage-seed). 0 réseau.
 *   recense --sample           recense un échantillon de ~12 villes VARIÉES (dont
 *                              les 11 'absentes' de l'audit) + applique à la
 *                              matrice. 1 requête HTTP/ville (détection plateforme).
 *   recense --slugs a,b,c      recense ces villes.
 *   recense --all [--limit N]  recense les 1106 munis (ou les N premières).
 *   report                     régénère work/coverage/TRACK-REPORT.md (lecture pure).
 *
 * AUCUN LLM, AUCUN crédit. Le seul coût réseau est la détection de plateforme du
 * recenseur : une requête HTTP par ville (GET ~4 KB, timeout 8 s).
 *
 * Exemples :
 *   npx tsx src/coverage-cli.ts seed
 *   npx tsx src/coverage-cli.ts recense --sample
 *   npx tsx src/coverage-cli.ts report
 *   npx tsx src/coverage-cli.ts recense --all --delay-ms 1500
 */

import {
  allMunicipalities,
  loadMatrix,
  saveMatrix,
  MATRIX_PATH,
} from "./coverage-matrix.js";
import { seedMatrix } from "./coverage-seed.js";
import {
  recenseVille,
  applyRecensement,
  type CityRecensement,
} from "./recense-ville.js";
import { generateReport, renderMarkdown } from "./coverage-report.js";

/** Échantillon VARIÉ de ~12 villes (inclut les 11 'absentes' zonage + 1 'ready'). */
export const SAMPLE_SLUGS: readonly string[] = [
  // 11 absentes de l'audit zonage (voies à trouver) :
  "sainte-catherine",
  "alma",
  "saint-charles-borromee",
  "saint-mathieu-de-beloeil",
  "la-sarre",
  "saint-boniface",
  "saint-come-liniere",
  "petite-riviere-saint-francois",
  "champlain",
  "plaisance",
  "notre-dame-de-lourdes--lerable",
  // + 1 grande ville variée (couverte multi-couches) :
  "sherbrooke",
];

interface Args {
  cmd: string;
  sample: boolean;
  all: boolean;
  slugs: string[] | null;
  limit: number | null;
  delayMs: number;
}

function parseArgs(argv: readonly string[]): Args {
  const a: Args = {
    cmd: argv[0] ?? "help",
    sample: false,
    all: false,
    slugs: null,
    limit: null,
    delayMs: 1500,
  };
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--sample") a.sample = true;
    else if (t === "--all") a.all = true;
    else if (t === "--slugs") a.slugs = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (t === "--limit") a.limit = Number(argv[++i]);
    else if (t === "--delay-ms") a.delayMs = Number(argv[++i]);
  }
  return a;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function printRecensement(rec: CityRecensement): void {
  // Affiche la voie validée si trouvée, sinon le 1er candidat de repli préfixé
  // de '~' (jamais vide : "aucun plafond" — toute couche a une voie à tenter).
  const lead = rec.layers
    .map((l) => {
      const v = l.firstViableTrack ?? `~${l.candidateTracks[0] ?? "?"}`;
      return `${l.layer}:${v}`;
    })
    .join("  ");
  console.log(
    `  ${rec.slug.padEnd(34)} platform=${rec.platform.padEnd(8)} ${lead}`,
  );
}

async function cmdSeed(): Promise<void> {
  const matrix = seedMatrix();
  saveMatrix(matrix);
  console.log(`[seed] matrice écrite : ${MATRIX_PATH}`);
  console.log(`[seed] munis=${matrix.municipalityCount}`);
  const r = generateReport();
  console.log("[seed] TRACK-REPORT régénéré.");
  console.log(renderMarkdown(r));
}

async function cmdRecense(args: Args): Promise<void> {
  let matrix = loadMatrix();
  if (!matrix) {
    console.log("[recense] matrice absente → seed implicite.");
    matrix = seedMatrix();
  }
  const all = allMunicipalities().map((m) => m.slug);
  let targets: string[];
  if (args.slugs) targets = args.slugs;
  else if (args.sample) targets = [...SAMPLE_SLUGS];
  else if (args.all) targets = args.limit ? all.slice(0, args.limit) : all;
  else targets = [...SAMPLE_SLUGS];

  console.log(`[recense] ${targets.length} ville(s), délai ${args.delayMs} ms`);
  for (let i = 0; i < targets.length; i++) {
    const slug = targets[i];
    const rec = await recenseVille(slug, { timeoutMs: 8000 });
    matrix = applyRecensement(matrix, rec);
    printRecensement(rec);
    if (i < targets.length - 1) await sleep(args.delayMs);
  }
  saveMatrix(matrix);
  console.log(`[recense] matrice mise à jour : ${MATRIX_PATH}`);
}

async function cmdReport(): Promise<void> {
  const r = generateReport();
  console.log(renderMarkdown(r));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.cmd) {
    case "seed":
      return cmdSeed();
    case "recense":
      return cmdRecense(args);
    case "report":
      return cmdReport();
    default:
      console.log(
        "usage: coverage-cli <seed|recense|report> [--sample|--all|--slugs a,b,c] [--limit N] [--delay-ms N]",
      );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
