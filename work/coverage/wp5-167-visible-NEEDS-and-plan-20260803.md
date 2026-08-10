# WP5 v3.4 — rendre le recall qc-zoning-events VISIBLE sur les 167 (plan + NEEDS)

Lane `lane/jointures` (worktree `.lanes/jointures`). Conducteur = cette instance.
Mandat owner (2026-08-03) : **résultat v3.4 VISIBLE sur les 167 pour mercredi**,
pas de « impossible / N-A ». On PRODUIT. ACK = ce commit.

## Décision structurante
Le verdict de faisabilité `3e30d696` (banc figé à 6 villes, gate précision
symétrique mal défini) est REMPLACÉ comme cible opérationnelle par une émission
et une mesure DIRECTIONNELLES sur les 167. La précision symétrique est retirée
du gate ; la métrique retenue est le **recall directionnel immo→geo** (métrique
Steve) : étant donné un DesignationEvent immo, geo fournit-il zone / lot / géom /
règlement ? Mesuré par ville là où la vérité-terrain immo existe.

## État du terrain (constaté)
- `acquisition/src/zoning-events-recall-gate.ts` câble EN DUR
  `RECALL_SAMPLE_MUNICIPALITIES` (6 villes) et `RECALL_SET_DENOMINATOR = 85`.
  → à dé-câbler vers un paramètre `--cohort <fichier de slugs>`.
- `acquisition/src/zoning-events-detect-emit.ts::runZoningEventsDryRun` est DÉJÀ
  paramétré par `--cities` : il détecte (adapter PV-corps), joint les zones
  servies S3, et écrit un `documents.json` directement consommable par le gate.
  → l'émission L1 sur les 167 = un RUN piloté par la cohorte, pas du code neuf.

## ⛔ NEEDS — liste des 167 (BLOCAGE amont, owner résout)
`docs/spec/reports/set-167-bprime.tsv` (PR #436, radar
`feat/set-167-canonical@800ee90`, handoff sha `d3ac9f81`) est **ABSENT** de ce
worktree ET de `/tmp/handoff` au 2026-08-03. Sans lui je ne peux pas énumérer les
167 lignes de l'artefact col-20 ni cadrer l'émission sur la cohorte exacte.

**Clé de jointure autoritaire = `graph_city_slug`** (pas `slug` ; forme
double-tiret = serving zonage). Cohorte = `priorityRank ≤ 167`.

Fournir l'un de :
1. `docs/spec/reports/set-167-bprime.tsv` committé/mergé dans cette lane, ou
2. un chemin S3 stable vers la tsv, ou
3. la simple liste des 167 `graph_city_slug` (un slug par ligne).

## Ce qui AVANCE sans attendre la liste
1. **Dé-câblage du gate** : `--cohort <fichier>` remplace les 6 villes en dur ;
   le dénominateur du recall dérive du compte de GT immo de la cohorte (ou d'un
   `--denominator`), plus jamais `85` gelé. Rétro-compat : défaut = les 6.
2. **Générateur col-20 par ville** (`zoning-events-cohort-col20.ts`) : lit
   (cohorte, documents geo émis, export GT immo optionnel) → une ligne par ville
   `{ slug, geo_events_count, immo_gt_available, recall_pct_si_mesurable, statut }`.
   GT immo absente ⇒ `statut = "immo-gt-pending"` (JAMAIS un unknown fabriqué).
3. **Émission L1 geo** sur le corpus disponible (RUN `runZoningEventsDryRun` sur
   la cohorte / le corpus servi) → `geo_events_count` par ville = résultat
   VISIBLE côté geo, indépendant d'immo.

## Dépendance immo (escaladée en parallèle)
immo produit l'export DesignationEvent des 167 (le conducteur méta l'escalade).
À réception : brancher l'export comme `--immo-events`, passer les villes
concernées de `immo-gt-pending` → `measured`, calculer le recall directionnel.

## Livrable #1 attendu
Dé-câblage + émission 167 + artefact col-20 par ville (167 lignes), committé et
capitalisé (S3 + git). Ce fichier est l'ACK et le contrat de la lane.
