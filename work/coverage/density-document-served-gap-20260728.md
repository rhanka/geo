# Écart documents de densité → objets servis

Mesure S3 reproductible: 2026-07-28T08:46:19.254Z. Univers fermé: les rapports d'ingest déjà enregistrés; aucune nouvelle recherche documentaire.

- Documents initialement marqués `publishable`: **25**
- Documents revus dans l'univers fermé: **35**
- Documents directement sélectionnés comme source servie: **18**
- Écart initial: **7 documents**, dans **2 collections**
- Écart après reclassement prouvé: **0 document**

## Liste exacte de l'écart initial

| Lot | Collection | Document | Date légale | Normes relues | Directes | Identiques à la référence plus récente |
|---|---|---|---:|---:|---:|---:|
| control-3 | champlain | `champlain-file-18292` — https://www.municipalite.champlain.qc.ca/file-18292 | 2018-08-06 | 47 | 0 | 47 |
| control-3 | champlain | `champlain-wayback-original-2009` — https://web.archive.org/web/20240112104603id_/http://www.municipalite.champlain.qc.ca/Document/CH_R%C3%A8glement%20Zonage.pdf | 2009-04-06 | 47 | 0 | 47 |
| control-3 | champlain | `champlain-wayback-modification-2014` — https://web.archive.org/web/20240112104031id_/http://www.municipalite.champlain.qc.ca/Document/modification%20r%C3%A8glement%20de%20zonage%20du%2019%20juin%202014.pdf | 2014-06-19 | 2 | 0 | 2 |
| remaining-4 | champlain | `champlain-wayback-reglement-2017-02` — https://web.archive.org/web/20240112103854id_/http://www.municipalite.champlain.qc.ca/Document/R%C3%88GLEMENT%202017-02%20MODIFIANT%20LE%20R%C3%88GLEMENT%20DE%20ZONAGE%202009-03.pdf | 2017-05-01 | 47 | 0 | 47 |
| remaining-4 | champlain | `champlain-file-18291` — https://www.municipalite.champlain.qc.ca/file-18291 | 2018-07-09 | 47 | 0 | 47 |
| remaining-4 | chesterville | `chesterville-agricole-codification-2017` — https://www.chesterville.net/fichiersUpload/fichiers/20220217141337-annexe-b-grilles-agricole-codification-2017.pdf | 2017 | 24 | 0 | 24 |
| remaining-4 | chesterville | `chesterville-residentiel-autres-2017` — https://www.chesterville.net/fichiersUpload/fichiers/20220217141450-annexe-b-grilles-residentiel-autres-2017.pdf | 2017 | 9 | 0 | 9 |

Ces documents sont tous antérieurs et leurs lectures sont des sous-ensembles exacts des références municipales plus récentes. Ils sont donc `corroboration-only`; ils ne deviennent jamais l'état de référence servi.

## Mesure des objets S3 effectivement servis

| Collection | Polygones portant une densité finie, sourcée et jointe |
|---|---:|
| champlain | 47 |
| chesterville | 33 |
| clermont--charlevoix-est | 32 |
| drummondville | 2 |
| mont-laurier | 1 |
| mont-tremblant | 218 |
| saint-dominique | 50 |
| saint-jerome | 13 |
| stoneham-et-tewkesbury | 1 |
| varennes | 125 |
| **Total** | **522** |

La comparaison des mesures S3 contrôle/finale trouve **0 collection** et **0 polygone** supplémentaires.
Une paire `undefined`/`null` n'est jamais comptée comme densité ni comme changement.

## Lectures non pliées

- `champlain` / `215`: code absent du SIG servi; aucun raccord inventé.
- `clermont--charlevoix-est` / `147.1-Hb`: code absent du SIG servi; aucun raccord inventé.
- `mont-tremblant` / `CA-466-1`: code absent du SIG servi; aucun raccord inventé.
- `saint-jerome` / `MMFD-757`: code absent du SIG servi; aucun raccord inventé.
- `saint-jerome` / `MMFD-766`: code absent du SIG servi; aucun raccord inventé.
- `saint-jerome` / `MMFD-784`: code absent du SIG servi; aucun raccord inventé.
