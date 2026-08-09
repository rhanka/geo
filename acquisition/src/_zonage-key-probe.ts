/**
 * _zonage-key-probe — $0 read-only diagnostic. Liste TOUTES les clés S3 sous
 * `normalized/ca-qc-zonage/` qui contiennent le slug, avec taille + date, et dit
 * si `usage_dominant` est présent dans chacune.
 *
 * Pourquoi: `fold-usage-dominant` écrit sur la PREMIÈRE clé trouvée (plate, puis
 * sous-dossier). Si les DEUX existent et que geo-api sert l'autre, le fold est
 * un no-op visible côté API (symptôme: la collection servie reste `null` partout
 * alors que le fold rapporte `couvert=...`). Ce probe tranche sans rien écrire.
 *
 *   npx tsx acquisition/src/_zonage-key-probe.ts --slug cap-sante
 */
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

import { BUCKET, s3Client, getBytes } from "./lib/s3.js";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const slug = (arg("slug") ?? "").trim();
  if (!slug) throw new Error("required: --slug <slug>");
  const s3 = s3Client();

  const keys: { key: string; size: number; mtime: string }[] = [];
  let token: string | undefined;
  do {
    const out = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: "normalized/ca-qc-zonage/",
        ContinuationToken: token,
      }),
    );
    for (const o of out.Contents ?? []) {
      if (o.Key && o.Key.includes(slug)) {
        keys.push({
          key: o.Key,
          size: o.Size ?? 0,
          mtime: o.LastModified ? o.LastModified.toISOString() : "?",
        });
      }
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);

  if (keys.length === 0) {
    console.log(`slug=${slug} — AUCUNE clé sous normalized/ca-qc-zonage/`);
    return;
  }
  console.log(`slug=${slug} — ${keys.length} clé(s):`);
  for (const k of keys) {
    let verdict = "";
    try {
      const fc = JSON.parse((await getBytes(s3, k.key)).toString("utf8")) as {
        features?: { properties?: Record<string, unknown> }[];
      };
      const feats = fc.features ?? [];
      const withField = feats.filter((f) => f.properties && "usage_dominant" in f.properties).length;
      const nonNull = feats.filter((f) => (f.properties?.["usage_dominant"] ?? null) !== null).length;
      verdict = `features=${feats.length} usage_dominant_present=${withField} non_null=${nonNull}`;
    } catch (e) {
      verdict = `illisible: ${e instanceof Error ? e.message : String(e)}`;
    }
    console.log(`  ${k.key}`);
    console.log(`      size=${k.size} mtime=${k.mtime} ${verdict}`);
  }
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
