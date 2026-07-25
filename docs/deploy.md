# Deployment — site (GitHub Pages) + API (k8s), domain split

`geo.sent-tech.ca` is split across two independently-deployed surfaces so a
static public site and a live OGC API can coexist on the same domain (ADR-0015):

| Surface | Domain | Where it runs | Deployed by |
| ------- | ------ | ------------- | ----------- |
| **Site** (`apps/site`, SvelteKit `adapter-static`) | **apex** `geo.sent-tech.ca` | **GitHub Pages** | [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) |
| **API** (`packages/geo-api`, OGC API – Features) | **subdomain** `api.geo.sent-tech.ca` | shared k8s cluster (`poc-k8s`) | [`deploy/k8s/`](../deploy/k8s) manifests |

The site is a fully static bundle; at build time it bakes in the API base URL
and at runtime the browser calls the API on the subdomain. The two never share a
host, so the apex Pages site and the `api.` k8s ingress do not collide.

## Site → GitHub Pages (apex, CNAME)

`pages.yml` builds `apps/site` and publishes it via the standard
`configure-pages` → `upload-pages-artifact` → `deploy-pages` flow.

- **Triggers:** push to `main` touching `apps/site/**`, `packages/geo-ui-svelte/**`,
  `packages/geo-core/**`, or the workflow itself; plus manual `workflow_dispatch`.
- **Permissions:** `pages: write`, `id-token: write` (OIDC for `deploy-pages`).
- **Build:** `npm ci`, then build the workspace deps
  (`npm run build -w @sentropic/geo-core -w @sentropic/geo-ui-svelte`), then
  `npm --workspace @sentropic/geo-site run build`. The artifact uploaded is
  **`apps/site/build`** (the `adapter-static` output dir, configured in
  `apps/site/svelte.config.js`).
- **Custom domain / CNAME:** `apps/site/static/CNAME` contains
  `geo.sent-tech.ca`. `adapter-static` copies `static/` into the build verbatim,
  so the published artifact carries the `CNAME` file GitHub Pages needs to serve
  the apex domain.
- **Base path:** the SvelteKit config sets **no `kit.paths.base`** (effective
  base `""`). This is correct for an **apex custom domain** — assets are served
  from `/`, not from a `/<repo>/` subpath as they would be on
  `*.github.io/<repo>`.

## API base URL wiring (`PUBLIC_GEO_API_URL`)

`apps/site/src/lib/catalog.ts` reads `PUBLIC_GEO_API_URL` via
`$env/dynamic/public` (default `http://localhost:8787` for local dev). The Pages
workflow sets it for the build:

```yaml
env:
  PUBLIC_GEO_API_URL: https://api.geo.sent-tech.ca
```

so the deployed site fetches `https://api.geo.sent-tech.ca/collections` (and the
per-collection `/items`), i.e. the k8s `geo-api` ingress. When the API is
unreachable (e.g. before it is live), the catalog degrades to the bundled
`collections.fallback.json` snapshot — the build never fails on a network error.

## API → k8s at `api.geo.sent-tech.ca`

[`deploy/k8s/ingress.yaml`](../deploy/k8s/ingress.yaml) routes
`api.geo.sent-tech.ca` to the `geo-api` Service, terminating TLS with a
cert-manager `letsencrypt-prod` certificate via the shared Traefik v3
controller. See [`deploy/k8s/README.md`](../deploy/k8s/README.md) for the full
deploy procedure (this PR only changes the host from the apex to the subdomain).

## poc-k8s follow-up (conductor)

This repo owns only the app workloads. For the API subdomain to resolve and get
a certificate, **`poc-k8s` must**:

1. **DNS:** add an `api.geo.sent-tech.ca` record pointing at the shared LB
   (the apex `geo.sent-tech.ca` now points at GitHub Pages instead — its A/AAAA
   records should target GitHub Pages IPs / a `CNAME` to `<owner>.github.io`,
   which is a domain-registrar / Pages-settings change, not a k8s one).
2. **Ingress / tenant contract:** update any host references in the `geo` tenant
   request (`requests/geo.md`, `tenants/geo/`) from `geo.sent-tech.ca` to
   `api.geo.sent-tech.ca` so the negotiated contract matches this Ingress.
3. Keep Traefik v3 + cert-manager `letsencrypt-prod` issuing for the
   `sent-tech.ca` zone (now covering `api.geo.sent-tech.ca`).

> The conductor amends the `poc-k8s` ingress PR — do not edit `../poc-k8s` from
> this repo.

## Validation done in this repo

- Site builds with the API subdomain baked in:
  `PUBLIC_GEO_API_URL=https://api.geo.sent-tech.ca npm --workspace @sentropic/geo-site run build`
  emits `apps/site/build` (including `CNAME` and `200.html`).
- Existing workflows (`ci.yml`, `npm-publish.yml`, `docker-publish.yml`) are
  untouched; `pages.yml` is additive. Nothing here auto-deploys to the cluster —
  no `kubectl`/`docker` is run by these changes.
