# geo — guidance repo

Acquisition QC (zones, normes, PV, règlement, usage dominant, effet densifiant,
cadastre/rôle, immo-lots) sur **1106 municipalités**. Données servies via API OGC
depuis S3 (`normalized/…`). Node/TS uniquement.

## Rapport de couverture (standard)

- Rapport portfolio par ville : **`node scripts/portfolio-city-report.mjs`**.
  Format **figé** : `docs/spec/SPEC_PORTFOLIO_REPORT.md`. Ne jamais reformater le
  rapport à la main — corriger le générateur, pas la sortie.
- Mesure = **complétion-ville / 1106**, `unknown ≠ complete`, partitions fermées,
  `Précédent`/`Δ` par diff de snapshots datés (`work/coverage/portfolio-report-history/`),
  **jamais fabriqués**. Anti-invention : entrée manquante → `unknown`, jamais deviné.
- Le rapport mesure **présence ET provenance/qualité** — sinon la ré-acquisition et le
  stampage sont invisibles.

## Principe de provenance (données servies)

- **Toute donnée servie porte sa source de preuve.** Chaque collection servie
  `qc-zonage-<slug>` porte `zone_source_url` + `zone_source_level`. Une **ré-acquisition
  de géométrie re-stampe dans la même passe** (runners `acquisition/src/zones-*-replace.ts` ;
  rattrapage : `acquisition/src/_restamp-served-from-proof.ts`).
- Écriture sur zone servie : provenance additive → `putServedZoneAdditive` (géométrie
  prouvée octet-pour-octet inchangée, whitelist de props) ; nouvelle géométrie →
  `putServedZoneGeojson` (preuve v2 exigée : url réelle + retrieved_at + sha256).
- geo-api sert le **sous-dossier** quand plat ET sous-dossier coexistent — stamper/déposer
  sur les **deux** layouts.

## Opérationnel

- **Runs S3** : préfixer `NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.
  Un `AggregateError [ETIMEDOUT]` est un bug happy-eyeballs (IPv6), **pas** une panne
  réseau — ne pas brider les runs sur ce signal.
- **Scripts committés** uniquement (pas de bash ad-hoc). **Commits par pathspec**
  (arbre de travail partagé). Branche de travail : `feat/cadre-acquisition`.
