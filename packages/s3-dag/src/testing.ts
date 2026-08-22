/**
 * In-memory test doubles for the ports — shipped so consumers can unit-test their
 * own DAGs without a cluster or S3. {@link InMemoryDagStore} implements true
 * compare-and-set (If-Match) semantics so CAS-conflict and crash paths are
 * exercisable deterministically.
 */

import type {
  DagStore,
  JobExecutor,
  JobStatus,
  JobSubmission,
  ObservedJob,
} from "./ports.js";

/** A `Map`-backed {@link DagStore} with real ETag/If-Match compare-and-set. */
export class InMemoryDagStore implements DagStore {
  #data = new Map<string, { body: string; etag: string }>();
  #seq = 0;

  #nextEtag(): string {
    this.#seq += 1;
    return `etag-${this.#seq}`;
  }

  get(key: string): Promise<{ body: string; etag: string } | undefined> {
    const e = this.#data.get(key);
    return Promise.resolve(e ? { ...e } : undefined);
  }

  put(key: string, body: string): Promise<{ etag: string }> {
    const etag = this.#nextEtag();
    this.#data.set(key, { body, etag });
    return Promise.resolve({ etag });
  }

  putIfMatch(
    key: string,
    body: string,
    etag: string | null,
  ): Promise<{ ok: true; etag: string } | { ok: false }> {
    const curEtag = this.#data.get(key)?.etag ?? null;
    if (curEtag !== etag) return Promise.resolve({ ok: false }); // the S3 412
    const newEtag = this.#nextEtag();
    this.#data.set(key, { body, etag: newEtag });
    return Promise.resolve({ ok: true, etag: newEtag });
  }

  list(prefix: string): Promise<string[]> {
    return Promise.resolve([...this.#data.keys()].filter((k) => k.startsWith(prefix)).sort());
  }

  // ── test helpers ──
  /** Deep-copy the store (simulate a crash: keep this, discard the live one). */
  clone(): InMemoryDagStore {
    const copy = new InMemoryDagStore();
    for (const [k, v] of this.#data) copy.#data.set(k, { ...v });
    copy.#seq = this.#seq;
    return copy;
  }

  /** Parsed body of a key, or undefined. */
  read<T>(key: string): T | undefined {
    const e = this.#data.get(key);
    return e ? (JSON.parse(e.body) as T) : undefined;
  }
}

/** A {@link JobExecutor} that records submissions and returns scripted statuses. */
export class FakeJobExecutor implements JobExecutor {
  readonly submitted: JobSubmission[] = [];
  #status = new Map<string, JobStatus>();

  /** Force a Job's observed status (e.g. mark it succeeded before the next tick). */
  setStatus(name: string, status: JobStatus): void {
    this.#status.set(name, status);
  }

  submit(job: JobSubmission): Promise<void> {
    this.submitted.push(job);
    if (!this.#status.has(job.name)) this.#status.set(job.name, "active");
    return Promise.resolve();
  }

  observe(names: readonly string[]): Promise<ObservedJob[]> {
    return Promise.resolve(names.map((name) => ({ name, status: this.#status.get(name) ?? "missing" })));
  }

  /** How many times a given Job name was submitted (idempotency assertions). */
  submitCount(name: string): number {
    return this.submitted.filter((j) => j.name === name).length;
  }
}
