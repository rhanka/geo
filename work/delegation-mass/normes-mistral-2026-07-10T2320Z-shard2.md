# Normes Mistral shard 2/4 - 2026-07-10T2320Z

Contraintes appliquees: shard `sorted-index % 4 == 2` via
`normes-shard-select.ts --n 4 --shard 2`, extraction Mistral uniquement
(`route ocr`, Mistral OCR / Document-AI), budget `1` par ville, depots
parquet-only. Aucun fichier `.claude` ou `.track` modifie par cette passe.

## Supervision

- Depart: `normes=598`.
- Apres depot `peribonka`: `normes=599`.
- Le shard local declare 75 cibles eligibles.

## Depot net

| slug | resultat |
| --- | --- |
| peribonka | DEPOT `registry/qc-zonage-norms/qc-zonage-norms-peribonka.parquet` |

Details `peribonka`:

- PDF local reutilise: `work/zonage-plans/peribonka-grille.pdf`.
- Moteur: `native-text/grille-native-first+ocr/mistral-ocr`.
- Cout OCR approx: `0.009`.
- Rows: 72 ; `uniqueZoneCodes=72`.
- Crossval SIG: `sig=25`, `overlap=21`, `recoupSig=84%`.
- `publishedFieldPct=43.9`.
- `zonage-norms-manifest-merge.ts --apply`: `peribonka` ajoute au manifeste.
- `lot-zone-join-run.ts --slugs peribonka`: `lots=952`, `assigned=55.57%`, `match=95.84%`, `without_norms=4.16%`, verify parquet/stats OK.
- `lots-enriched-run.ts --slugs peribonka`: `lots=952`, `zone_code=55.57%`, `norms=53.26%`, `surface=100%`, `code_postal=100%`, depot OK.

## Rejets gates / preuves

Lot local `work/zonage-norms/discovered-shard-2-codex-20260710.json`
force en `route ocr`:

| slug | preuve |
| --- | --- |
| martinville | OCR 60 pages, `0 zones extracted`, stderr maxBuffer |
| saint-augustin-de-desmaures | 4 pseudo-codes, SIG 10, `overlap=0`, rejet anti-invention |
| saint-malo | OCR 14 pages, `0 zones extracted` |
| saint-pamphile | OCR 60 pages, `0 zones extracted` |
| saint-simon | auto-grid 86..97, OCR 12 pages, `0 zones extracted` |
| sainte-helene-de-bagot | OCR 2 pages, `0 zones extracted` |
| schefferville | OCR 1 page, `0 zones extracted` |

Decouverte officielle:

- `grille-discovery-run` sur un lot de 15 slugs: la registry PV ne couvrait que
  3 villes et a bloque sur timeouts reseau; interrompu sans PDF confirme.
- `normes-obscura-run` lot C sur 10 sites officiels: 9 `no-grille-rendered`,
  1 PDF trouve pour `sainte-praxede`.
- `sainte-praxede`: OCR Mistral pages 82..89, 5 codes (`VA`, `VB`, `VC`, `VD`,
  `VE`), SIG 42, `overlap=0`, rejet anti-invention.
- `normes-obscura-run` lot D partiel: PDF reel telecharge pour `saint-godefroi`
  (`work/zonage-norms/saint-godefroi/grille.pdf`, 1054666 octets), mais le lot a
  ete interrompu sur site lent avant manifeste final.

## Blocage

Apres l'interruption du lot D, une nouvelle execution hors sandbox requise pour
Obscura/Mistral a ete rejetee par la plateforme: limite d'usage atteinte. Je n'ai
pas tente de contournement. `saint-godefroi` reste donc telecharge mais non extrait
et non depose.

## Fichiers locaux crees par cette passe

- `work/delegation-mass/normes-mistral-2026-07-10T2320Z-shard2.md`
- `work/zonage-norms/discovered-shard-2-codex-20260710.json`
- `work/zonage-norms/discovered-shard-2-obscura-20260710-c.json`
- `work/zonage-norms/obscura-shard-2-20260710-c.json`
- `work/zonage-norms/sainte-praxede/grille.pdf`
- `work/zonage-norms/saint-godefroi/grille.pdf`

## Commit

Depot S3 effectue pour `peribonka`, mais commit/push non effectues dans cette
passe: le worktree contient de nombreuses modifications preexistantes et les
fichiers locaux de couverture/manifeste modifies ne sont pas isolables proprement
sans risquer d'embarquer des changements d'autres agents. Le rapport ci-dessus
donne la preuve de depot et les commandes aval executees.
