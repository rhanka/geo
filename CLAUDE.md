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
- **La capture est de la donnée de production. JAMAIS DE CAPTURE LOCALE.** Le
  scraping tourne sur le **cluster** et écrit **directement sur S3** les octets
  bruts, le manifeste de fetch (`url`, `retrieved_at`, `sha256`, statut HTTP) et
  les logs. Les agents locaux ANALYSENT en lecture seule ; **ils ne captent
  jamais**. Une capture qui atterrit sur une machine est un défaut, pas un
  livrable — elle **n'existe pas** tant qu'elle n'est pas sur S3.
  Voir `docs/spec/SPEC_CAPTURE_ON_CLUSTER.md`.
- **Preuve par construction.** Le manifeste de capture EST la preuve v2 exigée
  par `putServedZoneGeojson`. Une preuve qu'on ne peut pas rattacher à une
  capture est déclarative, donc sans valeur.
- **Vert par omission = rouge.** Un typecheck ou un test qui passe parce qu'il ne
  regarde pas (workspace sauté, fichier exclu, `@ts-ignore`, fixture local
  absent) ne prouve rien. On corrige la cause, on n'élargit pas l'angle mort.

## ⭐ Principe fondateur — CONVERGENCE CONTINUE sur origin/main

> **Jamais de divergence `origin/main`. Aucun travail n'est « fait » tant qu'il
> n'est pas mergé sur `origin/main`. Jamais plus de 2 PR ouvertes vers `main`.**

- **Chaque job va jusqu'au merge.** Tout job (lane, worker, conducteur) ouvre une
  PR et la conduit **jusqu'au merge sur `origin/main`** — pas de branche qui
  s'accumule, pas de « terminé » sur une branche locale. Un livrable non mergé
  n'est **pas** livré. C'est le pendant du principe S3 : rien ne reste local, ni
  la donnée (→ S3), ni le code (→ `origin/main`).
- **Maximum 2 PR ouvertes vers `main` à la fois** (hors dependabot). Au-delà, on
  **merge ou ferme** avant d'en ouvrir une nouvelle. Cible permanente : **0 PR en
  attente** ; la divergence `origin/main ↔ branche` reste proche de 0.
- **Garde CI committée** : `.github/workflows/max-open-prs.yml` échoue si > 2 PR
  non-dependabot sont ouvertes vers `main`. La règle est **gravée dans le repo**,
  pas seulement dans les têtes.

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

## Moteur d'extraction — `mistral-medium-latest` BANNI (ADR-0024)

> **`mistral-medium-latest` (vision-chat Mistral) est BANNI. Il n'a jamais fonctionné
> et a causé une facture Mistral.ai de 480 € (319 munis en `mistral-vision`). Le SEUL
> usage Mistral sanctionné est l'OCR `/v1/ocr` (`mistral-ocr-latest`).**

- **Aucun code ne résout un modèle vision-chat Mistral** (`mistral-medium-*`, `pixtral-*`).
  Garde gravée : `packages/qc-sources/src/sources/vision-engine-policy.ts`
  (`assertVisionModelAllowed`), appelée par les 3 constructeurs vision ; test/CI
  `vision-engine-policy.test.ts` **échoue** si le ban est contourné. Le défaut a été
  **supprimé** : un modèle vision doit être **explicite et sanctionné**.
- **La route vision est inopérante (échec dur) tant que le remplaçant n'est pas ratifié.**
  Remplaçant = modèle vision fort derrière la gateway (a priori `gpt-5.6-terra`/`luna` xhigh,
  prompt JSON strict par cellule + gardes anti-décalage conservés), choisi par **double-consensus**
  (benchmark sur grilles déjà extraites, sans re-payer Mistral) + **ratification geo-archi**.
  `voxtral-*` (audio) et `/v1/ocr` (OCR) ne sont pas concernés. Voir `docs/decisions.md` ADR-0024.

## Opérationnel

- **Runs S3** : préfixer `NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.
  Un `AggregateError [ETIMEDOUT]` est un bug happy-eyeballs (IPv6), **pas** une panne
  réseau — ne pas brider les runs sur ce signal.
- **Scripts committés** uniquement (pas de bash ad-hoc). **Commits par pathspec**
  (arbre de travail partagé). Branche de travail : `feat/cadre-acquisition`.
- **Jamais de commande bloquante.** Pas de `while true; do sleep N; …; done`, pas
  de `until … sleep`, pas de polling qui occupe le shell en attendant un run. Un
  traitement long se lance en tâche de fond suivie (le harness notifie à la fin,
  il n'y a rien à surveiller), ou se découpe en lots courts qui écrivent leur
  avancement au fil de l'eau et reprennent proprement après interruption.
