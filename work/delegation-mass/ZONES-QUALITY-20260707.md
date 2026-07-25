# ZONES-QUALITY - 2026-07-07

Worker: `ZONES-QUALITY`

Objectif: reduire les 7 SIG a reacquerir:
`charlemagne`, `deux-montagnes`, `dollard-des-ormeaux`, `mont-tremblant`,
`saint-bruno-de-montarville`, `saint-gabriel-de-brandon`, `sainte-paule`.

## Resultat

Reduction: `7 -> 6`.

Slug corrige: `sainte-paule`.

Le depot AGOL precedent etait un faux positif France (`Saint Paul en Jarez`,
codes `U/N/A/AUc/AUs`). Il a ete remplace par le GeoPDF officiel de la
municipalite de Sainte-Paule:

`https://municipalite.sainte-paule.qc.ca/images/Upload/Refonte_reglement_2019/384_plan_1-2.pdf`

Validation du depot `t1-build --labels gpt55 --dict`:
- georef `NAD_1983_MTM_6`, residual `0.023 m`;
- 13 lectures vision, 13 validees contre dictionnaire, 0 rejet;
- 12 codes distincts servis sur 14 codes normatifs;
- label centroid a `1.115 km` du cadastre;
- 363/413 lots assignes (`87.89%`), aire couverte `85.81%`.

Le plan officiel `384_plan_2-2.pdf` a ete rejete: il lit des codes valides, mais
son georeferencement embarque place les labels a `2515 km` du cadastre. Aucun
depot partiel base sur ce plan n'a ete fait.

## Derives

`lot-zone-join`:
- `OK sainte-paule`
- 413 lots
- `assigned=87.89%`
- `match=100%`
- `without_norms=0%`

`lots-enriched`:
- `OK sainte-paule`
- `zone_code=87.89%`
- `norms=87.89%`
- `surface=100%`
- `code_postal=100%`
- `adresse=90.56%`

## Crossval et audit

Refresh du manifeste normes:
- `sainte-paule: overlap 0 -> 12`
- `sig=12`, `extracted=14`, `numericBridged=0`

Verification stricte apres depot:
- `PASS sainte-paule features=12 distinct=12 codeLike=100% norms=14 overlap=12`
- les 6 autres restent `FAIL`.

Audit final:
- `zonesDone=761`
- `OK-joignable=311`
- `reacquire=6`
- `reacquireAffectation=1`
- `reacquireSigNoCodes=0`
- `reacquireDisjoint=5`
- `needsManifestRefresh=0`

Reste a reacquerir:
- `charlemagne` - affectation (`URB`) au lieu du vrai zonage municipal.
- `deux-montagnes` - AGOL officiel courant et `AvisDeMotion` restent en codes `H-100/P-124`, disjoints de la grille `H-1/H-2`.
- `dollard-des-ormeaux` - ancien SIG local disjoint; R-2025 rejete par gate GCP independants (`0` GCP independant, `4` derives d'emprise).
- `mont-tremblant` - ArcGIS officiel confirme le depot courant (`Zonage region`, 585 entites); les normes sont disjointes/partielles.
- `saint-bruno-de-montarville` - GCP spatial OK, mais lecture GPT dictionnaire donne `0` label valide; aucun depot.
- `saint-gabriel-de-brandon` - WFS Geocentralis `pzon` officiel numeric-only (`etiquette_1`), sans prefixes `ID/URB/REC/REF`; pas de conversion inventee.

`coverage-matrix.json` n'a pas ete modifie manuellement.
