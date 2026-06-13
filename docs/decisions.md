# Decision log (ADR) — @sentropic/geo

Décisions prises **en autonomie** par le conductor (`claude:geo`, Opus 4.8) en mode `/loop`,
chacune validée par **double consensus** de deux conseillers Opus-4.8 indépendants quand elle
est structurante. Elles sont **révisables** : ce journal existe pour la revue a posteriori.

Format : `ADR-NNNN — titre · statut · date`. Statut ∈ {accepted, superseded, revisit}.

---

## ADR-0001 — Track & gouvernance en fichiers versionnés · accepted · 2026-06-13

**Contexte.** Le serveur MCP `track` (système de backlog) est indisponible dans cette session.
**Décision.** Tenir le backlog, le registre de licences et ce journal de décisions comme fichiers
versionnés du repo (`docs/backlog.md`, `licenses/registry.json` + `docs/licenses.md`,
`docs/decisions.md`). Durable, public, révisable, et indépendant de la disponibilité MCP.
**Conséquence.** Si `track` revient, on pourra y rejouer le backlog ; la source de vérité reste git.

## ADR-0002 — Taxonomie des packages (juridiction + discriminant `kind`) · accepted · 2026-06-13

**Consensus 4.8** (advisors `abba56cff14084549` #1 / `a22cd3980c7047848` #2).
- **Accord** : un package par juridiction ISO-3166 (`geo-source-ca-qc`, `geo-source-ca`,
  `geo-source-fr`…) ; pas de dépendance code parent↔enfant (tous ne dépendent que de `geo-core`) ;
  un package « province » détient les sources dont la province est l'éditeur autoritatif (Québec →
  Données Québec), un package « pays » détient les sources fédérales.
- **Désaccord arbitré** : stat/postal en packages séparés (#1) vs datasets internes taggés (#2).
  **Arbitrage conductor (hybride)** : (a) on ajoute un discriminant `kind: "administrative" |
  "statistical" | "postal"` au `SourceManifest` de `geo-core` (idée #2, fait) ; (b) on crée des
  packages frères `geo-source-<cc>-stat` / `geo-source-<cc>-postal` **seulement au moment de les
  implémenter** (idée #1), justifié par des licences/cadences très différentes (PCCF, La Poste…).
  D'ici là : YAGNI, tout vit dans le package juridiction taggé par `kind`.
- Lib de crosswalk postal↔admin (`geo-referential`) **différée** jusqu'à ≥2 pays.

## ADR-0003 — Registre de licences dérivé, anti-dérive · accepted · 2026-06-13

**Consensus 4.8** (les deux advisors). Source de vérité machine `licenses/registry.json`
(committé) ; vue humaine `docs/licenses.md` **générée** (CLI `geo licenses build`). Les champs
`redistributable` / `attributionRequired` / `shareAlike` sont **dérivés** de `geo-core.LICENSES`
via `resolveLicense(licenseId)` — jamais saisis à la main — pour que la **gate d'acquisition** et
le registre ne divergent jamais. La CI échoue si une entrée dérive de `LICENSES`.

## ADR-0004 — Modèle freshness & re-scrape · accepted · 2026-06-13

**Consensus 4.8.** `.meta.json.fetchedAt` = **fait** de dernière acquisition (ne pas le surcharger).
Ledger séparé `data/requests/<source>__<dataset>.json` = **politique** :
`{ requestedBy, requestedAt, manifestRef, lastFetchedAt, checksum, updateCadence, status }`.
Une demande immo crée/maj une entrée ; `geo refresh [--stale]` compare `now - lastFetchedAt` à
`updateCadence` (déjà sur `DatasetManifest`) et rejoue `acquire`. Un cron CI l'automatisera ensuite.

## ADR-0005 — Layout des données normalisées + FileProvider récursif · accepted · 2026-06-13

**Bug détecté par les deux advisors** : `writeNormalized` écrit
`data/normalized/<sourceSlug>/<datasetId>.geojson` (imbriqué) mais `FileProvider` scannait à plat.
**Décision.** On garde le layout imbriqué (namespacing par source, évite les collisions à l'échelle
mondiale) ; **`FileProvider` doit scanner récursivement** `data/normalized/**/*.geojson` + `.meta.json`.
**Id de collection OGC = `datasetId` globalement unique** : les sources préfixent par juridiction
(ex. `qc-municipalites`, `qc-regions`) pour rester uniques dans l'arbre mondial. Corrige le slice P0.

## ADR-0006 — P0 = municipalités du Québec (SDA, CC-BY 4.0) · accepted · 2026-06-13

**Consensus 4.8.** Première verticale réelle : Données Québec « Découpages administratifs (SDA) »,
provider MERN/MRNF, **CC-BY 4.0 (redistribuable, attribution requise)**, via le service ArcGIS REST
`SDA_WMS/MapServer`, couche municipalités, `outSR=4326&f=geojson`. Flux :
`acquire → writeNormalized → FileProvider → geo-api (/collections/qc-municipalites) → apps/site`.
Risques pinés : dérive d'index de couche ArcGIS (pin `layer` + assert des champs), CRS source
(forcer WGS84 via `outSR=4326`), licences postales restrictives (gate → non redistribuable).

## Méthode de décision

Décisions structurantes : 2 conseillers Opus-4.8 indépendants (lecture seule) → le conductor
verrouille les accords, arbitre les désaccords et consigne l'arbitrage ici avec les `agentId` pour
audit. Décisions mineures : prises directement et consignées si elles engagent l'architecture.
