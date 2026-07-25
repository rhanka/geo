# Zones recalage 3 — 2026-07-09T18:30Z

Shard: **3/4** (`index % 4 == 2`). Mission : servir de VRAIS zonages municipaux par recalage géoréférencé de plans PDF officiels (pas d'AGOL owner harvest, épuisé). Conducteur = agent principal ; découverte + recalage délégués à 4 sous-agents parallèles (3 slugs chacun) ; reconcile + commit centralisés.

## Sélection (script committé `acquisition/src/shard-zone-candidates.ts`)

- Shard 3/4 : 276 munis → **68 zones non-done**, dont **66 bucket-PDF** (`pdf-georef-t1/vectorize-t2/raster-t3/scan-t4/discovery-required`).
- Écartés d'emblée (recherche négative antérieure dans la matrice) : roxton, saint-justin, saint-samuel, la-tuque, saint-jean-port-joli (`PLAN_INTROUVABLE` / `plan-plat-non-georef`).
- 12 slugs attaqués, répartis en 4 lots (A/B/C/D).

## Résultat net : **1 dépôt réel** (priorité mission tenue)

| slug | lot | source plan | méthode | verdict | preuve chiffrée |
|---|---|---|---|---|---|
| **riviere-beaudette** | A | `riviere-beaudette.com/.../Zonage_Riviere-Beaudetteversion2016.pdf` (A1 vecteur, labels texte) | T1 abort (0 géoréf) → **T2 auto-seed affine + aniso-arbitrate** | **DÉPOSÉ ✅** | 26 GCP sur coins de lots réels, résidu **11.05 m** / holdout **12.73 m**, serving **100 %**, **33 codes lettrés** (Ra-101, Ag-107, Cm-108, Pu-201…), 31 features ; inline lot-zone-join 1848 lots/100 %, lots-enriched deposit=Y ; **S3 PRÉSENT** |
| saint-telesphore | A | Carte Annexe 1 (2009, vecteur) | T2 auto-seed affine + similarity | ABORT (gate) | best 40 GCP résidu 14.01/holdout 9.12 mais **serving 78.65 % < 85 %** → aniso NON confirmée (labels = numéros de lots, pas codes) ; similarity 0 appariement |
| sainte-justine-de-newton | A | règlement 414 texte (275 p) | T1 | INTROUVABLE | pas de planche carto vecteur ; 0 géoréf |
| lac-superieur | B | Annexe A vecteur (codes AG/CM/RE/VA) | T2 auto-seed | ABORT | **cadastre S3 = 66 lots** (coin de village) vs plan pleine muni → 0–2 GCP après pruning (<6) |
| montpellier | B | 2 plans VPlus (villageois + rural) | T2 auto-seed | ABORT | plans **raster** : SVG rend 315 / 853 pts, pas de coins de parcelle → 5 / 0 GCP ; relève de T3 raster |
| boileau | B | — | — | INTROUVABLE | SPA VPlus mort ; bylaw Wayback tronqué 1 MiB ; seul plan d'urbanisme (affectations, rejeté) |
| yamachiche | C | — | — | INTROUVABLE | `/cartes/` = fonds de plan (toponymes routiers, 0 code) ; zonage en mairie seulement |
| sainte-elisabeth | C | `plan-de-zonage.pdf` (Bentley Map, codes RA/RF/RC/AA) | T2 auto-seed | ABORT | **plan sans linework cadastral** : svg=15023 pts (zones/routes) vs 1119 parcelles → max 1 appariement (<6) |
| saint-elie-de-caxton | C | Règl. 2010-012 plan périmètre urbain | T2 auto-seed | ABORT | idem : svg=4702 vs 2368 parcelles, 0 coin de lot appariable ; feuillet hors-périmètre = scan raster |
| saint-casimir | D | zonage **SHP** MTM NAD83 z8 + DWG + web-GIS | T1 | ABORT/INTROUVABLE (PDF) | **aucun PDF carto** ; seul PDF = règlement texte 345 p (0 géoréf) |
| hebertville | D | règlement 364-2004 texte (229 p) | T1 | INTROUVABLE | règlement texte seul ; MRC LSJE = cartes d'affectation (rejetées) |
| saint-gedeon | D | règlement 2018-464 texte (327 p) | T1 | INTROUVABLE | idem ; portail vplus SPA sans PDF carto |

Bilan : **1 DÉPOSÉ · 5 ABORT-gate · 6 INTROUVABLE**.

## Causes racines (cohérent §10 « plafond du lever »)

Le résidu de ce shard est une **absence d'entrée**, pas un échec de méthode :
1. **Règlement texte seul** (pas de planche carto) : sainte-justine-de-newton, saint-casimir, hebertville, saint-gedeon.
2. **Plan vecteur sans trame cadastrale** (dessine zones/routes/hydro, aucun coin de lot appariable) : sainte-elisabeth, saint-elie-de-caxton.
3. **Plan raster** (image placée, pas de vecteur) : montpellier.
4. **Cadastre S3 trop épars** vs plan pleine muni : lac-superieur (66 lots).
5. **Anisotropie non confirmée par la couverture-lots** (labels = n° de lots) : saint-telesphore.
6. **Aucun plan carto récupérable** : boileau, yamachiche.

## Anti-invention

Aucun `zone_code` fabriqué, aucun gate contourné, aucun fichier de sortie bricolé. Les 11 non-dépôts sont adossés à l'exit-code du code committé (T1 exit 2 « no /VP /Measure /GEO », T2 pruning < min-gcps, aniso-arbitrate SKIP < 85 %). Le seul dépôt (riviere-beaudette) sert 33 codes lettrés verbatim sur coins de lots cadastraux réels, vérifié indépendamment `zones-s3-check` → PRÉSENT et `coverage-reconcile` → zones **773 → 779** (dont +1 riviere-beaudette imputable à ce shard).

## Pistes conducteur (hors-scope PDF de cette mission)

- **saint-casimir** : zonage officiel publié en **SHP MTM NAD83 z8** (`cartographie.portneuf.com`) + DWG → **voie SIG-vecteur** (supérieure au PDF, §10). À router vers la lane SIG.
- **montpellier** : plans raster valides → **T3 raster-register** avec seed manuel (hors time-box 6 min).
- **lac-superieur** : **lacune de couverture cadastre S3** (66 lots) — à combler avant tout recalage.

## Artefacts

- Dépôt gagnant : `work/gcp/riviere-beaudette.gcp.json` (26 GCP `independent:true`) + `work/gcp/riviere-beaudette.report.json`.
- Preuves d'échec (utiles) : `work/gcp/saint-telesphore.report.json`, `work/gcp/lac-superieur.autogcp.report.json`, `work/gcp/montpellier.autogcp.report.json`, `work/gcp/montpellier-rural.autogcp.report.json`.
- Sélection : `acquisition/src/shard-zone-candidates.ts`.
- Livrables par lot : `zones-recalage-3-20260709T1830Z-{A,B,C,D}.json` (ce dossier).
- Plans PDF téléchargés : `work/zonage-plans/*.pdf` (gitignorés `*.pdf`, non committés — jetables/volumineux).
