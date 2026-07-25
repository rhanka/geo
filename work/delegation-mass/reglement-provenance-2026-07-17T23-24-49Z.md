# Provenance règlement — shard 1/2 — 2026-07-17T23:24:49Z

Univers : `served && reglement=false`, slugs triés, index `% 2 == 1`.
Le triage courant donne 136 slugs : 10 déjà curés et 126 `HOLD-NULL`; aucun `TODO-URL` ou `TODO-NO-URL` ne reste à traiter dans ce shard. Les 126 verdicts `null` existants (et leur raison verbatim) sont déjà conservés, sans modification, dans `acquisition/config/reglement-provenance.json`.

## Villes servies

Avant : les dix lignes étaient encore `reglement=false` dans `work/coverage/zonage-enrichment.json`. Le fold a été rejoué ; il est idempotent (`cellsChanged=0` pour chaque collection), ce qui établit que les champs étaient déjà présents dans les polygones. Après : chaque `curl -s https://api.geo.sent-tech.ca/collections/qc-zonage-<slug>/items?limit=1 | jq -r '.features[0].properties.reglement_numero'` rend le numéro ci-dessous.

| Slug | Numéro servi après | Millésime | Page | Contrôle verbatim du document |
| --- | --- | --- | --- | --- |
| compton | `2020-166` | `2020` | 3 | « RÈGLEMENT DE ZONAGE N° 2020-166 » ; « Adopté à la séance de ce conseil tenue le 14 juillet 2020. » |
| saint-adrien | `248-2003` | `null` | 1 | « le Règlement de zonage numéro 248-2003 » |
| saint-alphonse | `274-2013` | `null` | 1 | « MODIFIANT LE RÈGLEMENT DE ZONAGE NUMÉRO 274-2013 » |
| saint-donat--la-mitis | `318` | `null` | 1 | « Règlement de zonage 318 » |
| saint-epiphane | `157` | `1991` | 1 | Registre curé : « règlement de zonage ... numéro 157 est entré en vigueur le 4e jour du mois de mars 1991 ». |
| saint-jacques-le-majeur-de-wolfestown | `98` | `1990` | 2 | « RÈGLEMENT DE ZONAGE NUMÉRO 98 » ; le règlement 257 l’amende, il n’est pas servi. |
| saint-joseph-de-coleraine | `376` | `null` | 1 | « RÈGLEMENT DE ZONAGE NUMÉRO 376 » |
| saint-luc-de-bellechasse | `05-07` | `2007` | 1 | Registre curé : « Règlement de zonage / Numéro 05-07 » ; adoption le 11 octobre 2007. |
| saint-michel-de-bellechasse | `545-2026` | `2026` | 1 | « RÈGLEMENT DE ZONAGE / # 545-2026 / Adoption : 30 mars 2026 » |
| sainte-catherine-de-hatley | `90-256` | `null` | 1 | « CODIFICATION ADMINISTRATIVE DU RÈGLEMENT DE ZONAGE 90-256 » |

## Villes null

Aucun nouveau verdict `null` dans ce lot : aucune entrée du registre n’a été ajoutée, modifiée ou écrasée. Les 126 `HOLD-NULL` déjà enregistrés restent volontairement sans stamp, avec leur `_note` verbatim dans le registre curé ; aucun numéro n’a été déduit d’une URL, d’un nom de fichier ou d’un amendement.

## Résultat

`fold-reglement-to-zonage.ts --slugs …` : `ok=10/10`, `skipped=0`. Contrôle API servi : `10/10` collections portent `reglement_numero`. Le shard est épuisé pour les cibles non déjà qualifiées.
