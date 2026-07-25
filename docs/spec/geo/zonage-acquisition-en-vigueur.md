# Acquisition du zonage EN VIGUEUR — spec canonique (geo owns)

> Origine : leçon Mont-Tremblant (2026-07), généralisée avec l'agent immo
> (radar-immobilier) via h2a loop-mrf5dl5b. geo est propriétaire de l'acquisition
> du zonage ; immo consomme l'OGC servi et mesure le rendu (fold-lot). Cette spec
> est le contrat partagé. Appliquer au focus-60 puis à la province.

## Principe

« Servi » ≠ « rendu ». Le critère d'acceptation n'est pas « une couche zonage
existe » ni même « zone↔grille cohérent au niveau couche » — c'est le **FOLD-LOT** :
sur le site, un lot QUELCONQUE affiche son **code de zone en vigueur** + ses normes
(**hauteur, densité, marges, façade min, superficie min**). Tant que ce n'est pas
vrai pour un lot pris au hasard, la ville n'est **pas** faite.

## Le piège MT (à éviter partout)

1. **Nom de couche trompeur** : la couche ArcGIS `Ancien_zonage` de Mont-Tremblant
   est en réalité le zonage **EN VIGUEUR** (ses codes matchent le règlement 2008-102
   en vigueur). On l'avait écartée sur son nom → erreur. **Choisir la géométrie par
   COHÉRENCE DES CODES avec la grille, jamais par le nom.**
2. **Grille partielle** : le règlement 2008-102 a **10 annexes par catégorie**
   (zone-100..zone-1000). N'extraire que l'annexe-100 (famille 1xx) donne 8 % de
   recouvrement. **Extraire TOUTES les catégories.**
3. **Amendement ≠ règlement rival** : `102-60` est l'amendement (2020) au base (2008)-102,
   pas un règlement concurrent. Ne pas re-sourcer un « bon millésime » qui existe déjà.

## Checklist par ville (10 points)

1. Règlement de base identifié (n° + année).
2. Amendements listés et rattachés au base (un n° d'amendement n'est pas un règlement rival).
3. Inventaire de **TOUTES** les annexes / catégories (ex MT : 10, pas 1).
4. Grille extraite pour **TOUTES** les catégories (fusion en une grille complète).
5. Géométrie tout-territoire choisie par **cohérence des codes** avec la grille (pas le nom de couche).
6. Codes **canonicalisés Lettre-Num** sur zonage + grille + lots (`canonZoneCodeServe`).
7. Recouvrement zone∩grille mesuré sur **toutes** les familles (`zone-grille-coherence-gate.ts`).
8. Fold-lot vérifié sur échantillon (lot nominal + %).
9. Provenance tracée (règlement + n° amendement + date + URL).
10. Mesure sur la **bonne cohorte** (z∩m∩p), pas un proxy géographique.

## Gates d'acceptation (rendu, pas marqueur)

- **G1 — cohérence zone∩grille** : ≥ 80 % des zones (toutes familles) portent une ligne
  de grille. Pas de résidu type 8 % (= grille partielle).
- **G2 — complétude FOLD-LOT** : ≥ 80 % des lots ont un `zone_code` + normes foldées ;
  un lot quelconque affiche code + hauteur + densité + marges + façade/superficie min.
- **G3 — provenance 100 %** : règlement + n° amendement + date + URL renseignés.
- **G4 — cohorte** : mesure sur le focus z∩m∩p, pas sur `priorityRank 1..30` (couronne MTL).

## Outillage geo (par étape de la checklist)

| Étape | Outil committé |
| --- | --- |
| Grille (extraction toutes catégories) | `acquisition/src/zonage-norms-run.ts` (Mistral OCR/schema, une annexe/PDF) ; glyphes → vision Claude |
| Grille → OGC servi | `acquisition/src/publish-norms-grilles.ts` (registry parquet → `normalized/`), puis rollout geo-api |
| Géométrie en-vigueur | source SIG municipale (ArcGIS/WFS) choisie par cohérence des codes, sinon recalage T1/T2 (`t1-build`/`t2-autogcp`/`t2-build`) |
| Canonicalisation ordre servi | `acquisition/src/zonage-canon-serve-run.ts` (Lettre-Num sur les 2 collections) |
| Fold-lot | `acquisition/src/lot-zone-join-run.ts` + `lots-enriched-run.ts` (chaîne : `focus-zone-pipeline.ts --slug`) |
| `*_value` normes depuis raw | `acquisition/src/zonage-norms-reparse-run.ts` (fill-nulls-only, no re-OCR) |
| Mesure des gates | `acquisition/src/zone-grille-coherence-gate.ts` (recouvrement strict + RAW + flags order/ancien) |
| Publication | `kubectl --kubeconfig ~/.kube/poc.yaml -n geo rollout restart deployment/geo-api` |

## Protocole de clôture ville-par-ville (avec immo, pire-maillon d'abord)

1. geo publie zonage + grille **complète** + re-fold lots + rollout.
2. geo pingue « ville X prête » (h2a, avec zone∩grille% + fold-lot% + 1 lot nominal).
3. immo re-mesure (snapshot autoritaire sur collection entière, cohorte z∩m∩p).
4. G1..G4 verts → « ville terminée » ; sinon immo renvoie le maillon manquant. Avancer par vagues.

## Note sur le flag `ancien-zonage` du gate

Le flag par NOM (`/ancien|former|abrog/`) est un **warning**, pas un couperet :
`real_zoning` reste `true` si le recouvrement strict est élevé (les codes matchent la
grille en vigueur = preuve que la couche EST en vigueur, quel que soit son nom) ou si la
provenance est explicitement vérifiée. La preuve par les codes prime sur le nom.
