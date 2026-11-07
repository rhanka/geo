import { defineEnvVars } from "@sveltejs/kit/env";

/**
 * Environment variables of the static site (SvelteKit 3: declared here, read via
 * `$app/env/public`). The site is prerendered with adapter-static, so the API base
 * URL is a build-time value: `pages.yml` builds with
 * `PUBLIC_GEO_API_URL=https://api.geo.sent-tech.ca`. Unset → `catalog.ts` default.
 */
export const variables = defineEnvVars({
  PUBLIC_GEO_API_URL: {
    public: true,
    static: true,
    description: "Public OGC API base URL (no trailing slash needed).",
    schema: (value) => (value === undefined || value === "" ? undefined : value),
  },
});
