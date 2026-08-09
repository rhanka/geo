# Lot « preuve v2 exacte » — ré-acquisition géocentralis (2026-07-25)

KPI visé : *Provenance zones — preuve v2 exacte* (`proof.schema_version=2.0` avec
`geometry_source.url` + `retrieved_at` + `sha256` des octets réellement reçus), mesuré
à **0 / 1106** avant ce lot (les 727 « acceptable » sont de la traçabilité legacy, pas
une preuve).

**Résultat net : +6 collections en preuve v2 exacte** (0 → 6 pour ce lot), toutes
également re-stampées `zone_source_url` / `zone_source_level=documented` dans la MÊME
passe (atomicité des runners, commit `b3708f8`).

---

## 1. Lot choisi et pourquoi

Sélection de 8 candidates dans `work/coverage/null-zone-sourcing-20260724.json` +
`-part2.json`, restreinte au **gisement geocentralis** (`geoserver.geocentralis.com`,
couche `evb:siadmin_pzon_99_s`, filtre `id_municipalite`).

Motif de ce gisement plutôt que les autres (MRC Bellechasse 19 munis, MRC Argenteuil 7,
MRC Coaticook 12, JMap Portneuf 12) :

- **Contrainte d'outillage dure.** `zones-arcgis-replace.ts` construit lui-même sa requête
  avec `where=1=1` sur le `--layer` fourni ; il n'expose AUCUN filtre attributaire. Les
  gisements MRC sont des couches **multi-munis** (filtrées par `mun_nom` / `co_mun` /
  `MUNI` dans les URLs du registre de sourcing) : passées telles quelles au runner, elles
  téléchargeraient toute la MRC → porte spatiale en ABORT (`nearest ≠ slug`) et
  recoupement de codes non discriminant. Elles sont donc **hors d'atteinte sans modifier
  un fichier source**, ce que le mandat interdit. Le gisement JMap Portneuf exige en plus
  une session anonyme POST : aucun runner committé ne la porte.
- `zones-geocentralis-replace.ts` prend `--pair slug=id_municipalite`, donc **mono-muni
  par construction** → 100 % des candidates geocentralis sont exécutables sans toucher au
  code. C'est le même chemin qui a produit `saint-frederic` (commit `4d64d88`).

Critères de priorisation appliqués (a) exact-match de codes constaté, (b) collection
`orphan`/provenance nulle, (c) volume :

| ville | id_mun | recoupement annoncé | niveau AVANT | volume candidat |
|---|---|---|---|---|
| la-prairie | 67015 | 263/263 (parfait) | legacy-traceable, `url=null` | 309 |
| varennes | 59020 | 16/16 (parfait) — servi 15× plus pauvre | legacy-traceable, `url=null` | 249 |
| ormstown | 69037 | 102/102 (parfait) | legacy-traceable, `url=null` | 114 |
| saint-jean-baptiste | 57033 | 58/58 (parfait) | **orphan** | 58 |
| saint-antoine-sur-richelieu | 57075 | 67/67 | **orphan** | 69 |
| sainte-anne-de-beaupre | 21030 | n/a (servi 100 % `zone_code=null`) | **orphan** | 148 |
| saint-denis-sur-richelieu | 57068 | 70/70 annoncé | **orphan** | 70 |
| chateauguay | 67050 | 124/133 | legacy-traceable, `url=null` | 319 |

Les 8 étaient `STAMPED_NULL` (`zone_source_url = null`) au readback du 2026-07-24 : le gain
de qualité de provenance est donc **maximal** sur chacune.

---

## 2. Verdict par ville

Toutes passées d'abord en `--inspect` (aucune écriture). Aucun gate forcé ; l'option
`--allow-deprecated` n'existe pas sur le runner geocentralis et n'a donc **pas** été
utilisée.

| ville | verdict | gate décisif |
|---|---|---|
| la-prairie | **DÉPOSÉE** | anti-invention 100 % codeLike · spatial 1.0 km · recoupement 263/263 · couverture 309 ≥ 263 |
| varennes | **DÉPOSÉE** | spatial 0.1 km · recoupement 16/16 · couverture 249 ≥ 16 |
| ormstown | **DÉPOSÉE** | spatial 0.6 km · recoupement 102/102 · couverture 114 ≥ 102 |
| saint-jean-baptiste | **DÉPOSÉE** | spatial 1.1 km · recoupement 58/58 · double layout |
| saint-antoine-sur-richelieu | **DÉPOSÉE** | spatial 0.5 km · recoupement 67/67 · couverture 69 ≥ 68 · double layout |
| sainte-anne-de-beaupre | **DÉPOSÉE** | spatial 0.4 km · 148 codes distincts 100 % codeLike · recoupement **0/0** (le servi actuel porte `zone_code` 100 % NULL : aucun code de référence à recouper) · couverture 148 ≥ 33 |
| saint-denis-sur-richelieu | **REFUSÉE** | **gate RECOUPEMENT** : 69/70 — le code servi `A-56` est absent de la couche officielle. Non listable en dépréciation (le runner geocentralis n'a pas `--allow-deprecated`) ⇒ aucun dépôt. |
| chateauguay | **REFUSÉE** | **gate RECOUPEMENT** : 124/133 — 9 codes servis absents (`A-768, C-233, C-765, C-766, H-627, H-761, I-3, P-5, P-767`) ⇒ aucun dépôt. |

Réserve explicite sur `sainte-anne-de-beaupre` : c'est la seule dépôt sans recoupement de
codes possible, le gate étant structurellement muet (dénominateur 0). Les garde-fous
réellement franchis sont l'anti-invention, la porte spatiale (0.4 km) et la couverture
(148 ≥ 33). Le servi remplacé était inexploitable (33 polygones, `zone_code` entièrement
null, donc `orphan` par construction).

---

## 3. AVANT → APRÈS (6 villes déposées)

Zones = features de la collection servie. `assigned` / `norms` = `lot-zone-join-run` +
`lots-enriched-run`. `mismatch` = `lot-zone-consistency-audit` (proxy CENTROÏDE).

| ville | zones | lots assigned % | norms % | mismatch % | niveau provenance |
|---|---|---|---|---|---|
| la-prairie | 263 → **309** | 91.46 → **99.27** | 6.16 → 4.99 | 10.22 → **8.55** | legacy-traceable (url null) → **documented + preuve v2** |
| varennes | 16 → **249** | 39.44 → **100** | 100 → 4.33 | 1.16 → 4.98 | legacy-traceable (url null) → **documented + preuve v2** |
| ormstown | 102 → **114** | 99.01 → **100** | 1.29 → **2.56** | 1.54 → 2.81 | legacy-traceable (url null) → **documented + preuve v2** |
| saint-jean-baptiste | 58 → 58 | 98.86 → **99.72** | 79.39 → 78.14 | 3.22 → 4.39 | orphan → **documented + preuve v2** |
| saint-antoine-sur-richelieu | 68 → **69** | 100 → 100 | 100 → 100 | 7.04 → **6.58** | orphan → **documented + preuve v2** |
| sainte-anne-de-beaupre | 33 (codes null) → **148** | *aucun produit* → **99.95** (2130 lots) | n/a → 0 | n/a → 7.14 | orphan → **documented + preuve v2** |

Readback de contrôle (`_zone-source-readback-audit.ts --slugs …`) après dépôt :
`total=8 stamped=6 stamped_null=2 unstamped=0 read_error=0` — les 6 déposées portent
`level=documented` et l'URL WFS `cql_filter=id_municipalite=…` verbatim ; les 2 refusées
restent `url=null` (inchangées, comme attendu).

### Aucune restauration de lots effectuée — justification

Trois villes voient le **mismatch monter** (varennes 1.16→4.98, ormstown 1.54→2.81,
saint-jean-baptiste 3.22→4.39). Ce n'est pas une régression et une restauration serait
strictement néfaste :

1. La métrique est un **proxy centroïde** (documenté dans l'en-tête du script) confronté à
   un fold **aire-majorité**. Son plancher monte mécaniquement avec la finesse du
   découpage. Preuve interne au lot : `saint-antoine-sur-richelieu`, dont la couche
   candidate est quasi identique à la servie (69 vs 68), affiche 7.04 % AVANT et 6.58 %
   APRÈS — donc ≈ 5–7 % est le **bruit de base** d'un fold frais sur zonage fin, pas de la
   péremption.
2. Le chiffre AVANT compare *anciens lots × ancienne géométrie*. Restaurer les lots
   produirait *anciens lots × NOUVELLE géométrie* — exactement le piège
   `rectifier-zone-exige-refold-lots`. Pour varennes, les 16 codes anciens ne couvrent plus
   que 359 lots dans la couche officielle : une restauration mettrait ~90 % des lots
   assignés en mismatch.
3. Les deux villes dont le mismatch **baisse** sont celles au plus fort volume
   (la-prairie 10.22→8.55) — le sens général est bon.

### Chute des normes sur varennes — lecture honnête

`varennes` passe de `norms=100 %` à `4.33 %` (3 269 → 359 lots porteurs de normes). Les 16
codes de l'ancienne couche sont TOUS présents dans la couche officielle : la chute
mesure donc que les **16 polygones legacy sur-couvraient massivement le territoire** et
attribuaient leurs normes à 3 269 lots que la couche officielle place dans d'autres zones.
L'état APRÈS est moins couvrant mais correct ; le déficit est désormais un vrai trou
d'acquisition de normes (238 zones sans grille), pas une couverture illusoire.
Même mécanique, plus modérée, sur la-prairie (6.16→4.99 %).

---

## 4. Traces S3 (écritures et sauvegardes)

Backups géométrie (`normalized/ca-qc-zonage/_replaced/`), horodatage `2026-07-25T194[23]Z` :
`qc-zonage-la-prairie__flat`, `qc-zonage-varennes__flat`, `qc-zonage-ormstown__flat`,
`qc-zonage-saint-jean-baptiste__subdir`, `qc-zonage-saint-antoine-sur-richelieu__subdir`,
`qc-zonage-sainte-anne-de-beaupre__subdir`.

Backups lots (`normalized/qc-lots/_replaced/` + `normalized/qc-lot-zonage/_replaced/`),
pour restauration via `_lot-zone-refold-s3.ts --slug <s> --mode restore --ts <ts>` :

| slug | ts backup lots |
|---|---|
| la-prairie | `2026-07-25T194338529ZZ` |
| varennes | `2026-07-25T194347823ZZ` |
| ormstown | `2026-07-25T194401686ZZ` |
| saint-jean-baptiste | `2026-07-25T194409884ZZ` |
| saint-antoine-sur-richelieu | `2026-07-25T194417312ZZ` |
| sainte-anne-de-beaupre | `2026-07-25T194425957ZZ` (2 objets — pas de parquet qc-lot-zonage préexistant) |

Note de layout : pour les 3 collections servies en SOUS-DOSSIER
(`saint-jean-baptiste`, `saint-antoine-sur-richelieu`, `sainte-anne-de-beaupre`), le runner
écrit les DEUX clés (plate + sous-dossier), toutes deux porteuses de la même preuve v2 et
du même sha256 — conforme à `fold-double-key-s3-serving`.

SHA-256 des octets prouvés (verbatim des runs) :

| slug | sha256 | retrieved_at |
|---|---|---|
| la-prairie | `sha256:3b63c670df1cb08ffd5069637238dced0c76b089c9640264c71d14fa87e44d09` | 2026-07-25T19:42:05.768Z |
| varennes | `sha256:c33363c463da86c294950ff52a1d3911c95acbb83ae145fe2d93a3126ea77e71` | 2026-07-25T19:42:19.096Z |
| ormstown | `sha256:f8372e734012c49fcb0c4addac5b85888cabbbd10abfa8dad7b12a7780331f8d` | 2026-07-25T19:42:28.205Z |
| saint-jean-baptiste | `sha256:4ed3ff1e7f86b3c7b1ee07f5e749175594b1acf3f5cadac7e10b4077fb5aab63` | 2026-07-25T19:42:41.346Z |
| saint-antoine-sur-richelieu | `sha256:7da115559c488a1866bf75a3880d76d624545400fd52cf3d3fddb515da0cede3` | 2026-07-25T19:42:50.930Z |
| sainte-anne-de-beaupre | `sha256:244263df224aae4ad872d019644be37ada3fce869fbfd4cc899ef9f620be4e2d` | 2026-07-25T19:43:03.261Z |

---

## 5. Reste à faire (non exécuté ici)

- **`saint-denis-sur-richelieu` (1 code) et `chateauguay` (9 codes)** sont déblocables
  UNIQUEMENT en prouvant la dépréciation de ces codes dans le règlement en vigueur, et
  seulement si `zones-geocentralis-replace.ts` reçoit un `--allow-deprecated` équivalent à
  celui de `zones-arcgis-replace.ts`. Le fichier source n'a pas été touché (lane d'un autre
  agent).
- **Gisements MRC (Bellechasse 19, Argenteuil 7, Coaticook 12) et JMap Portneuf 12** :
  ~40 collections supplémentaires, toutes bloquées par l'absence de filtre attributaire
  (`--where` / `--layer-defn`) dans `zones-arcgis-replace.ts` et par l'absence de runner
  JMap avec session anonyme. C'est un mur d'OUTILLAGE, pas de source : les URLs publiques
  sont déjà vérifiées dans le registre de sourcing.
- Villes mono-muni ArcGIS restantes exécutables sans modif (`--zone-field` à identifier) :
  `hampstead` (1869), `sherbrooke` (1904), `saint-hyacinthe` (1091), `shawinigan` (678),
  `westmount` (159), `quebec` (4786, GeoJSON officiel), `longueuil` (2085).
