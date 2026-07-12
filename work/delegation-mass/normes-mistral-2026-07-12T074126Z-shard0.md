# Normes Mistral — shard 0/4 — 2026-07-12

## Périmètre et méthode

- Cibles déterminées depuis `work/coverage/coverage-matrix.json`, triées, avec `index % 4 == 0`, `zones.status=done` et `normes.status!=done`.
- 66 cibles initiales couvertes en cinq lots; aucun slug hors shard n’a été extrait.
- Supervision `acquisition/src/loop-supervise.ts` exécutée au début et entre chaque lot.
- Extraction uniquement Mistral: `mistral-ocr-4-0`/`mistral-ocr-latest` et `mistral-schema` (`document_annotation`). GPT-5.5/Codex non utilisés.
- Dépôts Parquet-only (`--no-manifest` ou défaut schema sans `--manifest`), budget maximal USD 1 par ville.
- Règles de gate appliquées: au moins 3 codes verbatim, overlap SIG non nul, `publishedFieldPct` non nul, sinon aucune écriture produit.

## Dépôt net

### `saint-leon-de-standon`

- Source locale: `work/zonage-norms/saint-leon-de-standon/grille.pdf`.
- Moteur: Mistral `document_annotation`, `--first-page 126 --last-page 130`, coût USD 0,015.
- Résultat: 3 codes (`HA-1`, `HA-2`, `HA-3`), 3/3 en overlap SIG, `publishedFieldPct=50`, champs observés verbatim (`hauteur_max` 4,5; marge avant 4,5; marge latérale 2 pour les trois codes).
- Parquet: `registry/qc-zonage-norms/qc-zonage-norms-saint-leon-de-standon.parquet`.
- Merge appliqué: manifeste 654 → 655 entrées; `saint-leon-de-standon` ajouté. L’avertissement `registry` du merge concernait une clé inexistante de contrôle, pas le Parquet déposé.
- `lot-zone-join-run`: 1 468 lots, assignés 100 %, vérification Parquet OK; overlap lot/code 4,29 % (avertissement conservé).
- `lots-enriched-run`: 1 468 lots, dépôt OK, surface/code postal 100 %, adresse 89,37 %.

## Résultats des lots sans dépôt

Les résultats ci-dessous sont des preuves d’échec ou de non-productibilité; aucun code ou champ n’a été inventé.

### Lot 1 — 15 cibles

- `abercorn`: aucun PDF de règlement/grille confirmé; le PDF local connu est une carte de zonage.
- `albanel`: Mistral OCR, 0 zone extraite.
- `auclair`: Mistral OCR, 0 zone extraite; source courte/amendement, aucune annexe grille détectée.
- `baie-des-sables`: hors registry crawler; portail officiel non résolu côté DNS, aucun PDF confirmé.
- `barnston-ouest`: 3 codes mais overlap SIG 0/43; rejet anti-invention.
- `bedford--brome-missisquoi--2`: uniquement `grille.txt` local, aucun PDF exploitable.
- `caplan`: hors registry; portail officiel expose un projet modificatif du règlement 213, mais pas le règlement de base/annexe grille confirmé.
- `clermont--abitibi-ouest`: 5 codes mais overlap SIG 0/29; rejet anti-invention.
- `cloridorme`: hors registry; DNS du portail officiel échoue, aucun PDF confirmé.
- `east-broughton`: crawler/manifestes sans PDF confirmé.
- `escuminac`: hors registry; portail officiel inaccessible avec erreur de parse HTTP, aucun PDF confirmé.
- `frontenac`: PDF 375/376/378 officiels vérifiés, mais respectivement permis/tarifs, entretien hivernal et colportage; aucun règlement de zonage de base.
- `gatineau`: crawl borné interrompu par timeout global, aucun PDF confirmé.
- `grosse-ile`: seulement `src.txt` local; la preuve existante du lot précédent indique 2 codes, overlap 0; aucun PDF à réextraire.
- `hope`: portail officiel inspecté sans règlement/grille PDF exploitable.

### Lot 2 — 15 cibles

- `ivry-sur-le-lac`: OCR 0 zone; schema page 117 0 zone; la page 117 est du corps de règlement, pas une grille.
- `la-pocatiere`: `pdftotext` échoue sur le PDF local; aucun appel d’extraction publiable.
- `la-reine`: portail officiel inspecté, aucun PDF de zonage/grille exposé.
- `la-visitation-de-lile-dupas`: OCR 0 zone.
- `lac-des-plages`: OCR 30 codes mais `publishedFieldPct=0`; schema page 1 0 zone; rejet.
- `lascension-de-patapedia`: OCR 0 zone.
- `lepiphanie`: `pdftotext` échoue sur le PDF local.
- `les-iles-de-la-madeleine`: OCR 2 codes, overlap 0/167; schema pages 41–45 0 zone; rejet.
- `lile-danticosti`: OCR 0 zone.
- `lislet`: extraction directe du `src.pdf`, 4 codes, overlap 0/7; rejet anti-invention.
- `new-richmond`: OCR 0 zone.
- `normandin`: OCR fenêtre 169–209, 0 zone.
- `notre-dame-des-pins`: 18 codes, `publishedFieldPct=0`; rejet.
- `notre-dame-du-bon-conseil--drummond--2`: OCR 0 zone.
- `padoue`: crawler hors registry, aucun PDF confirmé.

### Lot 3 — 15 cibles

- `port-daniel-gascons`: OCR 0 zone; fichier Mistral expiré côté API, aucune publication.
- `ragueneau`: OCR 0 zone.
- `remigny`: OCR 0 zone.
- `riviere-bleue`: OCR 0 zone.
- `roquemaure`: aucun PDF confirmé par découverte bornée.
- `sacre-coeur-de-jesus`: 6 faux codes de facture, overlap 0/52; rejet.
- `saint-antoine-de-tilly`: 35 codes, `publishedFieldPct=0`; rejet.
- `saint-bonaventure`: aucun PDF confirmé.
- `saint-camille-de-lellis`: OCR puis schema 0 zone.
- `saint-cyprien-de-napierville`: OCR fenêtre 37–41, 0 zone.
- `saint-damase--les-maskoutins`: aucun PDF confirmé dans ce lot.
- `saint-donat--la-mitis`: aucun PDF confirmé dans ce lot.
- `saint-epiphane`: plans GeoPDF de zones seulement, pas de grille de normes.
- `saint-eugene-de-ladriere`: OCR 0 zone.
- `saint-hilaire-de-dorset`: OCR 0 zone.

### Lot 4 — 15 cibles

- `saint-jacques-de-leeds`: OCR `pdfunite` échoue; schema page 129 produit 14 codes mais `publishedFieldPct=0`.
- `saint-jean-de-la-lande`: OCR 0 zone.
- `saint-joseph-de-sorel`: aucun PDF local ou confirmé.
- `saint-jules`: OCR puis schema pages 18–20, 0 zone.
- `saint-leon-de-standon`: dépôt net décrit ci-dessus.
- `saint-majorique-de-grantham`: aucun PDF confirmé.
- `saint-marcel-de-richelieu`: OCR 0 zone.
- `saint-octave-de-metis`: aucun PDF confirmé.
- `saint-patrice-de-beaurivage`: aucun PDF confirmé.
- `saint-pie`: OCR 0 zone.
- `saint-pierre-de-broughton`: OCR 0 zone.
- `saint-prosper`: OCR 0 zone.
- `sainte-agathe-de-lotbiniere`: aucun PDF confirmé.
- `sainte-apolline-de-patton`: aucun PDF confirmé.
- `sainte-francoise--les-basques`: aucun PDF confirmé.

### Lot 5 — 6 cibles

- `sainte-gertrude-manneville`: aucun PDF local ou confirmé.
- `sainte-justine`: aucun PDF exact; le fichier trouvé est pour `sainte-justine-de-newton`, exclu.
- `sainte-lucie-de-beauregard`: OCR overlap 0/40; schema 2 codes, overlap 0 et aucun champ; rejet.
- `sainte-perpetue--nicolet-yamaska`: OCR et schema fenêtre 123–130 bloqués par `stderr maxBuffer`; 0 zone publiable.
- `sainte-rose-de-watford`: OCR 0 zone.
- `warden`: aucun PDF local ou confirmé.

## Suite

- Tous les 66 candidats initiaux du shard ont été couverts par dépôt, extraction Mistral rejetée ou preuve de source non productible.
- Aucun merge/join supplémentaire n’est requis pour les rejets; seul `saint-leon-de-standon` a été intégré.
- Aucun commit/push n’a été effectué dans ce rapport avant vérification ciblée des artefacts; les changements préexistants des autres agents sont préservés.
