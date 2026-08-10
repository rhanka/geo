# Étude — Dundee : légende raster et usage dominant

## Faits établis

- La grille réglementaire de Dundee est conservée sur S3 sous la clé
  `raw/usage-dominant-reglement-grid/cas/94da96ee3c370777aaec358adfb4b307eac5323564768a1f73583426e798241b.pdf`.
- La sonde S3 de texte natif a parcouru les 13 pages et ne trouve aucun texte,
  y compris avec l'expression universelle `.`. Le PDF est donc raster du point
  de vue de l'extraction textuelle.
- Une absence de texte ne démontre ni l'absence d'une légende ni une
  correspondance usage dominant. Elle ne permet pas de publier une carte.
- Les zones servies de Dundee existent, mais aucune source actuellement
  versionnée ne relie leurs codes aux catégories de dominance attendues.

## Question à trancher

Faut-il ajouter une voie de lecture raster, exécutée exclusivement sur le
cluster et dont les entrées, sorties brutes et reçus sont durablement déposés
sur S3, pour chercher une légende de dominance dans ce règlement?

## Contraintes non négociables

1. Aucun octet de règlement ni image rendue ne peut être capté ou conservé
   localement : le pod lit le CAS S3 et écrit ses artefacts et son reçu sur S3.
2. Le résultat est verbatim-ou-null. Une cellule illisible, ambiguë ou sans
   lien explicite à un code de zone est un refus durable, jamais une déduction.
3. La publication d'une carte exige une correspondance explicite,
   reproductible et reliée à la capture; une sortie OCR seule ne constitue pas
   une carte publiée.
4. Le job doit avoir une clé d'entrée immuable, une image identifiée, un budget
   borné, un délai actif et une clé de reçu S3 déterministe.

## Options en analyse

### A — ne rien ajouter

Conserver Dundee en `unknown` avec le rapport de raster. Aucun coût ni risque
de nouveau contrat, mais aucune possibilité de vérifier visuellement la
légende.

### B — job OCR raster dédié, sans modèle payant

Construire une image cluster contenant le moteur OCR et Poppler, qui rend les
pages dans le pod puis écrit la transcription, les métadonnées de page et le
reçu sur S3. Une règle déterministe cherche ensuite les paires code-zone /
catégorie. Il faut concevoir le schéma d'artefact, le runner et les gates de
preuve; la qualité sur une légende graphique reste inconnue sans essai.

### C — job vision dédié à coût borné

Construire un contrat distinct de l'extracteur de normes : le pod lit la
capture Dundee depuis S3, rend les pages, demande deux lectures indépendantes
d'une légende et dépose les deux réponses verbatim, leur concordance et le
reçu sur S3. Cela a un coût externe et exige un plafond approuvé; aucune
correspondance non concordante ne peut être servie.

## Ce que cette étude ne fait pas

Elle ne déclenche aucune capture, aucun job cluster, aucun appel de modèle et
ne modifie aucune donnée servie. Les options restent à faire valider après les
revues indépendantes.

## Revues indépendantes

Les revues de preuve et d'opérabilité concluent toutes deux
`needs-owner-decision` :

- Le runner `k8s-captured-normes-run.ts` exige une référence sous
  `registry/normes-captured-references/`, travaille dans la lane `normes` et
  produit un reçu de parquet de normes. La capture Dundee
  `usage-dominant-reglement-grid` ne peut pas être requalifiée pour le
  consommer : ce serait une rupture de provenance.
- L'extracteur `grille-vision-extractor.ts` a des garde-fous de concordance
  utiles, mais sa sortie est `ZoneNorms`. Son tableau d'`usages` permis ne peut
  pas être transformé en usage dominant; le fold exige une nomenclature
  officielle et une carte explicite par slug.
- La voie Tesseract versionnée est une primitive qui écrit des temporaires. Elle
  ne devient admissible que dans une image de pod nouvelle; seule, elle ne
  fournit ni reçu S3 ni preuve graphique d'une association code-catégorie.
- Le plafond `--budget-usd` du job normes n'est pas une limite de dépense
  effectivement observée. Toute nouvelle voie vision doit arrêter le traitement
  avant dépassement de sa limite de pages ou de coût et l'attester dans son reçu
  S3.

Les analyses complètes sont dans
`work/reviews/dundee-ocr-study-proof-peer.md` et
`work/reviews/dundee-ocr-study-operability-peer.md`.

## Contrat minimal si l'option B ou C est choisie

Une réalisation ultérieure devra, avant tout appel OCR ou vision :

1. Définir une référence de capture **usage-dominant** distincte, liant la ligne
   de manifeste réussie, la clé CAS, le digest, l'URL et une sélection de pages
   immuable. À défaut, produire un reçu de refus sur S3.
2. Exécuter exclusivement dans un pod une image identifiée par digest, avec
   deadline, idempotence, plafond de pages et plafond de coût effectivement
   appliqués. Le PDF et les PNG temporaires restent dans le volume éphémère du
   pod.
3. Déposer sur S3 les deux réponses brutes, les identités de prompt et modèle,
   les pages/rendus utilisés, leur concordance, la consommation observée et un
   reçu final de succès ou de refus.
4. N'accepter que des couples verbatim `code ou préfixe → catégorie` explicitement
   présents dans la nomenclature officielle. Deux lectures doivent concorder sur
   le couple et la page; les usages permis, les états mixtes, les divergences et
   les codes absents restent `null`/`unknown`.
5. Tester les identités de capture croisées, les dépassements de plafonds, les
   divergences, une légende ambiguë et une matrice d'usages permis qui ne donne
   aucune dominance, avant de pouvoir écrire
   `acquisition/config/usage-dominant-map/dundee.json`.

## Décision propriétaire requise

La décision ne porte pas sur une carte Dundee — aucune n'est démontrée — mais
sur l'autorisation de construire et d'exploiter le contrat dédié :

- **A.** Conserver Dundee à `unknown` avec la preuve raster existante.
- **B.** Autoriser un OCR raster cluster/S3 non payant, après une évolution de
  l'image, du runner, des contrats et des tests; le résultat peut encore être
  un refus.
- **C.** Autoriser un job vision cluster/S3, avec plafond externe explicite à
  définir, double lecture et les mêmes contrats; le résultat peut encore être
  un refus.

Sans ce choix, la seule action correcte reste A.
