# Dépôt v2 vecteur natif — record (2026-08-03)

Dépositeur `acquisition/src/zones-vecteur-natif-deposit-run.ts` (option B : octets ATTESTÉS
du CAS, vérifiés octet-pour-octet vs sha, `depositCapturedZones`). Manifeste attesté qa
`63a2bb7f` (7/7 PASS-banc). Preuve v2 = url+retrieved_at+sha256 du manifeste attesté.

## 6 DÉPOSÉS → `zone_source_level=documented`

| slug | features | AVANT level | APRÈS level | clé servie | source |
|---|---:|---|---|---|---|
| saint-charles-sur-richelieu | 63→64 | orphan | documented | nested | gonet |
| saint-dominique | 62 | legacy-traceable | documented | flat | gonet |
| saint-michel | 62 | (net-new) | documented | flat | gonet |
| saint-patrice-de-sherrington | 45 | (net-new) | documented | flat | gonet |
| saint-pie | 136 | legacy-traceable | documented | flat | gonet |
| contrecoeur | 164 | orphan | documented | nested | arcgis (qa PASS 0dcb5482) |

Chaque dépôt : backup `_replaced/`, gate identité+couverture OK, re-fold enrichment
(reglement/norms/usage_dominant/geometry-status/effet-densifiant), re-stamp `zone_source_url`
en dernier, readback APRÈS = documented confirmé.

## 2 BLOQUÉS — gate anti-régression (identité) — NE PAS forcer

| slug | capture | servi (orphan) | codes servis absents de la capture |
|---|---:|---:|---|
| saint-bernard-de-michaudville | 39 | 81 feat | 511, 512, C… (4) |
| saint-jude | 43 | 81 feat | 109, 110, 303, A301, A302, A303… (14) |

Le gate `depositCapturedZones` refuse de déposer une couche amont qui NE COUVRE PAS des
codes déjà servis (anti-perte de couverture). Le servi (81 feat, niveau **orphan** = sans
preuve) porte des codes absents de ma capture GOnet (39/43 zones). Deux hypothèses à trancher
AVANT dépôt : (a) ma capture GOnet est **incomplète** (couche/pagination partielle) ; (b) le
servi orphan est un **superset/Voronoï** contaminé (cf `zones-servies-sont-un-voronoi`) que la
capture propre devrait remplacer. Tant que non tranché : held, pas de dépôt forcé.

## Suite
- Ping lane lot : re-fold lots sur les 5 déposés (`rectifier-zone-exige-refold-lots`).
- Ping qa : attester `lot_zone_mismatch<5` (col 2) après fold ; déclencher la re-mesure
  matrice zones depuis S3 (col 1 figée 07-23 sinon invisible).
- bernard/jude : investiguer la complétude de capture GOnet vs servi orphan.

Note technique : le stdout du dépositeur est pollué par le stdout des folds enrichment
(sous-process) — le record fait foi via stderr ; à assainir (rediriger le stdout des folds).

## Lot `recalage/v2` — rapport A

Manifeste direct : `zones-vecteur-natif-manifest-a-20260803.json`.

| slug | verdict | features | champ zone | attribution | identité | capture |
|---|---|---:|---|---:|---|---|
| ayers-cliff | DÉPOSÉ | 45 | `Zonage` | 0,34 km | ayers-cliff | `zones-20260728T040436Z-1-d515695c-3bf7-4e63-aead-2e4c39afb03b` |
| boisbriand | DÉPOSÉ | 302 | `ZONAGEMUNICIPALID` | 0,82 km | boisbriand | `zones-20260728T040436Z-1-d515695c-3bf7-4e63-aead-2e4c39afb03b` |
