# SPEC EVOL — découverte d'un autre document porteur de densité

> Statut : décisions d'implémentation · Date : 2026-07-28  
> Portée : les 56 lignes `acquise_sans_densite` du constat `b8558365`, et elles seules.

## Invariant

Le document déjà acquis sans colonne de densité est une piste de navigation, jamais
une entrée d'extraction. Une densité n'existe que lorsqu'un **autre document** porte
verbatim une zone (ou plage de zones), un libellé de norme et une valeur/unité.
Découvrir une densité ne permet pas de conclure un effet : `effet = inconnu`.

## Décisions

- **D1 — univers fermé.** La campagne vérifie le SHA-256 du constat, exige exactement
  56 slugs et les répartit en lots stables `12 + 12 + 12 + 12 + 8`. L'annuaire MAMH,
  pas `ALL_PV_CITIES`, fournit l'identité et le site officiel.
- **D2 — autre document par construction.** L'URL canonique antérieure est exclue
  avant capture. Son SHA-256 est exclu après capture : un miroir byte-identique reste
  le même document et ne passe à aucun parseur/OCR.
- **D3 — capture cluster obligatoire.** Toute page, sitemap, requête SIG/CDX, plage
  Wayback et document passe par `capturedFetch`. Le CAS et la ligne de manifeste sont
  durables avant toute analyse. L'analyse locale ne lit que `raw/` et
  `capture/_runs/`.
- **D4 — progression atomique.** Un pod traite un slug et dépose un résultat immuable.
  Une reprise saute seulement un résultat terminal. Un slug interrompu reçoit un
  nouveau `run_id`; le CAS déduplique les octets sans effacer l'historique.
- **D5 — cinq pistes bornées.** Le ledger distingue : fichier frère/répertoire,
  fiche par zone/plage, annexe+sitemaps, SIG municipal/MRC et Wayback/CDX. Les liens
  opaques (`/file-N`), XLS/XLSX et fiches HTML sont admis comme candidats.
- **D6 — synonymes = classement uniquement.** `densité brute/nette`,
  `logements à l'hectare`, `log./ha`, `nombre de logements`, `COS` et
  `superficie minimale de terrain par logement` augmentent le rappel; ils ne
  constituent jamais seuls une norme publiable.
- **D7 — gates avant publication.** Le propriétaire MAMH/MRC doit être vérifié.
  Projet, premier/deuxième projet, avis ou document « pour adoption » sont rejetés.
  Une date HTTP ou de capture n'est pas une date légale. Sans date documentaire et
  force légale verbatim, le candidat reste inconclusif.
- **D8 — échec ≠ absence.** Timeout, 403 persistant avec UA navigateur, robots
  `Disallow`, mur JS, lecture S3 expirée, troncature Wayback ou identité/date ambiguë
  donnent `bloque_inconclusif`. `absence_documentee` signifie seulement que les cinq
  pistes bornées n'ont rendu aucun document admissible à la date de la campagne.
- **D9 — mesure autoritaire.** Le rapport contient exactement 56 lignes :
  `document_densite_verifie | absence_documentee | bloque_inconclusif`, avec URL,
  date légale, SHA/CAS et extrait/page verbatim. Le nombre de collections pliées est
  relu depuis les collections servies S3 après pliage; il n'est jamais déduit du
  nombre de documents trouvés.

## Routage d'analyse

Couche texte native et parseurs structurés en premier. L'OCR/vision n'est utilisé
qu'après localisation d'une page ou d'une fenêtre candidate, avec les moteurs et
gates déjà benchés dans `docs/study/model-eval-vision-ocr.md` §10 et
`docs/spec/zonage-extraction-methods.md` §3.
