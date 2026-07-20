/**
 * fold-usage-dominant.ts — MISSION D immo (fiabilise le filtre résidentiel #369).
 *
 * OBJECTIF — servir un champ `usage_dominant` par zone ∈
 *   {residentiel, commercial, industriel, agricole, environnemental} (+ null si
 *   ambigu/autre/public) sur CHAQUE feature de la collection POLYGONE
 *   `qc-zonage-<slug>` (S3 `normalized/ca-qc-zonage/…`), lue par le lot immo.
 *
 * SOURCE ANTI-INVENTION — la catégorie NE vient PAS d'une convention devinée ni
 * du champ `usages` de la grille (qui est la LÉGENDE COMPLÈTE non-discriminante,
 * chaque zone listant tous les H/C/I/A/P). Elle vient de la NOMENCLATURE des
 * zones telle qu'écrite dans la LÉGENDE du règlement de zonage officiel de CHAQUE
 * muni : le préfixe alphabétique du zone_code encode la grande catégorie
 * (ex MT: "R"/"V"=résidentiel-villégiature, "T"=touristique, "C"=commercial,
 * "I"/"EX"=industriel, "A"/"F"=agricole-forestier, "CO"=conservation). Ce mapping
 * préfixe→catégorie est déclaré, audité et sourcé dans un config committé par
 * slug: `acquisition/config/usage-dominant-map/<slug>.json`.
 *
 * MATCH — pour chaque feature on lit le zone_code (whitelist SIG_ZONE_CODE_FIELDS),
 * et on retient la catégorie du PLUS LONG préfixe du map qui préfixe le code
 * (case-insensible). Longest-prefix => `CO` (conservation) bat `C` (commercial).
 * Aucun préfixe ne matche => `usage_dominant=null` (honnête, jamais deviné).
 *
 * Champs stampés (VERBATIM, per-feature): `usage_dominant` (string|null) +
 * `usage_dominant_source="zone-nomenclature"`. Idempotent. Réversible (--strip).
 *
 * Usage (npx tsx, from acquisition/):
 *   npx tsx src/fold-usage-dominant.ts --slugs mont-tremblant --list-prefixes
 *   npx tsx src/fold-usage-dominant.ts --slugs mont-tremblant,sutton --dry-run
 *   npx tsx src/fold-usage-dominant.ts --slugs mont-tremblant,sutton
 *   npx tsx src/fold-usage-dominant.ts --slugs mont-tremblant --strip
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getBytes, putBytes, exists, s3Client } from "./lib/s3.js";
import { canonZoneCodeServe, SIG_ZONE_CODE_FIELDS } from "./lib/zonage-norms.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAP_DIR = resolve(ROOT, "acquisition", "config", "usage-dominant-map");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const SOURCE_TAG = "zone-nomenclature";

/** Les 5 catégories servies (+ null). Toute valeur d'un map DOIT appartenir à ce set (ou null). */
const CATEGORIES = ["residentiel", "commercial", "industriel", "agricole", "environnemental"] as const;
type Category = (typeof CATEGORIES)[number];
/** Valeur d'un préfixe: une des 5 catégories, OU null explicite. Le null explicite
 *  n'est PAS cosmétique: comme le match est longest-prefix, un préfixe long mappé à
 *  null (ex MT "VA" villageoise) BLOQUE le fallthrough vers un préfixe court mappé à
 *  une catégorie (ex "V" villégiature=residentiel). Sans lui, VA-118 tomberait à tort
 *  sur "V". Documente aussi une catégorie sciemment ambiguë (public/mixte). */
type MapValue = Category | null;

interface UsageMap {
  prefix_map?: Record<string, MapValue>;
  /** Nom EXACT de l'attribut SIG qui porte la vocation en clair (ex « Affectatio »). */
  attribute_field?: string;
  /** Libellé VERBATIM servi par cet attribut -> catégorie (ou null explicite). */
  attribute_map?: Record<string, MapValue>;
  source: string;
  note?: string;
}

type S3 = ReturnType<typeof s3Client>;

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Charge + valide le config committé du slug (null si absent). Rejette toute
 *  catégorie hors des 5 (anti-invention + garde-fou contre une typo). */
function loadMap(slug: string): UsageMap | null {
  const path = resolve(MAP_DIR, `${slug}.json`);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as UsageMap;
  const hasPrefix = !!raw.prefix_map && typeof raw.prefix_map === "object";
  const hasAttr = !!raw.attribute_map && typeof raw.attribute_map === "object";
  if (!hasPrefix && !hasAttr) {
    throw new Error(`${slug}: ni prefix_map ni attribute_map dans ${path}`);
  }
  if (hasAttr && !raw.attribute_field) {
    throw new Error(`${slug}: attribute_map sans attribute_field dans ${path}`);
  }
  for (const [k, v] of Object.entries(raw.prefix_map ?? {})) {
    if (v !== null && !(CATEGORIES as readonly string[]).includes(v)) {
      throw new Error(`${slug}: categorie invalide "${v}" pour prefixe "${k}" (attendu ${CATEGORIES.join("|")}|null)`);
    }
  }
  for (const [k, v] of Object.entries(raw.attribute_map ?? {})) {
    if (v !== null && !(CATEGORIES as readonly string[]).includes(v)) {
      throw new Error(`${slug}: categorie invalide "${v}" pour libelle "${k}" (attendu ${CATEGORIES.join("|")}|null)`);
    }
  }
  return raw;
}

/** Zone code brut d'une feature (1re valeur non-vide de la whitelist SIG). */
export function zoneCodeOf(props: Record<string, unknown>): string | null {
  for (const name of SIG_ZONE_CODE_FIELDS) {
    const v = props[name];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/** Run alphabétique de tête (pour l'inspection --list-prefixes). */
function alphaPrefix(code: string): string {
  const m = code.match(/^[A-Za-z]+/);
  return m ? m[0] : "";
}

/** Forme servie d'un code dont le séparateur digit-first est ESPACÉ (« 48 - R »).
 *  `canonZoneCodeServe` ne réverse le digit-first qu'avec UN SEUL caractère de
 *  séparation (`/^(\d+)[-\s]?([A-Za-z]+)$/`), donc « 48 - R » lui échappe et le
 *  code passe pour NUMÉRIQUE PUR — à la fois au `categoryFor` (aucun préfixe ne
 *  matche) et au gate `--list-prefixes` (rangé sous « (numérique) », ce qui fait
 *  RENONCER à une muni pourtant mappable: mesuré sur la Ville de Disraeli, 83 pol.).
 *  On resserre les espaces autour du tiret AVANT de passer à la canonisation.
 *  Additif: un code sans espace autour d'un tiret ressort identique. */
export function tightenedServeForm(code: string): string {
  return canonZoneCodeServe(code.replace(/\s*-\s*/g, "-"));
}

/** Motif du SIGLE de vocation en SUFFIXE PARENTHÉSÉ (« 624 (AGC) », « 104 (AGF) »,
 *  famille MRC de La Mitis). La source laisse parfois une parenthèse manquante
 *  (« 137 (MTF », « 83 AGC) ») — les deux moitiés couvrent ces deux cas. */
const PAREN_SIGLE = /(?:\(\s*([A-Za-z]{2,5})\s*\)?|\s([A-Za-z]{2,5})\s*\))\s*$/;

/** Sigle parenthésé d'un code, ou `""`. */
export function parenSigle(code: string): string {
  const m = code.match(PAREN_SIGLE);
  return m?.[1] ?? m?.[2] ?? "";
}

/** Motif du code de CARROYAGE cartésien dont la vocation est la lettre FINALE
 *  (« GJ06R », « HH13I », « KO02C » — Ville de Granby, règl. 0663-2016 art. 14
 *  « CODIFICATION DES ZONES »: « Deux lettres servent à repérer, de façon
 *  cartésienne, les zones sur le plan […]; Les deux chiffres qui suivent […]
 *  identifient spécifiquement et séquentiellement la zone dans une cellule […];
 *  La lettre qui suit le nombre séquentiel indique la vocation dominante de la
 *  zone. »). Les 2 lettres de tête sont une COORDONNÉE, pas une vocation: un map
 *  par préfixe y voit 110 « préfixes » sans aucun sens (`GJ32C` et `GJ06R`
 *  cohabitent). `canonZoneCodeServe` ne réverse que le digit-first, donc ces
 *  codes sont invisibles d'un map réglementaire à la lettre. */
const CARROYAGE_VOCATION = /^[A-Za-z]{2}\d{2}([A-Za-z]{1,3})$/;

/** Lettre(s) de vocation finale d'un code de carroyage, ou `""`. */
export function carroyageVocation(code: string): string {
  return code.match(CARROYAGE_VOCATION)?.[1] ?? "";
}

/** Plus long préfixe du map qui préfixe `form` (case-insensible). `len` vaut -1
 *  quand aucune clé ne matche — un map peut légitimement rendre `null` pour une
 *  clé qui matche, d'où la distinction entre « pas de match » et « match à null ». */
function longestPrefixMatch(
  form: string,
  prefixMap: Record<string, MapValue>,
): { cat: MapValue; len: number } {
  let cat: MapValue = null;
  let len = -1;
  const up = form.toUpperCase();
  for (const [prefix, value] of Object.entries(prefixMap)) {
    const p = prefix.toUpperCase();
    if (up.startsWith(p) && p.length > len) {
      cat = value;
      len = p.length;
    }
  }
  return { cat, len };
}

/** Catégorie du PLUS LONG préfixe du map qui préfixe le code (case-insensible).
 *  Un préfixe mappé à null gagne quand même s'il est le plus long => il BLOQUE
 *  le fallthrough vers un préfixe plus court (voir MapValue). Aucun match => null. */
export function categoryFor(code: string, prefixMap: Record<string, MapValue>): MapValue {
  let best: MapValue = null;
  let bestLen = -1;
  // Keep the raw form for existing maps whose verified SIG codes are digit-first
  // (for example "22 H"), then also test the reversible served form ("H-22") so
  // regulatory prefix maps (H, P, Rec…) work on the same feature.
  // Forme « NUMÉRO (SIGLE) » de la MRC de La Mitis (« 624 (AGC) », « 104 (AGF) ») : la
  // vocation est en SUFFIXE PARENTHÉSÉ, donc invisible d'un map par préfixe et non
  // réversée par canonZoneCodeServe. On ajoute le sigle comme forme candidate. La
  // source laisse parfois une parenthèse manquante (« 137 (MTF », « 83 AGC) ») — les
  // deux moitiés du motif couvrent ces deux cas. Additif: sans parenthèse dans le
  // code, rien ne change pour les maps existants.
  const sigle = parenSigle(code);
  // Forme « NUMÉRO ESPACE-TIRET-ESPACE LETTRE » (« 48 - R », « 33 - RC », Ville de
  // Disraeli) : `canonZoneCodeServe` ne réverse le digit-first qu'avec UN SEUL
  // caractère de séparation (`/^(\d+)[-\s]?([A-Za-z]+)$/`), donc « 48 - R » lui
  // échappe et le code reste invisible d'un map par préfixe. On resserre les
  // espaces autour du tiret AVANT de le lui passer, comme forme candidate de plus.
  // Additif: un code sans espace autour d'un tiret est inchangé, donc aucun map
  // existant ne bouge.
  // Forme « CARROYAGE + VOCATION FINALE » (« GJ06R », Ville de Granby): les deux
  // lettres de tête sont une COORDONNÉE cartésienne, la vocation est la lettre
  // FINALE. Additif: le motif exige exactement 2 lettres + 2 chiffres + 1-3
  // lettres, donc aucun code letter-first (`R-13`), digit-first (`22 H`) ni
  // parenthésé (`624 (AGC)`) ne l'active.
  // ⛔ ANTI-FALL-THROUGH OBLIGATOIRE: la coordonnée de tête n'est PAS un préfixe,
  // mais elle en a la forme, et elle GAGNE le longest-prefix à égalité de longueur
  // (`IJ21R` capté par la clé « I » => industriel au lieu de résidentiel; mesuré au
  // dry-run: 122 industriels et 132 commerciaux FAUX sur Granby). Donc quand le code
  // EST un carroyage et que le map connaît sa lettre de vocation, cette lecture est
  // AUTORITAIRE. À défaut de clé pour la vocation, on retombe sur les formes
  // ordinaires: aucun map existant ne change de comportement.
  const carroyage = carroyageVocation(code);
  if (carroyage) {
    const only = longestPrefixMatch(carroyage, prefixMap);
    if (only.len >= 0) return only.cat;
  }
  const tightened = tightenedServeForm(code);
  const forms = [code, canonZoneCodeServe(code), tightened, sigle].filter(
    (v, i, a) => v && a.indexOf(v) === i,
  );
  for (const form of forms) {
    const up = form.toUpperCase();
    for (const [prefix, cat] of Object.entries(prefixMap)) {
      const p = prefix.toUpperCase();
      if (up.startsWith(p) && p.length > bestLen) {
        best = cat;
        bestLen = p.length;
      }
    }
  }
  return best;
}

/** Catégorie d'une feature qui ne sert AUCUN zone_code mais sert la vocation EN CLAIR
 *  dans un attribut du SIG (« Affectatio » = « Affectation » tronqué à 10 caractères par
 *  le shapefile; mesuré sur saint-joachim 22/22 et sainte-anne-de-beaupre 33/33, couche
 *  `ca-qc-zonage-claudialarrotamrccdb-arcgis` de la MRC de La Côte-de-Beaupré, dont les
 *  libellés sont « Agricole dynamique », « Agroforestier », « Conservation »,
 *  « Forêt et récréation », « Périmètre d'urbanisation »…).
 *  Ces couches sont INFOLDABLES par `prefix_map`: il n'y a pas de code à préfixer.
 *  Le match est sur le LIBELLÉ VERBATIM (trim + insensible à la casse), jamais sur un
 *  fragment: un libellé absent du map => null honnête, comme pour un préfixe inconnu. */
export function categoryForAttribute(
  props: Record<string, unknown>,
  field: string,
  attributeMap: Record<string, MapValue>,
): MapValue {
  const raw = props[field];
  if (raw === null || raw === undefined) return null;
  const val = String(raw).trim();
  if (!val) return null;
  const up = val.toUpperCase();
  for (const [label, cat] of Object.entries(attributeMap)) {
    if (label.trim().toUpperCase() === up) return cat;
  }
  return null;
}

/** Clés S3 du polygone zonage: layout plat ET sous-dossier — les DEUX quand elles
 *  coexistent. Ne PAS s'arrêter à la première: quand les deux existent, geo-api
 *  sert le SOUS-DOSSIER (mesuré sur boischatel puis mont-saint-hilaire 2026-07-17:
 *  API=240 features = la clé sous-dossier, alors que la clé plate en porte 170).
 *  Un fold qui ne stampait que la plate rapportait « OK cellsChanged=340 » pour un
 *  servi resté null. On stampe donc chaque clé existante (idempotent, et immunisé
 *  contre la règle de résolution de l'API). Même correctif que fold-reglement-to-zonage. */
async function zonageKeys(s3: S3, slug: string): Promise<string[]> {
  const candidates = [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ];
  const keys: string[] = [];
  for (const k of candidates) if (await exists(s3, k)) keys.push(k);
  return keys;
}

interface Feature {
  properties?: Record<string, unknown>;
}

async function loadFeatures(
  s3: S3,
  key: string,
): Promise<{ fc: Record<string, unknown> & { features: Feature[] }; feats: Feature[]; repaired: boolean }> {
  // PRÉSERVE la FeatureCollection COMPLÈTE (type, crs, name, …) — on mute .features
  // en place puis on réécrit l'objet entier. NE JAMAIS reconstruire { features } seul:
  // ça droppe `type:"FeatureCollection"` et geo-api rend alors 404 Unknown collection.
  const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as Record<string, unknown> & {
    type?: string;
    features?: Feature[];
  };
  const feats = (fc.features ?? []) as Feature[];
  fc.features = feats;
  const repaired = typeof fc.type !== "string"; // objet déjà cassé par l'ancien bug
  if (repaired) fc.type = "FeatureCollection";
  return { fc, feats, repaired };
}

/** --list-prefixes: distribution des préfixes alpha + échantillons de codes (aucun map requis). */
async function listPrefixes(s3: S3, slug: string): Promise<void> {
  const keys = await zonageKeys(s3, slug);
  if (keys.length === 0) {
    console.log(`LIST ${slug} — polygone qc-zonage NON servi`);
    return;
  }
  for (const key of keys) await listPrefixesKey(s3, slug, key);
}

async function listPrefixesKey(s3: S3, slug: string, key: string): Promise<void> {
  const { feats } = await loadFeatures(s3, key);
  const byPrefix = new Map<string, { count: number; samples: Set<string> }>();
  let noCode = 0;
  for (const f of feats) {
    const code = zoneCodeOf(f.properties ?? {});
    if (!code) {
      noCode++;
      continue;
    }
    // MÊMES formes que `categoryFor`, sinon le gate MENT: un « 48 - R » ou un
    // « 18 (AGF) » rangés sous « (numérique) » font renoncer à une muni que le fold
    // sait pourtant mapper. Mesuré: la Ville de Disraeli (83 pol.) et TOUTE la famille
    // MRC de La Mitis (sainte-luce 104, sainte-angele 76, saint-gabriel-de-rimouski 66,
    // saint-donat 62, sainte-flavie 46, price 45, padoue 33…) étaient classées
    // « NUMERIC-ONLY » — verdict FAUX, `categoryFor` lit le sigle parenthésé depuis
    // le lot MRC de La Mitis.
    // Idem pour le CARROYAGE (« GJ06R »): l'alphaPrefix rend la COORDONNÉE (`GJ`),
    // ce qui fait voir 110 « préfixes » sans aucun sens et fait renoncer à la muni,
    // alors que `categoryFor` sait lire la lettre de vocation FINALE.
    const pref =
      carroyageVocation(code) ||
      parenSigle(code) ||
      alphaPrefix(tightenedServeForm(code) || canonZoneCodeServe(code) || code) ||
      "(numérique)";
    let e = byPrefix.get(pref);
    if (!e) {
      e = { count: 0, samples: new Set() };
      byPrefix.set(pref, e);
    }
    e.count++;
    if (e.samples.size < 6) e.samples.add(code);
  }
  const rows = [...byPrefix.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log(`LIST ${slug} — polygones=${feats.length} sansCode=${noCode} préfixes=${rows.length} key=${key}`);
  for (const [pref, e] of rows) {
    console.log(`  ${pref.padEnd(12)} n=${String(e.count).padStart(5)}  ex: ${[...e.samples].join(", ")}`);
  }
}

async function foldSlug(s3: S3, slug: string, opts: { dryRun: boolean; strip: boolean }): Promise<void> {
  const map = opts.strip ? null : loadMap(slug);
  if (!opts.strip && !map) {
    console.log(`SKIP ${slug} — pas de config acquisition/config/usage-dominant-map/${slug}.json`);
    return;
  }
  const keys = await zonageKeys(s3, slug);
  if (keys.length === 0) {
    console.log(`SKIP ${slug} — polygone qc-zonage NON servi`);
    return;
  }
  for (const key of keys) await foldKey(s3, slug, key, map, opts);
}

async function foldKey(
  s3: S3,
  slug: string,
  key: string,
  map: UsageMap | null,
  opts: { dryRun: boolean; strip: boolean },
): Promise<void> {
  const { fc, feats, repaired } = await loadFeatures(s3, key);
  let changed = 0;
  let noCode = 0;
  const catCount = new Map<string, number>(); // "residentiel"|..|"null"
  for (const f of feats) {
    f.properties = f.properties ?? {};
    if (opts.strip) {
      if ("usage_dominant" in f.properties) {
        delete f.properties["usage_dominant"];
        changed++;
      }
      if ("usage_dominant_source" in f.properties) {
        delete f.properties["usage_dominant_source"];
        changed++;
      }
      continue;
    }
    const code = zoneCodeOf(f.properties);
    if (!code) noCode++;
    const cat: Category | null = code ? categoryFor(code, map!.prefix_map) : null;
    catCount.set(cat ?? "null", (catCount.get(cat ?? "null") ?? 0) + 1);
    if (f.properties["usage_dominant"] !== cat) {
      f.properties["usage_dominant"] = cat;
      changed++;
    }
    if (f.properties["usage_dominant_source"] !== SOURCE_TAG) {
      f.properties["usage_dominant_source"] = SOURCE_TAG;
      changed++;
    }
  }
  if (opts.strip) {
    console.log(`${opts.dryRun ? "DRY " : "OK  "}${slug} STRIP polygones=${feats.length} cellsChanged=${changed} key=${key}`);
  } else {
    const total = feats.length || 1;
    const nullN = catCount.get("null") ?? 0;
    const covered = total - nullN;
    const dist = CATEGORIES.map((c) => `${c}=${catCount.get(c) ?? 0}`).join(" ");
    const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
    console.log(
      `${opts.dryRun ? "DRY " : "OK  "}${slug} polygones=${feats.length} couvert=${covered} (${pct(covered)}) null=${nullN} (${pct(nullN)}) sansCode=${noCode} cellsChanged=${changed}`,
    );
    console.log(`     dist: ${dist} null=${nullN}`);
  }
  if (!opts.dryRun && (changed > 0 || repaired)) {
    await putBytes(s3, key, Buffer.from(JSON.stringify(fc)), "application/geo+json");
    if (repaired) console.log(`     RÉPARÉ type:"FeatureCollection" (objet cassé par l'ancien bug loadFeatures)`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const strip = argv.includes("--strip");
  const list = argv.includes("--list-prefixes");
  const slugs = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) {
    console.error("pass --slugs <a,b> [--list-prefixes | --dry-run | --strip]");
    process.exit(2);
  }
  const s3 = s3Client();
  for (const slug of slugs) {
    if (list) await listPrefixes(s3, slug);
    else await foldSlug(s3, slug, { dryRun, strip });
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
