# Lecture de faisabilité — v3.4 recall `qc-zoning-events` (KPI 20) sur les 167

**Date** : 2026-08-03 · **Lane** : geo-jointures (WP5) · **Auteur** : conducteur lane/jointures
**Destinataire** : owner (+ immo pour la partie (c)) · **Nature** : dry-run, mesure read-only, PAS de dépôt.
**Consigne** : franchise totale, base d'une décision de réalignement owner+immo.

> v3.4 (recall `qc-zoning-events` vs `DesignationEvent` immo) est le *spine* geo→immo→STEVE.
> Ce n'est pas hors-scope. La question owner : peut-il être **utilisable par STEVE sur les 167
> (0-unknown : chaque ville complete OU N-A prouvé) d'ici mercredi** ? Et si non, faut-il rouvrir
> la classif B′ / les inputs immo avec immo ?

---

## Verdict en une ligne

**Non — impossible d'ici mercredi, et le blocage est STRUCTUREL, en amont de geo.** La vérité-terrain
immo n'existe que pour **5 municipalités mesurables** (banc contractuel de 6, `saint-stanislas` = 0),
**il n'y a aucune liste des 167 ni aucun export immo pour les 161 autres**, et le *gate* actuel
(recall ≥ 95 % **ET** précision « 0-faux-split ») exige une métrique de précision qui **ne peut pas
converger par construction** — elle mesure un écart d'ontologie, pas une faute de geo. Il faut
**rouvrir la définition du KPI et les inputs immo AVEC immo** (i-cond + architect immo) avant que v3.4
soit scorable au palier.

---

## (a) Recall+précision « utilisable par STEVE sur les 167, 0-unknown, mercredi » ?

**Non, sur deux plans indépendants.**

### Plan mesure — le KPI est inmesurable au palier
- La vérité-terrain immo (`DesignationEvent`) couvre **5 munis** : `saint-raymond`, `sutton`,
  `coaticook`, `saint-mathieu-de-beloeil`, `saint-eustache`. `saint-stanislas` est dans le banc mais
  a **0 événement immo** (`no_immo_ground_truth`, slug ambigu). `immo_events_outside_sample = []`.
- Le banc est **codé en dur** : `RECALL_SAMPLE_MUNICIPALITIES` = ces 6 villes,
  `RECALL_SET_DENOMINATOR = 85` figé. **Aucun chemin de code ne score contre 167.**
- **Aucune liste des 167** n'existe dans ce worktree (recherche `palier`/`167`/`selection` : rien).
- Conséquence : pour 161 des 167, on ne peut déclarer **ni complete NI N-A prouvé**. Un N-A « prouvé »
  exige de **prouver 0 `DesignationEvent` attendu** ; sans export immo pour ces villes, l'absence
  n'est pas prouvée — elle est **unknown**. Donc « 0-unknown sur 167 » est hors d'atteinte côté
  mesure, indépendamment de tout code geo.

### Plan métrique — le gate est inatteignable même sur les 5 mesurables
Deux grains testés, tous deux sous le seuil :

| Grain | Recall | Précision | Over-split | Fichier |
|---|---:|---:|---:|---|
| doc+type (committé `c5b855c2`) | **79/85 = 92,9 %** | **6,58 %** (79/1200) | 1042 | `zoning-events-recall-gate-setrecall-20260803T003143Z.*` |
| action (fix over-split) | **70/85 = 82,4 %** | 15,5 % (70/451) | 374 | `zoning-events-recall-gate-action-grain-20260803.*` |

- Le **plafond de recall** est déjà quasi atteint : le crosswalk vendorisé déclare lui-même
  `mapped_ceiling: 81/85` → **recall ≤ 95,3 %**, uniquement si l'identité (muni, url, date) est
  parfaite. Le doc+type à 79 est à **~2 du plafond** ; l'identité désalignée mange les 2 derniers.
- La **précision « 0-faux-split » ne peut PAS converger** (voir (b)/§ ontologie). Le gate tel qu'écrit
  est donc inatteignable par nature, pas par manque de travail.

### Où en est le fix over-split
Le worker a produit le run **action-grain** (non committé jusqu'ici). Résultat net : il **échange du
recall contre de la précision** (79→70 recall) et **plafonne à 15,5 %** de précision. Les deux points
sont sur une **frontière de Pareto** : on ne peut pas avoir recall ≥ 95 % **et** précision haute
simultanément, parce que geo et immo modélisent l'événement à des grains différents. **Le fix
over-split ne converge pas — il déplace le curseur sur une courbe, il ne franchit pas le gate.**

---

## (b) Le vrai blocage, chiffré et rangé par ordre

**1. (AMONT, dominant) Vérité-terrain immo absente au palier + pas de liste 167.**
5 villes mesurables / 167. 161 = unknown irréductible côté mesure. C'est le blocage n°1 : il rend le
KPI 20 non-scorable au palier quel que soit l'état de geo. La vérité-terrain vit en plus dans un
chemin local `~/src/radar-immobilier/tmp/handoff/jointures-designation-events-6.ndjson` — **non
committé, non déposé sur S3** : irreproductible (défaut de capitalisation, cf. principe fondateur).

**2. (STRUCTUREL) Écart d'ontologie geo↔immo → la précision « 0-faux-split » est un mauvais gate.**
geo émet **tout le cycle réglementaire par règlement** (projet-reglement → consultation →
changement-de-zonage → entree-en-vigueur), un événement par (règlement × étape). immo n'enregistre
**qu'un `DesignationEvent` par acte-sur-lot** (derogation/rezonage/ppcmoi/cptaq/piia). Exemple mesuré :
`saint-eustache` = **377 événements geo** vs ~50 matchables immo → over-split 324–887 selon le grain.
**Ces over-split ne sont pas des erreurs** — ce sont de vrais événements geo qu'immo n'a jamais
consignés. La précision « geo-matched / total-geo » **mesure l'incomplétude d'immo, pas une faute de
geo**. Un extracteur geo parfait afficherait toujours une précision à un chiffre contre immo.

**3. (IMMO) Sous-spécification des `DesignationEvent`.** `zone_ref` peuplé **13/85**, `no_lot` **14/85**
→ **72/85 événements immo n'ont NI zone NI lot**. Sans locus, immo ne peut pas se géo-localiser
lui-même ; la jointure doit venir de geo, mais l'identité (date/url) désaligne : immo date l'événement
au PV qui *consigne* la décision, geo à la *séance* (ex. `sutton` immo 2026-06-03 vs geo 2026-05-27),
et les URL de source diffèrent parfois pour le même acte réel (`identity_not_aligned`). Les ~5 % de
recall manquants sont : identité désalignée + 3 `piia` (geo n'a pas de type PIIA) + 1
`modification_reglementation`. **Presque tout côté immo.**

**4. (geo, mineur pour le gate) Over-split geo.** Réel pour l'UX STEVE (il faut un grain d'« action »
lisible), mais **c'est un leurre pour le gate** : le collapse au grain action **coûte du recall** et
ne suffit pas. À traiter comme confort d'affichage, pas comme condition de passage.

---

## (c) Structurellement bloqué — ce qui doit changer, et faut-il rouvrir B′ avec immo ?

**Oui, il faut rouvrir la définition du KPI et les inputs immo AVEC immo (i-cond + architect immo).**
geo seul ne peut pas débloquer v3.4 : les trois premiers murs sont amont/immo/métrique.

**C1 — Redéfinir la métrique en DIRECTIONNEL (immo→geo), pas en égalité d'ensembles symétrique.**
Ce que STEVE consomme : *étant donné un `DesignationEvent` immo (acte pertinent immo), geo fournit-il
le contexte zone/lot/géométrie/règlement ?* → **recall d'enrichissement immo→geo**. La « précision »
doit être redéfinie (soit « des événements que geo ET immo consignent, geo est-il correct ? », soit un
*join-yield* directionnel), soit **retirée du gate**. Le gate « précision 0-faux-split » symétrique
est à abandonner : il pénalise geo d'être complet.

**C2 — Rouvrir la classif B′ + les inputs immo, décisions à prendre avec immo :**
- (i) **immo doit émettre `zone_ref`/`no_lot` sur les `DesignationEvent`** (72/85 nuls aujourd'hui) —
  sans locus, pas de jointure géométrique fiable.
- (ii) **Aligner la clé d'identité** : immo date au PV, geo à la séance → convenir d'une clé partagée
  ou d'une fenêtre date/url sanctionnée (aujourd'hui match exact → faux missed).
- (iii) **Trancher `piia`/`autre`** : geo n'a pas de type PIIA ; soit geo l'ajoute, soit ces kinds
  sortent du dénominateur explicitement (impact recall +3/85).
- (iv) **immo doit produire un export vérité-terrain pour les villes du palier**, ou **réduire le
  périmètre du KPI** à ce qui est mesurable, avec un énoncé de mesurabilité explicite.

**C3 — Capitaliser la vérité-terrain** : déposer l'export immo (S3 + committé), pas un `tmp/handoff`
local.

**Décision demandée à owner + immo (voir aussi la matrice ci-dessous) :**
- **Option A (réaligne le KPI, tenable rapidement)** : KPI 20 = recall d'enrichissement immo→geo sur
  l'ensemble mesurable ; les 161 sans export immo = **N-A-non-mesurable documenté** (pas « prouvé »,
  mais énoncé honnête), pas unknown fabriqué. Franchit une « décision owner », pas le gate technique.
- **Option B (correct mais long)** : investir côté immo (zone_ref/no_lot + export palier) AVANT de
  scorer v3.4. **Ne peut PAS atterrir mercredi.**

---

## Ce que geo (cette lane) peut faire sans immo, en parallèle
- Collapse au grain « action » pour l'UX STEVE (déjà prototypé : run action-grain) — **sans** le
  vendre comme franchissement de gate.
- Combler les faux `identity_not_aligned` par une fenêtre date/url **si** immo sanctionne la clé (C2-ii).
- Rien de tout cela ne change le verdict (a) : le palier reste inmesurable sans input immo.

---

## Provenance (rejouable)
- Runner : `acquisition/src/zoning-events-recall-gate.ts` (banc figé 6 villes, dénominateur 85).
- Crosswalk gelé : `acquisition/src/data/crosswalk-taxonomie.json` (immo `b9c121d` / PR #451, blob `dfe67cf`) — `mapped_ceiling: 81/85`.
- geo dry-run : `work/coverage/qc-zoning-events-dryrun-action-grain-20260803/` (451 événements, 5 villes).
- immo vérité-terrain : `radar-immobilier/tmp/handoff/jointures-designation-events-6.ndjson` (85 DesignationEvents + 182 Signals, 5 munis) — **à capitaliser (S3+commit)**.
- Runs de recall : `zoning-events-recall-gate-setrecall-20260803T003143Z.*` (doc+type) ; `zoning-events-recall-gate-action-grain-20260803.*` (action).
- Per-city col 20 : `work/coverage/qc-zoning-events-col20-per-city-20260803.json`.
