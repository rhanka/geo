/**
 * fold-norms-to-zonage.ts — P0 immo (2026-07-13), suite de fold-reglement-to-zonage.
 *
 * La fiche lot immo lit la collection POLYGONE `qc-zonage-<slug>` (S3
 * `normalized/ca-qc-zonage/…`). Pour afficher les NORMES (hauteur/densité/marges/
 * façade/superficie) et pas seulement le règlement, on JOINT la grille
 * `qc-zonage-norms-<slug>` par `zone_code` sur chaque polygone (comme coaticook le
 * fait déjà nativement). Anti-invention: on ne copie QUE des valeurs déjà servies
 * verbatim sur la grille (ou null si la zone n'a pas de ligne). Réversible (--strip).
 *
 * Champs joints = les paires *_value + *_unit affichables (pas les *_raw/*_confidence,
 * pour limiter le poids du geojson polygone).
 *
 * Usage (from acquisition/):
 *   npx tsx src/fold-norms-to-zonage.ts --slugs mont-tremblant --dry-run
 *   npx tsx src/fold-norms-to-zonage.ts --slugs mont-tremblant,sutton
 */
import { pathToFileURL } from "node:url";

import { getBytes, exists, s3Client } from "./lib/s3.js";
import { putServedZoneAdditive } from "./lib/zonage-proof.js";

const NORMS_PREFIX = "normalized/qc-zonage-norms/";
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const NORM_FIELDS = [
  "hauteur_min_value", "hauteur_min_unit", "hauteur_max_value", "hauteur_max_unit",
  "densite_value", "densite_unit",
  "marge_avant_min_value", "marge_avant_min_unit",
  "marge_laterale_min_value", "marge_laterale_min_unit",
  "marge_arriere_min_value", "marge_arriere_min_unit",
  "facade_min_value", "facade_min_unit",
  "superficie_min_value", "superficie_min_unit",
] as const;

type S3 = ReturnType<typeof s3Client>;

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const canon = (v: unknown): string => String(v ?? "").trim().toUpperCase();

/**
 * Clé « relâchée » : la même chose sans séparateur. Elle rattrape le seul écart
 * de FORME qui soit sans perte — `A-10` côté zonage servi contre `A10` côté
 * grille — sans jamais réordonner de segments. Réordonner (`10-F` -> `F-10`)
 * serait une affirmation sémantique, pas une normalisation.
 */
export const looseKey = (v: unknown): string => canon(v).replace(/[-_.\s]+/g, "");

/**
 * Index relâché des codes, ou `null` si la relaxation ferait COLLISIONNER deux
 * codes distincts.
 *
 * C'est le garde-fou de tout le mode : sur une municipalité qui sert à la fois
 * `A-10` et `A10` comme deux zones différentes, retirer le séparateur les rend
 * indiscernables et la densité de l'une serait écrite sur l'autre — un effet
 * densifiant fabriqué. On refuse plutôt que de choisir.
 */
/**
 * Clé d'un code dont les DEUX segments ont été remis dans l'ordre de la source.
 *
 * Ce n'est PAS une normalisation de forme : c'est une affirmation sémantique, et
 * elle ne s'arme que pour les municipalités où l'ordre a été LU dans la source.
 * Les grilles de amherst (« 10F »), saint-basile-le-grand (« ZONE: 102-C ») et
 * les conventions de nommage de lac-etchemin et sayabec (« un numéro
 * d'identification auquel est attaché un suffixe ») disent toutes la même chose :
 * la forme de la municipalité est NUMÉRO puis LETTRE, c'est-à-dire celle du
 * zonage servi. Le `F-10` de nos normes est une inversion introduite par notre
 * propre extraction, pas une forme municipale.
 *
 * Renvoie `null` si le code n'a pas exactement deux segments : on ne devine pas
 * l'ordre d'un code qui en a trois.
 */
export function invertedKey(v: unknown): string | null {
  const segments = canon(v).split(/[-_.\s]+/).filter((s) => s.length > 0);
  if (segments.length !== 2) return null;
  return `${segments[1]}${segments[0]}`;
}

/**
 * Préfixe NUMÉRIQUE d'un code servi, quand la grille identifie la zone par son
 * seul numéro et porte la dominance à part.
 *
 * C'est la transformation la plus dangereuse des trois, parce qu'elle PERD de
 * l'information : `200-R` et `200-C` s'effondrent tous deux sur `200`. Elle ne
 * s'arme donc que par ville, après avoir mesuré qu'aucune collision n'existe, et
 * après avoir lu la convention dans la source — pour matane, la page 317 de
 * `corps-vm-89.pdf` titre « NUMÉROS DE ZONES » / « ET DOMINANCES » et aligne
 * « 200 201 202 203 204 205 » sous « R R R L C R ».
 *
 * Renvoie `null` si le code n'est pas un numéro suivi d'un unique segment.
 */
export function numericPrefixKey(v: unknown): string | null {
  const segments = canon(v).split(/[-_.\s]+/).filter((s) => s.length > 0);
  if (segments.length !== 2) return null;
  return /^\d+$/.test(segments[0]!) ? segments[0]! : null;
}

export function looseIndex(codes: Iterable<string>): Map<string, string> | null {
  const index = new Map<string, string>();
  for (const code of codes) {
    const key = looseKey(code);
    if (key === "") continue;
    const seen = index.get(key);
    if (seen !== undefined && seen !== canon(code)) return null;
    index.set(key, canon(code));
  }
  return index;
}

/** Map zone_code -> { NORM_FIELDS } depuis la grille servie. */
async function grilleNorms(s3: S3, slug: string): Promise<Map<string, Record<string, unknown>> | null> {
  const key = `${NORMS_PREFIX}qc-zonage-norms-${slug}.geojson`;
  if (!(await exists(s3, key))) return null;
  const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
  const map = new Map<string, Record<string, unknown>>();
  for (const f of fc.features ?? []) {
    const p: Record<string, unknown> = f.properties ?? {};
    const zc = canon(p["zone_code"]);
    if (!zc) continue;
    const sub: Record<string, unknown> = {};
    for (const nf of NORM_FIELDS) sub[nf] = p[nf] ?? null;
    map.set(zc, sub);
  }
  return map;
}

/** Stamp every existing layout: geo-api serves the sub-directory when both
 * layouts coexist, so stopping at the flat object can report success while the
 * API still exposes stale data. */
async function zonageKeys(s3: S3, slug: string): Promise<string[]> {
  const candidates = [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
  const keys: string[] = [];
  for (const key of candidates) if (await exists(s3, key)) keys.push(key);
  return keys;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const strip = argv.includes("--strip");
  const relaxSeparators = argv.includes("--relax-separators");
  // L'inversion de segments est une affirmation sur la source : elle n'est
  // legitime que pour les villes ou l'ordre a ete LU. Elle reste donc opt-in,
  // par ville, jamais globale.
  const invertSegments = argv.includes("--invert-segments");
  // La troncature PERD de l'information : elle exige une mesure de collision
  // sur les codes SERVIS, pas seulement sur les normes.
  const numericPrefix = argv.includes("--numeric-prefix");
  const slugs = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) {
    console.error("pass --slugs <a,b>");
    process.exit(2);
  }
  const s3 = s3Client();
  let ok = 0;
  const skipped: string[] = [];
  for (const slug of slugs) {
    const norms = strip ? null : await grilleNorms(s3, slug);
    if (!strip && (!norms || norms.size === 0)) {
      skipped.push(`${slug} (grille norms vide/absente)`);
      continue;
    }
    const keys = await zonageKeys(s3, slug);
    if (keys.length === 0) {
      skipped.push(`${slug} (polygone qc-zonage non servi)`);
      continue;
    }
    for (const key of keys) {
      const fc = JSON.parse((await getBytes(s3, key)).toString("utf8"));
      const feats: Array<{ properties?: Record<string, unknown> }> = fc.features ?? [];
      // Le mode relache n'est arme QUE si les deux vocabulaires restent
      // discernables sans separateur. Une collision d'un seul cote suffit a
      // l'annuler : mieux vaut ne pas plier que plier sur la mauvaise zone.
      let loose: Map<string, string> | null = null;
      if ((relaxSeparators || invertSegments || numericPrefix) && !strip) {
        const servedCodes = feats.map((f) => canon(f.properties?.["zone_code"])).filter((c) => c !== "");
        const zonageIndex = looseIndex(servedCodes);
        if (zonageIndex === null) {
          console.log(`REFUS ${slug} (codes servis indiscernables sans separateur) key=${key}`);
          continue;
        }
        if (numericPrefix) {
          // Deux codes servis distincts qui tombent sur le meme numero rendent
          // la densite indecidable : on refuse la ville entiere.
          const byPrefix = new Map<string, string>();
          let servedCollision: string | null = null;
          for (const code of new Set(servedCodes)) {
            const prefix = numericPrefixKey(code);
            if (prefix === null) continue;
            const seen = byPrefix.get(prefix);
            if (seen !== undefined && seen !== code) { servedCollision = `${seen} vs ${code}`; break; }
            byPrefix.set(prefix, code);
          }
          if (servedCollision !== null) {
            console.log(`REFUS ${slug} (--numeric-prefix: collision de codes servis: ${servedCollision}) key=${key}`);
            continue;
          }
        }
        const index = new Map<string, string>();
        let collision: string | null = null;
        for (const code of norms!.keys()) {
          // Une cle inversee et une cle relachee peuvent viser le meme code
          // servi : on les indexe ensemble et on refuse au premier conflit.
          const candidates = [
            // En mode prefixe numerique la grille porte le numero SEUL : sa
            // propre cle relachee est deja la cle recherchee.
            ...(relaxSeparators || numericPrefix ? [looseKey(code)] : []),
            ...(invertSegments ? [invertedKey(code) ?? ""] : []),
          ].filter((k) => k !== "");
          for (const candidate of candidates) {
            const seen = index.get(candidate);
            if (seen !== undefined && seen !== code) { collision = `${seen} vs ${code}`; break; }
            index.set(candidate, code);
          }
          if (collision !== null) break;
        }
        if (collision !== null) {
          console.log(`REFUS ${slug} (collision de codes normes: ${collision}) key=${key}`);
          continue;
        }
        loose = index;
      }
      let matched = 0, changed = 0;
      const propertiesBefore = feats.reduce((total, feature) => total + Object.keys(feature.properties ?? {}).length, 0);
      for (const f of feats) {
        f.properties = f.properties ?? {};
        if (strip) {
          for (const nf of NORM_FIELDS) if (nf in f.properties) { delete f.properties[nf]; changed++; }
          continue;
        }
        const code = canon(f.properties["zone_code"]);
        let sub = norms!.get(code);
        if (sub === undefined && loose !== null) {
          for (const candidate of [looseKey(code), numericPrefix ? numericPrefixKey(code) : null]) {
            if (candidate === null) continue;
            const resolved = loose.get(candidate);
            if (resolved !== undefined) { sub = norms!.get(resolved); break; }
          }
        }
        if (!sub) continue;
        matched++;
        for (const nf of NORM_FIELDS) {
          if (f.properties[nf] !== sub[nf]) { f.properties[nf] = sub[nf]; changed++; }
        }
      }
      const pct = feats.length ? Math.round((matched / feats.length) * 1000) / 10 : 0;
      const propertiesAfter = feats.reduce((total, feature) => total + Object.keys(feature.properties ?? {}).length, 0);
      console.log(`${dryRun ? "DRY " : "OK  "}${slug} polygones=${feats.length} matched=${matched} (${pct}%) cellsChanged=${changed} properties=${propertiesBefore}->${propertiesAfter} key=${key}`);
      if (!dryRun && changed > 0) {
        await putServedZoneAdditive(s3, key, fc, { allowedProps: NORM_FIELDS });
      }
    }
    ok++;
  }
  for (const s of skipped) console.log(`SKIP ${s}`);
  console.log(`DONE ok=${ok}/${slugs.length} skipped=${skipped.length}${dryRun ? " (dry-run)" : ""}`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
