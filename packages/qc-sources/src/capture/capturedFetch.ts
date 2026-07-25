/**
 * LE CHOKEPOINT DE CAPTURE — point de passage UNIQUE de tout appel réseau sortant
 * vers une source tierce (SPEC_CAPTURE_ON_CLUSTER.md §5.1, règle C-0).
 *
 * Pourquoi il existe : 73 fichiers de `acquisition/src` appellent `fetch()` nu, et
 * PAS UNE ligne du dépôt n'enregistre `url` + `http_status` + `retrieved_at` +
 * `sha256` par requête. C'est LA raison du KPI « preuve v2 exacte = 0/1106 » : la
 * preuve n'est pas difficile à produire, elle est détruite au moment même où elle
 * existe. Ce module la produit MÉCANIQUEMENT.
 *
 * Ce qu'il fait, dans l'ordre :
 *   1. verdict robots.txt (via un `RobotsGate` injecté — `RobotsCache` en prod) ;
 *   2. fetch, redirections suivies à la main pour tenir la chaîne des `Location` ;
 *   3. mesure `retrieved_at`, `http_status`, `content_type`, taille ;
 *   4. sha256 des octets REÇUS ;
 *   5. dépôt content-addressed via `rawStorageKey` / `buildRawDocumentRecord`
 *      (déjà écrits, typés, testés — ce module est l'écrivain qui leur manquait),
 *      avec HEAD-skip idempotent ;
 *   6. APPEND d'une ligne au `manifest.jsonl` du run — Y COMPRIS EN ÉCHEC.
 *
 * Il ne LANCE PAS sur un échec réseau ou HTTP : il RETOURNE un résultat portant la
 * ligne de manifeste. Un échec est une donnée (il documente un gisement épuisé),
 * pas un accident. `capturedFetchOrThrow` fournit la sémantique inverse pour les
 * appelants qui ont déjà une boucle de retry.
 */
import { buildRawDocumentRecord, rawMetaKey, type RawDocumentRecord } from "../RawDocument.js";
import type { CaptureRun } from "./capture-run.js";
import {
  assertCasKeyMatchesBytes,
  assertCaptureWritableKey,
  redactUrlForManifest,
  CaptureManifestLineSchema,
  type CaptureLane,
  type CaptureManifestLine,
  type CaptureMethod,
  type CaptureRobotsVerdict,
} from "./manifest.js";

// ─────────────────────────────────────────────────────────────────────────────
// Ports (structurels — aucun couplage au runtime undici ni au SDK S3)
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptureHttpHeaders {
  get(name: string): string | null;
}
export interface CaptureHttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly url?: string;
  readonly headers: CaptureHttpHeaders;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface CaptureRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  redirect?: "follow" | "manual" | "error";
  signal?: AbortSignal;
}
export type CaptureFetchLike = (
  url: string,
  init?: CaptureRequestInit,
) => Promise<CaptureHttpResponse>;

/** Ce que `capturedFetch` consomme de `RobotsCache` — rien de plus. */
export interface RobotsGate {
  isAllowed(url: string): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contexte d'appel
// ─────────────────────────────────────────────────────────────────────────────

export interface CapturedFetchContext {
  /** Le run qui porte le manifeste. */
  run: CaptureRun;
  /** `<source>` de la clé CAS : identifiant de lane-source, JAMAIS un slug. */
  source: string;
  /** Municipalités concernées. Vide pour une sonde de découverte. */
  slugs?: string[];
  /** Défaut : la lane du run. */
  lane?: CaptureLane;
  /** 1-based. Chaque tentative d'une boucle de retry DOIT incrémenter. */
  attempt?: number;
  /** Titre exposé par la source, quand il existe (porté par le `.meta.json`). */
  title?: string;
  /** Date de publication exposée par la source, quand elle existe. */
  publishedAt?: string;
  /** Version de l'adaptateur/runner appelant (provenance du RawDocumentRecord). */
  version?: string;
  robots?: RobotsGate;
  fetchImpl?: CaptureFetchLike;
  timeoutMs?: number;
  /** Plafond par objet — garde-fou coût (SPEC §5.2, défaut 100 Mio). */
  maxBytes?: number;
  maxRedirects?: number;
  /** `false` = journalise et hash, mais n'écrit AUCUN octet sous `raw/`. */
  store?: boolean;
}

export interface CapturedFetchResult {
  /** La ligne de manifeste — TOUJOURS présente, succès comme échec. */
  line: CaptureManifestLine;
  /** `true` ssi des octets ont été reçus ET hashés. */
  ok: boolean;
  /** La réponse HTTP finale, `null` si aucune réponse (DNS/TLS/timeout/robots). */
  response: CaptureHttpResponse | null;
  /** Les octets reçus, `null` en échec. */
  bytes: Uint8Array | null;
  /** Le `RawDocumentRecord` déposé (ou qui l'aurait été), `null` en échec. */
  record: RawDocumentRecord | null;
}

export const DEFAULT_CAPTURE_TIMEOUT_MS = 30_000;
export const DEFAULT_CAPTURE_MAX_BYTES = 104_857_600;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Erreur normalisée, courte, sans secret (règle C-6). */
function normalizeError(e: unknown): string {
  if (e instanceof Error) {
    const name = e.name === "AbortError" ? "timeout" : e.name;
    return `${name}: ${e.message}`.slice(0, 500);
  }
  return String(e).slice(0, 500);
}

/**
 * Le point de passage unique. Journalise une ligne de manifeste pour CHAQUE
 * tentative, dépose les octets en content-addressed, et ne lance jamais sur un
 * échec réseau/HTTP.
 */
export async function capturedFetch(
  url: string,
  init: CaptureRequestInit | undefined,
  ctx: CapturedFetchContext,
): Promise<CapturedFetchResult> {
  const run = ctx.run;
  const fetchImpl = ctx.fetchImpl ?? (globalThis.fetch as unknown as CaptureFetchLike);
  const method = (init?.method ?? "GET").toUpperCase() as CaptureMethod;
  const maxBytes = ctx.maxBytes ?? DEFAULT_CAPTURE_MAX_BYTES;
  const maxRedirects = ctx.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const requestedAt = new Date().toISOString();
  const redacted = redactUrlForManifest(url);

  // Squelette de ligne : tout est `null` tant que rien n'est PROUVÉ.
  const base = {
    run_id: run.runId,
    lane: ctx.lane ?? run.lane,
    source: ctx.source,
    slugs: ctx.slugs ?? [],
    url: redacted.url,
    method,
    attempt: ctx.attempt ?? 1,
    requested_at: requestedAt,
    retrieved_at: null as string | null,
    http_status: null as number | null,
    redirect_chain: [] as string[],
    final_url: null as string | null,
    content_type: null as string | null,
    bytes: null as number | null,
    sha256: null as string | null,
    storage_key: null as string | null,
    dedup: null as boolean | null,
    error: null as string | null,
    user_agent: run.userAgent,
    via_obscura: run.viaObscura,
    egress: run.egress,
    robots: "unknown" as CaptureRobotsVerdict,
    redacted: redacted.redacted,
  };

  const emit = async (patch: Partial<typeof base>): Promise<CaptureManifestLine> => {
    const line = CaptureManifestLineSchema.parse({ ...base, ...patch });
    await run.append(line);
    return line;
  };

  // ── 1. robots.txt ───────────────────────────────────────────────────────────
  if (ctx.robots) {
    let allowed = true;
    try {
      allowed = await ctx.robots.isAllowed(url);
      base.robots = allowed ? "allowed" : "disallowed";
    } catch {
      // Permissif sur échec (comportement REP standard), mais verdict INCONNU :
      // on ne prétend pas avoir lu un robots.txt qu'on n'a pas lu.
      allowed = true;
      base.robots = "unknown";
    }
    if (!allowed) {
      run.log(`[capture] ROBOTS-DISALLOWED ${redacted.url}`);
      const line = await emit({ error: "robots-disallowed" });
      return { line, ok: false, response: null, bytes: null, record: null };
    }
  }

  // ── 2. fetch + chaîne de redirections ───────────────────────────────────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS);
  const chain: string[] = [];
  let response: CaptureHttpResponse | null = null;
  let currentUrl = url;
  let currentMethod: string = method;
  let transportError: string | null = null;

  try {
    for (let hop = 0; ; hop++) {
      const headers = { ...(init?.headers ?? {}) };
      if (!Object.keys(headers).some((h) => h.toLowerCase() === "user-agent")) {
        headers["user-agent"] = run.userAgent;
      }
      const hopInit: CaptureRequestInit = {
        ...init,
        method: currentMethod,
        headers,
        redirect: "manual",
        signal: init?.signal ?? controller.signal,
      };
      const res = await fetchImpl(currentUrl, hopInit);
      response = res;
      if (!REDIRECT_STATUSES.has(res.status)) break;
      const location = res.headers.get("location");
      if (!location) break;
      if (hop >= maxRedirects) throw new Error(`too many redirects (>${maxRedirects})`);
      const next = new URL(location, currentUrl).toString();
      chain.push(redactUrlForManifest(next).url);
      // 303 (et 302 en pratique) rétrograde en GET ; 307/308 préservent la méthode.
      if (res.status === 303 && currentMethod !== "HEAD") currentMethod = "GET";
      currentUrl = next;
    }
  } catch (e) {
    transportError = normalizeError(e);
    response = null;
  }

  if (response === null) {
    clearTimeout(timer);
    const error = transportError ?? "no response";
    run.log(`[capture] FAIL ${method} ${redacted.url} — ${error}`);
    const line = await emit({ redirect_chain: chain, error });
    return { line, ok: false, response: null, bytes: null, record: null };
  }

  const finalUrl = redactUrlForManifest(response.url ?? currentUrl).url;
  const status = response.status;
  const contentType = response.headers.get("content-type");

  // ── 3. réponse non-2xx : pas d'octets, mais la ligne EXISTE ─────────────────
  if (!response.ok) {
    clearTimeout(timer);
    run.log(`[capture] HTTP ${status} ${method} ${redacted.url}`);
    const line = await emit({
      http_status: status,
      redirect_chain: chain,
      final_url: finalUrl,
      content_type: contentType,
      error: `HTTP ${status}`,
    });
    return { line, ok: false, response, bytes: null, record: null };
  }

  // ── 4. octets reçus → sha256 ────────────────────────────────────────────────
  let body: Uint8Array;
  try {
    body = new Uint8Array(await response.arrayBuffer());
  } catch (e) {
    clearTimeout(timer);
    const error = normalizeError(e);
    run.log(`[capture] FAIL-BODY ${method} ${redacted.url} — ${error}`);
    const line = await emit({
      http_status: status,
      redirect_chain: chain,
      final_url: finalUrl,
      content_type: contentType,
      error,
    });
    return { line, ok: false, response, bytes: null, record: null };
  }
  clearTimeout(timer);

  const retrievedAt = new Date().toISOString();

  if (body.byteLength > maxBytes) {
    const error = `max-bytes-exceeded: ${body.byteLength} > ${maxBytes}`;
    run.log(`[capture] ${error} ${redacted.url}`);
    const line = await emit({
      http_status: status,
      retrieved_at: retrievedAt,
      redirect_chain: chain,
      final_url: finalUrl,
      content_type: contentType,
      bytes: body.byteLength,
      error,
    });
    return { line, ok: false, response, bytes: null, record: null };
  }

  // ── 5. dépôt content-addressed (HEAD-skip idempotent) ───────────────────────
  const record = buildRawDocumentRecord({
    source: ctx.source,
    sourceUrl: url,
    ...(ctx.title !== undefined ? { title: ctx.title } : {}),
    ...(ctx.publishedAt !== undefined ? { publishedAt: ctx.publishedAt } : {}),
    body,
    fetchedAt: retrievedAt,
    contentType: contentType ?? "application/octet-stream",
    provenance: {
      version: ctx.version ?? "capturedFetch/1",
      userAgent: run.userAgent,
      viaObscura: run.viaObscura,
    },
  });

  let dedup: boolean | null = null;
  let storeError: string | null = null;
  let stored = false;
  if (ctx.store !== false) {
    try {
      assertCaptureWritableKey(record.storageKey);
      assertCasKeyMatchesBytes(record.storageKey, body);
      dedup = await run.storeHead(record.storageKey);
      if (!dedup) {
        await run.storePut(record.storageKey, body, record.contentType);
        await run.storePut(
          rawMetaKey(record.storageKey),
          `${JSON.stringify(record, null, 2)}\n`,
          "application/json",
        );
      }
      stored = true;
    } catch (e) {
      storeError = normalizeError(e);
      dedup = null;
    }
  }

  // ── 6. la ligne de manifeste ────────────────────────────────────────────────
  const line = await emit({
    http_status: status,
    retrieved_at: retrievedAt,
    redirect_chain: chain,
    final_url: finalUrl,
    content_type: contentType,
    bytes: body.byteLength,
    sha256: `sha256:${record.sha256}`,
    storage_key: stored ? record.storageKey : null,
    dedup,
    error: storeError,
  });
  run.log(
    `[capture] OK ${status} ${method} ${redacted.url} ${body.byteLength}B sha256:${record.sha256.slice(0, 12)}… ${
      dedup === true ? "dedup" : dedup === false ? "stored" : "not-stored"
    }`,
  );
  return { line, ok: true, response, bytes: body, record };
}

/** Erreur portant la ligne de manifeste DÉJÀ journalisée (rien n'est perdu). */
export class CapturedFetchError extends Error {
  readonly line: CaptureManifestLine;
  constructor(line: CaptureManifestLine) {
    super(
      `capture ${line.run_id}: ${line.method} ${line.url} — ${line.error ?? `HTTP ${String(line.http_status)}`}`,
    );
    this.name = "CapturedFetchError";
    this.line = line;
  }
}

/**
 * Variante « throw » pour les appelants qui ont déjà une boucle de retry : la ligne
 * est journalisée AVANT que l'erreur ne soit lancée.
 */
export async function capturedFetchOrThrow(
  url: string,
  init: CaptureRequestInit | undefined,
  ctx: CapturedFetchContext,
): Promise<CapturedFetchResult & { bytes: Uint8Array }> {
  const res = await capturedFetch(url, init, ctx);
  if (!res.ok || res.bytes === null) throw new CapturedFetchError(res.line);
  return { ...res, bytes: res.bytes };
}

/** Décode en UTF-8 les octets d'une capture réussie. */
export function capturedText(res: CapturedFetchResult): string {
  if (res.bytes === null) throw new CapturedFetchError(res.line);
  return new TextDecoder("utf-8").decode(res.bytes);
}
