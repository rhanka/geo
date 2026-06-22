# Plan de couverture — données géo Québec

> 2026-06-22. **Cible = 1106 municipalités (100 %) sur CHAQUE layer.** Les plafonds
> par voie (ex. ~350 en vecteur) ne sont PAS la cible : ce sont les rendements
> d'UNE voie. On atteint 1106 en **empilant les voies** + une voie d'investigation
> pour le résidu. Tous les rendements ci-dessous sont **mesurés** (S3/OGC/repo,
> daté 2026-06-22) ou **projetés** à partir d'un échantillon réel — jamais au pifomètre.
> Sources : `work/immo-audit/INVENTAIRE-scraping-qc.md` + `gisement-mrc.md`.

## 0. Le Québec = 1106 municipalités (87 MRC). C'est le dénominateur partout.

## 1. Départ → Cible, par layer (cible = 1106)

| Layer | Départ (mesuré) | Cible | Voie principale pour combler |
|---|---|---|---|
| Cadastre lots | 1102 / 1106 | **1106** | 4 manquantes = TNO sans cadastre (à confirmer) |
| Rôle foncier | 1095 / 1106 | **1106** | ~11 sans rôle MAMH publié — à investiguer |
| Index immo | 1102 / 1106 | **1106** | suit cadastre+rôle |
| code_zone sur lots | 28 / 1106 | **1106** | suit zones (layer ci-dessous) |
| **Zones (polygones)** | ~99 propres / 1106 | **1106** | empilement de voies §2 + PDF §3 |
| **Normes (grilles)** | 25 / 1106 | **1106** | crawl PDF (66 % hit mesuré) §3 |
| PV / signaux | 563 prêts / 1106 | **1106** | basculer prod + étendre configs |
| PMTiles | 2 (privé) | **1106 public** | tuilage + exposition publique |

## 2. ZONES — décomposition par VOIE (ce qui « motive le 350 », chiffré)

| # | Voie d'acquisition | Rendement | Munis | Base du chiffre |
|---|---|---|---|---|
| 1 | ArcGIS Hub — comptes nommés 1:1 | **mesuré** | **38** | 38/329 collections mappent 1:1 un muni (live OGC) |
| 2 | Désagrégation des agrégats | **mesuré** | **+61** | 5/118 agrégats ont un attr muni → 61 per-muni (Ét.0 livrée) |
| 3 | CKAN Données Québec (grandes villes) | **mesuré, épuisé** | 11 (inclus) | 50 packages = 11 grandes villes pinées |
| 4 | Énumération **nominative** des 87 comptes MRC | **projeté** | **+60 à +150** | 10 comptes MRC captés rendent 5-30 munis/compte ; mais ~la moitié des MRC n'ont AUCUN compte public (Joliette/Des Chenaux/Érable/Abitibi-O. = 0 à la sonde) |
| 5 | Adaptateurs portails MRC SHP (type Portneuf) | **projeté** | **+30 à +100** | 5-30 munis/portail × 6-10 portails exposant du SHP |
| 6 | WFS/JMap/GoNet municipaux | **non exploité** | **+0 à +50** | plateformes détectées mais pas moissonnées (scénario haut) |
| | **SOUS-TOTAL VECTEUR (1→6)** | | **~250-350 (23-32 %)** | = plafond open-data vecteur |

**Pourquoi ça plafonne ~350 (contrainte, pas pifomètre) :** la donnée vecteur ouverte
n'existe **pas** pour la majorité des ~750 petites munis (< 5 000 hab). Mesuré : la
recherche par mot-clé MRC est stérile (≥1 faux positif sur 2 sondes → vérif spatiale
obligatoire) ; CKAN MRC = orthophoto, pas zonage. Le gisement net au-delà de
l'existant = **+80 à +180 munis** (médian +120), pas « 87 MRC × N ».

## 3. ZONES 350 → 1106 : la voie PDF + le RECENSEMENT (plan d'investigation)

Pour les ~750 munis sans vecteur, le zonage existe en **PDF** sur le site municipal.

| Voie | Rendement | Donne | Statut |
|---|---|---|---|
| 7 | Découverte PDF (crawler PV) | **66 % hit mesuré** (161/244 munis sondés) | un PDF de grille | crawl démarré (arrêté pour cadrage) |
| 8 | PDF→GeoJSON par calage lots (ADR-0023) | **>85 % auto** sur GeoPDF géoréf T1/T2/T3 ; ~15 % semi-manuel T4 | polygones de zone (grossiers→propres selon type) | POC saint-amable OK |

**Le maillon manquant = un RECENSEMENT/TYPAGE des 1106** (lecture seule, 0 crédit) :
pour chaque muni, classer la voie applicable — *vecteur dispo ? / GeoPDF T1-3
extractible ? / scan T4 semi-manuel ? / aucune source ?* — à partir des taux mesurés.
**C'est CE recensement qui transforme le « 350 au pifomètre » en projection fondée
par muni** et qui chiffre honnêtement combien des 1106 sont réellement atteignables,
par quelle voie, et à quel coût. Il faut le faire AVANT de relancer du calcul payant.

## 4. NORMES (valeurs de grille) — même logique

| Voie | Rendement | Munis | Statut |
|---|---|---|---|
| Extraction native (grille horizontale texte) | mesuré | gratuit ($0) | en place |
| Extraction multizone/vision (grille verticale/image) | mesuré ~$0.06-0.32/muni | payant LLM | en place |
| Découverte des PDF de grille | **66 % hit** mesuré | ~370/563 sondables | crawl |

Cible normes = **= nb de munis publiant une grille PDF** (le recensement §3 le chiffre).
**Contrainte de coût** : l'extraction vision doit passer par le **CLI/LLM-gateway
multi-compte** (décision user), PAS l'API Mistral directe — à câbler avant tout run.

## 5. Roadmap remote (k8s) — APRÈS recensement + câblage LLM-gateway

1. **Recensement/typage des 1106** (lecture seule, 0 crédit) → projection fondée par layer.
2. **Câbler l'extraction sur le CLI/LLM-gateway multi-compte** (Claude), retirer l'appel Mistral direct.
3. **Acquisition de masse en Jobs k8s parallèles shardés** (orchestrateur TS `k8s-shard-run.ts` déjà prouvé) — uniquement une fois 1 et 2 faits, quota bumpé le temps du burst puis restauré.
4. Voies vecteur §2 (énumération MRC nominative + portails SHP) → ~350.
5. Voie PDF §3 (calage lots) → pousser vers 1106 selon le recensement.
6. PMTiles publics + CDN ; exposer normes en OGC ; basculer PV en prod.

> Rien qui consomme du crédit n'est relancé tant que (1) le recensement n'a pas chiffré
> la cible réelle par muni et (2) le LLM-gateway multi-compte n'est pas câblé.
