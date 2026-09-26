#!/usr/bin/env node
// =============================================================================
// restore-pg.docker.selftest.mjs — test Docker de la restauration PG (S2) de la
// bascule geo MODE=restore. Node seul (builtins) + le binaire `docker` ; image
// postgis/postgis:16-3.4 (celle du postgis préprod et du Job de restauration).
//
// Incident 2026-09-26 (run 36264826332) : pg_restore du backup prod dans une base
// fraîchement initialisée par l'image échouait sur
//   CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder WITH SCHEMA tiger;
//   ERROR: function soundex(character varying) does not exist
// car la prod a fuzzystrmatch dans le schéma `geo` (TOC du dump) et le script
// d'installation du géocodeur fixe search_path = tiger, <reset_val de search_path>
// ("$user", public) : soundex n'est trouvé que si le rôle qui restaure s'appelle geo.
//
// Le test construit une SOURCE SYNTHÉTIQUE qui reproduit la configuration
// d'extensions et de schémas du vrai dump (TOC comparée à REAL_TOC_SHAPE ci-dessous,
// relevée sur pg/2026-09-26/geo.dump), la vide avec pg_dump -Fc --no-owner
// --no-privileges, puis contre une cible fraîche (rôle ≠ geo, comme en préprod) :
//   1. l'ancienne commande (options d'avant le correctif) ÉCHOUE sur soundex et la
//      cible reste intacte (--single-transaction) — reproduction de l'incident ;
//   2. le script RÉEL du conteneur `restore` du template (db-restore-backup-job)
//      réussit : exit 0, verdict ok, postgis répond, lignes = dump, index présent ;
//   3. 2e passage : exit 0 (idempotent), mêmes comptes ;
//   4. un restore qui échoue (DROP TABLE bloqué par une vue) laisse la base intacte.
//
// Variables :
//   RESTORE_DOCKER_REQUIRED=1   Docker absent ⇒ ÉCHEC (CI). Sinon : SKIP explicite
//                               et journalisé (exit 0, jamais un « ok » silencieux).
//   RESTORE_DOCKER_TEMPLATE=…   autre template (preuve : l'ancien template échoue).
//   RESTORE_DOCKER_DUMP=…       vrai dump local au lieu de la source synthétique
//                               (poste opérateur seulement ; jamais en CI, jamais
//                               committé — la CI n'a aucune cred S3).
//
//   node deploy/ci/bascule-preprod/restore-pg.docker.selftest.mjs
// =============================================================================
import console from "node:console";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const DIR = import.meta.dirname;
const IMAGE = "postgis/postgis:16-3.4";
const DB = "geo";
const TARGET_USER = "preprod_admin"; // ≠ geo, comme le superuser préprod
const TEMPLATE = resolve(process.env.RESTORE_DOCKER_TEMPLATE || join(DIR, "db-restore-backup-job.tmpl.yaml"));
const REAL_DUMP = process.env.RESTORE_DOCKER_DUMP ? resolve(process.env.RESTORE_DOCKER_DUMP) : null;

// TOC de pg/2026-09-26/geo.dump (pg_restore -l, 24 entrées), sans OID ni owner.
const REAL_TOC_SHAPE = [
  "SCHEMA - geo", "SCHEMA - tiger", "SCHEMA - tiger_data", "SCHEMA - topology", "COMMENT - SCHEMA topology",
  "EXTENSION - fuzzystrmatch", "COMMENT - EXTENSION fuzzystrmatch", "EXTENSION - postgis", "COMMENT - EXTENSION postgis",
  "EXTENSION - postgis_tiger_geocoder", "COMMENT - EXTENSION postgis_tiger_geocoder", "EXTENSION - postgis_topology", "COMMENT - EXTENSION postgis_topology",
  "TABLE geo lots", "TABLE DATA geo lots", "TABLE DATA public spatial_ref_sys", "TABLE DATA tiger geocode_settings", "TABLE DATA tiger pagc_gaz",
  "TABLE DATA tiger pagc_lex", "TABLE DATA tiger pagc_rules", "TABLE DATA topology topology", "TABLE DATA topology layer",
  "SEQUENCE SET topology topology_id_seq", "INDEX geo lots_geom_gix",
];
// Commande S2 d'avant le correctif (template jusqu'au 2026-09-26).
const LEGACY_RESTORE = "pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction --dbname geo /work/geo.dump";

let passed = 0;
let failed = 0;
const ok = (name, cond, detail = "") => { if (cond) { passed += 1; console.log(`  ok   ${name}`); } else { failed += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); } };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const docker = (args, opts = {}) => spawnSync("docker", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
const tail = (s) => String(s || "").trim().split("\n").slice(-4).join(" | ");

// ── Docker présent ? Sinon SKIP journalisé (ou échec si requis) ────────────────
const probe = docker(["version", "--format", "{{.Server.Version}}"]);
if (probe.error || probe.status !== 0) {
  const why = probe.error ? probe.error.code : tail(probe.stderr);
  if (process.env.RESTORE_DOCKER_REQUIRED === "1") {
    console.log(`restore-pg.docker.selftest — ÉCHEC : Docker requis (RESTORE_DOCKER_REQUIRED=1) mais indisponible (${why})`);
    process.exit(1);
  }
  console.log(`restore-pg.docker.selftest — SKIP : Docker indisponible (${why}). AUCUN test exécuté ; ce n'est pas un succès.`);
  process.exit(0);
}

const id = `${process.pid}-${Date.now().toString(36)}`;
const NET = `geo-restore-st-${id}`;
const SRC = `geo-restore-st-src-${id}`;
const TGT = `geo-restore-st-tgt-${id}`;
const work = mkdtempSync(join(tmpdir(), "geo-restore-docker-"));
chmodSync(work, 0o755);

function cleanup() {
  docker(["rm", "-f", SRC, TGT]);
  docker(["network", "rm", NET]);
  rmSync(work, { recursive: true, force: true });
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

// Script bash du conteneur `restore` du template, tel que le Job l'exécute.
function restoreScript(file) {
  const text = readFileSync(file, "utf8");
  const m = text.match(/\n {8}- name: restore\n[\s\S]*?command: \["bash", "-c"\]\n {10}args:\n {12}- \|\n([\s\S]*?)\n {10}env:/);
  if (!m) throw new Error(`script du conteneur restore introuvable dans ${file}`);
  return m[1].split("\n").map((l) => l.replace(/^ {14}/, "")).join("\n");
}
function shape(tocText) {
  const lines = tocText.split("\n").filter((l) => /^\d+;/.test(l));
  return lines.map((l) => {
    const t = l.trim().split(/\s+/).slice(3);
    const two = `${t[0]} ${t[1]}`;
    const n = two === "TABLE DATA" || two === "SEQUENCE SET" ? 4 : t[0] === "COMMENT" ? 4 : 3;
    return t.slice(0, n).join(" ");
  });
}
function startPg(name, user, db) {
  const r = docker(["run", "-d", "--name", name, "--network", NET, "-e", `POSTGRES_USER=${user}`, "-e", "POSTGRES_PASSWORD=selftest-pw",
    "-e", `POSTGRES_DB=${db}`, IMAGE]);
  if (r.status !== 0) throw new Error(`docker run ${name} : ${tail(r.stderr)}`);
}
function waitReady(name, user, db) {
  // Pendant l'init, l'image n'écoute qu'en socket unix : TCP prêt = init (extensions) terminée.
  for (let i = 0; i < 120; i += 1) {
    if (docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", user, "-d", db]).status === 0) return;
    sleep(1000);
  }
  throw new Error(`${name} pas prêt après 120 s`);
}
const psql = (name, user, db, sql) => docker(["exec", "-e", "PGPASSWORD=selftest-pw", name, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", user, "-d", db, "-tAc", sql]);
const q = (name, user, db, sql) => { const r = psql(name, user, db, sql); if (r.status !== 0) throw new Error(`psql ${name} : ${tail(r.stderr)}`); return r.stdout.trim(); };
const clientEnv = ["-e", `PGHOST=${TGT}`, "-e", "PGPORT=5432", "-e", `PGUSER=${TARGET_USER}`, "-e", "PGPASSWORD=selftest-pw", "-e", `PGDATABASE=${DB}`];
const runClient = (cmd, extra = []) => docker(["run", "--rm", "--network", NET, "-v", `${work}:/work:ro`, ...extra, ...clientEnv, IMAGE, "bash", "-c", cmd]);
const targetState = () => ({
  exts: q(TGT, TARGET_USER, DB, "select string_agg(extname || '@' || extnamespace::regnamespace, ',' order by extname) from pg_extension"),
  geoSchema: q(TGT, TARGET_USER, DB, "select count(*) from pg_namespace where nspname = 'geo'"),
  lots: q(TGT, TARGET_USER, DB, "select to_regclass('geo.lots') is not null") === "t" ? q(TGT, TARGET_USER, DB, "select count(*) from geo.lots") : "absent",
});

try {
  if (docker(["image", "inspect", IMAGE]).status !== 0) {
    const pull = docker(["pull", "-q", IMAGE]);
    if (pull.status !== 0) throw new Error(`docker pull ${IMAGE} : ${tail(pull.stderr)}`);
  }
  if (docker(["network", "create", NET]).status !== 0) throw new Error("docker network create");
  startPg(TGT, TARGET_USER, DB);

  // ── dump : source synthétique (défaut) ou vrai dump local ────────────────────
  const dumpFile = join(work, `${DB}.dump`);
  if (REAL_DUMP) {
    copyFileSync(REAL_DUMP, dumpFile);
    console.log(`  (vrai dump local : ${REAL_DUMP})`);
  } else {
    startPg(SRC, "geo", DB);
    waitReady(SRC, "geo", DB);
    // Configuration de la prod d'après la TOC : extensions de l'image, fuzzystrmatch
    // dans le schéma geo, table geo.lots (geometry Polygon 4326) + index GiST.
    q(SRC, "geo", DB, `create schema geo;
      alter extension fuzzystrmatch set schema geo;
      create table geo.lots (geoid text, no_lot text, geom public.geometry(Polygon,4326), city text);
      insert into geo.lots select 'g' || i, 'lot-' || i,
        public.st_setsrid(public.st_makeenvelope(-73.6 + i * 1e-4, 45.5, -73.6 + i * 1e-4 + 5e-5, 45.50005), 4326), 'laval'
        from generate_series(1, 2500) i;
      create index lots_geom_gix on geo.lots using gist (geom);`);
    const d = docker(["exec", "-e", "PGPASSWORD=selftest-pw", SRC, "pg_dump", "-h", "127.0.0.1", "-U", "geo", "-d", DB, "-Fc", "--no-owner", "--no-privileges"],
      { encoding: "buffer" });
    if (d.status !== 0) throw new Error(`pg_dump : ${tail(d.stderr)}`);
    writeFileSync(dumpFile, d.stdout);
  }
  chmodSync(dumpFile, 0o644);
  const toc = runClient("pg_restore --list /work/geo.dump");
  const tocShape = shape(toc.stdout);
  ok(`TOC du dump (${tocShape.length} entrées) = configuration du vrai dump du 2026-09-26 (extensions, schémas, fuzzystrmatch → geo)`,
    toc.status === 0 && JSON.stringify([...tocShape].sort()) === JSON.stringify([...REAL_TOC_SHAPE].sort()),
    JSON.stringify(tocShape.filter((x) => !REAL_TOC_SHAPE.includes(x))));
  // Lignes par table dans le dump (blocs COPY … \.) : référence des comptes restaurés.
  const rows = runClient(`pg_restore -a -f - /work/geo.dump | awk '/^COPY /{t=$2; n=0; on=1; next} on && /^\\\\\\.$/{print t, n; on=0; next} on{n++}'`);
  const dumpRows = Object.fromEntries(rows.stdout.trim().split("\n").filter(Boolean).map((l) => l.split(" ")).map(([t, n]) => [t, Number(n)]));
  ok("comptes du dump lus (geo.lots > 0)", rows.status === 0 && dumpRows["geo.lots"] > 0, rows.stdout);
  const sha = createHash("sha256").update(readFileSync(dumpFile)).digest("hex");
  writeFileSync(join(work, "backup.env"), [`BACKUP_DATE=2026-09-26`, `PG_SHA256=${sha}`, `EXPECTED_TOC_ENTRIES=${tocShape.length}`,
    `DUMP_DATABASE=${DB}`, `DUMP_FILE=${DB}.dump`].join("\n") + "\n");
  chmodSync(join(work, "backup.env"), 0o644);

  waitReady(TGT, TARGET_USER, DB);
  const fresh = targetState();
  ok("cible fraîche : 4 extensions de l'image (fuzzystrmatch dans public), pas de schéma geo",
    /fuzzystrmatch@public/.test(fresh.exts) && /postgis_tiger_geocoder@tiger/.test(fresh.exts) && /postgis_topology@topology/.test(fresh.exts) && fresh.geoSchema === "0", JSON.stringify(fresh));

  // 1. Ancienne commande : échec soundex, cible intacte.
  const legacy = runClient(LEGACY_RESTORE);
  ok("ancienne commande S2 — échec « function soundex(character varying) does not exist » (incident reproduit)",
    legacy.status !== 0 && /function soundex\(character varying\) does not exist/.test(legacy.stderr), `exit ${legacy.status} ${tail(legacy.stderr)}`);
  ok("ancienne commande — transaction annulée : cible inchangée", JSON.stringify(targetState()) === JSON.stringify(fresh));

  // 2-3. Script réel du template, deux fois.
  const script = restoreScript(TEMPLATE);
  // Tables de config des extensions (spatial_ref_sys, tiger.pagc_*…) : le dump n'en porte
  // que les lignes ajoutées par l'utilisateur (pg_extension_config_dump) ; la cible garde
  // les lignes de l'image. Comparaison exacte sur les tables applicatives seulement.
  const extMember = (t) => q(TGT, TARGET_USER, DB, `select exists (select 1 from pg_depend where classid = 'pg_class'::regclass and objid = '${t}'::regclass and deptype = 'e')`) === "t";
  const counts = () => Object.fromEntries(Object.keys(dumpRows).filter((t) => !extMember(t)).map((t) => [t, Number(q(TGT, TARGET_USER, DB, `select count(*) from ${t}`))]));
  const appRows = () => Object.fromEntries(Object.entries(dumpRows).filter(([t]) => !extMember(t)));
  for (const pass of [1, 2]) {
    const term = join(work, `term-${pass}.json`);
    writeFileSync(term, "");
    chmodSync(term, 0o666);
    const r = runClient(script, ["-e", `EXPECTED_DATABASE=${DB}`, "-v", `${term}:/dev/termination-log`]);
    let verdict = null;
    try { verdict = JSON.parse(readFileSync(term, "utf8")); } catch { verdict = null; }
    ok(`template (restore ${pass}) — exit 0, verdict ok, TOC ${tocShape.length}`, r.status === 0 && verdict && verdict.ok === true && verdict.tocEntries === tocShape.length,
      `exit ${r.status} verdict ${JSON.stringify(verdict)} ${tail(r.stdout)} ${tail(r.stderr)}`);
    if (r.status !== 0) break;
    ok(`template (restore ${pass}) — postgis_version() répond`, /USE_GEOS/.test(q(TGT, TARGET_USER, DB, "select postgis_version()")));
    const got = counts();
    const want = appRows();
    ok(`template (restore ${pass}) — lignes des tables applicatives = dump (${JSON.stringify(got)})`, Object.keys(want).length > 0 && JSON.stringify(got) === JSON.stringify(want),
      JSON.stringify({ got, want }));
    ok(`template (restore ${pass}) — index lots_geom_gix présent, extensions de l'image conservées`,
      q(TGT, TARGET_USER, DB, "select count(*) from pg_indexes where schemaname = 'geo' and indexname = 'lots_geom_gix'") === "1" && targetState().exts === fresh.exts);
  }

  // 4. Échec d'un restore ⇒ base intacte (--single-transaction conservé).
  if (failed === 0) {
    const before = targetState();
    q(TGT, TARGET_USER, DB, "create view public.v_block as select geoid from geo.lots");
    const term = join(work, "term-fail.json");
    writeFileSync(term, "");
    chmodSync(term, 0o666);
    const r = runClient(script, ["-e", `EXPECTED_DATABASE=${DB}`, "-v", `${term}:/dev/termination-log`]);
    let verdict = null;
    try { verdict = JSON.parse(readFileSync(term, "utf8")); } catch { verdict = null; }
    ok("restore bloqué (vue dépendante) — exit ≠ 0, verdict « single transaction rolled back »", r.status !== 0 && verdict && verdict.ok === false && /rolled back/.test(verdict.reason),
      `exit ${r.status} ${JSON.stringify(verdict)}`);
    ok("restore bloqué — base intacte (mêmes extensions, mêmes lignes)", JSON.stringify(targetState()) === JSON.stringify(before));
    q(TGT, TARGET_USER, DB, "drop view public.v_block");
  }
} catch (e) {
  ok(`exécution Docker — ${e.message}`, false);
}

console.log(`\nrestore-pg.docker.selftest (geo) — ${passed} passés, ${failed} échoués${REAL_DUMP ? " (vrai dump)" : " (source synthétique)"}`);
process.exit(failed ? 1 : 0);
