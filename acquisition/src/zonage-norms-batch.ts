/**
 * Batch orchestrator for the per-municipality `qc-zonage-norms-<slug>` runner.
 *
 * Replaces a throwaway shell loop with a committed, TS-only, idempotent driver
 * (this repo is Node/TS end-to-end — no Python, no uncommitted /tmp scripts):
 *
 *   1. Read the muni manifest (`work/zonage-norms/munis.json`).
 *   2. Order native/multizone before vision so the simpler grids deposit first
 *      (cost is identical — multizone & vision both call Mistral — this only
 *      front-loads visible progress).
 *   3. STRONG IDEMPOTENCE — skip any muni already deposited under
 *      `registry/qc-zonage-norms/`, so an expensive vision pass is never redone.
 *   4. Spawn `zonage-norms-run.ts` per muni, sequentially. The child inherits
 *      `MISTRAL_API_KEY` (loaded here from `sentropic/.env` into the CHILD env
 *      only) and reads S3 creds from `s3.env` via `lib/s3`. When the manifest
 *      gives a `first`/`last` page range, pass it through so deep grilles
 *      (e.g. a 378-page PDF) are targeted instead of scanned from page 1.
 *
 * A secret value is NEVER printed (only presence/absence). Run detached:
 *   nohup npx tsx src/zonage-norms-batch.ts > /tmp/norms_batch.log 2>&1 &
 * Override the manifest path with argv[2], the per-muni budget with
 * `NORMS_BUDGET_USD`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { s3Client, loadEnv, listSlugs } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACQ = resolve(HERE, ".."); // acquisition/
const REPO = resolve(ACQ, ".."); // geo/
const RUNNER = join(HERE, "zonage-norms-run.ts");
const TSX = join(ACQ, "node_modules", ".bin", "tsx");

const MUNIS_JSON =
  process.argv[2] ?? join(REPO, "work", "zonage-norms", "munis.json");
const MISTRAL_ENV = "/home/antoinefa/src/sentropic/.env";
const BUDGET_USD = process.env["NORMS_BUDGET_USD"] ?? "4";

interface Muni {
  slug: string;
  route?: "auto" | "native" | "vision" | "multizone";
  pages?: number;
  first?: number;
  last?: number;
  reglement?: string;
  sourceUrl?: string;
}

function loadMunis(path: string): Muni[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (Array.isArray(raw)) return raw as Muni[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj["munis"])) return obj["munis"] as Muni[];
    return Object.values(obj) as Muni[];
  }
  return [];
}

/** native/multizone deposit first; vision (slowest) last. */
const ROUTE_ORDER: Record<string, number> = {
  native: 0,
  multizone: 1,
  auto: 2,
  vision: 3,
};

async function main(): Promise<void> {
  const munis = loadMunis(MUNIS_JSON);
  munis.sort(
    (a, b) =>
      (ROUTE_ORDER[a.route ?? "auto"] ?? 9) -
      (ROUTE_ORDER[b.route ?? "auto"] ?? 9),
  );

  // MISTRAL_API_KEY (vision + multizone need it) → CHILD env only, never logged.
  const childEnv = { ...process.env };
  const mistralKey = loadEnv(MISTRAL_ENV)["MISTRAL_API_KEY"];
  if (mistralKey) childEnv["MISTRAL_API_KEY"] = mistralKey;
  console.error(
    `[batch] MISTRAL_API_KEY ${childEnv["MISTRAL_API_KEY"] ? "chargée" : "ABSENTE"}`,
  );

  // Strong idempotence: which slugs are already deposited in S3?
  const s3 = s3Client();
  const deposited = await listSlugs(s3, "registry/qc-zonage-norms/", ".parquet");
  const isDeposited = (slug: string): boolean =>
    deposited.some((k) => k === slug || k.includes(slug));

  let ok = 0;
  let fail = 0;
  let skip = 0;
  for (const m of munis) {
    if (!m.slug) continue;
    if (isDeposited(m.slug)) {
      console.error(`SKIP (déjà déposé) ${m.slug}`);
      skip++;
      continue;
    }
    const pdf = join(REPO, "work", "zonage-norms", m.slug, "grille.pdf");
    if (!existsSync(pdf)) {
      console.error(`NO-PDF ${m.slug}`);
      continue;
    }
    const route = m.route ?? "auto";
    const pages = String(m.pages ?? 60);
    console.error(`=== ${m.slug} (route=${route}, pages=${pages}) ===`);
    const args = [
      RUNNER,
      "--slug",
      m.slug,
      "--pdf",
      pdf,
      "--source-url",
      m.sourceUrl ?? "non-disponible",
      "--route",
      route,
      "--max-vision-pages",
      pages,
      "--budget-usd",
      BUDGET_USD,
    ];
    if (m.reglement) args.push("--reglement", String(m.reglement));
    if (m.first) args.push("--first-page", String(m.first));
    if (m.last) args.push("--last-page", String(m.last));

    const res = spawnSync(TSX, args, {
      cwd: ACQ,
      env: childEnv,
      stdio: "inherit",
    });
    if (res.status === 0) {
      console.error(`OK ${m.slug}`);
      ok++;
    } else {
      console.error(`FAIL ${m.slug} (status=${res.status ?? "signal"})`);
      fail++;
    }
  }
  console.error(`=== FIN BATCH NORMES (ok=${ok} fail=${fail} skip=${skip}) ===`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
