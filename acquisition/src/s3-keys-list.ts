/**
 * s3-keys-list.ts — imprime les CLÉS S3 BRUTES (chemin complet) sous un préfixe,
 * filtrées par sous-chaîne. Diagnostic pur (0 écriture, 0 secret imprimé).
 *
 * Sert à lever l'ambiguïté "clé à plat supprimée mais List en retard" vs
 * "clé en sous-dossier jamais supprimée" : `qc-lots-gap` et `s3-key-probe --find`
 * masquent le chemin, cet outil le montre tel quel (y compris les sous-dossiers).
 *
 *   npx tsx acquisition/src/s3-keys-list.ts <prefix> [needle]
 *   npx tsx acquisition/src/s3-keys-list.ts normalized/ca-qc-zonage/ -arcgis
 */
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

import { BUCKET, s3Client } from "./lib/s3.js";

const [prefix, needle] = process.argv.slice(2);
if (!prefix) {
  console.error("usage: npx tsx acquisition/src/s3-keys-list.ts <prefix> [needle]");
  process.exit(2);
}

const s3 = s3Client();
let token: string | undefined;
let total = 0;
let shown = 0;
do {
  const r = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
  );
  for (const o of r.Contents ?? []) {
    const k = o.Key ?? "";
    total += 1;
    if (needle && !k.includes(needle)) continue;
    shown += 1;
    console.log(k);
  }
  token = r.IsTruncated ? r.NextContinuationToken : undefined;
} while (token);
console.error(`# ${shown}/${total} clés sous ${prefix}${needle ? ` contenant "${needle}"` : ""}`);
