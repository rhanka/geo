import { s3Client, listSlugs, BUCKET } from "./lib/s3.js";
const s3 = s3Client();
const slugs = await listSlugs(s3, "registry/qc-zonage-norms/qc-zonage-norms-", ".parquet");
console.log("count:" + slugs.length);
slugs.sort().forEach(s => console.log("  " + s));
