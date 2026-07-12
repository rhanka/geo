# NORMES via Mistral — shard 2/4 — 2026-07-12T191900Z

## Portée et garde-fous

- Branche demandée : `feat/cadre-acquisition`.
- Sélection initiale recalculée depuis `work/coverage/coverage-matrix.json` : `zones.status == done`, `normes.status != done`, liste triée 0-based, conservation de `index % 4 == 2` uniquement.
- Spécification lue : `docs/spec/normes-extraction-retenu.md`.
- `loop-supervise.ts` exécuté au début, entre les deux premiers lots et après chaque fusion.
- Extraction payante uniquement par Mistral OCR-4.0 ou Mistral `document_annotation` (`mistral-schema`). Aucun GPT-5.5/Codex utilisé pour l’extraction.
- Dépôt uniquement parquet-only; gates conservés : au moins 3 codes réels, overlap SIG non nul quand la grille SIG existe, `publishedFieldPct != 0`, valeurs verbatim-or-null.
- Le worktree était déjà très sale au départ. `.claude`, `.track`, les secrets et les changements d’autres agents n’ont pas été touchés.

## Dépôts nets

| slug | source officielle | voie Mistral | résultat des gates | propagation aval |
| --- | --- | --- | --- | --- |
| `barnston-ouest` | `https://www.mrcdecoaticook.qc.ca/municipalites/Urbanisme/Barnston-Ouest/BAO_Zonage_225.pdf` | `document_annotation`, auto-détection pages 65–165, 101 pages, 0,303 USD | 45 codes, SIG 43, overlap 37, `publishedFieldPct=1,7%` | join 650 lots, 100% assignés, match normes 99,85%; enrichi |
| `dupuy` | `https://dupuy.ao.ca/documents/pages/reglement-no-263-2025---zonage.pdf` | `document_annotation`, règlement complet 100 pages, 0,300 USD | 20 codes, SIG 41, overlap 1, `publishedFieldPct=50,6%` | join 936 lots, 100% assignés, match normes 0,75%; enrichi |
| `fugereville` | `https://www.mrctemiscamingue.org/app/uploads/2024/01/fugereville-reglement-de-zonage.pdf` | `document_annotation`, règlement complet 55 pages, 0,165 USD | 14 codes, SIG 29, overlap 5, `publishedFieldPct=0,9%` | join 494 lots, 100% assignés, match normes 14,98%; enrichi |

Les trois parquets ont été fusionnés avec `zonage-norms-manifest-merge.ts --apply`. Le merge a signalé la clé indépendante `registry` absente, sans empêcher les ajouts valides. Aucun parquet n’a été remplacé par une sortie sous-gate.

## Lot 1 — 12 slugs du shard

Pioche initiale : `aston-jonction`, `barnston-ouest`, `belleterre`, `brebeuf`, `chazel`, `courcelles-saint-evariste`, `dupuy`, `esprit-saint`, `franquelin`, `gatineau`, `grosse-ile`, `howick`.

- `aston-jonction` : Mistral OCR, 3 pages, 0 zone, 0,003 USD; pas de dépôt.
- `barnston-ouest` : dépôt décrit ci-dessus.
- `belleterre` : schema Mistral, 58 pages, 10 codes mais overlap 0/29; rejet anti-invention.
- `brebeuf` : Mistral OCR, règlement officiel 33 pages, 0 zone; pas de dépôt.
- `chazel`, `esprit-saint`, `franquelin`, `howick` : crawler/portails consultés, aucune URL PDF de grille HTTP 200 confirmée; aucune URL inventée.
- `courcelles-saint-evariste` : schema Mistral, fenêtre auto-détectée pages 129–133, 0 code; pas de dépôt.
- `dupuy` : dépôt décrit ci-dessus.
- `gatineau` : texte natif, 2 pages, 1 code réel, overlap 1 mais sous le seuil de 3; rejet.
- `grosse-ile` : le PDF local ne présente pas de grille par zone dans les pages candidates inspectées (p.72–73 : texte réglementaire; p.91 : tableau d’enseignes). Provenance PDF directe non retrouvée; aucune extraction/dépôt forcé.

Le crawler groupé a reconnu seulement 5 municipalités de sa registry et a été interrompu sur `gatineau` après absence de progression, avant la limite opérationnelle par slug. Les sources locales/MRC confirmées ont ensuite été traitées individuellement.

## Lot 2 — repioche dynamique après les deux premiers dépôts

Pioche : `batiscan`, `berry`, `caplan`, `clermont--abitibi-ouest`, `denholm`, `elgin`, `fermont`, `fugereville`, `grand-saint-esprit`, `honfleur`, `ivry-sur-le-lac`, `la-redemption`.

- `batiscan` : le fichier local échoue à `pdftotext` (status 1), donc aucun appel Mistral.
- `berry`, `caplan`, `elgin`, `grand-saint-esprit`, `honfleur`, `la-redemption` : aucune source PDF officielle confirmée; aucune URL inventée.
- `clermont--abitibi-ouest` : schema Mistral, 97 pages, 97 codes et 39% de champs, mais overlap 0/29; rejet strict.
- `denholm` : OCR Mistral 80 pages, 3 codes, overlap 1/15 mais `publishedFieldPct=0`; rejet. Une seconde passe schema ciblée p.40 et p.81 a donné 0 code; aucun dépôt.
- `fermont` : Mistral OCR, 2 pages, 0 zone; pas de dépôt.
- `fugereville` : dépôt décrit ci-dessus.
- `ivry-sur-le-lac` : schema Mistral ciblé p.117, 0 code; pas de dépôt.

Les appels de ce lot sont restés sous 1 USD par ville; coût Mistral cumulé de la session : environ 1,375 USD, dont au maximum 0,303 USD pour une ville.

## Lot 3 — preuve réutilisée sans repayer les mêmes documents

Après la relance du superviseur, les 12 cibles fraîches examinées étaient `gallichan`, `grand-saint-esprit`, `hope`, `kinnears-mills`, `la-reine`, `lac-delage`, `lac-saint-joseph`, `latulipe-et-gaboury`, `launay`, `leclercville`, `les-hauteurs`, `lorrainville`.

Les preuves Mistral déjà présentes dans les rapports/artefacts locaux ont été réutilisées pour éviter un nouvel appel identique : `kinnears-mills` (overlap nul), `lac-saint-joseph` (champs publiés nuls), `latulipe-et-gaboury` (0 zone) et `lorrainville` (0 zone). Les autres n’avaient pas de PDF de grille officiel confirmé dans l’inventaire local. Aucun dépôt supplémentaire n’a été fabriqué.

## Aval et état

- `lot-zone-join-run.ts` puis `lots-enriched-run.ts` ont réussi pour `barnston-ouest`, `dupuy` et `fugereville`.
- Les warnings de faible correspondance SIG/normes de `dupuy` et `fugereville` sont conservés dans les sorties; ils ne sont pas transformés en valeurs inventées.
- Dépôts nets de cette session : **3**.
- Commit ciblé prévu : ce seul rapport; aucun `git add .`, aucun ajout de `.claude`/`.track` ou de secrets.
