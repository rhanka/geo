# geo — guidance repo

Acquisition QC (zones, normes, PV, règlement, usage dominant, effet densifiant,
cadastre/rôle, immo-lots) sur **1106 municipalités**. Données servies via API OGC
depuis S3 (`normalized/…`). Node/TS uniquement.

## ⭐ Principe fondateur — REPRODUCTIBLE et CAPITALISÉ

> **Rien ne doit exister uniquement sur une machine. Toute logique se capitalise
> dans la lib, toute donnée captée se dépose sur le stockage objet.**

C'est la raison d'être de `@sentropic/geo`. Elle a été perdue de vue : le
2026-07-25, la mise sous CI a montré que du code (`lib/xlsx.ts`), des registres
de preuve (`proof-legacy-515-*`, `proof-orphan-356-*`) et toute la **capture**
(octets fetchés, URL appelées, logs de fetch) n'existaient que localement — donc
irreproductibles, non auditables, perdus au premier crash. Le KPI « preuve v2
exacte » est à **0/1106** pour cette seule raison : on ne peut pas prouver après
coup ce qu'on n'a pas conservé au moment du fetch.

Concrètement, avant de considérer un travail comme fait :

- **Rejouable sur un checkout propre.** Si un script a besoin d'un fichier, ce
  fichier est committé ou lu depuis S3 via un URI documenté. Un `ENOENT` en CI
  est un défaut de capitalisation, pas un incident de test.
- **La logique va dans `packages/` (lib), pas dans un script jetable.** Un
  `acquisition/src/_*.ts` est une sonde de diagnostic, jamais le lieu d'une règle
  métier. Ce qui sert deux fois se promeut dans la lib, avec un test.
- **La capture est de la donnée de production.** Le scraping tourne sur le
  cluster ; les octets bruts, le manifeste de fetch (`url`, `retrieved_at`,
  `sha256`, statut HTTP) et les logs vont sur le stockage objet. Les agents
  locaux ANALYSENT en lecture seule ; ils ne captent pas.
  Voir `docs/spec/SPEC_CAPTURE_ON_CLUSTER.md`.
- **Preuve par construction.** Le manifeste de capture EST la preuve v2 exigée
  par `putServedZoneGeojson`. Une preuve qu'on ne peut pas rattacher à une
  capture est déclarative, donc sans valeur.
- **Vert par omission = rouge.** Un typecheck ou un test qui passe parce qu'il ne
  regarde pas (workspace sauté, fichier exclu, `@ts-ignore`, fixture local
  absent) ne prouve rien. On corrige la cause, on n'élargit pas l'angle mort.

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
