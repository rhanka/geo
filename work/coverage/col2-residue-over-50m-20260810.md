# col-2 — résidu « vraie erreur » (>50 m de la zone assignée)

## Objet

geo-cond (`…ack-tolerance…t2020`) : le résidu au-delà de la tolérance (~0,5-1,2%,
centroïde >50 m de sa zone `code_zone` assignée) ne doit PAS être absorbé par la
tolérance — c'est la part **« vraie erreur »** à garder mismatch + investiguer
lot-par-lot. Ce livrable liste ce résidu par ville (read-only, HOLD respecté).

## Résultat (`_col2-residue-over-50m.ts`, seuil 50 m)

| ville | résidu >50 m | multi_zone | **mono_zone** | % des lots |
| --- | ---: | ---: | ---: | ---: |
| saint-hyacinthe | **220** | 28 | 192 | 1,14 % |
| varennes | 39 | 3 | 36 | 0,47 % |
| ormstown | 7 | 3 | 4 | 0,29 % |

Liste détaillée par lot (`no_lot`, `assigned`, `actual` codes contenant le
centroïde, `dist_m`, `multi_zone`) dans le `.json` (bornée aux 120 plus profonds
par ville, compte total conservé).

## Lecture

- Le résidu est **dominé par des lots MONO-zone** (192/220 à saint-hyacinthe).
  Un lot mono-zone dont le centroïde est à >50 m de sa zone assignée n'est PAS un
  slop de frontière : c'est soit un **gros lot irrégulier** (aire-majoritaire dans
  une zone mais centroïde profond dans une protrusion d'une autre), soit une
  **vraie divergence** (assignation `code_zone` stale/erronée, ou artefact de
  géométrie de zone). C'est la seule part à examiner au cas par cas.
- **Ordre de grandeur faible** (220 / 39 / 7 lots) → l'investigation lot-par-lot
  est tractable si la décision A/B retient un audit à tolérance (le résidu reste
  la métrique honnête de « vraie erreur »).

HOLD strict respecté : mesure only, aucune écriture servie, aucun changement d'audit.
Investigation lot-par-lot = APRÈS ratification A/B (archi+qa).
