/**
 * VoxtralTranscriber — calls Mistral's audio transcription API (voxtral-mini-latest)
 * to convert a local audio file into a plain-text transcript.
 *
 * Design contract:
 *   - Reads MISTRAL_API_KEY from the environment at call-time (never committed).
 *   - Network-gated: only invoked when YOUTUBE_SEANCES_LIVE=1 in environment;
 *     the adapter itself does not enforce this — callers do.
 *   - Injectable: the `TranscribeImpl` function type allows mocking in tests.
 *
 * Ref: POST https://api.mistral.ai/v1/audio/transcriptions
 *      model: voxtral-mini-latest
 *      multipart/form-data: file + model fields.
 */

import { createReadStream } from "node:fs";
import { basename } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** Result returned by a transcription call. */
export interface TranscriptionResult {
  /** The full transcript text. */
  readonly text: string;
  /** Detected language code (e.g. "fr"), when the API returns one. */
  readonly language?: string;
  /** Duration in seconds, when the API returns it. */
  readonly durationSeconds?: number;
}

/**
 * Injectable transcription implementation.
 * In production: `VoxtralTranscriber.transcribe`.
 * In tests: a mock that returns a canned `TranscriptionResult`.
 */
export type TranscribeImpl = (
  audioPath: string,
  opts?: { signal?: AbortSignal },
) => Promise<TranscriptionResult>;

// ─────────────────────────────────────────────────────────────────────────────
// Voxtral API response shape (minimal — only what we use)
// ─────────────────────────────────────────────────────────────────────────────

interface VoxtralApiResponse {
  text: string;
  language?: string;
  duration?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// VoxtralTranscriber
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Production implementation of `TranscribeImpl` that calls the Mistral Voxtral
 * audio transcription endpoint.
 *
 * Usage:
 *   const transcriber = new VoxtralTranscriber();
 *   const result = await transcriber.transcribe("/tmp/seance.mp3");
 *
 * Environment requirements:
 *   MISTRAL_API_KEY — Mistral API key (never committed; read at call-time).
 */
export class VoxtralTranscriber {
  private readonly apiBase: string;
  private readonly model: string;

  constructor(opts: { apiBase?: string; model?: string } = {}) {
    this.apiBase = opts.apiBase ?? "https://api.mistral.ai";
    this.model = opts.model ?? "voxtral-mini-latest";
  }

  /**
   * Transcribe an audio file at `audioPath` using Voxtral.
   *
   * Reads `MISTRAL_API_KEY` from `process.env` at call-time.
   * Throws `VoxtralTranscriberError` on API or auth failures.
   */
  readonly transcribe: TranscribeImpl = async (
    audioPath: string,
    opts?: { signal?: AbortSignal },
  ): Promise<TranscriptionResult> => {
    const apiKey = process.env["MISTRAL_API_KEY"];
    if (!apiKey) {
      throw new VoxtralTranscriberError(
        "missing-api-key",
        "MISTRAL_API_KEY is not set in the environment",
        audioPath,
      );
    }

    // Build multipart/form-data using Node's native FormData + Blob.
    // We use createReadStream → Blob so we don't load the full file into memory.
    const fileStream = createReadStream(audioPath);
    const chunks: Buffer[] = [];
    for await (const chunk of fileStream) {
      chunks.push(chunk as Buffer);
    }
    const fileBytes = Buffer.concat(chunks);
    const fileName = basename(audioPath);

    const form = new FormData();
    form.append("model", this.model);
    form.append("file", new Blob([fileBytes]), fileName);

    const endpoint = `${this.apiBase}/v1/audio/transcriptions`;

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
        ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      });
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      throw new VoxtralTranscriberError(
        isAbort ? "timeout" : "network",
        e instanceof Error ? e.message : String(e),
        audioPath,
      );
    }

    if (!res.ok) {
      let body = "";
      try {
        body = await res.text();
      } catch {
        // ignore
      }
      throw new VoxtralTranscriberError(
        "http",
        `HTTP ${res.status}: ${body}`,
        audioPath,
      );
    }

    let json: VoxtralApiResponse;
    try {
      json = (await res.json()) as VoxtralApiResponse;
    } catch (e) {
      throw new VoxtralTranscriberError(
        "parse",
        `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
        audioPath,
      );
    }

    return {
      text: json.text,
      ...(json.language !== undefined ? { language: json.language } : {}),
      ...(json.duration !== undefined ? { durationSeconds: json.duration } : {}),
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────────

export type VoxtralErrorKind =
  | "missing-api-key"
  | "network"
  | "timeout"
  | "http"
  | "parse";

export class VoxtralTranscriberError extends Error {
  constructor(
    readonly kind: VoxtralErrorKind,
    readonly detail: string,
    readonly audioPath: string,
  ) {
    super(`[voxtral:${kind}] ${detail} (file: ${audioPath})`);
    this.name = "VoxtralTranscriberError";
  }
}
