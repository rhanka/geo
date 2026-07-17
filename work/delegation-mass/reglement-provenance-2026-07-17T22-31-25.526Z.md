# Provenance règlement — shard 1/2

Date : `2026-07-17T22:31:25.526Z`

## Périmètre et réconciliation

- Règle de shard : liste triée des 272 municipalités servies avec `reglement=false`, indice `i % 2 === 1`.
- Mon shard contient 136 slugs.
- Le registre curé contenait déjà une entrée pour les 136 : 126 verdicts `null` documentés et 10 numéros officiels.
- Les 10 numéros ont été relus sur leurs PDF (copie locale ou URL publique connue), puis le fold a été exécuté. Le dry-run et le run ont tous deux retourné `ok=10/10`, `skipped=0`, `cellsChanged=0` : les fichiers S3 étaient déjà conformes, sans écrasement.

## Villes servies — avant → après

« Avant » est la valeur lue par le dry-run sur le polygone S3 ; `cellsChanged=0` prouve qu'elle est identique à la valeur « après » vérifiée sur l'API servie.

| Slug | Avant → après (`reglement_numero`, millésime) | Preuve verbatim | URL servie |
| --- | --- | --- | --- |
| compton | `2020-166`, `2020` → identique | p3 « Municipalité de Compton / RÈGLEMENT DE ZONAGE N° 2020-166 » ; p4 « Adoption : 14 juillet 2020 » | oui |
| saint-adrien | `248-2003`, `null` → identique | p1 « le Règlement de zonage numéro 248-2003 ainsi que ses modifications est en vigueur » | non : corpus local |
| saint-alphonse | `274-2013`, `null` → identique | p1 « MODIFIANT LE RÈGLEMENT DE ZONAGE NUMÉRO 274-2013 » | non : corpus local |
| saint-donat--la-mitis | `318`, `null` → identique | « Règlement de zonage 318 » (en-tête de grille) | non : corpus local |
| saint-epiphane | `157`, `1991` → identique | p1 « le règlement de zonage de la Municipalité de Saint-Épiphane numéro 157 est entré en vigueur le 4e jour du mois de mars 1991 » | non : corpus local |
| saint-jacques-le-majeur-de-wolfestown | `98`, `1990` → identique | p2 « le règlement de zonage de la municipalité de Saint-Jacques-le-Majeur-de-Wolfestown est en vigueur depuis le 15 octobre 1990 » | non : corpus local |
| saint-joseph-de-coleraine | `376`, `null` → identique | p1 « RÈGLEMENT DE ZONAGE NUMÉRO 376 » | non : corpus local |
| saint-luc-de-bellechasse | `05-07`, `2007` → identique | p1 « Règlement de zonage / Numéro 05-07 » ; art. 1.3 « a adopté le présent règlement le 11 octobre 2007 » | non : corpus local |
| saint-michel-de-bellechasse | `545-2026`, `2026` → identique | p1 « RÈGLEMENT DE ZONAGE / # 545-2026 / Adoption : 30 mars 2026 » | non : corpus local |
| sainte-catherine-de-hatley | `90-256`, `null` → identique | p1 « CODIFICATION ADMINISTRATIVE DU RÈGLEMENT DE ZONAGE 90-256 ET SES MODIFICATIONS » | oui |

Contrôle API effectué pour les 10 collections `qc-zonage-<slug>` : les dix `reglement_numero` correspondent au tableau. Les URL publiques servies sont celles de Compton et Sainte-Catherine-de-Hatley ; les huit autres valeurs `reglement_url=null` sont intentionnelles, car aucune URL publique vérifiée ne porte leur preuve locale.

## Villes null

Aucun verdict `null` n'a été créé, modifié ou annulé dans ce lot de 10 villes : aucune valeur non verbatim n'a été ajoutée. Les 126 verdicts `null` restants de ce shard étaient déjà présents dans `acquisition/config/reglement-provenance.json`, avec leur raison verbatim dans `_note`; ils restent inchangés. Exemples de raisons conservées telles quelles :

- barkmere : « l'annexe ne nomme AUCUN numéro de règlement de zonage ».
- degelis : « Le règlement de zonage de base n'est jamais numéroté dans le document. »
- temiscouata-sur-le-lac : « le seul doc connu [...] est un PROJET, pas un règlement OFFICIEL adopté. »
- saint-francois-du-lac : « le _source_url servi [...] est le RÈGLEMENT DE ZONAGE #2010-116 de la MUNICIPALITÉ DE SAINT-FRANÇOIS-XAVIER-DE-BROMPTON, PAS de Saint-François-du-Lac ».

## Écriture et suite

`acquisition/config/reglement-provenance.json` était déjà conforme : aucune modification locale à committer pour ce fichier. Le run `fold-reglement-to-zonage.ts --slugs ...` est idempotent et n'a écrit aucune cellule, car les collections servies portaient déjà les quatre champs attendus.
