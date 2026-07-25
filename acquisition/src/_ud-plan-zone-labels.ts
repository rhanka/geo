/**
 * _ud-plan-zone-labels.ts — $0 read-only. Extrait d'un PDF de PLAN DE ZONAGE (couche
 * texte) tous les libellés de zone de la forme <numéro><sigle> et rend le mapping
 * numéro -> sigle(s). Sert la lane usage_dominant quand le SIG ne porte QUE le numéro
 * alors que le règlement attache la dominance à une LETTRE écrite sur le plan.
 *
 *   npx tsx acquisition/src/_ud-plan-zone-labels.ts --pdf <path> --sigles A,Ad1,Af,Ca,F,I,Mi,P,R,Rc,Re,Rv,Co,Coi
 *   [--codes 25,38,33]   # limite la sortie aux numéros réellement servis
 *
 * N'écrit rien. Signale les numéros AMBIGUS (deux sigles différents) : ils doivent
 * rester null (anti-invention).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pdf = arg("pdf");
const sigles = (arg("sigles") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!pdf || !existsSync(pdf) || !sigles.length) {
  console.error("usage: --pdf <path existant> --sigles A,Af,Mi,… [--codes 25,38]");
  process.exit(2);
}
const only = new Set((arg("codes") ?? "").split(",").map((s) => s.trim()).filter(Boolean));

const txt = execFileSync("pdftotext", ["-layout", pdf, "-"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
});

// sigles les plus longs d'abord pour que « Ad1 » l'emporte sur « A »
const alt = [...sigles].sort((a, b) => b.length - a.length).join("|");
// STRICT : pas d'espace toléré entre numéro et sigle. Tolérer l'espace a produit
// des faux positifs mesurés (« 521 R » = un numéro de lot, « 3 F » = du bruit).
const re = new RegExp(`(?<![0-9A-Za-z])(\\d{1,3})(${alt})(?![0-9A-Za-z])`, "g");

const found = new Map<string, Map<string, number>>();
for (const m of txt.matchAll(re)) {
  const [, num, sig] = m;
  if (!found.has(num)) found.set(num, new Map());
  const inner = found.get(num)!;
  inner.set(sig, (inner.get(sig) ?? 0) + 1);
}

const nums = [...found.keys()].sort((a, b) => Number(a) - Number(b));
let ambig = 0;
for (const n of nums) {
  if (only.size && !only.has(n)) continue;
  const inner = found.get(n)!;
  const parts = [...inner.entries()].sort((a, b) => b[1] - a[1]);
  const flag = parts.length > 1 ? "  ⚠ AMBIGU" : "";
  if (parts.length > 1) ambig++;
  console.log(`${n.padStart(4)} -> ${parts.map(([s, c]) => `${s}×${c}`).join(", ")}${flag}`);
}
console.log(`# ${nums.length} numéros trouvés dans le plan, ${ambig} ambigus`);
if (only.size) {
  const missing = [...only].filter((c) => !found.has(c)).sort((a, b) => Number(a) - Number(b));
  console.log(`# demandés=${only.size} absents du plan=${missing.length}${missing.length ? " : " + missing.join(",") : ""}`);
}
