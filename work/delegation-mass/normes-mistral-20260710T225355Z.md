# Normes Mistral shard 1/4 - 2026-07-10T22:53:55Z

Shard applique: slugs `zones.status==done && normes.status!=done` dont index trie `% 4 == 1`.
Extraction faite uniquement avec Mistral (`ocr/mistral-ocr-4-0` ou `ocr/mistral-schema`), aucun GPT/Codex.

## Depots nets

| slug | moteur | pages | zones | overlap SIG | publishedFieldPct | cout |
|---|---:|---:|---:|---:|---:|---:|
| saint-liboire | mistral-schema | 87..143 | 55 | 54/64 | 52.0% | 0.171 |
| ville-marie | mistral-schema | 5..54 | 40 | 20/193 | 13.1% | 0.150 |
| saint-sulpice | mistral-schema | 116..200 | 31 | 2/7 | 17.3% | 0.255 |

Manifest merge applique:

- `saint-liboire`, `ville-marie`: `manifestAfter=596`
- `saint-sulpice`: `manifestAfter=597`

Aval lots:

- `saint-liboire`: lots=1864, zone_code=99.68%, normes=89%, surface=100%, code_postal=100%, adresse=93.03%, depot lots enrichis OK.
- `ville-marie`: lots=1517, zone_code=99.87%, normes=10.68%, surface=100%, code_postal=100%, adresse=95.58%, depot lots enrichis OK.
- `saint-sulpice`: lots=1910, zone_code=99.9%, normes=41.31%, surface=100%, code_postal=100%, adresse=98.27%, depot lots enrichis OK.

## Rejets gates / non productibles

- `duhamel-ouest`: OCR 1..60, 0 zone extraite.
- `fugereville`: OCR 1..55, 0 zone extraite.
- `lassomption`: OCR 1..60, 91 codes mais `overlap=0` vs 359 codes SIG, rejet anti-invention.
- `lery`: OCR 1..60, 0 zone extraite.
- `mont-carmel`: OCR 1..60, 0 zone extraite.
- `perce`: auto-grid 219..223, 14 codes, `overlap=8`, mais `publishedFieldPct=0`, rejet anti-invention.
- `pont-rouge`: OCR 194..210, 0 zone extraite.
- `princeville`: auto-grid 211..215, 15 codes, `overlap=0` vs 116 codes SIG, rejet anti-invention.
- `saint-didace`: OCR 1..60, 0 zone extraite.
- `valcourt--le-val-saint-francois--2`: OCR 1..18, 0 zone extraite.
- `dosquet`: seed PDF confirme, schema 55..60, 0 zone extraite; la page detectee etait explicative, pas la grille.
- `trois-rivieres`: schema page 1, codes lus `I/J/R`, `overlap=0`, rejet anti-invention.
- `namur`: schema whole PDF, 27 codes et 55.1% champs, mais `overlap=0` vs 4 codes SIG, rejet anti-invention.

## Decouverte

- Seed confirme: `dosquet`, `trois-rivieres`, `ville-marie`.
- Seed 404: `macamic`, `notre-dame-des-prairies`.
- Crawler 2-hop sur `courcelles-saint-evariste`, `grand-saint-esprit`: aucun PDF grille confirme.
- Recherche media WordPress: hits utiles deja traites (`dosquet`, `ville-marie`); pas de hit pour `laverlochere-angliers`, `nedelec`, `saint-edouard-de-fabre`.

## Notes

- Tous les depots sont parquet-only puis reconcilies par `zonage-norms-manifest-merge.ts --apply`.
- Les slugs avec fichiers PDF manifestement PV (`saint-benjamin`, `sainte-aurelie`) n'ont pas ete envoyes a Mistral.
- `work/zonage-norms/discovered.json` a ete modifie par une autre activite concurrente et n'est pas inclus dans ce lot.
