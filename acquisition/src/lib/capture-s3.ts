/**
 * capture-s3.ts — l'adaptateur S3 du CHOKEPOINT DE CAPTURE.
 *
 * La logique de capture vit dans la LIB (`packages/qc-sources/src/capture/`), qui
 * ne dépend que de zod ; ce module est le seul endroit qui la relie au SDK S3 réel.
 * Il n'ajoute AUCUNE règle : il implémente le port `CaptureObjectStore` (HEAD,
 * PUT, spool stream et promotion CAS) et ouvre un run.
 *
 * CONTRAINTE DURE (SPEC_CAPTURE_ON_CLUSTER.md §2.1/§2.2, règle C-5) : ce store
 * n'écrit QUE sous `raw/` et `capture/_runs/` — deux préfixes NEUFS, jamais servis.
 * Toute autre clé est refusée avant le moindre octet, EN PLUS du garde de la lib.
 * La seule suppression exposée sert au spool jetable sous `capture/_runs/`; les
 * objets CAS `raw/` ne sont jamais supprimés.
 *
 * Décision propriétaire en vigueur : journaliser d'abord, migrer sur cluster
 * ensuite. L'exécution reste LOCALE (`execution: "local"` dans `run.json`), mais
 * TOUTE capture est journalisée et déposée sur le stockage objet.
 *
 * Runs S3 : `NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`
 * (mémoire s3-etimedout-happy-eyeballs-ipv4first).
 */
import { randomUUID } from "node:crypto";

import type { S3Client } from "@aws-sdk/client-s3";

import {
  CaptureRun,
  buildCaptureRunId,
  isCaptureWritableKey,
  type CaptureLane,
  type CaptureObjectStore,
} from "../../../packages/qc-sources/src/capture/index.js";
import { copyObject, deleteObject, exists, putBytes, putStream, s3Client } from "./s3.js";

/**
 * UA de navigateur CONSTANT de la capture web. Il reste délibérément stable :
 * `CAPTURE_USER_AGENT` permet une compatibilité ponctuelle par environnement,
 * jamais une rotation par requête (SPEC §5.4/§8-D).
 */
export const DEFAULT_CAPTURE_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Résout l'UA une fois au démarrage du processus, sans valeur implicite variable. */
export function captureUserAgentFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env["CAPTURE_USER_AGENT"]?.trim() || DEFAULT_CAPTURE_USER_AGENT;
}

/** UA réellement transmise au run et au chokepoint pour ce processus. */
export const CAPTURE_USER_AGENT = captureUserAgentFromEnv();

/** Le port `CaptureObjectStore` au-dessus de `lib/s3.ts`, gardé par préfixe. */
export function s3CaptureStore(s3: S3Client): CaptureObjectStore {
  const guard = (key: string): void => {
    if (!isCaptureWritableKey(key)) {
      throw new Error(
        `capture-s3: écriture refusée hors raw/ et capture/_runs/ — ${key} (règle C-5 : un job de capture n'écrit jamais de donnée servie)`,
      );
    }
  };
  return {
    head: async (key: string): Promise<boolean> => {
      guard(key);
      return exists(s3, key);
    },
    put: async (key: string, body: Uint8Array | string, contentType?: string): Promise<void> => {
      guard(key);
      await putBytes(s3, key, body instanceof Uint8Array ? Buffer.from(body) : body, contentType);
    },
    putStream: async (key: string, body: AsyncIterable<Uint8Array>, contentType?: string): Promise<void> => {
      guard(key);
      await putStream(s3, key, body, contentType);
    },
    copy: async (sourceKey: string, destinationKey: string): Promise<void> => {
      guard(sourceKey);
      guard(destinationKey);
      await copyObject(s3, sourceKey, destinationKey);
    },
    delete: async (key: string): Promise<void> => {
      guard(key);
      await deleteObject(s3, key);
    },
  };
}

export interface OpenCaptureRunOptions {
  lane: CaptureLane;
  /** Réutilise un run-id existant (reprise) ; sinon `<lane>-<stamp>-<shard>`. */
  runId?: string;
  shard?: number | string;
  s3?: S3Client;
  userAgent?: string;
  /** `direct` | `tor:<lane>` | `proxy:<id>` — l'IP de sortie est un fait de provenance. */
  egress?: string;
  viaObscura?: boolean;
  /** Clé S3 de la worklist quand le run en a une. */
  worklist?: string | null;
  flushEvery?: number;
  echo?: ((msg: string) => void) | null;
}

/**
 * Ouvre un run de capture adossé à S3. `git_sha` vient de `GEO_GIT_SHA` /
 * `GIT_SHA` quand l'environnement le fournit, sinon `null` EXPLICITE — jamais
 * fabriqué (anti-invention).
 */
export function openCaptureRun(opts: OpenCaptureRunOptions): CaptureRun {
  const s3 = opts.s3 ?? s3Client();
  // `CaptureRun.flush()` réécrit l'objet manifeste : un shard unique est donc
  // impératif, sinon deux jobs de même lane démarrés dans la même seconde se
  // remplaceraient. `runId`/`shard` explicites restent disponibles pour une reprise.
  const shard = opts.shard ?? `${process.pid}-${randomUUID()}`;
  const runId =
    opts.runId ?? buildCaptureRunId(opts.lane, { shard });
  return new CaptureRun({
    runId,
    lane: opts.lane,
    store: s3CaptureStore(s3),
    userAgent: opts.userAgent ?? CAPTURE_USER_AGENT,
    egress: opts.egress ?? process.env["GEO_CAPTURE_EGRESS"] ?? "direct",
    viaObscura: opts.viaObscura ?? false,
    // L'exécution est LOCALE tant que la migration cluster n'est pas faite ; le
    // manifeste dit la vérité sur l'endroit où le fetch a réellement eu lieu.
    execution: process.env["GEO_CAPTURE_EXECUTION"] === "cluster" ? "cluster" : "local",
    gitSha: process.env["GEO_GIT_SHA"] ?? process.env["GIT_SHA"] ?? null,
    worklist: opts.worklist ?? null,
    ...(opts.flushEvery !== undefined ? { flushEvery: opts.flushEvery } : {}),
    ...(opts.echo !== undefined ? { echo: opts.echo } : {}),
  });
}
