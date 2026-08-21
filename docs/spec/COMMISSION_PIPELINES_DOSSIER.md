# COMMISSION — Dossier « Pipelines de données geo : mise au carré + dé-entropie »

> **Statut : COMMISSION cadrée (geo-archi, WP6) — à FIRE par geo-cond (gpt-5.6-sol xhigh) dès reconnexion MCP h2a.**
> Track : `01M0GWZW2753PV92WJ2PGX5GS2` (chore, accountable geo-archi). Réf stable pour le launch sanctionné.
> **Flow** : geo-cond fire sol → sol PRODUIT (grounding fresh) → **claude-fable-5** double-revoit (indépendant) →
> **geo-archi synthétise** (désaccords préservés) → **geo-cond présente à l'owner** (AskUserQuestion, Q/R).
> **Grounding déjà seedé** : `portfolio-city-report` FRESH `2026-08-20` (état au-carré par-pipeline, cf. §Seeds).

## Prompt sol (commission)

Tu es **gpt-5.6-sol (xhigh)**, commissionné par geo-archi (WP6) pour PRODUIRE l'analyse détaillée d'un dossier de
décision owner. Repo **geo** (Node/TS, QC land-use data QC, 1106 munis).

### Objectif owner (verbatim, à honorer)
> « merge main declanche ecrasement en preprod des données par celles de prod + upgrade, preprod est utilisé pour
> test les pipeline, mais tag pour déploiement prod ou les vraies données sont jouées / sauvegardées etc »
> « tout doit tourner sur k8s, y compris les raffraichissement pour les pv et autres données actualisables »
> « gérer a la baisse l'entropie de la spécificité des pipeline par ville, qu'on ait des moteurs commun de
> raffraichissement, qu'on minimise l'usage de llm aux stricts besoins et non l'inverse »

### Livrable : MATRICE pipeline × couche + recos cibles
**8 pipelines** : zones · normes · PV · règlement · usage dominant · effet densifiant · cadastre/rôle · immo-lots.
**6 couches** : capture → normalisation → extraction → jointure → serving → **refresh**.
(**extraction + jointure = MOTEURS TRANSVERSES** — analyse séparément, pas par pipeline.)

**Par cellule** : **au-carré ? `[FACT sourcé]`** (reproductible/rejouable/capitalisé/prouvé, principe fondateur) ·
**LLM `[FACT où + JUDGMENT requis/remplaçable + comment]`** · **spécificité par-ville `[data/config vs bespoke]`** ·
**refresh `[onk8s-cron / onk8s-job / local / absent]`**.

### Grounding OBLIGATOIRE (anti-invention)
1. **`node scripts/portfolio-city-report.mjs` FRESH** (le snapshot `20260725` est PÉRIMÉ ; `20260820` régénéré).
2. **`track report`** (état items/décisions).
3. **Lis le code réel** (`acquisition/src/`, `packages/`, `deploy/`) — pas de mémoire.
4. **Consulte les lane-conductors** pour normes · usage dominant · effet densifiant · cadastre/rôle. Confirmés :
   zones→geo-zones · PV→pv · règlement→reglements · immo-lots→geo-lot. **Ne fabrique pas** le mapping.
5. Verdict au-carré = **FACT** sourcé (`fichier:ligne` / report) ; recos = **JUDGMENT** ; manquant → **unknown**.

### Seeds (groundés par geo-archi)
- **État au-carré [FACT, coverage 2026-08-20]** — TRÈS hétérogène : **PV 1062/1106 (~96%)** · zones-complétion
  868 (~78%) · règlement 815 (~74%) · usage dominant 710 (~64%) · normes 502 (~45%) · immo lot-zone 342/1100
  (~31%) · immo normes pliées 52 (~5%) · immo adresse civique 22 (~2%) · **effet densifiant 5/1106 (~0.5%)** ·
  **provenance zones preuve-v2 : 0/1106** (toutes not-assessed). ⚠ **preuve-v2=0 + 3 sources coverage absentes**
  (`completion-regdens`, `immo-lot-zone-assignment-matrix`, `immo-folded-normes`) = gaps de capitalisation forts.
- **LLM concentré** (~37 fichiers) : normes (grille : `grille-*-cli`, `grille-mistral-schema`, `zonage-norms*`),
  PV (OCR : `ocr.ts`, `pv-ocr-artifact`), t1/t2 labels georef (`t1-labels-*`, `t2-labels-gpt55`, `t2-autogcp`).
  Autres pipelines = plus déterministes (GDAL/arcgis/parsers) → cible LLM-minimal = normes/PV/labels.
- **Refresh on-k8s existants** : `deploy/capture-job` (cronjob-refresh), `deploy/normes-job`, `deploy/acquisition-job`,
  `deploy/k8s/pv-probable-backlog-cronjob` (mix cronjob-auto / job-manuel).
- **Ancrage cycle preprod/prod** : serving geo-preprod déployé + sync prod→preprod (CD adoption **C1+C2+C3 /
  ADR-0028**) = la **1re instance** → formaliser « merge main → écrase preprod + upgrade » auto on-k8s.

### 4 recos cibles (JUDGMENT — chacune case-FOR + case-AGAINST + pré-mortem, ne starve aucune alternative)
1. **Moteurs COMMUNS de refresh** (spécificité par-ville = data/config). 2. **Refresh-on-k8s** (zéro local). 3.
**LLM-minimal** (plan de réduction requis-vs-déterministe par pipeline). 4. **Cycle preprod↔prod automatisé**
(merge→écrase+upgrade / tag→réel+backup) sur l'ancrage CD.

### Format de sortie (pour la synthèse present-decision)
- La **MATRICE 8×6** (JSON) : par cellule `{au_carre:{verdict,source}, llm:{ou,requis|remplacable,comment},
  specificite:data|config|bespoke, refresh:onk8s-cron|onk8s-job|local|absent}`.
- **FACTs (état) séparés des JUDGMENTs (recos)** ; incertitudes/désaccords **explicites** (pour la revue fable).
- Recos par pipeline/couche + les 4 recos cibles, chacune avec pré-mortem.
