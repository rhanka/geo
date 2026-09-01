/**
 * CAPTURE — le manifeste de run (axe TEMPOREL) et ses invariants.
 *
 * Normatif : docs/spec/SPEC_CAPTURE_ON_CLUSTER.md §2.2 / §2.3 / §2.5.
 *
 * Deux axes, jamais confondus :
 *   - axe CONTENU  : `raw/<source>/cas/<sha256>.<ext>` (RawDocument.ts, déjà écrit
 *     et testé) — ce qui a été OBTENU. Content-addressed, donc dédupliqué.
 *   - axe TEMPOREL : `capture/_runs/<run-id>/manifest.jsonl` — ce qui a été TENTÉ,
 *     quand, avec quel résultat. Un 404, un 403, un timeout n'ont PAS d'octets donc
 *     PAS de clé CAS : ils n'existent QUE dans le manifeste, et ce sont eux qui
 *     documentent l'épuisement d'un gisement.
 *
 * ANTI-INVENTION : toute valeur inconnue est un `null` EXPLICITE. On n'invente ni
 * URL, ni sha, ni horodatage. Un champ absent serait ambigu ; un `null` ne l'est pas.
 */
import { z } from "zod";

import { sha256Hex } from "../RawDocument.js";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulaire
// ─────────────────────────────────────────────────────────────────────────────

/** Lanes d'acquisition (SPEC §2.3, colonne `lane`). */
export const CAPTURE_LANES = [
  "zones",
  "normes",
  "pv",
  "reglement",
  "usage-dominant",
  "effet-densifiant",
  "cadastre",
  "immo-lots",
  "constraints",
] as const;
export type CaptureLane = (typeof CAPTURE_LANES)[number];

/** Verdict robots.txt AU MOMENT du fetch (jamais reconstitué après coup). */
export const CAPTURE_ROBOTS_VERDICTS = ["allowed", "disallowed", "unknown"] as const;
export type CaptureRobotsVerdict = (typeof CAPTURE_ROBOTS_VERDICTS)[number];

export const CAPTURE_METHODS = ["GET", "POST", "HEAD"] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

/** Les DEUX seuls préfixes d'écriture ouverts à la capture (SPEC §2.1 / §2.2). */
export const RAW_PREFIX = "raw/";
export const CAPTURE_RUNS_PREFIX = "capture/_runs/";

/** Format EXACT du sha porté par la preuve v2 (`lib/zonage-proof.ts`). */
export const SHA256_PREFIXED_RE = /^sha256:[a-f0-9]{64}$/;
/** `raw/<source>/cas/<sha256>.<ext>` — la clé CAS canonique. */
export const CAS_KEY_RE = /^raw\/([a-z0-9][a-z0-9._-]*)\/cas\/([a-f0-9]{64})\.([a-z0-9]+)$/;
/** `direct` | `tor:<lane>` | `proxy:<id>` — l'IP de sortie est un fait de provenance. */
export const EGRESS_RE = /^(direct|tor:[a-z0-9][a-z0-9-]*|proxy:[a-z0-9][a-z0-9-]*)$/;

/** Marqueur de rédaction d'un paramètre sensible (SPEC §2.3 in fine, règle C-6). */
export const REDACTED = "<redacted>";

// ─────────────────────────────────────────────────────────────────────────────
// Schéma d'une ligne de manifeste
// ─────────────────────────────────────────────────────────────────────────────

const laneEnum = z.enum([...CAPTURE_LANES] as [CaptureLane, ...CaptureLane[]]);
const methodEnum = z.enum([...CAPTURE_METHODS] as [CaptureMethod, ...CaptureMethod[]]);
const robotsEnum = z.enum(
  [...CAPTURE_ROBOTS_VERDICTS] as [CaptureRobotsVerdict, ...CaptureRobotsVerdict[]],
);

/**
 * Une ligne = UNE TENTATIVE de fetch. Elle est autoportante (elle re-porte le
 * `run_id` que le chemin donne déjà) et NE CONTIENT AUCUN SECRET (règle C-6).
 */
export const CaptureManifestLineSchema = z.object({
  /** Redondant avec le chemin, mais rend la ligne autoportante. */
  run_id: z.string().min(1),
  lane: laneEnum,
  /** Le `<source>` de la clé CAS — identifiant de lane-source, JAMAIS un slug. */
  source: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  /** Les municipalités servies par ce fetch. Vide = sonde de découverte. */
  slugs: z.array(z.string().min(1)),
  /** L'URL réellement appelée (http(s)), jamais une clé S3 ni un chemin local. */
  url: z.string().min(1),
  method: methodEnum,
  /** 1-based ; CHAQUE tentative produit une ligne, y compris les échecs. */
  attempt: z.number().int().positive(),
  requested_at: z.string().datetime(),
  /** Le champ que la preuve v2 EXIGE. `null` ssi aucun octet reçu. */
  retrieved_at: z.string().datetime().nullable(),
  /** `null` ssi aucune réponse (DNS, TLS, timeout, robots-disallowed). */
  http_status: z.number().int().nullable(),
  /** Vide si aucune redirection ; sinon la suite des `Location` traversés. */
  redirect_chain: z.array(z.string()),
  /** Dernière URL effectivement servie après redirections (`null` si aucune réponse). */
  final_url: z.string().nullable(),
  content_type: z.string().nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  sha256: z.string().regex(SHA256_PREFIXED_RE).nullable(),
  storage_key: z.string().nullable(),
  /** `true` si l'objet CAS existait déjà (HEAD-skip du PUT). */
  dedup: z.boolean().nullable(),
  /** Message d'erreur normalisé, `null` en cas de succès. */
  error: z.string().nullable(),
  user_agent: z.string().min(1),
  via_obscura: z.boolean(),
  egress: z.string().regex(EGRESS_RE),
  robots: robotsEnum,
  /**
   * `true` ⇒ l'URL du manifeste porte `<redacted>` : elle n'est PAS
   * re-téléchargeable telle quelle et NE PEUT PAS servir de preuve v2.
   */
  redacted: z.boolean(),
});
export type CaptureManifestLine = z.infer<typeof CaptureManifestLineSchema>;

/** En-tête de run (`capture/_runs/<run-id>/run.json`, SPEC §2.2). */
export const CaptureRunHeaderSchema = z.object({
  run_id: z.string().min(1),
  lane: laneEnum,
  /** `local` tant que l'exécution n'est pas migrée sur cluster (décision propriétaire). */
  execution: z.enum(["local", "cluster"]),
  /** sha git de l'image/arbre, `null` quand inconnu (anti-invention). */
  git_sha: z.string().nullable(),
  /** Clé S3 de la worklist quand le run en a une, sinon `null`. */
  worklist: z.string().nullable(),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().nullable(),
  exit_code: z.number().int().nullable(),
  user_agent: z.string().min(1),
  egress: z.string().regex(EGRESS_RE),
  via_obscura: z.boolean(),
  counts: z.object({
    attempts: z.number().int().nonnegative(),
    ok: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    dedup: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  }),
});
export type CaptureRunHeader = z.infer<typeof CaptureRunHeaderSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Identité du run
// ─────────────────────────────────────────────────────────────────────────────

/** `YYYYMMDDTHHMMSSZ` — triable, lisible, sans séparateur ambigu. */
export function captureRunStamp(now: Date = new Date()): string {
  return `${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "").replace(/Z$/, "")}Z`;
}

/**
 * `<lane>-<YYYYMMDDTHHMMSSZ>-<shard>` (SPEC §2.2). Triable, lisible, sans collision
 * tant qu'un seul shard d'une lane démarre par seconde.
 */
export function buildCaptureRunId(
  lane: CaptureLane,
  opts: { now?: Date; shard?: number | string } = {},
): string {
  const shard = opts.shard ?? 0;
  return `${lane}-${captureRunStamp(opts.now ?? new Date())}-${shard}`;
}

/** Les 3 clés d'un run (SPEC §2.2). */
export function captureRunKeys(runId: string): {
  manifest: string;
  log: string;
  header: string;
} {
  const base = `${CAPTURE_RUNS_PREFIX}${runId}`;
  return {
    manifest: `${base}/manifest.jsonl`,
    log: `${base}/run.log`,
    header: `${base}/run.json`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gardes d'écriture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La capture n'écrit QUE sous `raw/` et `capture/_runs/`. Toute autre clé —
 * `normalized/` en premier lieu (règle C-5) — est refusée AVANT le moindre octet.
 */
export function isCaptureWritableKey(key: string): boolean {
  return key.startsWith(RAW_PREFIX) || key.startsWith(CAPTURE_RUNS_PREFIX);
}

export function assertCaptureWritableKey(key: string): void {
  if (!isCaptureWritableKey(key)) {
    throw new Error(
      `capture refuse d'écrire hors des préfixes de capture (${RAW_PREFIX} | ${CAPTURE_RUNS_PREFIX}) : ${key}`,
    );
  }
}

/**
 * Garde d'immuabilité CAS (SPEC §2.5 mesure 2) : une clé `raw/**\/cas/**` dont le
 * sha256 du NOM ne correspond pas au sha256 des OCTETS est un bug, pas une donnée.
 * Pendant exact de `isServedZoneKey` côté zonage servi.
 */
export function assertCasKeyMatchesSha256(key: string, sha256: string): void {
  const m = CAS_KEY_RE.exec(key);
  if (!m) throw new Error(`clé CAS malformée (attendu raw/<source>/cas/<sha256>.<ext>) : ${key}`);
  if (!/^[a-f0-9]{64}$/.test(sha256) || sha256 !== m[2]) {
    throw new Error(
      `clé CAS mensongère : ${key} annonce ${m[2]} mais les octets valent ${sha256} — écriture refusée`,
    );
  }
}

/**
 * Vérifie la même invariance CAS quand les octets sont déjà disponibles. Le
 * chemin streaming appelle `assertCasKeyMatchesSha256` avec le digest calculé
 * sur les mêmes chunks avant leur dépôt, sans re-matérialiser le document.
 */
export function assertCasKeyMatchesBytes(key: string, body: Uint8Array): void {
  assertCasKeyMatchesSha256(key, sha256Hex(body));
}

// ─────────────────────────────────────────────────────────────────────────────
// Rédaction des secrets (règle C-6)
// ─────────────────────────────────────────────────────────────────────────────

/** Noms de paramètres réputés porteurs d'un secret. */
const SECRET_PARAM_RE =
  /^(?:.*[-_])?(?:token|key|apikey|api_key|secret|password|passwd|pwd|signature|sig|sas|auth|authorization|access_token|refresh_token|credential|credentials)$/i;

/**
 * Remplace la VALEUR de tout paramètre réputé secret par `<redacted>`. Le fetch,
 * lui, utilise l'URL COMPLÈTE — seul le manifeste est rédigé. Une URL rédigée n'est
 * plus re-téléchargeable telle quelle : {@link captureProofFields} la REFUSE.
 */
export function redactUrlForManifest(url: string): { url: string; redacted: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, redacted: false };
  }
  let redacted = false;
  for (const name of [...parsed.searchParams.keys()]) {
    if (!SECRET_PARAM_RE.test(name)) continue;
    parsed.searchParams.set(name, REDACTED);
    redacted = true;
  }
  // Les fragments ne sont pas envoyés au serveur mais ils sont bien présents
  // dans une URL de manifeste/log. OAuth y dépose couramment access_token : les
  // traiter exactement comme la query évite de le rendre durable par accident.
  if (parsed.hash.length > 1) {
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    let fragmentRedacted = false;
    for (const name of [...fragment.keys()]) {
      if (!SECRET_PARAM_RE.test(name)) continue;
      fragment.set(name, REDACTED);
      fragmentRedacted = true;
    }
    if (fragmentRedacted) {
      parsed.hash = `#${fragment.toString()}`;
      redacted = true;
    }
  }
  if (parsed.username || parsed.password) {
    parsed.username = "";
    parsed.password = "";
    redacted = true;
  }
  return { url: parsed.toString(), redacted };
}

/**
 * Nettoie un texte destiné à `capture/_runs/<run-id>/run.log`.
 *
 * Un log de pod est utile au diagnostic mais durable, donc il suit la même
 * règle C-6 que le manifeste : une URL signée ou une affectation de variable
 * secrète ne doit pas y survivre. Le texte reste autrement tel qu'émis par le
 * processus; le but est la persistance sûre, pas la restructuration du log.
 */
export function redactCaptureLog(text: string): string {
  const urlsRedacted = text.replace(/https?:\/\/[^\s"'<>`]+/g, (value) => redactUrlForManifest(value).url);
  // Headers HTTP : la valeur peut contenir plusieurs mots (`Bearer <jeton>`) ou
  // plusieurs cookies. On supprime donc TOUTE la valeur jusqu'au saut de ligne.
  const headersRedacted = urlsRedacted.replace(
    /\b((?:proxy-)?authorization|(?:set-)?cookie)\s*:\s*[^\r\n]*/gim,
    (_match, name: string) => `${name}: ${REDACTED}`,
  );
  // Affectations shell et objets JSON/JS : guillemets facultatifs autour de la
  // clé et de la valeur. Les séparateurs usuels gardent le reste du diagnostic.
  return headersRedacted.replace(
    /(["']?(?:token|api[_-]?key|secret|password|passwd|pwd|signature|sig|sas|auth(?:orization)?|access[_-]?token|refresh[_-]?token|credential(?:s)?)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;\]}]+)/gi,
    (_match, prefix: string) => `${prefix}${REDACTED}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ligne de manifeste → preuve v2
// ─────────────────────────────────────────────────────────────────────────────

/** Hôte de stockage objet (le nôtre) : jamais une source amont. Comparé sur les
 *  LABELS séparés par des points, jamais en sous-chaîne — un `/s3[.:]/` naïf
 *  matche aussi `services3.arcgis.com`, l'hôte ArcGIS Online le plus courant. */
function isObjectStorageHost(hostname: string): boolean {
  return hostname.toLowerCase().split(".").some((label) => label === "s3" || label.startsWith("s3-"));
}

/** URL http(s) réelle — même critère que `isRealGeometryUrl` côté zonage. */
function isRealHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      !!u.hostname &&
      !/^(localhost|127\.|::1)/i.test(u.hostname) &&
      !isObjectStorageHost(u.hostname)
    );
  } catch {
    return false;
  }
}

/** Les 3 champs qu'une ligne de capture fournit MÉCANIQUEMENT à la preuve v2. */
export interface CaptureProofFields {
  url: string;
  retrieved_at: string;
  sha256: `sha256:${string}`;
}

/**
 * Convertit une entrée de manifeste en les champs d'acquisition d'un
 * `GeometrySourceProof` (SPEC §3.1). Ne fabrique RIEN : si la ligne ne porte pas
 * d'octets (404/403/timeout), ou si son URL a été rédigée, il n'y a pas de preuve
 * et la fonction ÉCHOUE — c'est le point : une preuve sans capture est déclarative
 * (règle C-2).
 *
 * `type` / `method` / `reliability` ne sont PAS dérivables ici : ils appartiennent
 * au vocabulaire zonage (`acquisition/src/lib/zonage-proof.ts`), qui compose ces
 * champs via `proofFromCaptureEntry`.
 */
export function captureProofFields(line: CaptureManifestLine): CaptureProofFields {
  if (line.redacted) {
    throw new Error(
      `capture ${line.run_id}: l'URL porte ${REDACTED} — non re-téléchargeable, elle NE PEUT PAS servir de preuve v2 (déposer zone_source_url: null)`,
    );
  }
  if (line.sha256 === null || line.retrieved_at === null || line.storage_key === null) {
    throw new Error(
      `capture ${line.run_id}: la ligne n'a PAS d'octets CAS durables (http_status=${String(line.http_status)}, storage_key=${String(line.storage_key)}, error=${String(line.error)}) — aucune preuve v2 dérivable`,
    );
  }
  if (!SHA256_PREFIXED_RE.test(line.sha256)) {
    throw new Error(`capture ${line.run_id}: sha256 hors format sha256:<64hex> — ${line.sha256}`);
  }
  const cas = CAS_KEY_RE.exec(line.storage_key);
  if (!cas || cas[2] !== line.sha256.slice("sha256:".length)) {
    throw new Error(
      `capture ${line.run_id}: storage_key CAS absent ou incohérent avec sha256 — aucune preuve v2 dérivable`,
    );
  }
  if (!isRealHttpUrl(line.url)) {
    throw new Error(`capture ${line.run_id}: url non re-téléchargeable — ${line.url}`);
  }
  return {
    url: line.url,
    retrieved_at: line.retrieved_at,
    sha256: line.sha256 as `sha256:${string}`,
  };
}

/** Sérialise une ligne validée en JSONL (une ligne, pas de retour chariot interne). */
export function serializeManifestLine(line: CaptureManifestLine): string {
  return JSON.stringify(CaptureManifestLineSchema.parse(line));
}

/** Relit un `manifest.jsonl` (lignes vides tolérées). Valide CHAQUE ligne. */
export function parseManifestJsonl(text: string): CaptureManifestLine[] {
  const out: CaptureManifestLine[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    out.push(CaptureManifestLineSchema.parse(JSON.parse(line)));
  }
  return out;
}
