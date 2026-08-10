# Palier 20×167 — passe S3 live du 2026-08-10

## Contrat

Cette passe ne crédite aucune donnée déclarée. Les lecteurs S3 sont tous en
lecture seule avec :

```sh
NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10
```

Le pivot final est `scripts/palier-matrix-report.mjs`, après fermeture des
sources qui le permettent. Il est validé avec `--check`.

## Lectures fraîches réellement closes

| Source / colonnes | Commande et résultat vérifié |
|---|---|
| Couverture réconciliée (source des matrices Immo) | `npx tsx acquisition/src/coverage-reconcile.ts` contre S3 : premier scan **pv=1 064 (+7), normes=815 (+175), zones=911 (+94), cadastre=1 106 (+0), role-foncier=1 106 (+0), tod=39 (+0)** ; les scans suivants sont stables à +0. Le snapshot retenu est explicitement horodaté **`generatedAt=2026-08-10T02:05:34.501Z`**. |
| Cohérence lot-zone (2) | `npx tsx acquisition/src/lot-zone-consistency-audit.ts --scale --max-seconds 600 --out work/coverage/lot-zone-consistency-scale-20260810.json` (reprises du checkpoint) : **866/866** villes auditables, 718 sous 5 %, 123 à 5 % ou plus. Aucun changement de cellule dans la cohorte. |
| Provenance zones (8–10) | `npx tsx acquisition/src/zone-provenance-quality-run.ts --date=20260810 --batch=100 --concurrency=16` : 873 collections servies, 0 lecture illisible. La matrice retenue est `zone-provenance-quality-matrix-20260810T013417Z-ad1126284740439d.json` ; ses statuts de cohorte sont inchangés. Les manifests sont passés de 1 316 (snapshot précédent) à 1 332, sans promotion de statut. |
| URL source servie (11) | `npx tsx acquisition/src/_zone-source-readback-audit.ts --slugs <167-slugs> --date=20260810 --concurrency 16` : **47 STAMPED, 62 STAMPED_NULL, 1 UNSTAMPED, 57 sans collection servie**. Les 57 sont des clés réellement absentes, pas des verts supposés. |
| Assignation Immo (12) | `npx tsx acquisition/src/immo-lot-zone-assignment-matrix.ts --date 20260810 --max-seconds 55` puis `--resume` : partition 1 106 fermée, 347 complete / 543 incomplete / 210 unknown / 6 N/A. Dans la cohorte : **24 / 93 / 46**, identique au précédent palier. |
| Normes pliées Immo (13) | `npx tsx acquisition/src/immo-folded-normes-city-matrix.ts --date 20260810 --max-seconds 55` : 52 complete / 815 incomplete / 233 unknown / 6 N/A. Dans la cohorte : **4 / 109 / 50**, identique. |
| PV captés (4) | `npx tsx acquisition/src/pv-couverture-municipale.ts --out=... --markdown=...` contre les captures capitalisées dans le checkout courant : **640/1 106** municipalités, dont **102/163** complètes dans le palier. Cette réagrégation est plus stricte que l'artefact du 8 août (125/163) : aucune sortie n'est masquée. |

## Limites explicites du pivot

- Les colonnes 1 et 3 restent reliées aux manifestes locaux de 2026-07-23.
  Leur générateur existant fige lui-même ce reportDate et la chaîne documentée
  ne possède pas le générateur S3 du maillon de corroboration. La couverture
  20260810 n'est donc pas utilisée pour les présenter comme fraîches ; une
  collection servie sans ce maillon reste `unknown`.
- Les colonnes 5–7 restent reliées à
  `completion-regdens-percity-20260808.json`. La preuve règlement fraîche
  n'est pas convertie automatiquement en artefact per-city compatible : elle
  ne peut donc pas être promue par inférence dans ce palier.

## Résultat du pivot validé

Après le scan de couverture S3 retenu et la régénération de la matrice Immo
dépendante, `node scripts/palier-matrix-report.mjs --date=20260810` puis
`--check` :

- Résolu total (`complete` ou `N-A` prouvé, dénominateurs par KPI) :
  **1 656/3 284 (50,426 %) → 1 642/3 284 (50,000 %)**, soit **−14**.
- Colonne 4 : 125 complete / 36 incomplete / 2 unknown →
  **102 / 59 / 2** (réagrégation PV stricte, −23 complete).
- Colonne 11 : 38 / 71 / 54 → **47 / 61 / 55** (+9 complete). Le
  read-back S3 est stable par rapport aux artefacts de cohortes suffixés du
  8–9 août ; le palier précédent résolvait toutefois le dernier nom strict
  `zone-source-readback-audit-20260802.json`.
- Colonnes 2, 8–10, 12 et 13 : aucun changement de cellule cohorte. En
  particulier, les 37 dépôts REAL-GAIN déjà vérifiés n'ajoutent aucune ville
  complète aux colonnes 12 ou 13 dans cette passe.

Le re-scan 20260810 modifie bien la couverture source, mais ne produit aucune
cellule palier supplémentaire après la première passe fraîche : le résultat
final reste **1 642/3 284 (50,000 %)**, avec col. 12 **24 / 93 / 46** et col. 13
**4 / 109 / 50** (complete / incomplete / unknown).

La baisse nette est donc un fait de mesure actuel, pas une absence de travail :
les captures partielles ou les preuves non projetées per-city ne ferment pas
automatiquement une ville.
