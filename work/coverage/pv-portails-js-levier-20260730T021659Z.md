# Levier PV — portails JS

Mesure seule; aucune campagne, aucune capture ou écriture sous `raw/`,
`capture/_runs/` ou `normalized/`. La source est l’enquête fermée de 30 sur 222.

## Existant

Le dépôt a déjà : GoNet/GoAzimut statique ([`pv-gonet-run.ts:1`](../../acquisition/src/pv-gonet-run.ts#L1)),
VPlus API ([`pv-vplus-run.ts:1`](../../acquisition/src/pv-vplus-run.ts#L1)), Wix RSS/JSON
([`pv-wix-run.ts:1`](../../acquisition/src/pv-wix-run.ts#L1)), WordPress media
([`pv-wp-media-run.ts:1`](../../acquisition/src/pv-wp-media-run.ts#L1)), livehost/sitemap
([`pv-livehost-run.ts:1`](../../acquisition/src/pv-livehost-run.ts#L1)), rendu Chromium/CDP passif
([`pv-obscura-run.ts:1`](../../acquisition/src/pv-obscura-run.ts#L1)) et ingestion d’un DOM Playwright
interagi ([`pv-dom-deposit.ts:1`](../../acquisition/src/pv-dom-deposit.ts#L1)). Le parseur route déjà
gestionweblex et ASP.NET vers un navigateur ([`proces-verbaux-parser.ts:508`](../../packages/qc-sources/src/sources/proces-verbaux-parser.ts#L508)).

## Confrontation

Les 18 cas `b` sont tous des HTML 200 : 17 ont une page PV HTML suivie, Saint-Sulpice est
script-heavy. Les familles prouvées par une URL committée sont WordPress (Gaspé, Murdochville,
Thurso) et Drupal (Saint-Clet), soit 4; Maskinongé et Saint-Joseph-des-Érables sont seulement
Joomla-like, Notre-Dame-du-Mont-Carmel seulement Wix-like, et 11 éditeurs ne sont pas
identifiables sans le DOM non conservé. Le CDP existant est donc admissible aux **18/18**;
**0/18** n’exige un nouvel adaptateur d’éditeur avant ce premier test, mais **0/18** succès
d’extraction n’a été mesuré ici.

## Levier et décision

Extrapolation descriptive, `n=30` : le levier incrémental portail est `18/30 × 222 = 133,2`
municipalités attendues; `a+b+c` donne `23/30 × 222 = 170,2`, dont `37,0` déjà directes. Elle
devient fausse si les 222 diffèrent par MRC, taille, éditeur, WAF ou interactivité. Le plus petit
incrément est une variante PV-CDP capturée, pas un adaptateur par éditeur : l’image actuelle est
HTTP-only ([`Dockerfile:3`](../../deploy/capture-job/Dockerfile#L3)); le coût connu est Chromium/Tor,
**≥1 GiB** et **un seul pod** ([`SPEC_CAPTURE_ON_CLUSTER.md:463`](../../docs/spec/SPEC_CAPTURE_ON_CLUSTER.md#L463)).

Le JSON voisin porte les 18 noms, les niveaux de certitude et les références complètes.
