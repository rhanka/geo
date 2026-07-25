# Provenance règlement — shard 2/3 — 2026-07-18T08:01:32Z

Périmètre : 84 slugs `served=true` et `reglement=false` de
`work/coverage/zonage-enrichment.json`, triés puis filtrés par `index % 3 == 2`.
Le registre curé contenait déjà les 84 décisions : 3 numéros et 81 verdicts
`null`. Il n’y avait donc aucune entrée de registre à réécrire.

## Villes servies, avant / après

Le fold officiel a été exécuté pour les trois numéros curés. Il est idempotent
(`cellsChanged=0`) : les champs sont déjà sur les polygones servis. La
vérification API demandée a retourné les mêmes valeurs après le fold.

| Slug | Avant `reglement_numero` | Après / API | Preuve curée |
| --- | --- | --- | --- |
| ogden | `2025-05` | `2025-05` | p1 «RÈGLEMENT DE ZONAGE / # 2025-05» |
| pointe-fortune | `400-2024` | `400-2024` | p1 «RÈGLEMENT NUMÉRO 400-2024» |
| saint-polycarpe | `218-2025` | `218-2025` | p1 «RÈGLEMENT DE ZONAGE NUMÉRO 218-2025» |

`ogden` porte aussi le millésime `2025`; `pointe-fortune` et
`saint-polycarpe` gardent un millésime `null`, car aucune date d’adoption ou
d’entrée en vigueur n’est imprimée dans leur document lisible. L’année du
numéro n’a pas été inférée.

## Nulls confirmés sur le lot de PDF à URL servie

- `barkmere` — p1 «GRILLE DES SPÉCIFICATIONS / Annexe 2 du Règlement de
  zonage / VILLE DE BARKMERE»; les 28 pages ne donnent aucun numéro. La
  colonne «No. de règlement / Entrée en vigueur» est vide, et «13 juin 2009»
  est la date d’«Apur urbanistes-conseils», pas une adoption.
- `lac-des-aigles` — grille de spécifications sans occurrence de «règlement»,
  numéro ou date d’adoption/entrée en vigueur; «2011 à 2099, 2711 à 2722» sont
  des codes d’usage CUBF.
- `mont-saint-michel` — l’URL servie
  `Grilles_specifications_R257.pdf` répond désormais HTTP 404; «R257» n’est
  que le nom de fichier, donc aucun numéro n’est déposé.
- `saint-alexis` — l’URL servie `2025-127_annexe_B.pdf` répond désormais HTTP
  404; le registre conserve le verdict antérieur : annexe B scannée, où
  «2025-127» n’est pas confirmé dans le document.
- `saint-antoine-de-lisle-aux-grues` — PDF scan image; lecture visuelle p1
  «ST-ANTOINE-DE-L'ISLE-AUX-GRUES / GRILLE DES USAGES PERMIS», p2 grille pure,
  sans numéro. «18070» est l’identifiant de fichier.
- `saint-felicien` — le cahier de 235 pages ne contient aucune occurrence de
  «18-943»; il cite des amendements, notamment «18-969», «18-965» et
  «18-967», jamais le règlement de base.
- `saint-gabriel-de-brandon` — le PDF de 80 pages ne nomme ni son règlement ni
  sa municipalité (`OWNER-ABSENT`); aucune occurrence de «règlement de zonage
  numéro N».
- `saint-jean-de-matha` — p1 «GRILLE DES SPÉCIFICATIONS / Règlement de zonage
  / ZONE P1-1» : «P1-1» est explicitement le code de zone, pas le numéro du
  règlement.
- `saint-roch-ouest` — «ANNEXE 4.2 CADRE NORMATIF POUR LE CONTRÔLE DE
  L’UTILISATION DU SOL DANS LES ZONES DE CONTRAINTES»; «151-2023» n’est pas
  imprimé comme numéro de règlement de zonage de base.
- `saint-thomas` — p1 «Règlement de zonage - ANNEXE \"B\"» nomme le règlement
  sans le numéroter; aucune occurrence de «règlement de zonage numéro N» dans
  les 62 pages.

Les 71 autres verdicts `null` du shard étaient déjà consignés, avec leur
raison verbatim, dans `acquisition/config/reglement-provenance.json`; aucun
nouveau fait ne justifie de les modifier. Aucun numéro n’a été déduit d’une
URL ou d’un nom de fichier.
