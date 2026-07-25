/**
 * _frag-verify-backups.ts — ONE-OFF: confirm the non-destructive backup key
 * exists on S3 for every zone-contiguity rectification in this mission.
 *
 * Usage: npx tsx acquisition/src/_frag-verify-backups.ts
 */
import { exists, s3Client } from "./lib/s3.js";

const SLUGS = ["notre-dame-de-lourdes--joliette", "cowansville"];

async function main(): Promise<void> {
  const s3 = s3Client();
  for (const slug of SLUGS) {
    const key = `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`;
    const backupKey = `normalized/ca-qc-zonage/qc-zonage-${slug}.contour-auto-preclip.geojson`;
    const hasServed = await exists(s3, key);
    const hasBackup = await exists(s3, backupKey);
    console.log(`${slug}: served=${hasServed} backup=${hasBackup}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
