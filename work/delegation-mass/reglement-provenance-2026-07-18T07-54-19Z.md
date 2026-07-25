# Provenance règlement — shard 0/3 — 2026-07-18T07:54:19Z

Périmètre : slugs `reglement=false` de `zonage-enrichment.json`, triés, avec
`index % 3 == 0`. Le shard compte 99 cibles. Aucune découverte hors de l'URL
servie n'a été effectuée.

## Villes servies confirmées

Un second passage a traité les 12 numéros déjà curés du shard. Trois polygones
existent; le fold est idempotent (`cellsChanged=0`) car les quatre champs y
étaient déjà présents. Contrôle API après fold :

| Slug | Avant | Après | `reglement_numero` API |
| --- | --- | --- | --- |
| saint-damien | 753 | 753 | 753 |
| sainte-emelie-de-lenergie | 15RG-0712 | 15RG-0712 | 15RG-0712 |
| sainte-melanie | 673.1-2024 | 673.1-2024 | 673.1-2024 |

- `saint-damien` — p1 «REGLEMENT DE ZONAGE NO. 753»; p2 «Adoption du
  reglement : 3 octobre 2017». Millésime 2017.
- `sainte-emelie-de-lenergie` — p1/p3 «RÈGLEMENT D'URBANISME NUMÉRO
  15RG-0712»; adoption le 14 janvier 2013. Millésime 2013.
- `sainte-melanie` — p5 «Reglement de zonage de la Municipalite de
  Sainte-Melanie numero 673.1-2024». Millésime null : aucune date d'adoption
  ou d'entrée en vigueur dans le corps.

Les neuf autres numéros curés (`beloeil`, `lile-cadieux`, `lile-perrot`,
`lorraine`, `mascouche`, `saint-isidore--roussillon`,
`saint-jean-sur-richelieu`, `saint-patrice-de-sherrington`,
`saint-urbain-premier`) n'ont pas de polygone `qc-zonage-<slug>` servi : le
fold les a explicitement ignorés.

## Avant / après servi

| Slug | Avant | Après | Résultat du fold |
| --- | --- | --- | --- |
| authier | absent | absent | skip (numéro null) |
| barkmere | absent | absent | skip (numéro null) |
| farnham | absent | absent | skip (numéro null) |
| hemmingford--les-jardins-de-napierville | absent | absent | skip (numéro null) |
| lac-des-aigles | absent | absent | skip (numéro null) |
| notre-dame-de-lourdes--joliette | absent | absent | skip (numéro null) |
| orford | absent | absent | skip (numéro null) |
| prevost | absent | absent | skip (numéro null) |
| rougemont | absent | absent | skip (numéro null) |
| saint-alexis | absent | absent | skip (numéro null) |

Les dix lignes sont les seules de ce shard ayant à la fois un polygone servi
et une URL/source de grille exploitable. `fold-reglement-to-zonage.ts` a été
exécuté sur elles : `DONE ok=0/10 skipped=10`. Contrôle collection servi :
`qc-zonage-authier` renvoie `reglement_numero = null`.

`beloeil` a bien le registre curé `1667-00-2011`, millésime 2012, lu p1
(`«RÈGLEMENT DE ZONAGE / 1667-00-2011»`, `«ADOPTION : 27 février 2012»),
mais aucun polygone `qc-zonage-beloeil` n'est servi : pas de fold ni de
contrôle collection possible.

## Nulls confirmés (verbatim-or-null)

- `authier` — PDF servi (16 p) : aucune occurrence de «reglement», «zonage»
  ou d'année; aucune numéro officiel lisible.
- `barkmere` — p1 : «Annexe 2 du Règlement de zonage»; aucune numéro dans les
  28 pages. «No. de règlement / Entrée en vigueur» est une en-tête vide; la
  date «13 juin 2009» est associée à «Apur urbanistes-conseils», pas à une
  adoption.
- `farnham`, `prevost`, `rougemont` — source servie sentinelle
  `https://non-disponible`; aucun PDF connu à lire.
- `hemmingford--les-jardins-de-napierville` — `_source_url` vers
  `www.mrcmatapedia.qc.ca`, hors de la MRC Les Jardins-de-Napierville :
  provenance fausse, non utilisable.
- `lac-des-aigles` — grille (7 p) sans «règlement», numéro, adoption ou entrée
  en vigueur; les 4 chiffres visibles sont des codes CUBF, pas un millésime.
- `notre-dame-de-lourdes--joliette` — URL servie est un portail HTML de
  procès-verbaux, pas un PDF de règlement.
- `orford` — cahier de grilles (126 p), p1 «GRILLE DES USAGES ET DES
  SPÉCIFICATIONS PAR ZONE / ZONE: P1»; aucune couverture ni numéro dans le
  document. Le `951` du nom de fichier n'est pas retenu.
- `saint-alexis` — annexe B scannée; «2025-127» n'est présent que dans le nom
  de fichier et n'est pas confirmé verbatim dans le document.

Les entrées null étaient déjà présentes dans
`acquisition/config/reglement-provenance.json`; aucune modification du
registre n'est justifiée par ce shard.
