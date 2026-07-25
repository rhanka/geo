# Sourcing des zones `zone_source_url: null` (hors focus-30) — Partie 2 — 2026-07-24

Suite de la lane de **diagnostic pur** (zéro écriture S3 : pas de fold, pas de
`putServedZone*`, pas de mirror). Périmètre : les **295 slugs `not-examined`**
laissés par le tour précédent (`work/coverage/null-zone-sourcing-20260724.json`,
committé, non modifié par cette lane). Anti-invention strict : chaque URL a été
récupérée (GET réel) et recoupée avec les codes de zone réellement servis
quand ceux-ci existent.

## Périmètre et méthode

- Univers : 295 slugs `verdict="not-examined"` du registre committé HEAD
  (`git show HEAD:work/coverage/null-zone-sourcing-20260724.json`), déjà hors
  focus-30 et hors les 26 slugs examinés en partie 1.
- Snapshot figé : la liste null (`zone-source-readback-audit-20260724.json`)
  a été lue depuis `git show HEAD:…` — jamais depuis la copie working-tree
  (réécrite en continu par une autre lane pendant cette session, cf. consigne).
  `--mamh-match` a été appelé avec `--audit <snapshot figé>` explicitement
  pour éviter tout faux `in-null-worklist=false`.
- Réseau : `NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`
  systématique. Le fetch Node natif (`fetch()`) a échoué (`fetch failed`,
  panne connue undici sur certains hôtes ArcGIS) sur plusieurs domaines
  (`services1.arcgis.com`, `services6.arcgis.com`, `services9.arcgis.com`) —
  contourné par `curl` (fiable à 100 % sur les mêmes hôtes) pour la
  récupération, puis comparaison des codes en Node local. `--verify` du
  script committé a été utilisé quand le fetch Node passait (ex. westmount,
  honfleur, saint-anselme, saint-henri, saint-jean-baptiste,
  saint-denis-sur-richelieu).
- Outils : `acquisition/src/_null-zone-source-probe.ts` (`--probe`,
  `--verify`, `--mamh-match`, `--validate-registry`) + **lecture** (jamais
  exécution en mode `--deposit`) de `acquisition/src/zones-jmap-run.ts
  --probe` pour apprendre/valider le protocole JMap NG (session anonyme REST
  v2.0) sans aucune écriture (le mode `--probe` de ce script committé ne fait
  ni GET S3 ni PUT S3, retourne avant tout accès S3).

## Couverture ce tour

**46 / 295 slugs classés `candidate-real-source`** (249 restent
`not-examined`, journalisés dans le JSON, pas omis). **Aucun nouvel
`orphan`** déclaré ce tour (délibéré : plusieurs pistes MRC sondées sans
succès en temps imparti, cf. section dédiée, mais pas assez creusées pour
mériter un verdict négatif définitif — laissées `not-examined`).

| Verdict | Nombre |
|---|---:|
| `candidate-real-source` | **46** |
| `not-examined` (laissé pour un prochain tour) | 249 |

Les 46 candidats couvrent **5 606 zones déjà servies** (somme `zones_estimees`,
= comptage `features` de l'audit figé), sur un total de 295×moyenne pour le
reste du périmètre. Plusieurs candidats sont plus riches que le servi actuel
(ex. `pont-rouge` 212 vs 77, `saint-casimir` 90 vs 16, `sainte-anne-de-beaupre`
148 vs 33) — upside net en plus de la simple attribution de provenance.

## Gisements identifiés ce tour

1. **Villes liées de Montréal, ArcGIS propre par ville** (comme découvert par
   accident sur `hampstead` puis confirmé sur `westmount`) : chaque ville
   démembrée/reconstituée de l'île de Montréal semble héberger son PROPRE
   organisme ArcGIS Online (`hampstead.maps.arcgis.com`,
   `vdw.maps.arcgis.com` pour Westmount) avec une couche `Zonage` dédiée,
   souvent **par-LOT** (une géométrie par unité d'évaluation, pas par
   polygone de zone) — cohérent avec les forts comptages de features
   (hampstead 1869 zones = 1869 LOTS taggés par zone). Seuls 2/9 villes du
   cluster « ? MRC » ont été confirmées faute de temps (`cote-saint-luc`,
   `dorval`, `mont-royal`, `montreal-ouest`, `montreal-est`, `pointe-claire`,
   `kirkland`, `dollard-des-ormeaux`, `saint-lambert` restent
   `not-examined` — même piste à essayer : chercher l'org ArcGIS propre à
   chaque ville via ses webapps publiques, PAS via une recherche par mot-clé
   globale qui ne trouve rien).
2. **MRC de Bellechasse** — couche ArcGIS UNIQUE `i002_zonage_municipal_en_vigueur_vue`
   (org `DgGbwYJQAY35Ym3n`, service `services6.arcgis.com`), qui couvre les
   20 municipalités de la MRC en un seul FeatureServer avec un champ
   `mun_nom` à filtrer et un champ code-zone `no_zone`. C'était noté « couche
   non localisée » dans le tour précédent (part1) — trouvée cette fois en
   suivant `bellechasse.ca/carte-interactive-<muni>` → redirection vers
   `mrcbellechasse.maps.arcgis.com/apps/instant/sidebar` (appid) → webmap →
   FeatureServer. **19/19 municipalités null du cluster couvertes.**
3. **MRC de Portneuf** — portail **JMap NG** propre (`cartographie.portneuf.com`,
   project id 1), avec **19 couches "Zonage municipal `<ABBR>`"** (une par
   municipalité + TNO), protocole identique à celui déjà documenté dans ce
   dépôt pour Alma (`acquisition/src/zones-jmap-run.ts`) : session anonyme
   `POST /services/rest/v2.0/session {"type":"WEB","username":"anonymous","password":""}`
   puis `GET .../layers/<id>/elements?sessionId=<id>&pageSize=2000&withPropertyName=true`.
   Le mapping abréviation→municipalité N'EST PAS explicite dans le nom de
   couche (`CS`, `DG`, `DON`, `POR`, `RAP`, `SA`, `SB`, `SC`, `SEC`, `SM`,
   `ST`, `SU`, `PON`…) — établi ici EMPIRIQUEMENT en comparant les 15
   premiers codes triés du candidat au sample retourné par `--probe` pour
   chaque slug (identiques à 15/15 pour 11 des 13 municipalités).
   **13/13 municipalités null du cluster couvertes** — le plus gros gain de
   cette passe après Bellechasse.
4. **MRC d'Argenteuil** — couche ArcGIS UNIQUE `Zonage` (org `iZcAwIV2GibwcZLe`,
   item "Zonage réglementaire du territoire local", propriétaire
   `mahurtubise_mrcargenteuil`), champ `co_mun` (code géographique MAMH) à
   filtrer, champ code-zone `zone`. Trouvée via l'appli Experience publique
   "évaluation foncière" de la MRC (item lié dans le même web map).
   **7/7 municipalités null du cluster couvertes**, plus une 8e
   (`saint-andre-dargenteuil`, co_mun=76008, 138/138 codes) qui corrige un
   verdict `orphan` du tour précédent (non modifié ici, hors périmètre
   d'écriture — signalé pour un futur tour).
5. **geocentralis WFS a encore grossi** : 152 codes `id_municipalite`
   distincts désormais (vs 86 dans part1). Re-sondage `--mamh-match` avec la
   liste à jour → 5 nouveaux matches hors doublons Bellechasse/Argenteuil :
   `saint-jean-baptiste`, `saint-denis-sur-richelieu`,
   `saint-antoine-sur-richelieu`, `saint-charles-sur-richelieu` (4/7 de la
   MRC de La Vallée-du-Richelieu — `chambly`, `carignan`,
   `saint-basile-le-grand` restent non trouvés, cherchés individuellement
   sans succès pour `chambly`) et `sainte-anne-de-beaupre` (MRC La
   Côte-de-Beaupré, servi actuellement à codes NULS — aucun recoupement
   possible mais candidat réel identifié).

## Top 15 candidats par volume

| Slug | Zones servies | Type | Gisement |
|---|---:|---|---|
| `hampstead` | 1869 | arcgis | ArcGIS propre Hampstead (`services1.arcgis.com/IP2j0oTRjMlb9KsM`), champ `Zone` |
| `brownsburg-chatham` | 238 | arcgis | MRC Argenteuil (`services9.arcgis.com/iZcAwIV2GibwcZLe`), `co_mun=76043` |
| `lachute` | 225 | arcgis | MRC Argenteuil, `co_mun=76020` |
| `saint-basile` | 191 | jmap | MRC Portneuf JMap, couche #147 (SB) |
| `deschambault-grondines` | 177 | jmap | MRC Portneuf JMap, couche #137 (DG) |
| `donnacona` | 171 | jmap | MRC Portneuf JMap, couche #267 (DON) |
| `portneuf` | 161 | jmap | MRC Portneuf JMap, couche #133 (POR) |
| `westmount` | 159 | arcgis | ArcGIS propre Westmount (`cartes.westmount.org`), champ `ZoneNumber` |
| `cap-sante` | 144 | jmap | MRC Portneuf JMap, couche #266 (CS) |
| `riviere-a-pierre` | 135 | jmap | MRC Portneuf JMap, couche #156 (RAP) |
| `saint-ubalde` | 122 | jmap | MRC Portneuf JMap, couche #148 (SU) |
| `saint-marc-des-carrieres` | 116 | jmap | MRC Portneuf JMap, couche #150 (SM) |
| `saint-anselme` | 111 | arcgis | MRC Bellechasse (`services6.arcgis.com/DgGbwYJQAY35Ym3n`), `mun_nom=Saint-Anselme` |
| `saint-alban` | 100 | jmap | MRC Portneuf JMap, couche #279 (SA) |
| `saint-henri` | 86 | arcgis | MRC Bellechasse, `mun_nom=Saint-Henri` |

## Pistes sondées SANS succès ce tour (laissées `not-examined`, pas `orphan`)

- **MRC de Témiscamingue** (16 slugs null, 1047 zones) — page géomatique
  MRC consultée, AUCUN lien ArcGIS/JMap public trouvé sur cette page
  (semble offrir des cartes personnalisées sur demande, pas de portail
  self-service). Une seule page vérifiée — PAS exhaustif (chaque muni a
  peut-être son propre portail comme les villes liées de Montréal).
- **MRC de Matawinie** (14 slugs null, 884 zones) — portail identifié
  (`carte.matawinie.org/public/`, JMap sur Tomcat) mais connexion en
  timeout lors du sondage `/rest/v2/projects` — protocole potentiellement
  différent de JMap NG (v2 vs NG) ou service temporairement indisponible.
  À reprendre avec le protocole JMap classique (`services/rest/v2.0/session`
  documenté dans `zones-jmap-run.ts`, pas encore essayé ici faute de temps).
- **Chambly** (246 zones, MRC La Vallée-du-Richelieu) — cherché
  individuellement, seule une appli "Zonage" ArcGIS trouvée mais décrite
  comme obsolète par le moteur de recherche et rattachée à un org
  (`AmosMP.maps.arcgis.com`) qui ne semble pas être celui de Chambly — pas
  assez concluant pour un verdict. `carignan` et `saint-basile-le-grand`
  (même MRC) non cherchés individuellement.
- **MRC Roussillon** (5 slugs, 583 zones — `candiac`, `saint-constant`,
  `delson`, `saint-philippe`, `saint-mathieu`), **MRC des Maskoutains**
  (11 slugs, 610 zones), **MRC de L'Érable** (4 slugs, 469 zones),
  **Ville de Rivière-du-Loup** (222 zones) — recherches ArcGIS lancées,
  rien de concluant en temps imparti. Piste "Geocentriq"
  (`app.geocentriq.com/mrc/<mrc>`) repérée pour Témiscamingue/Maskoutains/
  L'Érable — plateforme SPA JS, endpoints REST sous-jacents NON
  reverse-engineerés cette passe (différent de `geocentralis`, homonyme
  trompeur — à examiner spécifiquement dans un futur tour, gisement
  potentiellement large vu qu'il revient sur 3 MRC différentes).
- **MRC de La Vallée-du-Richelieu** (org `mrcvr.maps.arcgis.com` confirmé
  actif avec plusieurs webappviewer publics) — recherche par mot-clé
  générique infructueuse (le mot "richelieu" est trop générique dans
  l'index ArcGIS global) ; nécessiterait d'énumérer les items de l'org
  directement (nécessite l'org id numérique, pas juste l'URL courte) —
  non fait faute de temps.

## Fichiers

- `work/coverage/null-zone-sourcing-20260724-part2.json` — registre (295
  entrées : `{slug, verdict, url, type, features, codes_recoupes,
  zones_estimees, note}`), un enregistrement par slug `not-examined` de
  part1 : 46 `candidate-real-source` + 249 `not-examined`.
- `work/coverage/null-zone-sourcing-20260724-part2.md` — cette synthèse.

**Aucune écriture S3 effectuée. Rien commité par cet agent. Les fichiers
`null-zone-sourcing-20260724.json/.md` (part1) et
`_null-zone-source-probe.ts` du tour précédent n'ont pas été modifiés.**
