/**
 * geo-served-contract-verify.ts — VÉRIFIE le contrat publié comme le ferait un
 * CONSOMMATEUR EXTERNE, pas comme son auteur.
 *
 * Le producteur qui relit sa propre variable en mémoire ne prouve rien : il
 * prouve qu'il sait recalculer ce qu'il vient de calculer. Ce runner repart des
 * OCTETS STOCKÉS et refait les trois contrôles que `SPEC_GEO_SERVED_CONTRACT.md`
 * §1 impose à un lecteur tiers :
 *
 *   1. `latest.json` porte `snapshot_sha256` et `snapshot_s3_uri` sous le préfixe
 *      attendu ;
 *   2. le SHA-256 des octets RÉELLEMENT téléchargés du snapshot vaut exactement
 *      ce `snapshot_sha256` ;
 *   3. le nom du fichier snapshot EST ce hash, sans le préfixe `sha256:`.
 *
 * Un seul contrôle en échec ⇒ la publication est fausse, et le runner sort en
 * erreur plutôt que d'annoncer un succès partiel. Il ÉCRIT RIEN : lecture seule.
 *
 * Usage :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/geo-served-contract-verify.ts
 */
import { createHash } from "node:crypto";

import { getBytes, s3Client } from "./lib/s3.js";

const PREFIX = "exports/immo/geo-served-contract/v1";
const LATEST_KEY = `${PREFIX}/latest.json`;
const SNAPSHOT_PREFIX = `${PREFIX}/snapshots/`;

interface LatestPointer {
  readonly snapshot_sha256?: unknown;
  readonly snapshot_s3_uri?: unknown;
  readonly schema_version?: unknown;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `s3://<bucket>/<key>` → `<key>`. Refuse toute autre forme : une URI qu'on ne
 *  sait pas lire ne doit pas être « interprétée au mieux ». */
function keyFromS3Uri(uri: string): string {
  const match = /^s3:\/\/[^/]+\/(.+)$/.exec(uri);
  if (!match?.[1]) throw new Error(`URI de snapshot illisible: ${uri}`);
  return match[1];
}

async function main(): Promise<void> {
  const s3 = s3Client();
  const failures: string[] = [];

  const latest = JSON.parse((await getBytes(s3, LATEST_KEY)).toString("utf8")) as LatestPointer;
  const declaredSha = latest.snapshot_sha256;
  const snapshotUri = latest.snapshot_s3_uri;

  // Contrôle 1 — le pointeur porte les deux champs, et le snapshot est bien sous
  // le préfixe attendu. Un snapshot ailleurs ne serait pas couvert par le contrat.
  if (typeof declaredSha !== "string" || !/^sha256:[a-f0-9]{64}$/.test(declaredSha)) {
    failures.push(`latest.snapshot_sha256 absent ou hors format: ${JSON.stringify(declaredSha)}`);
  }
  if (typeof snapshotUri !== "string") {
    failures.push(`latest.snapshot_s3_uri absent: ${JSON.stringify(snapshotUri)}`);
  }
  if (failures.length > 0) {
    console.error(JSON.stringify({ verified: false, failures }, null, 2));
    process.exitCode = 1;
    return;
  }

  const snapshotKey = keyFromS3Uri(snapshotUri as string);
  if (!snapshotKey.startsWith(SNAPSHOT_PREFIX)) {
    failures.push(`snapshot hors du préfixe contractuel: ${snapshotKey}`);
  }

  // Contrôle 2 — re-hachage des OCTETS TÉLÉCHARGÉS, pas d'une valeur en mémoire.
  const bytes = await getBytes(s3, snapshotKey);
  const actual = `sha256:${sha256Hex(bytes)}`;
  if (actual !== declaredSha) {
    failures.push(`sha des octets téléchargés ${actual} ≠ latest.snapshot_sha256 ${String(declaredSha)}`);
  }

  // Contrôle 3 — le NOM du fichier est ce hash. Sans lui, deux snapshots
  // différents pourraient coexister sous un même nom au fil des republications.
  const expectedName = `${(declaredSha as string).slice("sha256:".length)}.json`;
  const actualName = snapshotKey.slice(SNAPSHOT_PREFIX.length);
  if (actualName !== expectedName) {
    failures.push(`nom du snapshot ${actualName} ≠ hash attendu ${expectedName}`);
  }

  const manifest = JSON.parse(bytes.toString("utf8")) as { schema_version?: unknown; complete?: unknown };
  console.log(JSON.stringify({
    verified: failures.length === 0,
    latest_uri: `s3://sentropic-geo/${LATEST_KEY}`,
    snapshot_uri: snapshotUri,
    snapshot_sha256: declaredSha,
    snapshot_bytes: bytes.length,
    schema_version: manifest.schema_version ?? null,
    complete: manifest.complete ?? null,
    failures,
  }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
