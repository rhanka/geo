/**
 * _effet-densifiant-triage.ts — lane geo-4a (effet densifiant), triage $0 read-only.
 *
 * Pour chaque slug: (1) règlement de zonage SERVI (registre reglement-provenance),
 * (2) inventaire disque work/zonage-norms/<slug>/ (PDF = grilles/corps ; json =
 * extractions), (3) tout second-côté candidat (projet/refonte/amendement) sur disque.
 *
 * ANTI-INVENTION: n'extrait ni ne décide rien. Affiche des faits bruts (registre +
 * fichiers). L'opérateur décide s'il existe un CHANGEMENT de zonage à deux côtés.
 *
 * Usage: npx tsx acquisition/src/_effet-densifiant-triage.ts --slugs a,b,c
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NORMS = resolve(ROOT, "work", "zonage-norms");
const PROV = resolve(ROOT, "acquisition", "config", "reglement-provenance.json");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function listDir(dir: string): { name: string; kb: number }[] {
  try {
    return readdirSync(dir)
      .map((n) => ({ name: n, kb: Math.round(statSync(resolve(dir, n)).size / 1024) }))
      .sort((a, b) => b.kb - a.kb);
  } catch {
    return [];
  }
}

function main(): void {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) {
    console.log("usage: --slugs a,b,c");
    process.exit(1);
  }
  const prov = JSON.parse(readFileSync(PROV, "utf8")) as { slugs: Record<string, Record<string, unknown>> };
  for (const slug of slugs) {
    console.log(`\n===== ${slug} =====`);
    const p = prov.slugs[slug];
    if (p) {
      console.log(
        `PROV reglement=${p["reglement_numero"] ?? "null"} millesime=${p["reglement_millesime"] ?? "null"} url=${p["reglement_url"] ?? "null"}`,
      );
      if (p["_note"]) console.log(`NOTE ${String(p["_note"]).slice(0, 400)}`);
    } else {
      console.log("PROV absent (aucune entrée registre)");
    }
    const dir = resolve(NORMS, slug);
    const files = listDir(dir);
    if (!files.length) {
      console.log(`DISK work/zonage-norms/${slug}/ : (vide/absent)`);
    } else {
      const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
      const jsons = files.filter((f) => f.name.toLowerCase().endsWith(".json"));
      console.log(`DISK pdfs=${pdfs.length} jsons=${jsons.length}`);
      for (const f of pdfs) console.log(`  PDF  ${f.kb}KB ${f.name}`);
      for (const f of jsons.slice(0, 12)) console.log(`  JSON ${f.kb}KB ${f.name}`);
    }
    // second-côté candidats: dossier -projet / -refonte / -amendement
    for (const suff of ["-projet", "-refonte", "-amendement", "-ancien", "-avant"]) {
      const d = resolve(NORMS, `${slug}${suff}`);
      if (existsSync(d)) console.log(`SECOND-COTE dir present: ${slug}${suff}/ (${listDir(d).length} fichiers)`);
    }
  }
}

main();
