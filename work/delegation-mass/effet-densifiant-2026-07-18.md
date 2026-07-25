SHARD 0/2

# Effet densifiant — lot 0/2 — 2026-07-18

Périmètre exclusif : indices pairs de la liste focus. Aucun artefact
`work/effet-densifiant/<slug>.json` n'a été servi dans ce lot : aucun cas ne
réunit les deux compteurs de logements vérifiables et la garde AVANT/APRÈS.

## Villes SERVIES

Aucune (0 zone densifiée).

## Villes `inconnu` — aucun événement de zonage détectable

- `champlain` — index Urbanisme officiel consulté :
  `https://www.municipalite.champlain.qc.ca/fr/avis-public/c842/urbanisme/page-1`.
  Les avis accessibles n'identifient pas un amendement au règlement de zonage
  servi `2009-03 (mod. 2012-03)` avec une zone et un document de changement.
- `mont-saint-hilaire` — l'index public officiel
  `https://www.villemsh.ca/ville/mont-saint-hilaire-en-bref/publications/avis-publics/`
  redirige vers un filtre d'actualités côté client ; aucune pièce de changement
  de zonage exploitable n'est exposée dans le HTML acquis.
- `levis` — l'index tenté
  `https://www.ville.levis.qc.ca/ville/vie-democratique/avis-publics/` ne
  renvoie pas de corpus d'avis exploitable (919 octets) ; aucun événement ne
  peut être affirmé.
- `chelsea` — l'index
  `https://www.chelsea.ca/fr/votre-municipalite/avis-public` expose des liens
  génériques « Avis de promulgation »/« Avis public », sans identité de
  règlement ou zone dans le corpus statique ; aucun événement zonage précis
  n'est détectable sans inventer son objet.
- `preissac` — l'index `https://preissac.com/avis-publics/` ne fournit que
  quatre dérogations mineures ; aucune refonte ni modification de zonage.

## Villes bloquées — événement ou transition détecté, mais non servable

- `mont-tremblant` — projet `(2026)-102-84` détecté dans l'avis officiel du
  2026-01-28 : il modifie `(2008)-102` pour retirer une obligation de mixité
  dans la partie sud de `CV-324`.
  Source : `https://vdmt.ca/storage/app/media/informations-municipales/administration-et-finances/avis-publics-et-appels-doffres/2026/avis-public/20260128_AP-Consult-pub-102-84_EEV-117-4-et-A-64-2.pdf`.
  La grille servie `2008-102`, annexe A p. 736, donne `40 logements/ha`, mais
  le projet ne donne aucun compteur de logements AVANT/APRÈS : une modification
  de mixité ne permet pas d'inventer un delta.
- `saint-mathieu-de-beloeil` — le règlement `22.10` est explicitement entré
  en vigueur le 24 mars 2023 (règlement `22.10.18.26`, p. 1), tandis que la
  grille servie est identifiée `08.09`. Ce rapprochement ne suffit pas à
  déduire une chaîne de règlements. Source :
  `https://stmathieudebeloeil.ca/wp-content/uploads/2026/07/REG-22.10.18.26.pdf`.
  La collection servie a `reglement_millesime=null` : la garde AVANT du fold
  rend la direction indécidable ; aucun delta ne peut être servi.
- `saint-amable` — `712-35-2023` modifie `712-00-2013` dans `P-5`, mais son
  objet est seulement le C.O.S. maximal de la classe `H5`, pas un nombre de
  logements. Source :
  `https://www.st-amable.qc.ca/wp-content/uploads/2023/04/saint-amable-avis-public-premier-projet-reglement-712-35-2023.pdf`.
  Sans deux compteurs de logements, le verrou du fold imposerait `inconnu`.
- `rosemere` — le projet `801-59` est détecté comme créant `H-160` au
  détriment d'une zone existante. Source :
  `https://www.ville.rosemere.qc.ca/download.php?filename=CC_R_801-59_projet.pdf`.
  L'index ne fournit pas les deux grilles ou des compteurs de logements
  vérifiables ; le projet seul ne suffit pas à un diff.
- `plaisance` — la provenance locale signale expressément un corpus à cheval
  sur la transition `URB-99-05` / « PROJET Règlement ... » et la collection
  servie a `reglement_numero=null`, `reglement_millesime=null`. La garde
  AVANT/APRÈS est donc indécidable avant même l'extraction des compteurs.
- `sainte-cecile-de-milton` — l'index officiel détecte plusieurs amendements
  de `560-2017`, notamment `684-2026` :
  `https://www.miltonqc.ca/wp-content/uploads/2026/06/AVIS-PUBLIC-DE-CONSULTATION-PUBLIC-REG.-684-2026-AMD-ZONAGE-560-2017.pdf`.
  La collection servie porte `560-2017` mais `reglement_millesime=null` ; la
  garde de direction interdit le fold.
- `neuville` — projet de règlement `104.37` détecté :
  `https://www.ville.neuville.qc.ca/storage/app/media/ma-ville/administration-et-finances/avis-publics/2026/1.2%20-%20Projet%20r%C3%A8glement%20104.37.pdf`.
  Le règlement/millésime de la collection servie est nul ; aucun côté AVANT
  n'est déterminable et le projet ne donne pas un compteur de logements.

## Contrôles effectués

- Collections servies relues pour les douze slugs avec
  `acquisition/src/_effet-shard-triage.ts`.
- Les zones de dossiers déjà servis (`saint-stanislas-de-kostka`, `sutton`,
  `saint-raphael`, `coaticook`) ont été exclues.
- Aucun fold, aucune écriture S3 et aucun redémarrage de `geo-api` : les gates
  documentaires ne permettaient pas un résultat 4a fiable.
