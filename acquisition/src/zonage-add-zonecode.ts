/**
 * zonage-add-zonecode.ts — normalise le champ code-zone CANONIQUE (`zone_code`
 * + `name`) sur des collections `qc-zonage-<slug>` déjà servies qui ont été
 * publiées par COPIE BRUTE (zonage-republish-reattributed.ts) et n'exposent donc
 * PAS le champ `zone_code` attendu par immo — le code réglementaire est présent
 * mais sous le nom d'attribut SOURCE hétérogène (NumZone / Zone / ZoneNumber…)
 * et `name` vaut "feature-N".
 *
 * CONTEXTE (rhanka/geo#4, recall immo): le contrat immo lit `zone_code`
 * (confirmé 70/82). Les 5 villes du Lot A (westmount, hampstead, cote-saint-luc,
 * dorval, chambly) ont été republiées par copy server-side SANS normaliser
 * `zone_code` → immo lit `zone_code`=undefined sur elles. Leur DONNÉE est
 * complète et correcte (ex chambly NumZone contient C-020, R-128, P-064 = la
 * grille réglementaire). On expose juste le code sous le champ canonique.
 *
 * ANTI-INVENTION (STRICTE):
 *   - Le champ source est FOURNI explicitement par ville (vérifié à la main que
 *     ses valeurs sont des codes réglementaires courts type R-128 / CW-1 / AF-1).
 *     On NE DEVINE PAS le champ. Si la ville n'a pas ce champ → SKIP (log).
 *   - `zone_code` = valeur source trim()ée VERBATIM (jamais reformatée, jamais
 *     reconstruite). Si la valeur est vide/null → zone_code absent pour ce
 *     feature (pas inventé).
 *   - ADDITIF: on conserve TOUTES les propriétés existantes (dont l'attribut
 *     source). On AJOUTE `zone_code` et on remplace `name` (="feature-N",
 *     inutile) par le code. La géométrie est intacte.
 *   - IDEMPOTENT: ré-exécutable sans dérive (même entrée → même sortie).
 *   - Ne touche QUE les slugs listés. Ne supprime rien. La source -arcgis reste.
 *
 * USAGE:
 *   npx tsx src/zonage-add-zonecode.ts            # DRY-RUN (plan, n'écrit pas)
 *   npx tsx src/zonage-add-zonecode.ts --write    # écrit S3 (overwrite même clé)
 *   npx tsx src/zonage-add-zonecode.ts --only chambly,dorval [--write]
 *
 * TS-only. Aucun secret loggé.
 */
import { s3Client, getBytes, putBytes, BUCKET } from "./lib/s3.js";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

const PREFIX = "normalized/ca-qc-zonage/";

/**
 * Carte ville→champ code réglementaire, VÉRIFIÉE manuellement (zinspect):
 *   chambly        NumZone    → C-020, R-128, P-064, A-001, CONS-… (246 zones)
 *   hampstead      Zone       → CW-1, I-1, RA-…, RB-… (grille)
 *   westmount      ZoneNumber → R13-02-02, P1-02-01 (grille)
 *   cote-saint-luc Zonage_ID  → CC-1, RM*-64, RU-20, IR-17 (grille)
 *   dorval         NUM_ZONE   → U01-01, H01-17, C01-30, V01-40 (grille)
 *   longueuil      Zonage     → H34-327 (VLO), P34-191 (VLO), C34-317 (VLO) (1927 zones)
 */
const FIELD_MAP: Array<{ slug: string; field: string }> = [
  { slug: "chambly", field: "NumZone" },
  { slug: "hampstead", field: "Zone" },
  { slug: "westmount", field: "ZoneNumber" },
  { slug: "cote-saint-luc", field: "Zonage_ID" },
  { slug: "dorval", field: "NUM_ZONE" },
  { slug: "longueuil", field: "Zonage" },
];

interface GF { type: string; properties: Record<string, unknown>; geometry: unknown }
interface GJ { type: string; features: GF[]; [k: string]: unknown }

/** Trouve la clé .geojson servie pour un slug (sous-dossier OU fichier plat). */
async function findKey(s3: ReturnType<typeof s3Client>, slug: string): Promise<string | null> {
  // sous-dossier d'abord
  const sub = `${PREFIX}qc-zonage-${slug}/`;
  const r1 = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: sub, MaxKeys: 50 }));
  for (const o of r1.Contents ?? []) if (o.Key?.endsWith(".geojson")) return o.Key;
  // fichier plat
  const flat = `${PREFIX}qc-zonage-${slug}.geojson`;
  const r2 = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: flat, MaxKeys: 5 }));
  for (const o of r2.Contents ?? []) if (o.Key === flat) return o.Key;
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(",")) : null;
  const s3 = s3Client();

  const targets = FIELD_MAP.filter((m) => !only || only.has(m.slug));
  console.log(`[zonecode] mode=${write ? "WRITE" : "DRY-RUN"} cibles=${targets.length}`);

  for (const { slug, field } of targets) {
    const key = await findKey(s3, slug);
    if (!key) { console.log(`  SKIP ${slug}: aucune geojson servie`); continue; }
    const gj = JSON.parse((await getBytes(s3, key)).toString("utf8")) as GJ;
    const feats = gj.features ?? [];
    let withField = 0, alreadyOk = 0, changed = 0;
    const sample: string[] = [];
    for (const f of feats) {
      const props = f.properties ?? (f.properties = {});
      const raw = props[field];
      if (raw === null || raw === undefined || raw === "") continue;
      withField++;
      const code = String(raw).trim();
      if (props["zone_code"] === code && props["name"] === code) { alreadyOk++; continue; }
      props["zone_code"] = code;
      props["name"] = code;
      changed++;
      if (sample.length < 8) sample.push(code);
    }
    const cover = feats.length ? ((withField / feats.length) * 100).toFixed(0) : "0";
    console.log(
      `  ${slug}: feats=${feats.length} field=${field} cover=${cover}% changed=${changed} alreadyOk=${alreadyOk} sample=${JSON.stringify(sample)}`,
    );
    if (withField === 0) { console.log(`    !! champ '${field}' absent → SKIP write (anti-invention)`); continue; }
    if (write && changed > 0) {
      await putBytes(s3, key, Buffer.from(JSON.stringify(gj)), "application/geo+json");
      console.log(`    -> écrit ${key}`);
    } else if (write) {
      console.log(`    (rien à écrire — idempotent)`);
    }
  }
  console.log(`[zonecode] terminé.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
