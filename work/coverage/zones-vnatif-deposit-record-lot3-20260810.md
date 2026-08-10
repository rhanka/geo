# Dépôt v2 vecteur natif — record lot3 (2026-08-10)

Capture cluster `geo-capture-zones-20260810t121500z` (run-stamp `20260810T121500Z`,
2 shards, **Complete 2/2**, 19s). Chemin de dépôt RÉUTILISÉ (déjà committé, cf lot1
`1f6beea2` / lot2 `f16fc5f0`) : manifeste dérivé des OCTETS CAS par
`zones-vecteur-natif-manifest-run.ts`, dépôt octet-vérifié + gates
identité/couverture/régression par `zones-vecteur-natif-deposit-run.ts`
(`depositCapturedZones` → `putServedZoneGeojson`). Preuve v2 visée =
`{url, retrieved_at, sha256}` du manifeste ; `type=arcgis method=natif reliability=directe`.

Chaque capture a été RE-HASHÉE (sha256 des octets CAS == sha annoncé == sha de la clé CAS),
confirmée FeatureCollection non vide **100% polygonale**, et `nearest_registre_muni == slug`
(anti-homonyme G4) avant tout dépôt (`_zones-vnatif-resolve-lot3-20260810.ts`).

Détermination du zone_field DEPUIS LES OCTETS (pas la worklist `outFields=*`) :
- **saint-hippolyte** (`75045_PUBLIC/MapServer/142`, source JMAP) : `REGLEMENT_` = code
  complet unique (100% non-null, distinct=112, ex `C-134`,`H-122`,`P-127`) ; les autres
  champs (`JMAP_ID` séquentiel, `JMAP_AREA/LENGT/CENTR`) sont du housekeeping géométrique.
- **saint-lin-laurentides** (`services8/PF86XLgxesdAEe8M/Zonage/FeatureServer/0`) :
  `CodeZone` = code complet unique (100% non-null, distinct=139, un polygone par zone,
  ex `M-18`,`H1-14`,`P-12`). `NUMERO` seul est 89.9% non-null, `USAGE` n'est que la lettre
  de classe (distinct=10) — champ zone légitime = `CodeZone`.

## Résultat : 0 DÉPOSÉ, 2 SKIP (gate identité — anti-régression)

Les 2 captures sont **réelles et valides**, mais le dépôt est REFUSÉ par le gate
identité de `depositCapturedZones` : la collection SERVIE porte des codes de zone
absents de la couche amont capturée. Aucun dépôt forcé (anti-régression) — un
remplacement amputerait des zones servies. Évidence exacte :
`_zones-vnatif-compare-lot3-20260810.ts` + verdict du runner `--commit`.

| slug | capture (champ) | servi (level, layout) | codes couverts / non couverts | codes non couverts |
|---|---|---|---|---|
| saint-hippolyte | 112 (`REGLEMENT_`) | 93 (legacy-traceable, flat) | 92 / **1** | REC612 |
| saint-lin-laurentides | 139 (`CodeZone`) | 115 (orphan, nested) | 109 / **6** | C4,H148,H149,H150,H210,P13 |

### saint-hippolyte — coverage-bound/unserved-v2
Servi legacy-traceable (93 feat, 93 codes, `zone_source_url=null`). La capture (112 feat,
plus complète en nombre) omet cependant **REC612** — déposer amputerait cette zone servie.
HELD. À reconcilier (REC612 périmé/renommé dans la source LBP courante, ou trou de capture ?).

### saint-lin-laurentides — servi geometry-suspect (intent = REMPLACER)
Servi `orphan` (139 feat / 115 codes distincts, `zone_source_url=null`, layout sous-dossier),
géométrie incomplète (~10.74% des lots hors toutes zones servies). L'intention lot3 était de
REMPLACER par un v2 complet. La capture `CodeZone` (139 feat, un polygone par zone) est une
couche propre mais couvre **109/115** codes servis seulement : elle en omet **6**
(C4,H148,H149,H150,H210,P13). Un remplacement n'est un progrès QUE s'il est un superset des
codes servis (pas d'amputation) — condition non remplie → **SKIP**, exactement comme lot2
pour saint-colomban / sainte-sophie. Pas de dépôt forcé.

### Readback indépendant (`_zones-vnatif-readback-lot3-20260810.ts`) — S3 intact
Le gate lève AVANT toute écriture (`putServedZoneGeojson`) : aucun backup `_replaced/` créé,
S3 inchangé. Les objets servis conservent leur provenance antérieure et ne portent PAS le
sha256 de la capture lot3 :
- saint-hippolyte reste `legacy-traceable` (93 feat, `zone_source_url=null`), `proof_shas=[]` ;
- saint-lin-laurentides reste `orphan` (139 feat, `zone_source_url=null`), `proof_shas=[]`.

Aucun des 2 objets ne porte le sha256/url de la capture lot3 → dépôt non intervenu, anti-régression tenue.

## Suite (les octets CAS sont durables, re-déposables sans re-capture)
- **saint-hippolyte** : réconcilier le code servi REC612 (périmé/renommé LBP courant ?),
  puis re-déposer depuis le CAS (`sha256:543f88a1…`).
- **saint-lin-laurentides** : réconcilier les 6 codes servis manquants
  (C4,H148,H149,H150,H210,P13). Vu que le servi est `orphan` + géométrie suspecte, arbitrer :
  soit obtenir/attendre une source amont qui couvre ces 6 codes, soit décider explicitement
  de repartir du CodeZone complet (perte assumée des 6 codes orphelins) — à trancher avant
  tout dépôt (jamais d'amputation implicite).
