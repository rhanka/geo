/** _reglement-registry-show.ts — imprime les entrées du registre pour --slugs a,b,c. Lecture seule. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");
const i = process.argv.indexOf("--slugs");
const slugs = (i >= 0 ? process.argv[i + 1] : "").split(",").map((s) => s.trim()).filter(Boolean);
const cfg = JSON.parse(readFileSync(REGISTRY, "utf8")) as { slugs: Record<string, unknown> };
for (const s of slugs) {
  console.log(`\n### ${s}`);
  console.log(s in cfg.slugs ? JSON.stringify(cfg.slugs[s], null, 2) : "(ABSENT)");
}
