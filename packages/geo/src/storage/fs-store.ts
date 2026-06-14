/**
 * {@link FsStore} — a {@link Store} backed by a local directory. Keys map to
 * paths under a root: `join(root, key)`. Used for local development, tests, and
 * as a fallback when no object-storage URI is configured.
 */

import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import type { PutOptions, Store } from "./store.js";

/** A {@link Store} rooted at a local directory. */
export class FsStore implements Store {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Resolve a store key to an absolute filesystem path under the root. */
  private pathFor(key: string): string {
    return join(this.root, key);
  }

  async put(key: string, body: Uint8Array | string, _opts?: PutOptions): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      const buf = await readFile(this.pathFor(key));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (err) {
      if (isErrno(err, "ENOENT")) return undefined;
      throw err;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch (err) {
      if (isErrno(err, "ENOENT")) return false;
      throw err;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const keys = await walk(this.root, this.root);
    keys.sort();
    if (prefix === undefined || prefix.length === 0) return keys;
    return keys.filter((k) => k.startsWith(prefix));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

/** Recursively collect keys (root-relative, slash-separated) under `dir`. */
async function walk(dir: string, root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isErrno(err, "ENOENT")) return [];
    throw err;
  }

  const keys: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      keys.push(...(await walk(full, root)));
    } else if (entry.isFile()) {
      keys.push(toKey(relative(root, full)));
    }
  }
  return keys;
}

/** Normalize a relative path to a forward-slash-separated store key. */
function toKey(relPath: string): string {
  return sep === "/" ? relPath : relPath.split(sep).join("/");
}

/** Type guard: is `err` a Node errno error with the given `code`? */
function isErrno(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}
