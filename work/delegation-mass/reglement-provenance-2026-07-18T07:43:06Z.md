# Provenance règlement — shard 0/3 — 2026-07-18T07:43:06Z

Périmètre: uniquement les slugs dont l’index dans la liste triée des 295 villes
`reglement=false` est congru à `0 mod 3` (99 slugs). Le registre curé contenait
déjà un verdict pour chacun: 94 verdicts `null` motivés et les cinq dossiers
complets ci-dessous. Aucun numéro n’a été déduit d’une URL ou d’un nom de fichier.

## Villes servies / contrôlées

| Slug | Lecture verbatim contrôlée | Avant | Après (`qc-zonage`) |
| --- | --- | --- | --- |
| beloeil | PDF p. 1: «RÈGLEMENT DE ZONAGE / 1667-00-2011», «ADOPTION : 27 février 2012» | Registre: `1667-00-2011`, 2012, p. 1, URL source. Polygone absent du stockage (`SKIP polygone qc-zonage non servi`). | API: `null`; aucun polygone servi à enrichir. |
| lile-perrot | PDF p. 1: «Règlement numéro 746»; tableau: «746 / 1er octobre 2025»; p. 2: «ADOPTION : Le 1er octobre 2025». | Registre: `746`, 2025, p. 1, URL source. Polygone absent du stockage (`SKIP polygone qc-zonage non servi`). | API: `null`; aucun polygone servi à enrichir. |
| mascouche | PDF p. 1: «Règlement de zonage no 1103»; p. 3: «RÈGLEMENT NUMÉRO 1103» et séance du 5 septembre 2006 qui statue et ordonne par ce règlement. | Registre: `1103`, 2006, p. 1, URL source. Polygone absent du stockage (`SKIP polygone qc-zonage non servi`). | API: `null`; aucun polygone servi à enrichir. |
| saint-damien | PDF p. 1: «RÈGLEMENT DE ZONAGE NO. 753»; p. 2: «Adoption du règlement : 3 octobre 2017». | Registre: `753`, 2017, p. 2, URL source. Pliage: 61 polygones, `cellsChanged=0` (déjà conforme). | API: `753`. |
| sainte-emelie-de-lenergie | PDF p. 1: «Règlement d’urbanisme numéro 15RG-0712 / Relatif au zonage», «Adoption du règlement : 14 janvier 2013». | Registre: `15RG-0712`, 2013, p. 1, URL source. Pliage: 52 polygones, `cellsChanged=0` (déjà conforme). | API: `15RG-0712`. |

## Villes null

Aucun nouveau verdict `null` n’a été écrit dans ce lot: les 94 verdicts `null`
du shard étaient déjà présents et motivés dans le registre curé. Ils ont été
laissés inchangés afin de ne pas réécrire des décisions concurrentes. Les trois
valeurs API `null` ci-dessus ne sont pas des règlements absents: les collections
polygones `qc-zonage` correspondantes ne sont pas servies, donc le fold ne peut
pas les écrire.

## Résultat

Le contrôle PDF confirme les cinq numéros et millésimes du registre. Deux
collections polygones servies portent déjà les quatre champs requis; trois
restent bloquées exclusivement par l’absence de collection `qc-zonage`, non par
une absence de provenance règlement.
