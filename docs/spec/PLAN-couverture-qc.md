# Plan de couverture — données géo Québec → 1106 municipalités (100 %)

> 2026-06-22. **Cible = les 1106 municipalités, sur les 3 couches : Zones, Normes, PV.**
> **Aucun plafond** : toute ville a une source ; si pas de vecteur ouvert, on **recompose
> le vecteur** depuis le PDF / le logiciel SIG / le site municipal (obscura, session).
> Principe : une **cascade de voies** par ville — la 1re qui marche gagne ; un **recenseur
> exhaustif** tourne en parallèle pour trouver la source des villes sans hit facile.

## UN tableau — toutes les couches × type d'acquisition

| # | Type d'acquisition | Ce qu'il produit | Zones | Normes | PV | Couverture visée | Coût | Statut |
|---|---|---|:--:|:--:|:--:|---|---|---|
| 1 | Vecteur ouvert ArcGIS/AGOL (par compte) | polygones de zone | ✅ | | | villes/MRC à compte SIG | gratuit | en place — 38 |
| 2 | Désagrégation des agrégats (par `mun_nom`/centroïde) | polygones per-muni | ✅ | | | villes cachées dans layers MRC | gratuit | fait — +61 |
| 3 | CKAN Données Québec | polygones | ✅ | | | grandes villes | gratuit | épuisé — 11 |
| 4 | Portails MRC (SHP / WFS / JMap / GoNet) | polygones | ✅ | | | villes des MRC à portail | gratuit | partiel → à généraliser |
| 5 | Découverte PDF (crawler PV 2-hop + robots) | localise le PDF grille/plan | ✅ | ✅ | | toute ville à PDF en ligne | gratuit | 66 % hit mesuré |
| 6 | **PDF→GeoJSON — recomposition vecteur** (GeoPDF géoréf T1, vectorisation calque T2, raster géoréf T3, calage sur lots) | **polygones recomposés** + valeurs | ✅ | ✅ | | toute ville à plan/grille PDF | gratuit (sauf OCR) | POC saint-amable OK |
| 7 | **Sites villes + session (obscura, headless)** | atteint PDF/SIG derrière JS/onclick/login | ✅ | ✅ | ✅ | villes à site protégé (ex. cap-sante onclick, gestionweblex/ASP.NET) | gratuit | **à brancher (était squizzé)** |
| 8 | Extraction valeurs de grille — natif (texte) / vision (image) | valeurs normes | | ✅ | | grilles trouvées | natif gratuit ; **vision = LLM** | en place |
| 9 | Scrapers PV (sites municipaux) | procès-verbaux / signaux | | | ✅ | villes configurées | gratuit | 563 prêts |
| 10 | **Recenseur exhaustif de sources** (par ville sans hit facile) | trouve LA voie : site muni, logiciel SIG, dépôt SHP, PDF, portail MRC | ✅ | ✅ | ✅ | les villes « dures » | gratuit | **à construire** |

**Cible = 1106 sur les 3 couches.** Chaque ville est servie par la 1re voie qui marche
(cascade 1→7) ; celles sans hit facile passent par le **recenseur (10)** → puis
recomposition (6) ou obscura (7). **Le seul poste payant = l'extraction vision (8)** —
il doit passer par le **CLI/LLM-gateway multi-compte Claude**, pas l'API Mistral.

## Gratuit vs payant (pour ne pas brûler de crédit)

- **Gratuit (réseau/calcul, 0 LLM)** : voies 1-7, 9, 10 + extraction **native** (texte).
  → tout ça peut tourner **maintenant**, en parallèle, sans crédit.
- **Payant (LLM)** : seulement l'extraction **vision** des grilles-images (voie 8 vision).
  → **gelé** tant que le CLI/LLM-gateway multi-compte n'est pas câblé.

## Plan d'exécution (parallèle, vers 1106)

**A. Recensement exhaustif des 1106 (voie 10) — lancer en parallèle, gratuit.**
Pour chaque municipalité : catalogue ArcGIS/AGOL + CKAN + portail MRC + **site municipal
(obscura si session/JS)** + présence de PDF (plan & grille) + logiciel SIG détecté.
Sortie : par ville, la **liste ordonnée des sources réelles** + le **type T1/T2/T3/T4**
du PDF s'il y en a. C'est la carte qui pilote tout le reste — et qui prouve qu'il n'y a
pas de plafond (chaque ville a au moins une voie).

**B. Acquisition de masse en Jobs k8s parallèles shardés** (orchestrateur TS prouvé),
voies 1-7 + 9 + extraction native. Gratuit. Tourne pendant que A affine les villes dures.

**C. Recomposition vecteur (6) + obscura (7)** sur les villes sans vecteur ouvert,
guidées par le recensement A → polygones recomposés depuis PDF/logiciel/site.

**D. Extraction vision (8)** — uniquement après câblage LLM-gateway multi-compte ;
en Jobs k8s shardés, quota bumpé le temps du burst puis restauré.

**E. Exposition** : PMTiles publics + CDN ; normes en collections OGC ; PV en prod.

> Itération : A (recenseur) ne s'arrête pas tant qu'une ville n'a pas AU MOINS une voie
> identifiée. Pas de « plafond » : une ville sans source ouverte = une source à trouver
> (site/logiciel/PDF), pas une ville abandonnée.
