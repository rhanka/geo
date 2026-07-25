// Compat shim — see ../../README.md.
//
// Legacy acquisition scripts import `websiteForSlug` / `MUNICIPAL_DIRECTORY`
// from this module path. The real source of truth is the versioned MAMH
// municipal directory at packages/qc-sources/src/geo/qc-municipal-directory.json
// (schema qc-municipal-directory/v1, key `entries`). We load it repo-relatively
// FIRST so `remote shell --sync` (which ships only tracked files) is
// self-sufficient, and fall back to the out-of-repo shared copy only when the
// versioned one is unavailable.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  // 1) Versioned repo-relative source of truth (shipped by --sync).
  resolve(HERE, "../../../qc-sources/src/geo/qc-municipal-directory.json"),
  // 2) Out-of-repo shared copy (developer machine fallback).
  "/home/antoinefa/src/_acquisition-shared/qc-municipal-directory.json",
];

function valuesFromPayload(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && data.entries && typeof data.entries === "object") {
    return Object.values(data.entries);
  }
  if (data && typeof data === "object") {
    return Object.entries(data)
      .filter(([slug]) => !slug.startsWith("$") && !["generatedAt", "source", "stats", "entries"].includes(slug))
      .map(([slug, value]) => ({ slug, ...(typeof value === "object" && value ? value : { website: value }) }));
  }
  return [];
}

function loadRows() {
  for (const p of CANDIDATES) {
    try {
      if (!fs.existsSync(p)) continue;
      return valuesFromPayload(JSON.parse(fs.readFileSync(p, "utf8")));
    } catch {
      // try next candidate
    }
  }
  return [];
}

function pickWebsite(row) {
  if (!row || typeof row !== "object") return undefined;
  return row.website ?? row.siteUrl ?? row.url ?? row.homepage ?? row.site ?? row.web ?? row["Site Web"] ?? row.site_web;
}

export const MUNICIPAL_DIRECTORY = loadRows();

const bySlug = new Map();
for (const row of MUNICIPAL_DIRECTORY) {
  const slug = row.slug ?? row.citySlug ?? row.id ?? row.municipalitySlug;
  const website = pickWebsite(row);
  if (typeof slug === "string" && typeof website === "string" && /^https?:\/\//i.test(website)) {
    bySlug.set(slug, website);
  }
}

export function websiteForSlug(slug) {
  return bySlug.get(slug);
}

export default { websiteForSlug, MUNICIPAL_DIRECTORY };
