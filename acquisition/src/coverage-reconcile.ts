/**
 * coverage-reconcile — réconcilie work/coverage/coverage-matrix.json sur la
 * VÉRITÉ S3 (les workers publient en S3, le conductor réconcilie ici).
 *
 * Un SEUL script nommé, appelé simplement `npx tsx src/coverage-reconcile.ts`
 * — au lieu d'inliner un gros `node -e '...'` à chaque tick (qui déclenche des
 * demandes d'autorisation parce que non analysable statiquement).
 *
 * Marque `status:"done"` chaque ville dont la donnée existe en S3 :
 *   - pv      ← registry/qc-pv/<slug>/index.json
 *   - normes  ← registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet
 *   - zones   ← normalized/ca-qc-zonage/qc-zonage-<slug>.geojson (plat ou sous-dossier)
 *   - cadastre← normalized/qc-cadastre-lots/<slug>.geojson
 *   - role    ← registry/role-foncier/<slug>.parquet
 *
 * N'écrit jamais de secret. Idempotent. Écrit la matrice + imprime le scoreboard.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { s3Client, BUCKET } from "./lib/s3.js";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";

const HERE = dirname(fileURLToPath(import.meta.url));
const MATRIX = resolve(HERE, "..", "..", "work", "coverage", "coverage-matrix.json");

/** Tous les slugs sous `prefix` extraits par `pick` (dédupliqués). */
async function slugSet(
  s3: S3Client,
  prefix: string,
  pick: (key: string) => string | null,
): Promise<Set<string>> {
  const out = new Set<string>();
  let token: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const o of r.Contents ?? []) {
      const slug = o.Key ? pick(o.Key) : null;
      if (slug) out.add(slug);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

interface Layer {
  field: string;
  prefix: string;
  pick: (key: string) => string | null;
  track: (slug: string) => string;
}

const LAYERS: Layer[] = [
  {
    field: "pv",
    prefix: "registry/qc-pv/",
    pick: (k) => k.match(/registry\/qc-pv\/([^/]+)\//)?.[1] ?? null,
    track: (s) => `qc-pv-${s}`,
  },
  {
    field: "normes",
    prefix: "registry/qc-zonage-norms/",
    pick: (k) => {
      if (!k.endsWith(".parquet")) return null;
      const s = k
        .replace("registry/qc-zonage-norms/qc-zonage-norms-", "")
        .replace(/\.parquet$/, "")
        .replace(/\/.*/, "");
      return s && !s.startsWith("manifest") ? s : null;
    },
    track: (s) => `qc-zonage-norms-${s}`,
  },
  {
    field: "zones",
    prefix: "normalized/ca-qc-zonage/",
    pick: (k) =>
      k.match(/ca-qc-zonage\/qc-zonage-([^/]+)\.geojson$/)?.[1] ??
      k.match(/ca-qc-zonage\/qc-zonage-([^/]+)\/qc-zonage-/)?.[1] ??
      null,
    track: (s) => `qc-zonage-${s}`,
  },
  {
    field: "cadastre",
    prefix: "normalized/qc-cadastre-lots/",
    pick: (k) => k.match(/qc-cadastre-lots\/([^/]+)\.geojson$/)?.[1] ?? null,
    track: (s) => `qc-cadastre-lots-${s}`,
  },
  {
    field: "role-foncier",
    prefix: "registry/role-foncier/",
    pick: (k) => k.match(/role-foncier\/([^/]+)\.parquet$/)?.[1] ?? null,
    track: (s) => `role-foncier-${s}`,
  },
];

async function main(): Promise<void> {
  const s3 = s3Client();
  const matrix = JSON.parse(readFileSync(MATRIX, "utf8")) as {
    cities: Record<string, Record<string, { status?: string; doneTrack?: string }>>;
  };
  const cities = matrix.cities;

  const deltas: Record<string, number> = {};
  for (const layer of LAYERS) {
    const present = await slugSet(s3, layer.prefix, layer.pick);
    let added = 0;
    for (const slug of present) {
      const city = cities[slug];
      if (!city) continue;
      const cur = city[layer.field];
      if (!cur || cur.status !== "done") {
        city[layer.field] = {
          ...(cur ?? {}),
          status: "done",
          doneTrack: layer.track(slug),
        };
        added++;
      }
    }
    deltas[layer.field] = added;
  }

  writeFileSync(MATRIX, JSON.stringify(matrix, null, 2));

  const done = (field: string): number =>
    Object.keys(cities).filter((s) => cities[s][field]?.status === "done").length;
  const line = LAYERS.map(
    (l) => `${l.field}=${done(l.field)} (+${deltas[l.field]})`,
  ).join(" | ");
  console.log(`SCOREBOARD /1106 : ${line}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
