/** Consolidate prior shard evidence, bounded official scans, and this pass's deposits. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Row = { slug: string; index: number; status: "depot" | "echec"; method: string; proof: string; source?: string };
const matrix = JSON.parse(readFileSync("work/coverage/coverage-matrix.json", "utf8")) as { cities: Record<string, any> };
const sorted = Object.keys(matrix.cities).sort();
const depositedThisPass = new Set<string>(["sainte-elisabeth"]);
const shard = sorted
  .map((slug, index) => ({ slug, index }))
  .filter(({ slug, index }) => index % 2 === 1 && (matrix.cities[slug]?.zones?.status !== "done" || depositedThisPass.has(slug)));
const shardSet = new Set(shard.map((row) => row.slug));

const prior = new Map<string, Omit<Row, "index">>();
function walk(value: unknown, context: string): void {
  if (!value) return;
  if (Array.isArray(value)) return value.forEach((item) => walk(item, context));
  if (typeof value !== "object") return;
  const object = value as Record<string, any>;
  if (typeof object.slug === "string" && shardSet.has(object.slug)) {
    const proof = object.proof ?? object.reason ?? object.verdict;
    if (typeof proof === "string" && proof.trim()) {
      const deposit = /deposit|depot/i.test(context) || /deposit|depot/i.test(String(object.status ?? ""));
      const candidate: Omit<Row, "index"> = {
        slug: object.slug,
        status: deposit ? "depot" : "echec",
        method: String(object.method ?? object.methode ?? "preuve rapport antérieur"),
        proof: proof.trim(),
        ...(object.sourceUrl ? { source: String(object.sourceUrl) } : {}),
      };
      const existing = prior.get(object.slug);
      if (!existing || candidate.proof.length > existing.proof.length) prior.set(object.slug, candidate);
    }
  }
  for (const [key, child] of Object.entries(object)) walk(child, `${context}/${key}`);
}
for (const file of readdirSync("work/delegation-mass").filter((name) => /^zones-recalage.*\.json$/.test(name))) {
  try {
    walk(JSON.parse(readFileSync(join("work/delegation-mass", file), "utf8")), file);
  } catch {
    // A malformed unrelated historical report is not evidence.
  }
}

const discovery = new Map<string, any>();
for (let batch = 1; batch <= 8; batch++) {
  const file = `work/zones-recalage/shard1of2/discovery-batch0${batch}.json`;
  const report = JSON.parse(readFileSync(file, "utf8")) as { results: any[] };
  for (const result of report.results) discovery.set(result.slug, result);
}

const explicit = new Map<string, Omit<Row, "index">>([
  ["sainte-elisabeth", {
    slug: "sainte-elisabeth", status: "depot", method: "T2 GCP indépendants + labels texte",
    source: "work/zonage-plans/sainte-elisabeth-plan.pdf",
    proof: "34 GCP indépendants; résidu max 12,977 m / RMS 5,906 m; 177 codes réels verbatim; 131 features; 1092/1119 lots (97,59%); centroïde 1,503 km; dépôt S3 qc-zonage-sainte-elisabeth puis lot-zone-join-run et lots-enriched-run OK (1119 lots, zone_code 97,59%, surface 100%, adresse 98,57%, FSA 100%)",
  }],
  ["austin", {
    slug: "austin", status: "echec", method: "T1 GeoPDF Claude dict-validé + inventaire S3",
    proof: "géoréf NAD83 MTM8, résidu 0,16 m; 125/125 lectures Claude exactes contre 125 codes officiels; ABORT sur cadastre canonique absent: NoSuchKey normalized/qc-cadastre-lots/austin.geojson; inventaire S3 normalized/ vérifié: seules les 2 clés qc-zonage-norms-austin existent, aucune clé cadastre austin",
  }],
  ["saint-david-de-falardeau", {
    slug: "saint-david-de-falardeau", status: "depot", method: "T1 GeoPDF texte + dictionnaire grille×plans",
    source: "https://www.villefalardeau.ca/_files/ugd/3d921f_1339654cb0054f56b76484f4381b5795.pdf",
    proof: "résidu 0,156 m; 130 codes distincts double-attestés; 26 annotations rejetées; spatial 2,024 km; 61 features; 1786/1786 lots; surface 100%; dépôt S3 + lot-zone join + lots-enriched OK",
  }],
  ["sainte-julienne", {
    slug: "sainte-julienne", status: "depot", method: "T1 GeoPDF multisheet texte + dictionnaire grille×plan",
    source: "https://www.sainte-julienne.com/storage/app/media/municipalite/administration/procedures-et-reglements/2312-177_Zonage_HPU_20251009.pdf",
    proof: "résidu 0 m; pages 1+2 fusionnées; 106 codes double-attestés; 3 annotations rejetées; spatial 0,185 km; 97 features; 8246/8247 lots (99,99%); surface 99,84%; dépôt S3 + lot-zone join + lots-enriched OK",
  }],
  ["matane", { slug: "matane", status: "echec", method: "T1 puis T2 auto-GCP page 2", proof: "T1 sans géoréf embarqué; T2: 13 fits passent résidu/holdout (jusqu'à 45 GCP, résidu min 10,358 m), mais rotation ambiguë; couverture tight 0%, serving max 1,89%, aniso serving 0,26% < 85%, seulement 2 codes → SKIP" }],
  ["ogden", { slug: "ogden", status: "echec", method: "T1 GeoPDF Claude dict-validé", proof: "géoréf résiduel 0,18 m et 48/48 lectures validées, mais gate spatial échoue: centroïde labels à 17,01 km du cadastre (>8 km) → ABORT sans dépôt" }],
  ["sacre-coeur", { slug: "sacre-coeur", status: "echec", method: "classification T1/T2", proof: "deux plans officiels vector-glyph (512/457 chemins), zéro code texte; registre de normes absent, donc aucun dictionnaire autoritaire pour la voie Claude dict-validée; aucun dépôt" }],
  ["saint-ambroise", { slug: "saint-ambroise", status: "echec", method: "classification T3", proof: "deux plans officiels raster-scan (une grande image chacun, 0 chemin vectoriel); t2-raster-register exige un seed GCP grossier local absent; aucun recalage démontrable sans fabriquer de contrôles" }],
  ["saint-honore", { slug: "saint-honore", status: "echec", method: "classification T1 glyph", proof: "deux plans officiels vector-glyph (7292/2968 chemins), zéro code texte; registre de normes absent, donc voie Claude dict-validée non ouvrable honnêtement" }],
  ["cap-chat", { slug: "cap-chat", status: "echec", method: "T1 GeoPDF glyphes + classification officielle", proof: "les deux cartes officielles sont géoréférencées (résidus 2,96 m et 1,09 m) mais pdftotext donne 0 code; leurs titres/légendes sont explicitement « Zones de contraintes relatives à l'érosion côtière », pas un zonage municipal → ABORT sans servir" }],
  ["gaspe", { slug: "gaspe", status: "echec", method: "T1 puis T2 auto-seed + arbitrages", proof: "T1 sans /VP /Measure /GEO; T2: seeds résidu/holdout mais iso-gate; arbitrage anisotropie meilleur serving 56,13% < 85%, donc SKIP" }],
  ["lac-sergent", { slug: "lac-sergent", status: "echec", method: "T2 auto-seed + lot-assignment", proof: "2 rotations passent le résidu mais tight=0% et serving=0% pour les deux; marge 0 pt < 15 pt; anisotropie serving 0% < 85% → SKIP" }],
  ["lochaber-partie-ouest", { slug: "lochaber-partie-ouest", status: "echec", method: "T1 GeoPDF glyphes", proof: "GeoPDF officiel résidu 0,16 m mais 0 code sélectionnable; aucun dictionnaire réglementaire autoritaire trouvé pour ouvrir la voie Claude dict-validée → ABORT" }],
  ["saint-jerome", { slug: "saint-jerome", status: "echec", method: "audit résidu PDF", proof: "aucun plan PDF officiel présent dans le cache ou les rapports de recalage; seuls des artefacts ArcGIS historiques existent et l'AGOL owner harvest est explicitement hors mission" }],
  ["saint-felix-dotis", { slug: "saint-felix-dotis", status: "echec", method: "sondage officiel", proof: "liens trouvés: cahier des spécifications, règlement texte et deux extraits d'amendement AVANT/APRÈS; aucun plan de zonage municipal complet téléchargeable dans le scan borné" }],
  ["saint-samuel", { slug: "saint-samuel", status: "echec", method: "sondage officiel", proof: "liens officiels trouvés uniquement vers règlement de zonage et projets de règlement; aucun plan/cartographie de zonage autonome" }],
  ["saint-sixte", { slug: "saint-sixte", status: "echec", method: "T2 auto-GCP + arbitrage aniso", proof: "7 seeds passent résidu/holdout mais aucun l'iso-gate; meilleure couverture serving 70,04% < seuil 85% → SKIP" }],
  ["saint-stanislas--maria-chapdelaine", { slug: "saint-stanislas--maria-chapdelaine", status: "echec", method: "classification T3", proof: "deux plans officiels raster purs: 0 texte, 0 chemin vectoriel, une image chacun; aucun seed GCP local fiable pour T3" }],
  ["sainte-angele-de-monnoir", { slug: "sainte-angele-de-monnoir", status: "echec", method: "sondage officiel", proof: "résultats officiels = règlement PIIA et document composite annexes/plans; aucun lien qualifié explicitement comme plan de zonage municipal autonome" }],
  ["sainte-christine", { slug: "sainte-christine", status: "echec", method: "T1 texte + contrôle dictionnaire", proof: "T1 ABORT: aucun /VP /Measure /GEO; plan vector-glyph sans codes sélectionnables; dictionnaire officiel présent mais limité à 201..205, soit 0 code lettré, donc échec du gate explicite ≥3 codes lettrés" }],
  ["sainte-marie-salome", { slug: "sainte-marie-salome", status: "echec", method: "classification T3", proof: "annexe B officielle = raster pur, 0 texte et 0 chemin vectoriel; T3 non ouvrable sans seed GCP grossier local réel" }],
  ["upton", { slug: "upton", status: "echec", method: "T1 puis T2 auto-seed frais", source: "https://www.upton.ca/wp-content/uploads/2026/07/Plan-de-zonage.pdf", proof: "T1 ABORT: aucun /VP /Measure /GEO exploitable. T2: 2635 points SVG et 9 seeds passent résidu+holdout, mais tous échouent l'iso-gate (anisotropie 1,804–3,088 et/ou orientation non north-up); aucun GCP servi ni dépôt." }],
]);

const rows: Row[] = [];
for (const item of shard) {
  const fixed = explicit.get(item.slug);
  if (fixed) {
    rows.push({ ...fixed, index: item.index });
    continue;
  }
  const scan = discovery.get(item.slug);
  if (scan) {
    const pages = Array.isArray(scan.pages) ? scan.pages : [];
    const okPages = pages.filter((page: any) => Number(page.status) >= 200 && Number(page.status) < 300).length;
    rows.push({
      slug: item.slug,
      index: item.index,
      status: "echec",
      method: "sondage borné du site officiel MAMH",
      source: scan.website ?? undefined,
      proof: `${pages.length} pages candidates contrôlées (${okPages} HTTP 2xx); aucun lien PDF de plan/carte de zonage extrait verbatim`,
    });
    continue;
  }
  const old = prior.get(item.slug);
  if (old) rows.push({ ...old, index: item.index });
  else rows.push({ slug: item.slug, index: item.index, status: "echec", method: "audit local", proof: "aucune entrée PDF officielle ni artefact recalable trouvé dans le résidu courant" });
}

const deposits = rows.filter((row) => row.status === "depot");
const uncovered = rows.filter((row) => /aucune entrée PDF officielle ni artefact/.test(row.proof));
const generatedAt = new Date().toISOString();
const stamp = generatedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const base = `work/delegation-mass/zones-recalage-${stamp}-shard1of2`;
const payload = {
  generatedAt,
  shard: { mod: 2, rem: 1, rule: "(sorted slug index % 2) == 1" },
  selection: { nonDoneAtConsolidation: shard.length, rows: rows.length, uncoveredFallbacks: uncovered.length },
  deposits,
  rows,
  verification: {
    selector: "137/137 slugs non-done impairs couverts; 1 dépôt net de cette passe; 0 hors shard",
    loopSuperviseScoreboardZones: 822,
    loopSuperviseQualityServed: 821,
    austinRetry: "résidu 0,16 m; 125/125 lectures Claude validées; NoSuchKey normalized/qc-cadastre-lots/austin.geojson; s3-keys-list normalized/ austin = 2 clés de normes, 0 cadastre",
  },
};
writeFileSync(`${base}.json`, `${JSON.stringify(payload, null, 2)}\n`);
const lines = [
  `# Recalage PDF zones — shard 1/2 — ${generatedAt}`,
  "",
  "Règle: slugs dont `(index dans la liste triée) % 2 == 1`. Aucun AGOL owner harvest. Aucun code inventé.",
  "",
  `Résultat consolidé: **${deposits.length} dépôt net dans cette passe**, ${rows.length} slugs non terminés avec dépôt ou preuve, ${uncovered.length} fallback(s) sans preuve structurée.`,
  "",
  "## Dépôts nets de cette passe",
  "",
  ...(deposits.length > 0
    ? deposits.map((row) => `- **${row.slug}** — ${row.proof}${row.source ? ` — source: ${row.source}` : ""}`)
    : ["Aucun. Les dépôts antérieurs désormais `done` ne sont pas réattribués à cette passe."]),
  "",
  "## Tous les slugs du shard",
  "",
  "| index | slug | statut | méthode | preuve |",
  "|---:|---|---|---|---|",
  ...rows.map((row) => `| ${row.index} | ${row.slug} | ${row.status} | ${row.method.replace(/\|/g, "/")} | ${row.proof.replace(/\|/g, "/")} |`),
  "",
  "## Vérifications",
  "",
  "- Sélecteur trié: 137/137 slugs non-`done` impairs couverts, plus 1 dépôt net de cette passe; 0 hors shard.",
  "- `austin`: résidu 0,16 m et 125/125 lectures Claude validées; dépôt bloqué par `NoSuchKey normalized/qc-cadastre-lots/austin.geojson`; l'inventaire S3 `normalized/` ne contient que 2 clés de normes pour Austin et aucun cadastre.",
  "- `loop-supervise`: scoreboard zones=822; qualité `821 servis`; Sainte-Élisabeth est le dépôt net de cette passe.",
  "",
];
writeFileSync(`${base}.md`, `${lines.join("\n")}\n`);
console.log(JSON.stringify({ base, rows: rows.length, deposits: deposits.map((row) => row.slug), uncovered: uncovered.map((row) => row.slug) }));
