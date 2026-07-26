/**
 * CAPTURE — le RUN : le manifeste JSONL, le `run.log` et l'en-tête `run.json`
 * déposés sous `capture/_runs/<run-id>/` (SPEC_CAPTURE_ON_CLUSTER.md §2.2).
 *
 * Le stockage objet est un PORT (`CaptureObjectStore`) et non le SDK S3 : ce module
 * vit dans la lib, qui ne dépend que de zod. L'adaptateur S3 réel est
 * `acquisition/src/lib/capture-s3.ts`. Les tests injectent un faux client — aucun
 * réseau, aucune I/O S3 réelle.
 *
 * S3 n'a pas d'append : le run TIENT ses lignes en mémoire et ré-écrit l'objet
 * complet à chaque flush. Un `manifest.jsonl` de ~5 000 fetches pèse ~2-3 Mio
 * (SPEC §2.6), donc c'est tenable, et cela garantit qu'un run interrompu laisse
 * derrière lui tout ce qu'il avait déjà tenté.
 */
import {
  CaptureRunHeaderSchema,
  captureRunKeys,
  assertCaptureWritableKey,
  redactCaptureLog,
  serializeManifestLine,
  type CaptureLane,
  type CaptureManifestLine,
  type CaptureRunHeader,
} from "./manifest.js";

/**
 * Port d'écriture objet, réduit au strict nécessaire : HEAD idempotent + PUT.
 * Aucune suppression n'est exposée — règle C-7 (les objets `raw/` ne sont JAMAIS
 * supprimés par un script d'acquisition).
 */
export interface CaptureObjectStore {
  /** `true` ssi la clé existe déjà (HEAD-skip du PUT). */
  head(key: string): Promise<boolean>;
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<void>;
}

export interface CaptureRunOptions {
  runId: string;
  lane: CaptureLane;
  store: CaptureObjectStore;
  /** UA réellement envoyé — constante honnête, aucune rotation (SPEC §5.4 / §8-D). */
  userAgent: string;
  /** `direct` | `tor:<lane>` | `proxy:<id>`. */
  egress?: string;
  viaObscura?: boolean;
  execution?: "local" | "cluster";
  /** sha git, `null` quand inconnu (jamais fabriqué). */
  gitSha?: string | null;
  /** Clé S3 de la worklist du run, `null` quand il n'y en a pas. */
  worklist?: string | null;
  /** Ré-écrit manifeste + log toutes les N lignes. 1 = durabilité maximale. */
  flushEvery?: number;
  /** Miroir console des lignes de log (défaut : `console.error`). */
  echo?: ((msg: string) => void) | null;
  startedAt?: string;
}

/**
 * Un run de capture. Accumule les lignes de manifeste et le log, les dépose sous
 * `capture/_runs/<run-id>/`, et publie l'en-tête `run.json` à la clôture.
 */
export class CaptureRun {
  readonly runId: string;
  readonly lane: CaptureLane;
  readonly userAgent: string;
  readonly egress: string;
  readonly viaObscura: boolean;
  readonly keys: { manifest: string; log: string; header: string };

  private readonly store: CaptureObjectStore;
  private readonly execution: "local" | "cluster";
  private readonly gitSha: string | null;
  private readonly worklist: string | null;
  private readonly flushEvery: number;
  private readonly echo: ((msg: string) => void) | null;
  private readonly startedAt: string;

  private readonly lines: CaptureManifestLine[] = [];
  private readonly logLines: string[] = [];
  private sinceFlush = 0;
  private counts = { attempts: 0, ok: 0, failed: 0, dedup: 0, bytes: 0 };

  constructor(opts: CaptureRunOptions) {
    this.runId = opts.runId;
    this.lane = opts.lane;
    this.store = opts.store;
    this.userAgent = opts.userAgent;
    this.egress = opts.egress ?? "direct";
    this.viaObscura = opts.viaObscura ?? false;
    this.execution = opts.execution ?? "local";
    this.gitSha = opts.gitSha ?? null;
    this.worklist = opts.worklist ?? null;
    this.flushEvery = Math.max(1, opts.flushEvery ?? 1);
    this.echo = opts.echo === undefined ? (m): void => console.error(m) : opts.echo;
    this.startedAt = opts.startedAt ?? new Date().toISOString();
    this.keys = captureRunKeys(this.runId);
    assertCaptureWritableKey(this.keys.manifest);
  }

  /** Les lignes journalisées jusqu'ici (lecture seule — le run en est propriétaire). */
  manifestLines(): readonly CaptureManifestLine[] {
    return this.lines;
  }

  /** HEAD-skip idempotent sur une clé de capture (SPEC §2.5 mesure 1). */
  async storeHead(key: string): Promise<boolean> {
    assertCaptureWritableKey(key);
    return this.store.head(key);
  }

  /** PUT gardé : `raw/` et `capture/_runs/` UNIQUEMENT (règle C-5). */
  async storePut(key: string, body: Uint8Array | string, contentType?: string): Promise<void> {
    assertCaptureWritableKey(key);
    await this.store.put(key, body, contentType);
  }

  /** Une ligne de `run.log`. AUCUN secret ne doit y transiter (règle C-6). */
  log(msg: string): void {
    const stamped = `${new Date().toISOString()} ${redactCaptureLog(msg)}`;
    this.logLines.push(stamped);
    this.echo?.(stamped);
  }

  /**
   * Journalise UNE tentative. Appelée par `capturedFetch` en succès COMME en
   * échec — c'est l'échec qui documente l'épuisement d'un gisement (SPEC §2.2).
   */
  async append(line: CaptureManifestLine): Promise<void> {
    this.lines.push(line);
    this.counts.attempts += 1;
    if (line.sha256 !== null) {
      this.counts.ok += 1;
      this.counts.bytes += line.bytes ?? 0;
      if (line.dedup === true) this.counts.dedup += 1;
    } else {
      this.counts.failed += 1;
    }
    this.sinceFlush += 1;
    if (this.sinceFlush >= this.flushEvery) await this.flush();
  }

  /** Ré-écrit `manifest.jsonl` + `run.log` en entier (S3 n'a pas d'append). */
  async flush(): Promise<void> {
    this.sinceFlush = 0;
    const manifest = this.lines.map((l) => serializeManifestLine(l)).join("\n");
    await this.store.put(
      this.keys.manifest,
      manifest.length > 0 ? `${manifest}\n` : "",
      "application/x-ndjson",
    );
    await this.store.put(
      this.keys.log,
      this.logLines.length > 0 ? `${this.logLines.join("\n")}\n` : "",
      "text/plain; charset=utf-8",
    );
  }

  /** En-tête courant du run (validé). */
  header(exitCode: number | null = null, finishedAt: string | null = null): CaptureRunHeader {
    return CaptureRunHeaderSchema.parse({
      run_id: this.runId,
      lane: this.lane,
      execution: this.execution,
      git_sha: this.gitSha,
      worklist: this.worklist,
      started_at: this.startedAt,
      finished_at: finishedAt,
      exit_code: exitCode,
      user_agent: this.userAgent,
      egress: this.egress,
      via_obscura: this.viaObscura,
      counts: { ...this.counts },
    });
  }

  /** Flush final + dépôt de `run.json`. Idempotent. */
  async finish(exitCode: number | null = 0): Promise<CaptureRunHeader> {
    const header = this.header(exitCode, new Date().toISOString());
    await this.flush();
    await this.store.put(
      this.keys.header,
      `${JSON.stringify(header, null, 2)}\n`,
      "application/json",
    );
    return header;
  }
}
