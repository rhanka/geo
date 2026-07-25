/**
 * `geo licenses build` — regenerate `docs/licenses.md` from the JSON license
 * registry (`licenses/registry.json`). For each entry it asserts that the
 * declared `redistributable`/`attributionRequired`/`shareAlike` flags match what
 * `@sentropic/geo-core`'s `resolveLicense(licenseId)` reports (CI guards against
 * drift); any mismatch throws.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { resolveLicense } from "@sentropic/geo-core";

export const DEFAULT_REGISTRY_PATH = "licenses/registry.json";
export const DEFAULT_OUT_PATH = "docs/licenses.md";

/** One source entry in the JSON registry. */
export interface RegistryEntry {
  sourceId: string;
  kind: string;
  provider: string;
  providerUrl?: string;
  homepage?: string;
  licenseId: string;
  redistributable: boolean;
  attributionRequired: boolean;
  shareAlike?: boolean;
  attribution: string;
  sourceUrl?: string;
  retrievedAt: string;
  datasets?: string[];
  notes?: string;
}

export interface Registry {
  note?: string;
  sources: RegistryEntry[];
}

export interface LicensesBuildOptions {
  registry?: string;
  out?: string;
  cwd?: string;
}

export interface LicensesBuildResult {
  registryPath: string;
  outPath: string;
  markdown: string;
  entries: number;
}

function resolveFrom(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/** Short, display-friendly license label for the table. */
function licenseLabel(licenseId: string): string {
  const map: Record<string, string> = {
    "cc-by-4.0": "CC BY 4.0",
    "cc-by-sa-4.0": "CC BY-SA 4.0",
    "cc0-1.0": "CC0 1.0",
    "ogl-ca": "OGL Canada",
    "odbl-1.0": "ODbL 1.0",
    "public-domain": "Domaine public",
    proprietary: "Propriétaire",
    unknown: "Inconnue",
  };
  return map[licenseId] ?? resolveLicense(licenseId).title;
}

function shortProvider(provider: string): string {
  // Trim the long parenthetical/dash tail for the table; keep the lead.
  const dash = provider.indexOf(" — ");
  if (dash > 0) {
    const head = provider.slice(0, dash);
    const tailMatch = provider.match(/\(([^)]+)\)\s*$/);
    return tailMatch?.[1] ? `${head} — ${tailMatch[1]}` : head;
  }
  return provider;
}

/**
 * Assert that the registry's declared redistribution flags match geo-core's
 * canonical license. Throws on the first drift with an actionable message.
 */
export function assertNoLicenseDrift(registry: Registry): void {
  for (const entry of registry.sources) {
    const canonical = resolveLicense(entry.licenseId);
    const problems: string[] = [];
    if (canonical.redistributable !== entry.redistributable) {
      problems.push(
        `redistributable: registry=${entry.redistributable} but geo-core=${canonical.redistributable}`,
      );
    }
    if (canonical.attributionRequired !== entry.attributionRequired) {
      problems.push(
        `attributionRequired: registry=${entry.attributionRequired} but geo-core=${canonical.attributionRequired}`,
      );
    }
    const canonicalShareAlike = canonical.shareAlike ?? false;
    const entryShareAlike = entry.shareAlike ?? false;
    if (canonicalShareAlike !== entryShareAlike) {
      problems.push(
        `shareAlike: registry=${entryShareAlike} but geo-core=${canonicalShareAlike}`,
      );
    }
    if (problems.length > 0) {
      throw new Error(
        `license drift for source "${entry.sourceId}" (licenseId="${entry.licenseId}"): ` +
          problems.join("; ") +
          `. Fix licenses/registry.json or geo-core LICENSES.`,
      );
    }
  }
}

/** Render the registry as the `docs/licenses.md` markdown document. */
export function renderLicensesMarkdown(registry: Registry): string {
  const header =
    "<!-- GÉNÉRÉ depuis licenses/registry.json par `geo licenses build`. Ne pas éditer à la main. -->\n" +
    "# Registre des licences — @sentropic/geo\n\n" +
    "Ce registre rend explicites les droits de **redistribution** de chaque source. La colonne\n" +
    "*Redistribuable* est dérivée de `@sentropic/geo-core` (`LICENSES`) et fait foi pour la **gate\n" +
    "d'acquisition** : une source non redistribuable n'est jamais re-téléchargée/republiée. Voir\n" +
    "[ADR-0003](decisions.md).\n\n";

  const tableHeader =
    "| Source | Type | Fournisseur | Licence | Redistribuable | Attribution | Récupéré |\n" +
    "| --- | --- | --- | --- | :---: | --- | --- |\n";

  const rows = registry.sources
    .map((e) => {
      const redistributable = e.redistributable ? "✅" : "❌";
      const attribution = e.attributionRequired ? "requise" : "non requise";
      return (
        `| \`${e.sourceId}\` | ${e.kind} | ${shortProvider(e.provider)} | ` +
        `${licenseLabel(e.licenseId)} | ${redistributable} | ${attribution} | ${e.retrievedAt} |`
      );
    })
    .join("\n");

  const attributions = registry.sources
    .map((e) => {
      const note = e.notes ? ` ${e.notes}` : "";
      const link = e.homepage ? ` Source : [Données Québec](${e.homepage}).` : "";
      return `- **\`${e.sourceId}\`** — ${e.attribution}.${note ? note : ""}${link}`;
    })
    .join("\n");

  const footer =
    "\n\n> Mise à jour : ce fichier est régénéré par `geo licenses build` à partir de `licenses/registry.json`\n" +
    "> et des `SourceManifest` des packages `geo-source-*`.\n";

  return `${header}${tableHeader}${rows}\n\n## Attributions\n\n${attributions}${footer}`;
}

/**
 * Read the JSON registry, assert no license drift, render the markdown and write
 * it to the output path. Returns the resolved paths and rendered markdown.
 */
export async function buildLicenses(
  options: LicensesBuildOptions = {},
): Promise<LicensesBuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const registryPath = resolveFrom(cwd, options.registry ?? DEFAULT_REGISTRY_PATH);
  const outPath = resolveFrom(cwd, options.out ?? DEFAULT_OUT_PATH);

  let registry: Registry;
  try {
    registry = JSON.parse(await readFile(registryPath, "utf8")) as Registry;
  } catch (cause) {
    throw new Error(`failed to read license registry at ${registryPath}`, { cause });
  }
  if (!registry || !Array.isArray(registry.sources)) {
    throw new Error(`license registry at ${registryPath} has no "sources" array`);
  }

  assertNoLicenseDrift(registry);

  const markdown = renderLicensesMarkdown(registry);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, markdown);

  return { registryPath, outPath, markdown, entries: registry.sources.length };
}
