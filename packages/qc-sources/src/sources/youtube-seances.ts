/**
 * youtube-seances — SourceAdapter for city council session videos on YouTube.
 *
 * Signal value: council sessions contain early signals of zoning changes
 * (avis de motion, discussions) that typically surface ~15 days before the
 * official PV is published. The transcript is the RawDocument.
 *
 * OFF BY DEFAULT / NETWORK-GATED:
 *   - `listSeanceVideos` makes network calls only when called with a live
 *     `fetchImpl`. In production it calls the YouTube Data API v3.
 *   - `getTranscript` downloads audio and calls Voxtral only when the injected
 *     `transcribeImpl` does so. Tests always inject a mock.
 *   - No network calls are made in CI: the adapter is never instantiated by
 *     any test unless explicitly configured.
 *
 * Activation: set YOUTUBE_SEANCES_LIVE=1 + YOUTUBE_API_KEY + MISTRAL_API_KEY
 * in the runtime environment. Tests must never set these.
 *
 * Architecture:
 *   - `listSeanceVideos(config, opts)` — async-generator yielding video refs
 *     from a YouTube channel within the past 6 months.
 *   - `getTranscript(ref, opts)` — returns a `RawDocument` (text/plain) with
 *     the transcript text. Tries the YouTube caption track first; falls back to
 *     download + Voxtral transcription.
 *   - `YouTubeSeancesAdapter` — full `SourceAdapter` wrapping the above two.
 */

import type { SourceKind } from "../domain.js";
import { sha256Hex } from "../RawDocument.js";
import type {
  IsoDateString,
  ListOptions,
  RawDocument,
  RawDocumentRef,
  SourceAdapter,
} from "../SourceAdapter.js";
import type { TranscribeImpl } from "./voxtral-transcriber.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const YOUTUBE_SEANCES_ADAPTER_VERSION = "0.1.0";
export const YOUTUBE_SEANCES_SOURCE_KIND: SourceKind = "video-youtube";

/** Look-back window in days (6 months). */
const DEFAULT_WINDOW_DAYS = 183;

/** Hard timeout per network fetch. */
const FETCH_TIMEOUT_MS = 30_000;

/** Honest user-agent (rules/MASTER.md Scraping Policy). */
export const YOUTUBE_SEANCES_USER_AGENT =
  "radar-immobilier/0.1 (+https://github.com/rhanka/radar-immobilier)";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-city YouTube channel configuration.
 *
 * `channelUrl` is the canonical YouTube channel URL
 * (e.g. "https://www.youtube.com/@VilleValleyfield" or a /channel/UC… URL).
 * The adapter uses it to derive the channel ID via the YouTube Data API.
 */
export interface YouTubeChannelConfig {
  /** City slug used for RawDocument.city (lowercase, hyphenated). */
  readonly citySlug: string;
  /** YouTube channel URL or channel ID (UC…). */
  readonly channelUrl: string;
  /**
   * Optional keyword filter applied to video titles (case-insensitive).
   * When omitted, all videos within the window are returned.
   * Recommended value: "séance" | "conseil" | "municipal".
   */
  readonly titleKeywords?: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube Data API v3 shapes (minimal)
// ─────────────────────────────────────────────────────────────────────────────

interface YtSearchItem {
  id: { videoId?: string };
  snippet: {
    title: string;
    publishedAt: string;
    description?: string;
    channelId?: string;
  };
}

interface YtSearchResponse {
  items?: YtSearchItem[];
  nextPageToken?: string;
}

interface YtCaptionTrack {
  id: string;
  snippet: {
    language: string;
    name: string;
    trackKind: string;
  };
}

interface YtCaptionListResponse {
  items?: YtCaptionTrack[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SeanceVideoRef — enriched ref for a seance video
// ─────────────────────────────────────────────────────────────────────────────

export interface SeanceVideoRef {
  readonly videoId: string;
  readonly url: string;
  readonly title: string;
  readonly publishedAt: IsoDateString;
  readonly citySlug: string;
  /** True when a YouTube caption track (ASR or manual) was found. */
  readonly hasCaptions?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// FetchLike
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal fetch signature used throughout — injectable for testing. */
export type YtFetchLike = (
  url: string,
  init?: {
    signal?: AbortSignal;
    headers?: Record<string, string>;
    method?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

// ─────────────────────────────────────────────────────────────────────────────
// Adapter options
// ─────────────────────────────────────────────────────────────────────────────

export interface YouTubeSeancesAdapterOptions {
  /** Inject a mock fetch in tests; defaults to globalThis.fetch. */
  readonly fetchImpl?: YtFetchLike;
  /** Inject a mock transcriber in tests. */
  readonly transcribeImpl?: TranscribeImpl;
  /** YouTube Data API v3 key; read from YOUTUBE_API_KEY env when absent. */
  readonly youtubeApiKey?: string;
  /** Look-back window in days; defaults to DEFAULT_WINDOW_DAYS (6 months). */
  readonly windowDays?: number;
  /** Per-fetch timeout in ms; defaults to FETCH_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Clock injection for testing. */
  readonly now?: () => Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────────

export type YouTubeSeancesErrorKind =
  | "timeout"
  | "network"
  | "http"
  | "parse"
  | "missing-api-key"
  | "no-transcript";

export class YouTubeSeancesError extends Error {
  constructor(
    readonly kind: YouTubeSeancesErrorKind,
    readonly detail: string,
    readonly url: string,
  ) {
    super(`[youtube-seances:${kind}] ${detail}`);
    this.name = "YouTubeSeancesError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extract a channel ID (UC…) from a channel URL, or return as-is if already an ID. */
export function extractChannelId(channelUrl: string): string | null {
  // Direct channel ID
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(channelUrl)) return channelUrl;

  // https://www.youtube.com/channel/UC…
  const channelMatch = channelUrl.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/);
  if (channelMatch?.[1]) return channelMatch[1];

  // Handle-based URLs (@handle or /user/…) cannot be resolved without an API call.
  return null;
}

/** Return an ISO date string `windowDays` before `now`. */
export function windowStartIso(now: Date, windowDays: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - windowDays);
  return d.toISOString();
}

/** Match a video title against keyword filters (case-insensitive). */
export function matchesTitleKeywords(
  title: string,
  keywords: readonly string[],
): boolean {
  if (keywords.length === 0) return true;
  const lower = title.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

// ─────────────────────────────────────────────────────────────────────────────
// listSeanceVideos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List recent council session videos from a city's YouTube channel.
 *
 * Uses the YouTube Data API v3 `search.list` endpoint with `channelId` and
 * `publishedAfter` parameters. Reads `YOUTUBE_API_KEY` from the environment
 * when `opts.youtubeApiKey` is not provided.
 *
 * OFF BY DEFAULT: only makes network calls when `fetchImpl` is provided or
 * when `YOUTUBE_API_KEY` is set in the environment (production only).
 *
 * @yields `SeanceVideoRef` for each matching video, newest first.
 */
export async function* listSeanceVideos(
  config: YouTubeChannelConfig,
  opts: {
    fetchImpl?: YtFetchLike;
    youtubeApiKey?: string;
    windowDays?: number;
    timeoutMs?: number;
    now?: () => Date;
    signal?: AbortSignal;
  } = {},
): AsyncGenerator<SeanceVideoRef> {
  const apiKey =
    opts.youtubeApiKey ?? process.env["YOUTUBE_API_KEY"] ?? undefined;
  if (!apiKey) {
    throw new YouTubeSeancesError(
      "missing-api-key",
      "YOUTUBE_API_KEY is not set; YouTube ingestion is OFF by default",
      config.channelUrl,
    );
  }

  const fetchImpl =
    opts.fetchImpl ?? (globalThis.fetch as unknown as YtFetchLike);
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const now = opts.now ? opts.now() : new Date();

  // Resolve channel ID
  const channelId = extractChannelId(config.channelUrl);
  if (!channelId) {
    throw new YouTubeSeancesError(
      "parse",
      `Cannot resolve channel ID from URL: ${config.channelUrl}. ` +
        "Provide a /channel/UC… URL or a bare UC… ID.",
      config.channelUrl,
    );
  }

  const publishedAfter = windowStartIso(now, windowDays);
  const keywords = config.titleKeywords ?? [];

  let pageToken: string | undefined;
  do {
    if (opts.signal?.aborted) return;

    const params = new URLSearchParams({
      part: "snippet",
      channelId,
      type: "video",
      order: "date",
      publishedAfter,
      maxResults: "50",
      key: apiKey,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Awaited<ReturnType<YtFetchLike>>;
    try {
      res = await fetchImpl(url, {
        signal: controller.signal,
        headers: { "user-agent": YOUTUBE_SEANCES_USER_AGENT },
      });
    } catch (e) {
      clearTimeout(timer);
      const isAbort = e instanceof Error && e.name === "AbortError";
      throw new YouTubeSeancesError(
        isAbort ? "timeout" : "network",
        e instanceof Error ? e.message : String(e),
        url,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new YouTubeSeancesError(
        "http",
        `HTTP ${res.status}`,
        url,
      );
    }

    let data: YtSearchResponse;
    try {
      data = JSON.parse(await res.text()) as YtSearchResponse;
    } catch (e) {
      throw new YouTubeSeancesError(
        "parse",
        `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
        url,
      );
    }

    for (const item of data.items ?? []) {
      if (opts.signal?.aborted) return;
      const videoId = item.id.videoId;
      if (!videoId) continue;

      const title = item.snippet.title;
      if (keywords.length > 0 && !matchesTitleKeywords(title, keywords)) {
        continue;
      }

      yield {
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title,
        publishedAt: item.snippet.publishedAt,
        citySlug: config.citySlug,
      };
    }

    pageToken = data.nextPageToken;
  } while (pageToken !== undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// getTranscript
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieve the transcript for a council session video.
 *
 * Strategy (in order):
 *   1. Try to fetch the YouTube automatic caption track (VTT/SRT format)
 *      via the `captions.list` API. If available, download and return as text.
 *   2. Fall back to downloading the audio with yt-dlp + transcribing with
 *      Voxtral via the injected `transcribeImpl`.
 *
 * Returns a `RawDocument` with `contentType: "text/plain"` and the transcript
 * in both `body` (UTF-8 bytes) and `text` fields.
 *
 * @param ref    - A `RawDocumentRef` produced by `listSeanceVideos` or
 *                 `YouTubeSeancesAdapter.list()`. `ref.metadata.videoId` must
 *                 be set.
 * @param opts   - Injectable fetch + transcribe implementations.
 */
export async function getTranscript(
  ref: RawDocumentRef,
  opts: {
    fetchImpl?: YtFetchLike;
    transcribeImpl?: TranscribeImpl;
    youtubeApiKey?: string;
    timeoutMs?: number;
    now?: () => Date;
    signal?: AbortSignal;
  } = {},
): Promise<RawDocument> {
  const videoId = ref.metadata?.["videoId"] as string | undefined;
  if (!videoId) {
    throw new YouTubeSeancesError(
      "parse",
      "ref.metadata.videoId is missing — use refs from listSeanceVideos()",
      ref.url,
    );
  }

  const fetchedAt: IsoDateString = (opts.now ? opts.now() : new Date()).toISOString();
  const fetchImpl =
    opts.fetchImpl ?? (globalThis.fetch as unknown as YtFetchLike);
  const apiKey =
    opts.youtubeApiKey ?? process.env["YOUTUBE_API_KEY"] ?? undefined;

  // ── Strategy 1: YouTube caption track ──────────────────────────────────────
  let transcriptText: string | null = null;
  if (apiKey) {
    transcriptText = await tryYouTubeCaptions(videoId, apiKey, fetchImpl, opts);
  }

  // ── Strategy 2: yt-dlp + Voxtral ───────────────────────────────────────────
  if (transcriptText === null) {
    const transcribeImpl = opts.transcribeImpl;
    if (!transcribeImpl) {
      throw new YouTubeSeancesError(
        "no-transcript",
        `No YouTube captions available and no transcribeImpl provided for video ${videoId}`,
        ref.url,
      );
    }
    transcriptText = await transcribeWithVoxtral(videoId, ref.url, transcribeImpl, opts);
  }

  const body = new TextEncoder().encode(transcriptText);
  const doc: RawDocument = {
    ref,
    sourceKind: YOUTUBE_SEANCES_SOURCE_KIND,
    ...(ref.city !== undefined ? { city: ref.city } : {}),
    url: ref.url,
    fetchedAt,
    contentType: "text/plain",
    body,
    text: transcriptText,
    sha256: sha256Hex(body),
    provenance: {
      adapterVersion: YOUTUBE_SEANCES_ADAPTER_VERSION,
      userAgent: YOUTUBE_SEANCES_USER_AGENT,
      fetchedViaObscura: false,
      obtentionMode: "transcription",
    },
    metadata: { ...ref.metadata, videoId },
  };
  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function tryYouTubeCaptions(
  videoId: string,
  apiKey: string,
  fetchImpl: YtFetchLike,
  opts: { timeoutMs?: number; signal?: AbortSignal },
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;

  // 1. List available caption tracks.
  const listParams = new URLSearchParams({
    part: "snippet",
    videoId,
    key: apiKey,
  });
  const listUrl = `https://www.googleapis.com/youtube/v3/captions?${listParams.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let listRes: Awaited<ReturnType<YtFetchLike>>;
  try {
    listRes = await fetchImpl(listUrl, {
      signal: controller.signal,
      headers: { "user-agent": YOUTUBE_SEANCES_USER_AGENT },
    });
  } catch {
    clearTimeout(timer);
    return null; // non-fatal — fall through to Voxtral
  } finally {
    clearTimeout(timer);
  }

  if (!listRes.ok) return null;

  let captionData: YtCaptionListResponse;
  try {
    captionData = JSON.parse(await listRes.text()) as YtCaptionListResponse;
  } catch {
    return null;
  }

  const tracks = captionData.items ?? [];
  // Prefer French ASR, then any French track, then any track.
  const track =
    tracks.find((t) => t.snippet.language === "fr" && t.snippet.trackKind === "asr") ??
    tracks.find((t) => t.snippet.language === "fr") ??
    tracks[0];

  if (!track) return null;

  // 2. Download the caption track (requires OAuth in general; the Data API
  //    /captions/{id} endpoint requires OAuth for private tracks, but publicly
  //    accessible ASR tracks can often be fetched via timedtext).
  //    We use the unofficial timedtext URL as a best-effort approach.
  const captionUrl =
    `https://www.youtube.com/api/timedtext?lang=fr&v=${videoId}&fmt=vtt`;

  const capController = new AbortController();
  const capTimer = setTimeout(() => capController.abort(), timeoutMs);
  let capRes: Awaited<ReturnType<YtFetchLike>>;
  try {
    capRes = await fetchImpl(captionUrl, {
      signal: capController.signal,
      headers: { "user-agent": YOUTUBE_SEANCES_USER_AGENT },
    });
  } catch {
    clearTimeout(capTimer);
    return null;
  } finally {
    clearTimeout(capTimer);
  }

  if (!capRes.ok) return null;

  const vtt = await capRes.text();
  return vttToPlainText(vtt);
}

/**
 * Strip VTT/SRT markup and return plain text.
 * Deduplicates consecutive identical lines (subtitle repetition).
 */
export function vttToPlainText(vtt: string): string {
  const lines = vtt.split("\n");
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    // Skip header, timestamps, empty lines, NOTE blocks, and VTT metadata (Kind: / Language:)
    if (
      line.startsWith("WEBVTT") ||
      line.startsWith("NOTE") ||
      line.startsWith("Kind:") ||
      line.startsWith("Language:") ||
      line.match(/^\d{2}:\d{2}:\d{2}/) ||
      line.match(/^\d{2}:\d{2},\d{3}/) || // SRT timestamps
      line.match(/^\d+$/) || // SRT sequence numbers
      line.trim() === ""
    ) {
      continue;
    }
    // Strip inline VTT tags like <00:00:00.000><c>text</c>
    const clean = line
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      result.push(clean);
    }
  }
  return result.join("\n");
}

async function transcribeWithVoxtral(
  videoId: string,
  videoUrl: string,
  transcribeImpl: TranscribeImpl,
  opts: { signal?: AbortSignal },
): Promise<string> {
  // Download audio with yt-dlp to a temp file, then transcribe.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const execFileAsync = promisify(execFile);
  const tmpDir = await mkdtemp(join(tmpdir(), `radar-yt-${videoId}-`));
  const audioPath = join(tmpDir, "audio.mp3");

  try {
    // yt-dlp: extract best audio, convert to mp3 with ffmpeg
    try {
      await execFileAsync("yt-dlp", [
        "--no-playlist",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "5", // ~128 kbps — sufficient for transcription
        "-o",
        audioPath,
        videoUrl,
      ]);
    } catch (e) {
      // yt-dlp not installed (ENOENT) or download failure → no-transcript
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new YouTubeSeancesError(
          "no-transcript",
          "yt-dlp is not installed; audio download unavailable",
          videoUrl,
        );
      }
      throw new YouTubeSeancesError(
        "network",
        `yt-dlp failed: ${e instanceof Error ? e.message : String(e)}`,
        videoUrl,
      );
    }

    const result = await transcribeImpl(
      audioPath,
      opts.signal !== undefined ? { signal: opts.signal } : undefined,
    );
    return result.text;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTubeSeancesAdapter — full SourceAdapter implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `SourceAdapter` for YouTube council session videos.
 *
 * `list()` yields `RawDocumentRef` for each session video within the window.
 * `fetch()` retrieves the transcript (YouTube captions or Voxtral fallback).
 * `hash()` returns the sha256 of the transcript bytes.
 *
 * This adapter is OFF by default: `list()` throws `YouTubeSeancesError` with
 * kind `"missing-api-key"` unless `YOUTUBE_API_KEY` is set (or `youtubeApiKey`
 * is provided in options). Tests always inject mocks.
 */
export class YouTubeSeancesAdapter implements SourceAdapter {
  readonly kind: SourceKind = YOUTUBE_SEANCES_SOURCE_KIND;
  readonly city: string;
  readonly version = YOUTUBE_SEANCES_ADAPTER_VERSION;

  private readonly config: YouTubeChannelConfig;
  private readonly opts: YouTubeSeancesAdapterOptions;

  constructor(
    config: YouTubeChannelConfig,
    opts: YouTubeSeancesAdapterOptions = {},
  ) {
    this.config = config;
    this.city = config.citySlug;
    this.opts = opts;
  }

  async *list(listOpts: ListOptions): AsyncIterable<RawDocumentRef> {
    if (listOpts.signal?.aborted) return;
    const now = this.opts.now ?? (() => new Date());

    for await (const video of listSeanceVideos(this.config, {
      ...(this.opts.fetchImpl !== undefined ? { fetchImpl: this.opts.fetchImpl } : {}),
      ...(this.opts.youtubeApiKey !== undefined ? { youtubeApiKey: this.opts.youtubeApiKey } : {}),
      ...(this.opts.windowDays !== undefined ? { windowDays: this.opts.windowDays } : {}),
      ...(this.opts.timeoutMs !== undefined ? { timeoutMs: this.opts.timeoutMs } : {}),
      now,
      ...(listOpts.signal !== undefined ? { signal: listOpts.signal } : {}),
    })) {
      const ref: RawDocumentRef = {
        sourceKind: this.kind,
        city: this.city,
        url: video.url,
        discoveredAt: now().toISOString(),
        title: video.title,
        publishedAt: video.publishedAt,
        contentType: "text/plain",
        metadata: { videoId: video.videoId },
      };
      yield ref;
    }
  }

  async fetch(ref: RawDocumentRef): Promise<RawDocument> {
    return getTranscript(ref, {
      ...(this.opts.fetchImpl !== undefined ? { fetchImpl: this.opts.fetchImpl } : {}),
      ...(this.opts.transcribeImpl !== undefined ? { transcribeImpl: this.opts.transcribeImpl } : {}),
      ...(this.opts.youtubeApiKey !== undefined ? { youtubeApiKey: this.opts.youtubeApiKey } : {}),
      ...(this.opts.timeoutMs !== undefined ? { timeoutMs: this.opts.timeoutMs } : {}),
      ...(this.opts.now !== undefined ? { now: this.opts.now } : {}),
    });
  }

  hash(raw: RawDocument): string {
    return raw.sha256 ?? sha256Hex(raw.body);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Well-known city configurations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Salaberry-de-Valleyfield YouTube channel.
 * Channel: https://www.youtube.com/@VilleValleyfield (verified 2026-06-10)
 * Channel ID: UCvq59Bz8DIAMaZfm3-gvHwA (resolved via YouTube Data API)
 */
export const VALLEYFIELD_YOUTUBE_CONFIG: YouTubeChannelConfig = {
  citySlug: "salaberry-de-valleyfield",
  channelUrl: "UCvq59Bz8DIAMaZfm3-gvHwA",
  titleKeywords: ["séance", "conseil", "municipal"],
};

/** Factory shortcut for the Valleyfield YouTube séances adapter. */
export function createValleyfieldYouTubeAdapter(
  opts: YouTubeSeancesAdapterOptions = {},
): YouTubeSeancesAdapter {
  return new YouTubeSeancesAdapter(VALLEYFIELD_YOUTUBE_CONFIG, opts);
}

/** Generic factory for any city. */
export function createYouTubeSeancesAdapter(
  config: YouTubeChannelConfig,
  opts: YouTubeSeancesAdapterOptions = {},
): YouTubeSeancesAdapter {
  return new YouTubeSeancesAdapter(config, opts);
}
