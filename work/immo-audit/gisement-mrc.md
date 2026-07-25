# Gisement zonage-vecteur via MRC / ArcGIS — chiffrage pour immo

> **Statut** : chiffrage (assessment) · **Date** : 2026-06-22 · **Auteur** : geo (claude:geo-quebec).
> **Read-only** : aucun harvest de masse, aucune ingestion, aucun commit. Échantillon léger seulement (≈25 requêtes polies, UA honnête, timeouts courts).
> **Anti-invention** : tout chiffre est rattaché à un artefact du repo ou à une requête live datée ci-dessous.

---

## TL;DR

- La prémisse « les 87 MRC publient le zonage à l'échelle MRC, donc gros gisement vecteur » est **partiellement fausse en pratique**. Le canal MRC réel n'est **PAS** Données Québec (qui est ville-centrique : ortho + grandes villes), c'est **ArcGIS Online / Hub** (comptes SIG de MRC). Mais beaucoup d'items ArcGIS titrés « Zonage » sont en réalité de l'**affectation, des milieux humides ou du PIIA**, pas une grille réglementaire municipale (vérifié live, §B).
- Le « 329 collections `qc-zonage-*` » est un **mauvais proxy de couverture muni** : seulement **38** d'entre elles (3,4 % des 1106 munis) mappent proprement 1:1 à un slug de municipalité ; les **291 autres** sont des couches **agrégées par compte ArcGIS** (un layer MRC couvre N munis d'un coup) ou des doublons affectation/PIIA/bruit (live API, §B).
- **Gisement réaliste** d'un harvest MRC/AGOL systématique *au-delà de l'existant* : **+80 à +180 munis** confirmables en vecteur (fourchette justifiée §C), pas « des centaines de plus » et pas « les 87 MRC × leurs munis ».
- **Les 11 absentes** : **0 confirmée quick-coverable** par la voie MRC à l'échantillon ; 2 ont un faux-positif déjà disqualifié live (sainte-catherine, alma) ; les 9 autres n'ont **aucune** grille MRC/AGOL publique trouvée → **PDF/site municipal** (§D). C'est cohérent avec l'audit #4 (3/14 quick wins seulement).

---

## A. Voies de source zonage-vecteur au QC — exploitées vs non

Infra existante (lue dans le repo, à **réutiliser**, ne rien réinventer) :

| Voie | Outil geo | Statut | Rendement réel observé |
|---|---|---|---|
| **AGOL search** (ArcGIS Online, recherche par compte/owner) | `scripts/ca-qc-zonage-arcgis/harvest.mjs` → `ca-qc-zonage-arcgis/registry.generated.json` | **EXPLOITÉE** | 118 endpoints vérifiés live, **61 comptes** ArcGIS distincts (dont **10 comptes MRC**). C'est la voie qui a réellement rapporté. |
| **Annuaire MAMH** (slug→site→probe domaine) | `harvest-mamh.mjs` (`source: "mamh-domain-probe"`) | **EXPLOITÉE (marginale)** | **1** seul endpoint via cette voie dans le registre. Le manque d'annuaire MAMH fiable reste *le* goulot (cf. `discover-arcgis.d.ts` : « ~30-40 % de couverture », `recense-platform.d.ts` : annuaire « non implémenté »). |
| **Heuristique slug→domaine** (`sig.<slug>.ca`…) | `geo/dist/catalog/discover-arcgis.js` (`defaultMunicipalDomainGuesser`) | **CODÉE mais ~30-40 % seulement** | Documentée comme le vrai bottleneck ; peu de rendement sans annuaire d'URLs officielles. |
| **Données Québec (CKAN)** | `geo/dist/acquire/ckan.js` + `ca-qc-zonage-ckan/index.js` | **EXPLOITÉE (épuisée)** | `package_search?q=zonage` = **50 packages**, mais ce sont les **grandes villes** (Longueuil, Gatineau, Saguenay, Lévis, Trois-Rivières, Sherbrooke, Québec, Repentigny, Rimouski, Rouyn-Noranda, Shawinigan), déjà pinés (11). |
| **CKAN niveau MRC** | (même outil) | **VÉRIFIÉE NÉGATIVE** | **12 MRC seulement** ont une org sur DQ ; quasi toutes ne publient **que de l'orthophoto/hydro**, **pas de zonage** (live §B). MRC de l'Érable et MRC des Laurentides = 0 package. |
| **Portails MRC hétérogènes (SHP/blob)** | spec `cadre-acquisition §2.1(3)` ; ex. **MRC Portneuf = SHP par muni** (neuville, saint-gilbert, saint-raymond couverts ainsi) | **PARTIELLEMENT exploitée, 1 adaptateur/portail** | Pas de découverte générique : chaque portail MRC = un adaptateur ad-hoc. C'est ici que se trouve le gisement *incrémental* réel, mais coûteux. |
| **Géoportails / WFS municipaux** | mentionné `cadre §2.1(4)`, `recense-platform` détecte jmap/gonet | **NON exploitée systématiquement** | Détection de plateforme codée mais pas de harvest WFS/JMap/GoNet en place. |
| **MERN/MELCCFP provincial** | endpoints supplémentaires manuels | **PARTIELLE** | zones inondables (BDZI/ZIS), zone agricole : présents en `SUPPLEMENTAL` mais = contraintes, **pas** grille de zonage municipale. |
| **PDF cascade** (boundary→fusion→cadastre) | `acquisition/zonage-norms-run.ts` + `work/zonage-norms/*` | **EXPLOITÉE, en cours** | C'est le **fallback** pour les villes sans vecteur ouvert ; un crawl PDF tourne actuellement (ne pas toucher). |

**Lecture** : geo a déjà *épuisé* les voies « faciles » (CKAN grandes villes + AGOL par compte). Le gisement résiduel MRC est dans (a) l'**énumération exhaustive des comptes ArcGIS MRC** non encore moissonnés et (b) les **portails MRC SHP hétérogènes** (1 adaptateur chacun). Aucun « bouton MRC » magique ne couvre 87×N munis.

---

## B. Gisement estimé — fourchette justifiée + échantillon

### Ce que disent les artefacts (ancrage)
- `municipalities.qc.json` : **1106 munis**, dont **1051** ont un champ `mrc` non nul, sur **87 MRC** distinctes.
- API live `https://api.geo.sent-tech.ca/collections` (2026-06-22) : **329 `qc-zonage-*`**, **1102 `qc-lots-*`**.
  - **lots ≈ complet** (1102/1106) — le cadastre est résolu province-wide.
  - **zonage : 38** collections mappent 1:1 un slug muni (= **3,4 %** des munis ont une grille « propre » nommée). Les **291 autres** sont des slugs de **compte ArcGIS** / agrégats MRC / doublons affectation-PIIA-bruit.
- Registre ArcGIS généré : **118** endpoints (`source: agol-search` 117 + `mamh-domain-probe` 1) + **53 supplémentaires** (30 `manual-demo-unverified`, 23 `manual-supplemental`). Beaucoup de supplémentaires = contraintes (PIIA, zones inondables, patrimoine), **pas** des grilles.

### Pourquoi le comptage « par collection » trompe
Un layer agrégé MRC (ex. `geomatiquemrcdugranit-granit-*`, `claudialarrotamrccdb-*`, `jdube-mrcbellechasse`) **couvre plusieurs munis dans une seule collection**. À l'inverse, un même compte produit 5-8 collections quasi-doublons (zonage vue / affectation / PU). Donc **329 ≠ 329 munis** et **329 ≠ 329 grilles utiles**. La seule mesure honnête = **confirmation spatiale par muni** (centroïde→bbox→schéma), exactement la méthode de l'audit #4 — qui a donné **3 couverts / 14 testés** côté « absents ».

### Échantillon live (rendement réel par MRC) — 2026-06-22
| Sonde | Canal | Résultat | Verdict |
|---|---|---|---|
| MRC Roussillon « Zonage » (owner `Martin_Lessard0`) | AGOL | service trouvé, 821 features, champ `ZONE`=`CHATEAUGUAY/ST-REGIS`, `Classifi_1`=`Marais` | **FAUX POSITIF** : milieux-humides/pression agricole, pas une grille réglementaire. 0 feature au centroïde Ste-Catherine. |
| « Zonage de Alma » → FS `A_zoning` (owner `diego_NBSE`) | Hub→AGOL | 45 features, champs EN/FR `Z_code_FR`/`Community`, **0** au centroïde Alma | **FAUX POSITIF** : démo/autre « Alma », pas la Ville d'Alma (Lac-St-Jean). |
| MRC Joliette / Des Chenaux / Érable / Abitibi-Ouest / Beauce-Sartigan / Maskinongé « zonage » | AGOL keyword | **total 0** chacun | recherche par mot-clé MRC ≈ stérile. |
| MRC Charlevoix « zonage » | AGOL | 1 hit = « Zonage de la Région de biosphère » | hors sujet (zonage écologique). |
| 12 orgs MRC sur Données Québec | CKAN | Charlevoix/Maskinongé/Portneuf/Drummond = **orthophotos**; Arthabaska = cours d'eau; Érable & Laurentides = **0** | **MRC ≠ zonage sur DQ.** |

**Conclusion sur le rendement** : la recherche par mot-clé (AGOL/Hub/CKAN) est *bruitée et stérile* pour les MRC. Le rendement réel du harvest existant vient de **l'énumération de comptes ArcGIS connus** + **confirmation spatiale**, pas du keyword. Et un « hit zonage » exige une **vérification live obligatoire** (≥1 faux positif sur 2 sondes ici).

### Fourchette du gisement (au-delà de l'existant)
Base de raisonnement :
- 61 comptes ArcGIS déjà moissonnés ; le QC compte vraisemblablement **plusieurs centaines de comptes SIG municipaux/MRC** publics, mais avec un **fort taux de faux positifs/doublons** (observé) et un **fort recouvrement** avec les 329 déjà présentes.
- Les 10 comptes MRC déjà captés rapportent typiquement 1 layer agrégé multi-munis → un compte MRC neuf « propre » peut ajouter **5-30 munis** d'un coup ; mais beaucoup de MRC n'ont **aucun** compte AGOL public exploitable (échantillon : Joliette, Des Chenaux, Érable, Abitibi-Ouest → rien).

| Scénario | Munis vecteur **additionnels** confirmables | Hypothèse |
|---|---|---|
| **Bas** | **+60 à +90** | énumération exhaustive des comptes AGOL MRC restants + 3-5 portails SHP MRC déjà connus (type Portneuf), confirmés spatialement. |
| **Médian (réaliste)** | **+100 à +150** | bas + ~10-15 adaptateurs portails MRC SHP/Hub + récupération des munis « cachés » dans les layers agrégés déjà présents (désagrégation par `mun_nom`/centroïde). |
| **Haut (optimiste)** | **+150 à +200** | médian + WFS/JMap/GoNet municipaux + qualification licence permettant la republication. Plafond pratique. |

→ **Gisement MRC/AGOL net = +80 à +180 munis** (point médian ≈ **+120**). Cela porterait la couverture vecteur de l'ordre de **~150-200 munis aujourd'hui** (estimé : 38 propres + munis dans les agrégats) vers **~250-350 munis** (≈ 23-32 % des 1106). **Le reste (~750+ munis, surtout < 5 000 hab.) restera PDF/scan ou sans source ouverte.** La couverture vecteur province-wide « quasi-complète » via MRC est **un mythe** : la donnée ouverte n'existe pas pour la majorité des petites munis.

---

## C. Les 11 villes ABSENTES → MRC → disponibilité

MRC tirée de `municipalities.qc.json` (champ `mrc`). « Dispo » = sonde live légère 2026-06-22 (AGOL/Hub/CKAN).

| Ville (slug) | MRC | Pop. | Quick via MRC ? | Constat (sondé) |
|---|---|---|---|---|
| sainte-catherine | Roussillon | 17 780 | **NON** | MRC Roussillon « Zonage » = couche milieux-humides (faux positif, vérifié live). Pas de grille muni. |
| alma | Lac-Saint-Jean-Est | 30 734 | **NON** | seul FS `A_zoning` = démo/autre Alma (45 feat., 0 au centroïde). Aucun zonage Ville d'Alma trouvé. |
| saint-mathieu-de-beloeil | La Vallée-du-Richelieu | 3 019 | **NON** (à re-tester) | audit #4 : candidat `ludyvine-cnmsh` mais 0 feature au point. MRC VR sans layer agrégé trouvé. |
| saint-charles-borromee | Joliette | 16 904 | **NON** | AGOL/Hub « MRC Joliette zonage » = 0. Hub ne renvoie que de l'hydro CEHQ. |
| saint-boniface | Maskinongé | 5 416 | **NON** | MRC Maskinongé sur DQ = orthophoto seulement ; AGOL keyword = 0. |
| la-sarre | Abitibi-Ouest | 7 186 | **NON** | AGOL « MRC Abitibi-Ouest zonage » = 0 ; Hub = bruit global. |
| saint-come-liniere | Beauce-Sartigan | 3 430 | **NON** | AGOL « MRC Beauce-Sartigan zonage » = 0. |
| petite-riviere-saint-francois | Charlevoix | 1 120 | **NON** | MRC Charlevoix : AGOL = « biosphère » (écologique), DQ = orthophoto. audit #4 : `claudialarrotamrccdb` 0 feature au point. |
| champlain | Des Chenaux | 1 932 | **NON** | AGOL « MRC Des Chenaux zonage » = 0 ; Hub = bruit Mauricie. |
| plaisance | Papineau | 1 205 | **NON** (non re-sondé en détail) | aucun compte AGOL MRC Papineau « zonage » connu ; à classer PDF par défaut. |
| notre-dame-de-lourdes--lerable | L'Érable | 817 | **NON** | MRC de l'Érable = **0 package** sur DQ ; pas de compte AGOL zonage trouvé. (Homonyme NDL-Joliette ≠ cette ville, cf. audit #4 §D.) |

**Bilan 11 absentes** : **0 quick-coverable via MRC** confirmée à l'échantillon. 2 faux positifs déjà disqualifiés live (sainte-catherine, alma). Les 9 autres = **pas de vecteur ouvert MRC/AGOL** → cascade **PDF / site municipal**. C'est cohérent avec l'audit #4 (les « faciles » avaient déjà été captés ; le résidu est structurellement difficile).

> ⚠️ Réserve honnête : « NON » = *pas trouvé à la sonde légère*, pas « prouvé inexistant ». Un harvest ciblé (énumération du compte SIG exact de chaque MRC + probe du portail MRC SHP) pourrait en récupérer 1-3, surtout les plus grosses (alma 30k, sainte-catherine 18k, saint-charles-borromée 17k) si leur Ville/MRC a un FS non indexé par mot-clé. À tester nominativement, pas par keyword.

---

## D. Plan de moisson MRC priorisé + effort

Réutilise l'infra existante — **ne crée pas de nouveau pipeline**. Pivot : `scripts/ca-qc-zonage-arcgis/harvest.mjs` (AGOL par compte) + `crawlArcgisLayer` (`geo/acquire/arcgis-crawl`) + cascade PDF (`zonage-norms-run.ts`) + cadre on-demand (`docs/spec/cadre-acquisition-on-demand.md`).

**Étape 0 — Désagrégation gratuite (aucun réseau neuf).** Repasser les **291 collections agrégées** déjà servies et, par `mun_nom`/centroïde, **réattribuer les munis cachées** (ex. layers MRC qui contiennent déjà plusieurs villes). Quick win pur calcul. *Effort : 0,5-1 j.* Inclut la **désagrégation A-16 saint-frederic** (frontières internes réelles) demandée par immo.

**Étape 1 — Quick wins de mapping (déjà identifiés audit #4).** Câbler les alias slug→collection pour saint-eustache (`pantaleona`), coaticook (`mrcdecoaticook`), saint-raphael (`jdube-mrcbellechasse`), hemmingford (id suffixé). *Effort : < 0,5 j (côté immo + alias geo).*

**Étape 2 — Énumération nominative des comptes MRC (PAS par mot-clé).** Pour chacune des 87 MRC : résoudre son **org/owner ArcGIS** (annuaire à constituer une fois), lister `services/<owner>`, filtrer polygone + champ zone, **vérifier live** (point-in-QC + schéma). Cible prioritaire = les **MRC des 11 absentes** + les MRC des z∩m∩p non encore propres. *Effort : 2-4 j (le coût est l'annuaire owner↔MRC, pas le crawl).* **C'est le vrai levier du gisement (§B médian).**

**Étape 3 — Adaptateurs portails MRC SHP (1 par portail).** Type MRC Portneuf (SHP par muni sur blob). Prioriser 5-10 MRC qui exposent un dépôt SHP. *Effort : 0,5-1 j par portail* → 3-6 j pour 6-10 portails. Rendement : 5-30 munis/portail.

**Étape 4 — Résidu PDF/site municipal.** Les 9 absentes sans vecteur + la longue traîne → cascade PDF existante (déjà en cours) + résolution site via annuaire MAMH. *Effort : variable, c'est le pipeline le plus coûteux/feature.*

**Ordre de priorité** : Étape 0 → 1 (jours-homme faibles, valeur immédiate) → 2 ciblée sur les 11 absentes + z∩m∩p → 3 → 4.

**Effort total chiffrage** : **~10-16 j-homme** pour viser le scénario médian (+100-150 munis), dont la moitié sur l'annuaire owner↔MRC (réutilisable ensuite).

---

## E. Ce qui reste irréductiblement PDF/scan (ou sans source)

- **Majorité des munis < 5 000 hab.** : pas de SIG, zonage en **PDF** (souvent scanné) sur le site municipal, voire annexé au règlement. Aucune voie vecteur ouverte.
- **Des 11 absentes** : au moins **plaisance, notre-dame-de-lourdes--lerable, petite-riviere-saint-francois, champlain, saint-come-liniere, saint-boniface** → PDF/site (MRC sans vecteur ouvert confirmé). Les plus grosses (alma, sainte-catherine, saint-charles-borromée, saint-mathieu-de-beloeil, la-sarre) **méritent une sonde nominative** avant de les déclarer PDF-only.
- **Couches « affectation »/PIIA/schéma d'aménagement MRC** ≠ grille de zonage réglementaire : utiles en contexte mais **ne remplacent pas** le `code_zone` par lot exigé par immo (anti-invention).
- **Plafond structurel** : même un harvest MRC parfait laisse **~700+ munis** sans vecteur ouvert. La promesse « province-wide vecteur via MRC » n'est **pas** réaliste ; le réaliste est **~25-32 % des munis en vecteur**, le reste en PDF/cascade ou différé.

---

### Annexe — artefacts & requêtes (traçabilité)
- `packages/geo-sources-americas/dist/ca-qc-zonage-arcgis/registry.generated.json` (118 endpoints, `verifiedAt`).
- `packages/geo-sources-americas/dist/ca-qc-zonage-arcgis/index.js` (`SUPPLEMENTAL` = 53).
- `packages/geo-sources-americas/dist/ca-qc-zonage-ckan/index.d.ts` (11 grandes villes pinées).
- `packages/geo/dist/catalog/discover-arcgis.d.ts` / `recense-ckan.d.ts` / `recense-platform.d.ts` (outils + limites documentées).
- `packages/geo/dist/acquire/arcgis-crawl.d.ts` / `ckan.d.ts` (primitives d'acquisition, SHP via GDAL).
- `packages/qc-sources/src/geo/municipalities.qc.json` (1106 munis, champ `mrc`, 87 MRC).
- `docs/spec/cadre-acquisition-on-demand.md` (§2.1 voies de source, §3 pipeline à réutiliser).
- `work/immo-audit/zonage-resolution.{md,json}` (audit #4 : 3/14 quick wins, 11 absentes).
- Live 2026-06-22 (UA `sentropic-geo/0.1`, polies) : `api.geo.sent-tech.ca/collections` ; `arcgis.com/sharing/rest/search` ; `hub.arcgis.com/api/v3/datasets` ; `donneesquebec.ca/.../package_search` + `organization_list` ; FS Roussillon & A_zoning point-in-polygon.
