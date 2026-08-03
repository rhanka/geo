# Pilote capture vecteur natif GOnet — consolidé (10 villes)

Worker `h2a-zones-gonet-capture` (luna xhigh), mode **capture+gate SANS dépôt servi**
(`deposit:false`). Runner : `acquisition/src/zones-obscura-run.ts` (enrichi, committé `3c0c2156`).
Lots committés : pilote `3c0c2156`, lot1 `56c32025`, lot2 `3908d8dd`, lot3 `5d9a9f66`, lot4 `9e0a6291`.

## Verdicts (10/10)

| slug | verdict | features | codes | lettrés | champ | nearest muni | km |
|---|---|---:|---:|---:|---|---|---:|
| saint-bernard-de-michaudville | PASS_CAPTURE | 39 | 37 | 100% | — | self | 0.34 |
| saint-charles-sur-richelieu | PASS_CAPTURE | 64 | 62 | 100% | No_zone | self | 0.07 |
| saint-dominique | PASS_CAPTURE | 62 | 62 | 100% | Num_zone | self | 0.84 |
| saint-michel | PASS_CAPTURE | 62 | 62 | 100% | — | self | 0.37 |
| saint-patrice-de-sherrington | PASS_CAPTURE | 45 | 33 | 100% | — | self | 1.02 |
| saint-pie | REJECT_LETTERED_LT50 | 136 | 106 | 11.8% | — | self | 1.72 |
| saint-barnabe-sud | REJECT_LETTERED_LT50 | 26 | 26 | 26.9% | — | self | 0.90 |
| saint-jude | REJECT_LETTERED_LT50 | 43 | 43 | 30.2% | — | self | 0.64 |
| saint-paul | NO_VECTOR | 0 | 0 | — | — | — | — |
| saint-edouard | NO_VECTOR | 0 | 0 | — | — | — | — |

**PASS=5, REJECT=3, NO_VECTOR=2.**

## Pipeline validé

Les 5 PASS portent une provenance **v2 par construction** : `source_url_reelle` = un
`/query?...f=geojson` réel (features, pas une page HTML — cf. `capture-arcgis-page-html`),
`retrieved_at`, `sha256_octets`, champ ∈ taxonomie zone (`No_zone`/`Num_zone`), attribution
registre <1.1 km. C'est exactement le triplet exigé par `putServedZoneGeojson`.

## Deux décisions requises AVANT dépôt / avant de scaler arcgis-12

### D1 — Gate qa du vecteur natif (non défini)
Le garant `scripts/recalage-attestation.mjs` (`e7657bb8`) est **raster** (residual/aniso/orient/shear)
et vit sur la branche qa, absent de lane/zones. Pour du **vecteur natif il n'y a pas de recalage**,
donc pas de résidu à attester : la preuve est le manifeste de capture, la qualité est le gate
anti-invention (déjà passé) + le lot-zone mismatch <5% (post-fold, lane lot). **Question à qa/geo-cond :
quel est le gate d'attestation pour un dépôt v2 vecteur-natif ?** Sans réponse, je ne dépose pas
(règle « aucun dépôt sans qa PASS-banc » + anti effet-fabriqué).

### D2 — Faux-rejet du zonage NUMÉRIQUE (gate `lettered≥50%`)
Le gate `codeLikeRatio<0.5` est **value-based** (agnostique du nom de champ). saint-pie/barnabe/jude
ont la **même structure** que les PASS (1 polygone/zone, cardinalité zonage-scale) mais des codes
majoritairement numériques → rejetés. Or ~1/3 des munis QC ont des codes zone **légitimement
numériques** (`usage-dominant-sig-prefix-gate`). Discriminant correct = **autorité du NOM de champ**
(`No_zone`/`Num_zone`/…) + cardinalité ≤~300 : quand le champ est un champ-zone et la cardinalité
est zonage-scale, les valeurs numériques sont du zonage, pas du cadastre → le gate lettered doit être
**bypassé**. Correction de runner + test requis avant de scaler (sinon même faux-rejet sur arcgis-12).

## NO_VECTOR (2)
saint-paul, saint-edouard : couche zonage GOnet non localisée par le field-picker. Découverte plus
profonde (énumération MapServer) requise avant tout verdict N-A.

## Suite
- HOLD arcgis-12 jusqu'à D2 (éviter de propager le faux-rejet numérique).
- 5 PASS en attente de D1 pour dépôt v2 + ping lane lot (re-fold).
