#!/usr/bin/env node
// geo-preprod-refresh.mjs — la gate « dernier km » du cycle de récup preprod (§4 SPEC
// geo-preprod-serving). Après qu'un job de sync a écrit `normalized-preprod/…` + stampé
// un coherence_id, CE script rend le nouveau point de cohérence RÉELLEMENT SERVI :
//
//   1. rollout restart deployment/<deploy> -n <ns>   (geo-api cache son index au démarrage)
//   2. rollout status (attend Ready)
//   3. verify GATÉ (geo-verify-served-collections.mjs) : les collections sont exposées ET
//      — si --expect-coherence — le coherence_id SERVI == celui sync'd (fail-closed).
//
// Ordre §4 : sync → stamp coherence_id → CE refresh → alors seulement le coherence_id est
// *servi*. Tant que le verify échoue (pod pas frais / champ coherence non exposé), le
// coherence_id N'EST PAS déclaré servi. Committé = rejouable par le job poc-k8s.
//
// Usage : node scripts/geo-preprod-refresh.mjs [--deploy geo-api-preprod] [--ns geo-preprod]
//            [--base https://api.preprod.geo.sent-tech.ca] [--expect-coherence <id>]
//            [--coherence-field <path>] <collId> [<collId> …]
//   OVH_KUBECONFIG (def /tmp/ovh.kubeconfig), ROLLOUT_TIMEOUT (def 180s)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KUBECONFIG = process.env.OVH_KUBECONFIG || "/tmp/ovh.kubeconfig";
const TIMEOUT = process.env.ROLLOUT_TIMEOUT || "180s";
const here = dirname(fileURLToPath(import.meta.url));

let deploy = "geo-api-preprod";
let ns = "geo-preprod";
let base = process.env.GEO_API_BASE || "https://api.preprod.geo.sent-tech.ca";
let expectCoherence = null;
let coherenceField = null;
const ids = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--deploy") deploy = argv[++i];
  else if (a === "--ns") ns = argv[++i];
  else if (a === "--base") base = argv[++i];
  else if (a === "--expect-coherence") expectCoherence = argv[++i];
  else if (a === "--coherence-field") coherenceField = argv[++i];
  else ids.push(a);
}
if (ids.length === 0) {
  console.error("usage: node scripts/geo-preprod-refresh.mjs [--deploy …] [--ns …] [--base …] [--expect-coherence <id>] <collId> …");
  process.exit(2);
}

const kubectl = (args) =>
  execFileSync("kubectl", ["--kubeconfig", KUBECONFIG, "-n", ns, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  console.error(`# 1/3 rollout restart deployment/${deploy} -n ${ns}`);
  console.error(kubectl(["rollout", "restart", `deployment/${deploy}`]).trim());
  console.error(`# 2/3 rollout status (timeout ${TIMEOUT})`);
  console.error(kubectl(["rollout", "status", `deployment/${deploy}`, `--timeout=${TIMEOUT}`]).trim());
} catch (e) {
  console.error(`ROLLOUT ECHEC: ${(e.stderr || e.stdout || e.message || "").toString().trim()}`);
  process.exit(3);
}

console.error(`# 3/3 verify gaté (base=${base}${expectCoherence ? `, expect-coherence=${expectCoherence}` : ""})`);
const verifyArgs = [join(here, "geo-verify-served-collections.mjs")];
if (expectCoherence) verifyArgs.push("--expect-coherence", expectCoherence);
if (coherenceField) verifyArgs.push("--coherence-field", coherenceField);
verifyArgs.push(...ids);
try {
  execFileSync("node", verifyArgs, { stdio: "inherit", env: { ...process.env, GEO_API_BASE: base } });
} catch {
  console.error("VERIFY ECHEC: coherence_id non servi frais OU collection absente => coherence_id NON declare servi.");
  process.exit(1);
}
console.error("OK: rollout applique + verify gate verte => coherence_id SERVI.");
