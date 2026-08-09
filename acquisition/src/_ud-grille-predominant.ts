/**
 * _ud-grille-predominant.ts — lane usage_dominant.
 *
 * Certaines grilles des spécifications portent, EN EN-TÊTE DE CHAQUE FICHE DE ZONE, une
 * déclaration de dominance (« USAGE PRÉDOMINANT: R ») à côté du numéro de zone (« Zone 100 »).
 * Ce n'est PAS la matrice des usages permis : c'est une déclaration, une fiche par zone.
 * Ce helper apparie, page par page, le numéro de zone et le sigle déclaré, et rend la
 * distribution + les pages où l'appariement échoue (à lire à la main).
 *
 * usage: --pdf <path> [--zone-re <regex>] [--dom-re <regex>] [--json]
 *   --zone-re  motif de capture du numéro de zone   (défaut: /\bZone\s+([A-Za-z0-9\-]+)/)
 *   --dom-re   motif de capture du sigle dominant   (défaut: /USAGE\s+PR.DOMINANT\s*:?\s*([A-Za-z]+)/)
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pdf = arg("pdf");
if (!pdf || !existsSync(pdf)) throw new Error("usage: --pdf <path existant> [--zone-re R] [--dom-re R] [--json]");

const zoneRe = new RegExp(arg("zone-re") ?? String.raw`\bZone\s+([A-Za-z0-9\-]+)`, "i");
const domRe = new RegExp(arg("dom-re") ?? String.raw`USAGE\s+PR.DOMINANT\s*:?\s*([A-Za-z]+)`, "i");
const asJson = process.argv.includes("--json");

const txt = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const pages = txt.split("\f");

const pairs: Array<{ page: number; zone: string; dom: string }> = [];
const misses: Array<{ page: number; zone?: string; dom?: string }> = [];

pages.forEach((page, i) => {
  if (!page.trim()) return;
  const z = page.match(zoneRe);
  const d = page.match(domRe);
  if (z?.[1] && d?.[1]) pairs.push({ page: i + 1, zone: z[1], dom: d[1].toUpperCase() });
  else if (z?.[1] || d?.[1]) misses.push({ page: i + 1, zone: z?.[1], dom: d?.[1]?.toUpperCase() });
});

// une zone peut occuper plusieurs pages: on garde la valeur et on signale toute CONTRADICTION
const byZone = new Map<string, Set<string>>();
for (const p of pairs) {
  if (!byZone.has(p.zone)) byZone.set(p.zone, new Set());
  byZone.get(p.zone)!.add(p.dom);
}
const conflicts = [...byZone.entries()].filter(([, s]) => s.size > 1);

if (asJson) {
  const out: Record<string, string> = {};
  for (const [z, s] of byZone) if (s.size === 1) out[z] = [...s][0];
  console.log(JSON.stringify(out, null, 2));
} else {
  const dist = new Map<string, number>();
  for (const [, s] of byZone) if (s.size === 1) dist.set([...s][0], (dist.get([...s][0]) ?? 0) + 1);
  console.log(`# ${pdf}`);
  console.log(`pages=${pages.length} fiches appariées=${pairs.length} zones distinctes=${byZone.size}`);
  console.log(`distribution: ${[...dist.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" ")}`);
  console.log(`zones: ${[...byZone.entries()].filter(([, s]) => s.size === 1).map(([z, s]) => `${z}:${[...s][0]}`).join(" ")}`);
  if (conflicts.length) console.log(`⚠️ CONTRADICTIONS (même zone, sigles différents): ${conflicts.map(([z, s]) => `${z}:{${[...s].join(",")}}`).join(" ")}`);
  if (misses.length) console.log(`⚠️ pages NON appariées (${misses.length}): ${misses.map((m) => `p${m.page}[zone=${m.zone ?? "?"} dom=${m.dom ?? "?"}]`).join(" ")}`);
}
