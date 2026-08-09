/**
 * _html-links-dump.ts — sonde READ-ONLY, $0, lane P0_1 (provenance règlement).
 *
 * Beaucoup de portails municipaux (WebLex, OctoberCMS, WordPress) rendent leur
 * catalogue de règlements en HTML plat: le titre du lien porte le numéro, et
 * l'URL ne le porte PAS (piège [[reglement-numero-url-trap]]). WebFetch, lui,
 * résume la page avec un petit modèle et AVALE la liste quand elle est longue —
 * mesuré sur sthilairededorset.ca: « aucun lien détaillé » alors que le HTML en
 * porte des dizaines.
 *
 * Cette sonde télécharge (ou relit) le HTML et imprime les ancres <a> avec leur
 * texte, filtrées par motif. Elle n'extrait AUCUN numéro et ne décide rien:
 * l'opérateur lit le document ciblé et relève le numéro VERBATIM.
 *
 * Usage:
 *   npx tsx acquisition/src/_html-links-dump.ts --url <url> [--match zonage|urbanisme]
 *   npx tsx acquisition/src/_html-links-dump.ts --file /abs/page.html --match regl
 */
import { readFileSync } from "node:fs";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function main(): Promise<void> {
  const url = arg("url");
  const file = arg("file");
  const match = arg("match");
  if (!url && !file) {
    console.error("usage: --url <url> | --file <path> [--match <regex>]");
    process.exit(2);
  }
  let html: string;
  if (file) {
    html = readFileSync(file, "utf8");
  } else {
    const res = await fetch(url!, { headers: { "user-agent": UA }, redirect: "follow" });
    html = await res.text();
    console.log(`# HTTP ${res.status} ${res.headers.get("content-type") ?? "?"} ${html.length}o ${url}`);
  }
  const re = match ? new RegExp(match, "i") : null;
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  let shown = 0;
  const seen = new Set<string>();
  for (const m of anchors) {
    const href = decode(m[1]!.trim());
    const text = decode(m[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (!text && !href) continue;
    const key = `${text}\t${href}`;
    if (seen.has(key)) continue;
    if (re && !re.test(text) && !re.test(href)) continue;
    seen.add(key);
    console.log(`${text}\t${href}`);
    shown++;
  }
  console.log(`# ancres=${anchors.length} affichées=${shown} match=${match ?? "-"}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
