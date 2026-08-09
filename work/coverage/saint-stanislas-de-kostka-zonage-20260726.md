# Saint-Stanislas-de-Kostka — zonage (2026-07-26)

Périmètre unique : `saint-stanislas-de-kostka` (présent dans B′). Aucun
slug `saint-stanislas` n'a été lu ni traité.

## État mesuré avant — S3 servi

- Collection servie :
  `normalized/ca-qc-zonage/qc-zonage-saint-stanislas-de-kostka.geojson`, layout
  plat seul, 48 features / 48 `zone_code` distincts, 0 nul ou vide. Les 48 codes
  sont lettrés et aucun n'est un numéro de lot, un entier nu ou une affectation.
- Géométrie : les 48 features portent `source=geopdf-esri` et
  `confidence=contour-auto`. L'audit live donne **fragmented**, 171 parties,
  38 zones multipart, maximum 12, moyenne 3,56 ; zones urbaines éclatées :
  `H-1,H-2,H-3,H-9,MXTR-1`. Il n'y a pas de dispersion inter-ville.
- Provenance : `zone_source_url` est présent mais `null` sur 48/48 ;
  `zone_source_level=legacy-traceable` sur 48/48. `proof` est présent sur
  48/48, v1 `complete` sur 48/48, avec
  `proof.sources.geometry.upstream_uri=null` sur 48/48 ; aucune preuve de
  collection v2.
- Millésime porté par la couche : `reglement_numero=330-2018` et
  `reglement_millesime=2018` sur 48/48.
- Lots, audit live : 1 827 lots ; **1 622 assignés**, 1 510 appariés, 9
  mal assignés, 103 `outside_all`, 205 non assignés ; mismatch
  **6,91 %**. Le dénominateur n'est donc pas nul : le taux n'est pas un faux
  « propre » à 0 %.

`lot-zone-consistency.json` et `zone-contiguity.json` ont chacun été sauvegardés
avant l'audit puis restaurés octet pour octet (SHA-256 identique avant/après).

## Cause établie

Ce n'est pas un fold périmé.

1. La géométrie actuelle est explicitement une géométrie `contour-auto`; la
   précédente rectification T1 n'a remplacé que 24/48 codes et a conservé le
   reste comme repli. Cela établit l'origine des 171 fragments; les 103 lots
   `outside_all` sont le symptôme spatial mesuré séparément. Son entrée de
   preuve reste v1 sans URL amont.
2. Le document servi est juridiquement périmé. Le diagnostic du règlement
   `451-2025` de la même municipalité dit, art. 1.6, qu'il abroge le règlement
   de zonage `330-2018` et ses amendements. Son annexe A contient le plan en
   vigueur en deux feuillets (plan général et périmètre urbain) et son art. 1.21
   les rend partie intégrante du règlement. Les codes des 48 zones servies sont
   donc les identifiants de l'ancien plan, non la cible d'un recoupement naïf
   avec le plan 451.
3. Les seuls octets 451 trouvés sont locaux sous
   `work/zonage-norms/saint-stanislas-de-kostka-projet/451-2025-zonage.pdf` :
   aucun URL source, objet `raw/` ni manifeste `capture/_runs/` ne les rattache
   à une capture. Ils sont un indice de diagnostic, pas une source déposable.
   L'inventaire de provenance confirme d'ailleurs la couche 48 features comme
   `legacy-traceable` / `quarantine`, « pipeline label seul, pas d'URL ».
4. Aucun endpoint SIG officiel ArcGIS/GeoCentralis n'est établi pour cette
   municipalité. Les runners de remplacement imposés ne peuvent donc pas
   produire une preuve v2 ni franchir leurs gates à partir de ce PDF local.

## Remède choisi — non appliqué

**Ré-acquérir la géométrie complète du règlement 451-2025, puis seulement
rejoindre les lots.** Un re-fold maintenant consacrerait les limites de 330-2018
et masquerait encore la cause.

Il manque exactement, avant tout dépôt :

1. l'URL municipale officielle stable du règlement 451-2025 et de son annexe A
   (ou une couche SIG officielle équivalente) ;
2. sa capture sur le cluster, déposée sous `raw/` avec manifeste
   `capture/_runs/` (URL, date, SHA-256) ;
3. une couche couvrant les deux feuillets de l'annexe A, avec dictionnaire de
   codes 451 validé contre ses grilles ;
4. un passage par le runner officiel applicable, avec preuve v2, recoupement
   des codes du document courant et contrôle des propriétés réappliquées. Les
   anciens codes 330 ne pourraient être autorisés comme dépréciés qu'après cette
   preuve documentaire et une réassignation spatiale des lots.

## État après

Aucun objet S3, backup servi, re-fold ou propriété de zonage n'a été modifié.
L'état demeure donc : 48 zones / 171 parties, provenance
`legacy-traceable` sans URL et sans preuve v2, 1 622 lots assignés, mismatch
6,91 % (9 mal assignés + 103 `outside_all`).
