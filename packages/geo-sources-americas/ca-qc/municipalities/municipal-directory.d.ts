// Type surface for the compat shim (municipal-directory.js).
export interface MunicipalDirectoryRow {
  readonly slug?: string;
  readonly name?: string;
  readonly website?: string;
  readonly email?: string;
  readonly [key: string]: unknown;
}

export declare const MUNICIPAL_DIRECTORY: readonly MunicipalDirectoryRow[];

/** Returns the official municipal website URL for a slug, or undefined. */
export declare function websiteForSlug(slug: string): string | undefined;

declare const _default: {
  websiteForSlug: typeof websiteForSlug;
  MUNICIPAL_DIRECTORY: typeof MUNICIPAL_DIRECTORY;
};
export default _default;
