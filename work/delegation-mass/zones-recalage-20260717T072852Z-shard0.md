# Recalage PDF zones — shard 0/1 — 2026-07-17T07:28:52Z

Lot de 8 slugs `zones.status != done` au début du lot. Tous relèvent d'une piste PDF de la matrice; aucun harvest AGOL n'a été effectué.

## Déposé

| Slug | Voie | Preuves de gate | Suite immo |
|---|---|---|---|
| `oka` | T1 GeoPDF texte | `NAD_1983_MTM_8`, résidu 0,129 m, 116 codes réglementaires distincts, 105/116 labels dans la bbox cadastrale, écart spatial 1,762 km, 1 910/1 913 lots (99,84 %) | `lot-zone-join-run` puis `lots-enriched-run` OK; 1 913 lots, zone_code 99,84 %, dépôt enrichi OK |

Le fichier employé est `work/zonage-pdf/oka-1.pdf`, intitulé « Règlement concernant le zonage — Plan 1 de 3 — Annexe A ». L'URL primaire n'était pas conservée dans cet artefact local; la tentative de relire `https://oka.qc.ca/` a échoué par résolution DNS, donc aucune URL n'est inventée ici.

## Refus documentés (aucune collection servie)

| Slug | Source/document | Voie et raison vérifiée |
|---|---|---|
| `amherst` | `https://municipalite.amherst.qc.ca/wp-content/uploads/2023/05/352-02-Zonage-revise-2017.pdf` | T1: pas de `/VP /Measure /GEO`; le règlement indique que les deux feuillets cartographiques sont les annexes A/B, absentes des 87 pages publiées. |
| `austin` | `https://municipalite.austin.qc.ca/wp-content/uploads/reglement_zonage.pdf` | T1: pas de géoréf embarqué; les pages 154–157 ne sont que les intercalaires des annexes I–IV, sans les cartes. |
| `begin` | `https://begin.ca/app/uploads/2025/08/15-288_BEGIN_Reg_ZONAGE-partie-1-chapitre-1-6.pdf` et partie 2 | T1: pas de géoréf; le règlement dit que le plan est composé de deux planches, non jointes aux deux PDF publiés. |
| `bethanie` | `https://municipalitedebethanie.ca/wp-content/uploads/2023/10/Reglement-Zonage-Bethanie.pdf`, p.190 | T2: `svg_points=0`; T3: 1 contrôle indépendant après vérification de patch, requis ≥8. |
| `saint-clet` | cache PDF `work/zonage-pdf/saint-clet-carte.pdf`, p.1 | T1: pas de géoréf; T2: `svg_points=0`; T3: 3 contrôles indépendants après pruning, requis ≥8. |
| `saint-telesphore` | cache PDF `work/zonage-pdf/saint-telesphore.pdf`, p.1 | T1: pas de géoréf; T2: rotations 180° et 0° séparées de seulement 0,10 point au cutoff 300 m (<15), donc ambiguë. Arbitrage anisotropie refusé: couverture serving 78,65 % (<85 %). |
| `sainte-justine-de-newton` | cache PDF `work/zonage-pdf/sainte-justine-de-newton.pdf`, p.229 | T1: pas de géoréf; T2: `svg_points=0`; T3: 0 contrôle indépendant après vérification de patch, requis ≥8. |

Les rapports machine associés sont les fichiers `zones-recalage-20260717T-*.json` de ce dossier. Les amorces chamfer ne sont pas des calibrations et n'ont jamais été publiées.

## Contrôle après lot

`loop-supervise` après le dépôt: score `zones=839` (contre 838 avant le lot). Le statut de matrice d'`oka` est désormais `done`, `doneTrack=qc-zonage-oka`.
