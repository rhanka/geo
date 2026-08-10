# Annexe — preuve N-A des coverage gaps lot↔zone

Lecture S3 seule. Un lot sans `code_zone` est **coverage-gap prouvé** seulement si son centroïde shoelace est hors de toute zone servie; `inside_served` reste une jointure à traiter et `no_geometry` n'est jamais crédité.

| Ensemble | Villes complètes / demandées | Lots sans code examinés | Coverage-gap prouvé (hors zones) | Dans zone servie | Sans géométrie |
| --- | ---: | ---: | ---: | ---: | ---: |
| Province auditable | 101 / 864 | 980028 | 978250 | 1778 | 0 |
| Priorité ≤ 167 (registre committé) | 25 / 110 | 33993 | 33800 | 193 | 0 |

Les comptes ne couvrent que les villes terminées; aucune extrapolation aux villes partielles ou inconnues.
