/**
 * Gate anti-artefacts : empêche la donnée de re-polluer l'historique git.
 *
 * L'historique a été purgé le 2026-07-25 de 53 Mio de données dont la source de
 * vérité vivait ailleurs (couches `qc-zonage` déjà servies depuis S3, extraits
 * cadastre re-téléchargeables, un bundle JS aspiré de 14,7 Mio). Une purge sans
 * garde ne tient pas : deux semaines suffisent à tout ré-committer. Ce test est
 * le cliquet.
 *
 * CE QU'IL REFUSE : tout fichier SUIVI par git, sous un chemin de données, dont
 * l'extension est celle d'un artefact volumineux (`.geojson`, `.parquet`, `.js`
 * bundlé, …) et qui n'est pas explicitement inscrit au registre.
 *
 * CE QU'IL N'EST PAS : un plafond de taille. Un gros fichier n'est pas le
 * problème — un fichier dont la source de vérité est AILLEURS l'est. Le registre
 * dit, pour chaque exception, POURQUOI le dépôt en est la source.
 *
 * Registre : `acquisition/config/data-artifact-allowlist.json`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ALLOWLIST_PATH = resolve(ROOT, "acquisition", "config", "data-artifact-allowlist.json");

/** Extensions qui trahissent un artefact de données ou un paquet aspiré. */
const ARTIFACT_EXT = /\.(geojson|parquet|gpkg|gdb|shp|dbf|tif|tiff|mbtiles|pmtiles)$/i;

/** Répertoires ou vit la donnee de pipeline. Le code source n'y est jamais. */
const DATA_ROOTS = ["work/", "data/"];

interface Allowlist {
  /** chemin exact -> raison pour laquelle le dépôt EST la source de vérité. */
  files: Record<string, string>;
  /** préfixes tolérés, avec la même exigence de justification. */
  prefixes: Record<string, string>;
}

function trackedFiles(): string[] {
  // Fichiers SUIVIS uniquement : l'arbre porte des centaines de sondes locales
  // non suivies appartenant à d'autres lanes, les inclure graverait leur scratch.
  return execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean);
}

function loadAllowlist(): Allowlist {
  if (!existsSync(ALLOWLIST_PATH)) return { files: {}, prefixes: {} };
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as Partial<Allowlist>;
  return { files: raw.files ?? {}, prefixes: raw.prefixes ?? {} };
}

function isAllowed(path: string, allow: Allowlist): boolean {
  if (path in allow.files) return true;
  return Object.keys(allow.prefixes).some((p) => path.startsWith(p));
}

describe("gate artefacts de données", () => {
  const allow = loadAllowlist();

  it("aucun artefact de données non déclaré n'est suivi par git", () => {
    const offenders = trackedFiles().filter(
      (f) => DATA_ROOTS.some((r) => f.startsWith(r)) && ARTIFACT_EXT.test(f) && !isAllowed(f, allow),
    );

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "Artefact(s) de données committé(s) sans justification :",
            ...offenders.slice(0, 20).map((f) => `  - ${f}`),
            offenders.length > 20 ? `  … et ${offenders.length - 20} autre(s)` : "",
            "",
            "La source de vérité d'une couche servie est S3, pas git : la committer",
            "duplique la production dans le contrôle de version (53 Mio purgés le",
            "2026-07-25). Déposer l'objet sur S3 et le lire par son URI.",
            "",
            "Si le dépôt EST réellement la source — fixture d'un test pérenne sans",
            "source pérenne identifiée pour le rejouer — inscrire le chemin dans",
            `${"acquisition/config/data-artifact-allowlist.json"} avec la raison.`,
          ].join("\n"),
    ).toEqual([]);
  });

  it("chaque exception du registre porte une justification non vide", () => {
    const entries = [...Object.entries(allow.files), ...Object.entries(allow.prefixes)];
    const unjustified = entries.filter(([, reason]) => typeof reason !== "string" || reason.trim().length < 20);
    expect(
      unjustified.map(([p]) => p),
      "Une exception sans raison explicite est une porte ouverte : dire pourquoi le dépôt est la source.",
    ).toEqual([]);
  });
});
