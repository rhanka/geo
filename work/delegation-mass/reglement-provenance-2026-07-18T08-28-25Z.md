# Provenance règlement — shard 0/2 — 2026-07-18T08:28:25Z

Périmètre : les 252 slugs `served=true` et `reglement=false` de
`work/coverage/zonage-enrichment.json`, triés, puis filtrés par
`index % 2 == 0`. Le shard compte donc 126 villes. Le registre curé contient
déjà une décision pour chacune : 11 numéros officiels et 115 verdicts `null`
motivés. Aucune découverte hors des URL déjà servies n’a été faite.

## Villes servies — avant / après

Les 11 numéros ci-dessous étaient déjà présents dans le registre. Les grilles
`qc-zonage-norms-*` publiques ont bien été croisées pour leurs métadonnées
source : elles portent encore `reglement_numero=null`, mais leurs URLs
`_source_url` / `reglement_url` correspondent au registre lorsqu’elles sont
présentes. La collection publique de polygones `qc-zonage-*` porte déjà le bon
numéro dans les onze cas.

| Slug | Avant dans `zonage-enrichment` | Registre / millésime | Après : API publique |
| --- | --- | --- | --- |
| degelis | `false` | `656` / `2018` | `656` |
| montebello | `false` | `Z-17-01` / `2017` | `Z-17-01` |
| notre-dame-du-sacre-coeur-dissoudun | `false` | `2007-06` / `null` | `2007-06` |
| pointe-fortune | `false` | `400-2024` / `null` | `400-2024` |
| roberval | `false` | `2018-09` / `null` | `2018-09` |
| saint-damien | `false` | `753` / `2017` | `753` |
| saint-polycarpe | `false` | `218-2025` / `null` | `218-2025` |
| saint-roch-des-aulnaies | `false` | `315-2016` / `2016` | `315-2016` |
| sainte-beatrix | `false` | `526-2012` / `2012` | `526-2012` |
| sainte-emelie-de-lenergie | `false` | `15RG-0712` / `2013` | `15RG-0712` |
| sainte-melanie | `false` | `673.1-2024` / `null` | `673.1-2024` |

Preuves curées, relues comme critères de décision (numéro verbatim, jamais
déduit de l’URL) :

- `degelis` — p1 «REGLEMENT NUMERO 656» sous «REGLEMENT DE ZONAGE»; p195
  «Reglement entre en vigueur le 14 mars 2018».
- `montebello` — p1 «RÈGLEMENT DE ZONAGE NUMÉRO Z-17-01»; adoption le
  19 juin 2017.
- `notre-dame-du-sacre-coeur-dissoudun` — p9 «Le present reglement porte le
  titre de « Reglement de Zonage » et le numero 2007-06.»; aucune date
  d’adoption ou d’entrée en vigueur imprimée.
- `pointe-fortune` — p1 «RÈGLEMENT NUMÉRO 400-2024»; aucune date
  d’adoption/EEV verbatim accessible, donc millésime `null`.
- `roberval` — en-tête p2+ «Règlement zonage no 2018-09»; aucune date
  d’adoption/EEV dans la grille, donc millésime `null`.
- `saint-damien` — p1 «REGLEMENT DE ZONAGE NO. 753»; p2 «Adoption du
  reglement : 3 octobre 2017».
- `saint-polycarpe` — p1 «RÈGLEMENT DE ZONAGE NUMÉRO 218-2025»; aucune date
  d’adoption/EEV imprimée, donc millésime `null`.
- `saint-roch-des-aulnaies` — p1 «Règlement no. 315-2016 – 21 novembre
  2016»; les 338-2019, 355-2021, 366-2023 et 379-2024 sont explicitement des
  amendements.
- `sainte-beatrix` — p10 «peut aussi être cité sous le nom de « Règlement
  numéro 526-2012 »»; p1 «Règlement adopté le 9 juillet 2012».
- `sainte-emelie-de-lenergie` — p1/p3 «RÈGLEMENT D'URBANISME NUMÉRO
  15RG-0712»; adoption le 14 janvier 2013.
- `sainte-melanie` — p5 «Reglement de zonage de la Municipalite de
  Sainte-Melanie numero 673.1-2024»; l’art. final dit seulement «Le present
  reglement entrera en vigueur conformement a la Loi.», donc millésime `null`.

Le pliage demandé a été lancé pour ces onze slugs. Le `npx tsx` normal ne peut
pas démarrer dans ce bac (socket IPC interdit) ; l’exécution Node/TS équivalente
(`node --import …/tsx/dist/loader.mjs`) a donné `DONE ok=0/11 skipped=11`, car
le backend S3 configuré ne trouve aucune clé `qc-zonage-<slug>`. Aucun PUT n’a
donc été effectué. Les onze appels demandés à l’API publique, après ce passage,
retournent les valeurs de la colonne «Après» : le service est déjà correct et
la matrice de couverture est périmée sur ce point.

## Nulls confirmés (verbatim-or-null)

Le détecteur de verdicts potentiellement périmés a signalé 23 corpus locaux.
Les dix cas suivants sont les documents les plus à risque, mais leur raison
verbatim conserve un `null` honnête :

- `amos` — p1 «#A) Zones agricoles « A-1 » / GRILLE DE SPECIFICATIONS /
  ZONE A-1»; le recueil de 550 pages ne porte aucun numéro de règlement.
- `cloridorme` — le PDF local nouvellement présent est seulement
  `websearch-grille.pdf`; il n’existe toujours aucune grille de normes servie
  ni URL de règlement à lire. Aucun numéro n’est attesté.
- `frontenac` — p1 «RÈGLEMENT NO. 378-2008 REMPLAÇANT LE RÈGLEMENT NO.
  316-99 SUR» puis «sur le colportage» : c’est un règlement de colportage,
  pas de zonage.
- `lascension-de-patapedia` — p1 «Règlement numéro xxxxxx» et p2
  «RÈGLEMENT NUMÉRO xxxxx»; les dates sont des pointillés vides. C’est un
  gabarit non rempli, pas un numéro officiel.
- `maskinonge` — couverture exactement «RÈGLEMENT DE ZONAGE», «ANNEXE A»,
  «TERMINOLOGIE»; aucune numéro, municipalité ni date dans cette annexe.
- `saint-cyprien--les-etchemins` — le seul PDF est «382-2025 RÈGLEMENT DE
  CONCORDANCE MODIFIANT LE RÈGLEMENT DE LOTISSEMENT NO 261-07 ET LE
  RÈGLEMENT RELATIF AUX PERMIS ET CERTIFICATS 260-07»; il ne numérote pas le
  zonage. `260-07` administre le zonage, il ne l’est pas.
- `saint-felicien` — le cahier servi ne contient aucune occurrence de
  «18-943»; «18-969», «18-965», «18-967» et «18-950» sont des amendements ou
  autres règlements. Le numéro dans l’URL est écarté.
- `saint-pierre-de-lamy` — p1 «PROJET DE Règlement numéro 2022-005 modifiant
  le Plan d’urbanisme numéro 01-2014» : projet de plan d’urbanisme, non un
  règlement de zonage en vigueur.
- `sainte-rose-de-watford` — le PDF est un avis public d’«ENTRÉE EN VIGUEUR»;
  il ne numérote aucun règlement de zonage.
- `val-saint-gilles` — p1 «PROJET / RÈGLEMENT DE ZONAGE / Règlement no. /
  Adopté le : / Entrée en vigueur le :» et p5 «Règlement de zonage numéro
  XX» : champs vides/placeholder, donc aucun numéro officiel.

Les 105 autres `null` du shard restent consignés avec leur raison verbatim
complète dans `acquisition/config/reglement-provenance.json`. Le lint du
registre est vert : 848 clés uniques, 592 numéros et 256 `null` motivés ; il
n’y a ni doublon ni champ manquant. Aucune valeur n’a été inférée d’un nom de
fichier, d’une URL ou de l’année incluse dans un numéro.
