/**
 * License model. Redistribution permission is a first-class field: the
 * acquisition engine (`@sentropic/geo-acquire`) refuses to re-host or republish
 * a dataset whose license is not `redistributable`.
 */

export type LicenseId =
  | "cc-by-4.0"
  | "cc-by-sa-4.0"
  | "cc0-1.0"
  | "ogl-ca"
  | "licence-ouverte-2.0"
  | "odbl-1.0"
  | "public-domain"
  | "proprietary"
  | "unknown";

export interface License {
  id: LicenseId;
  title: string;
  url?: string;
  /** May the data be re-hosted / republished by this project? */
  redistributable: boolean;
  /** Must upstream attribution be preserved and displayed? */
  attributionRequired: boolean;
  /** Derivatives must keep the same license. */
  shareAlike?: boolean;
}

export const LICENSES: Record<LicenseId, License> = {
  "cc-by-4.0": {
    id: "cc-by-4.0",
    title: "Creative Commons Attribution 4.0 International",
    url: "https://creativecommons.org/licenses/by/4.0/",
    redistributable: true,
    attributionRequired: true,
  },
  "cc-by-sa-4.0": {
    id: "cc-by-sa-4.0",
    title: "Creative Commons Attribution-ShareAlike 4.0 International",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    redistributable: true,
    attributionRequired: true,
    shareAlike: true,
  },
  "cc0-1.0": {
    id: "cc0-1.0",
    title: "Creative Commons Zero 1.0 Universal",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    redistributable: true,
    attributionRequired: false,
  },
  "ogl-ca": {
    id: "ogl-ca",
    title: "Open Government Licence – Canada",
    url: "https://open.canada.ca/en/open-government-licence-canada",
    redistributable: true,
    attributionRequired: true,
  },
  "licence-ouverte-2.0": {
    id: "licence-ouverte-2.0",
    title: "Licence Ouverte / Open Licence 2.0 (Etalab)",
    url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    redistributable: true,
    attributionRequired: true,
  },
  "odbl-1.0": {
    id: "odbl-1.0",
    title: "Open Data Commons Open Database License 1.0",
    url: "https://opendatacommons.org/licenses/odbl/1-0/",
    redistributable: true,
    attributionRequired: true,
    shareAlike: true,
  },
  "public-domain": {
    id: "public-domain",
    title: "Public Domain",
    redistributable: true,
    attributionRequired: false,
  },
  proprietary: {
    id: "proprietary",
    title: "Proprietary / all rights reserved",
    redistributable: false,
    attributionRequired: true,
  },
  unknown: {
    id: "unknown",
    title: "Unknown license",
    redistributable: false,
    attributionRequired: true,
  },
};

/** Common upstream spellings → canonical {@link LicenseId}. */
const LICENSE_ALIASES: Record<string, LicenseId> = {
  "cc-by": "cc-by-4.0",
  "cc-by-4.0": "cc-by-4.0",
  "ccby": "cc-by-4.0",
  "creative-commons-attribution": "cc-by-4.0",
  "cc-by-sa": "cc-by-sa-4.0",
  "cc-by-sa-4.0": "cc-by-sa-4.0",
  "cc0": "cc0-1.0",
  "cc-zero": "cc0-1.0",
  "ogl-canada": "ogl-ca",
  "ogl-ca": "ogl-ca",
  "licence-ouverte": "licence-ouverte-2.0",
  "licence-ouverte-2.0": "licence-ouverte-2.0",
  "lov2": "licence-ouverte-2.0",
  "etalab-2.0": "licence-ouverte-2.0",
  "fr-lo": "licence-ouverte-2.0",
  "odbl": "odbl-1.0",
  "odc-odbl": "odbl-1.0",
  "public-domain": "public-domain",
  "pd": "public-domain",
};

/**
 * Resolve an arbitrary license identifier (CKAN `license_id`, SPDX-ish string,
 * etc.) to a known {@link License}. Unrecognized identifiers resolve to the
 * conservative `unknown` license (not redistributable).
 */
export function resolveLicense(id: string | License | undefined): License {
  if (id && typeof id === "object") return id;
  if (!id) return LICENSES.unknown;
  const key = id.trim().toLowerCase();
  if (key in LICENSES) return LICENSES[key as LicenseId];
  const aliased = LICENSE_ALIASES[key];
  if (aliased) return LICENSES[aliased];
  return LICENSES.unknown;
}

/** Whether a license permits re-hosting / republication. */
export function canRedistribute(license: string | License | undefined): boolean {
  return resolveLicense(license).redistributable;
}

/** Human-readable attribution line for a provider under a given license. */
export function attributionLine(provider: string, license: License): string {
  return license.attributionRequired ? `© ${provider} — ${license.title}` : provider;
}
