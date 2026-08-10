# Dépôt v2 vecteur natif — record lot2 (2026-08-10)

Capture cluster `geo-capture-zones-20260810t110000z` (run-stamp `20260810T110000Z`,
3 shards, **Complete 3/3**). Chemin de dépôt RÉUTILISÉ (déjà committé, cf lot1
`1f6beea2`) : manifeste dérivé des OCTETS CAS par `zones-vecteur-natif-manifest-run.ts`,
dépôt octet-vérifié + gates identité/couverture/régression par
`zones-vecteur-natif-deposit-run.ts` (`depositCapturedZones` → `putServedZoneGeojson`).
Preuve v2 visée = `{url, retrieved_at, sha256}` du manifeste ; `type=arcgis method=natif reliability=directe`.

Chaque capture a été RE-HASHÉE (sha256 des octets CAS == sha annoncé == sha de la clé CAS),
confirmée FeatureCollection non vide, et `nearest_registre_muni == slug` (anti-homonyme)
avant tout dépôt (`_zones-vnatif-resolve-lot2-20260810.ts`).

## Résultat : 0 DÉPOSÉ, 3 SKIP (gate identité — anti-régression)

Les 3 captures sont **réelles et valides**, mais le dépôt est REFUSÉ par le gate
identité : la collection SERVIE porte des codes de zone absents de la couche amont
capturée. Aucun dépôt forcé (anti-régression) — un remplacement amputerait des zones
servies. Évidence exacte : `_zones-vnatif-compare-lot2-20260810.ts`.

| slug | capture (champ) | servi (level) | codes couverts / non couverts | codes non couverts |
|---|---|---|---|---|
| lassomption | 361 (`Zonage`) | 359 (**documented**) | 347 / **12** | H1133,H1134,H331-334,H405,I102-104,P138,P221 |
| saint-colomban | 199 (`COMBINE`) | 161 (legacy-traceable) | 155 / **6** | C176,C177,C3093,H1161,P170,P175 |
| sainte-sophie | 105 (`Numero`) | 64 (legacy-traceable) | 61 / **3** | V80,V804,V805 |

### Détermination du champ zone (MapServer LBP inclus)
- **lassomption** (`Zonagev2/FeatureServer/1`) : `Zonage` = code complet en un seul champ
  (100% non-null, distinct=361, ex `H1-103`) ; `Zone` (classe) et `num` (numéro) n'en sont
  que les parties. Clean single-field.
- **saint-colomban** (MapServer/140) : `COMBINE` = code complet assemblé dans UN champ source
  (100% non-null, 100% bien-formé sur les 199 feat, ex `H1-009`, `N2-145.3`). `NO_ZONE` seul
  n'est que 81.9% non-null (les 36 zones N2 à sous-numéro décimal ne tiennent pas dans le
  champ entier). **PAS composite multi-champ** contrairement à mirabel → champ zone légitime.
- **sainte-sophie** (MapServer/140) : `Numero` = code complet unique (100% non-null, distinct=105,
  ex `RU-601`,`CH-201`,`V-800`) ; `TYPE`/`N0M` en sont l'étiquette d'affectation redondante.
  Clean single-field.

### Readback indépendant (confirme l'absence de régression)
Le gate lève AVANT toute écriture (`putServedZoneGeojson`) : aucun backup `_replaced/` créé,
S3 intact. Les objets servis conservent leur provenance antérieure :
- lassomption reste `documented` avec `zone_source_url=…/URB_MAJZonageJuillet2021/FeatureServer/0`
  (la couche SŒUR déjà prouvée v2, PAS la capture Zonagev2/1) ;
- saint-colomban & sainte-sophie restent `legacy-traceable`, `zone_source_url=null`.

Aucun des 3 objets ne porte le sha256/url de la capture lot2 → dépôt non intervenu, anti-régression tenue.

## Suite (les octets CAS sont durables, re-déposables sans re-capture)
- **lassomption** : déjà couverte en v2 `documented` (couche sœur `URB_MAJZonageJuillet2021/0`).
  La worklist a ciblé `Zonagev2/1`, une couche qui OMET 12 zones du servi. Pas de gain à
  déposer ; à clore comme déjà-documented sauf décision de basculer vers Zonagev2 (à trancher).
- **saint-colomban / sainte-sophie** (servi legacy sans v2) : cibles réelles d'upgrade. Reconcilier
  les codes legacy manquants (6 / 3) — périmés/renommés dans la source LBP courante, ou trous
  de la capture ? Trancher avant un dépôt réconcilié.
