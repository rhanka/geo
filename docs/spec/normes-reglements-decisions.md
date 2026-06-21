# Normes / règlements de zonage — décisions d'architecture (DOSSIER tranché)

> **Statut** : DÉCIDÉ par le principal · **Date** : 2026-06-21 · Débloque le chantier normes (était 0%).
> Issu du consensus (codex 5.5xhigh + opus 4.8max) : **geo possède le produit-donnée « normes », immo fournit un adaptateur, cityweft différé.**

## Les 5 décisions

| # | Sujet | Décision | Implication |
|---|---|---|---|
| 1 | **Repo cityweft** | Rester **sous-module QC dans geo** ; charter cityweft **après** le pilote 30 | Code des normes vit dans `geo` (sous-module `qc/`), pas de repo transverse maintenant |
| 2 | **Licence règlements** | Servir les **normes dérivées + provenance** (pas le PDF brut) ; **MAIS stocker le document** (cache/archivage/**versionnage**) ; renvoi par défaut sur la **source officielle** ; **HEAD-check** (ETag/Last-Modified) à chaque appel pour détecter un changement | On archive le document (traçabilité + évitement de charge sur la source, défendable) sans le republier ; on expose la grille des spécifications + lien source + version |
| 3 | **Périmètre** | **QC-first**, extension **Canada** ensuite | Sous-module `qc/`, interfaces Canada-ready (schémas/adapters génériques) |
| 4 | **Seuil de confiance normes** | **0.85 par champ** ; sous le seuil → **2e passe OCR Mistral** (clé `sentropic/.env` → `MISTRAL_API_KEY`, via la lib **graphify**) ; si toujours < seuil → `null` + flag « à vérifier » | Anti-invention : jamais servir une norme douteuse comme certaine ; double-OCR pour récupérer |
| 5 | **Scraper (budget)** | **Transférer** le scraper d'immo **vers geo** (déplacer + adapter, **pas réécrire**), puis **itérer en double consensus** | Migration de `radar-immobilier/packages/radar-sources/` → geo |

## Brique à migrer (décision 5) — `packages/radar-sources/` (TypeScript)
immo a déjà construit le contrat propre `SourceAdapter` / `RawDocumentRef` / `RawDocument` / `ListOptions` + des adapters réels :
- **`reglements-urbanisme-parser.ts`** ← cœur du chantier normes (parse n° règlement + codes ; à étendre vers la **grille des spécifications** : usages, densité, hauteur min/max, marges, frontage/superficie min de lot).
- `role-evaluation-mamh.ts` / `role-evaluation-parser.ts` (rôle — geo l'a déjà ré-implémenté en python ; garder comme référence/fixtures).
- `adresses-quebec.ts`, `prioritySources.ts`, `municipalities.ts`.
- Fixtures golden PV par ville (`proces-verbaux-*.fixture.ts`).

**Plan de migration** : déplacer `packages/radar-sources/**` → `geo/packages/qc-sources/` (ou sous-module `qc/`), adapter imports/build au monorepo geo, **garder les tests golden**, puis **revue double-consensus** (2 modèles forts) avant d'en faire la base du `bylaw-orchestrator`.

## bylaw-orchestrator (cible, après migration)
`SourceAdapter.fetch(city)` → `RawDocument` (stocké S3 pour cache/version + **HEAD-check** fraîcheur) → parse → **grille des spécifications** par `zone_code` → normes `{usages[], densite, hauteur_min/max, marges, frontage_min, superficie_min}` avec **confidence par champ** (0.85 + fallback Mistral-OCR/graphify) → produit-donnée `qc-zonage-norms-<slug>` (federation-first, immo lit). Chaîne complète : **LOT → ZONE → NORMES**.
