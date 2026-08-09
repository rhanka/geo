# Preuve v2 B' immo — 2026-07-26

Périmètre strict : `barnston-ouest`, `lachute`, `westmount` — aucune autre ville
du vivier B' n'a été lue ni écrite. `props` est le nombre de clés de propriétés
de la collection zonage servie (union protégée par le gate anti-perte de schéma).
`mismatch` est l'audit centroïde ; le numérateur/dénominateur des lots assignés
est affiché pour ne jamais interpréter un 0 % sans assignation.

| ville | inspect / décision | zones avant → après | props avant → après | lots assignés avant → après | mismatch avant → après | provenance avant → après |
|---|---|---:|---:|---:|---:|---|
| `barnston-ouest` | **REFUSÉE** — la couche filtre bien `MUNI='BAO'` (38/38 codes, 0,03 km), mais le gate de preuve refuse l'URL `services3.arcgis.com` comme non re-téléchargeable. Aucun override, aucun dépôt servi. | 38 → 38 | 42 → 42 | 650/650 (100 %) → 650/650 (100 %) | 3,23 % → 3,23 % | orphan → orphan |
| `lachute` | **REFUSÉE** — filtre `co_mun='76020'`, 225 features, 0,37 km ; gate recoupement rouge : **224/225**, `Hc-201` servi absent de la couche. Aucun override, aucun dépôt servi. | 225 → 225 | 22 → 22 | 7 242/7 243 (99,99 %) → 7 242/7 243 (99,99 %) | 3,48 % → 3,48 % | orphan → orphan |
| `westmount` | **DÉPOSÉE** — 159/159 codes, couverture 159 ≥ 159, 0,12 km, une page de capture. Re-fold `lot-zone-join-run` puis `lots-enriched-run` terminé. | 159 → 159 | 30 → **62** | 5 013/5 040 (99,46 %) → 5 013/5 040 (99,46 %) | 10,99 % → 10,99 % | orphan → **documented + preuve v2** |

Westmount : aucune perte de propriété servie (30 → 62 au readback final ; les
cinq folds du dépôt avaient déjà porté le total à 54) ;
le produit `qc-lots` final porte 58 clés de propriétés. Le mismatch est stable
avec le même nombre de lots assignés : aucune conclusion de qualité n'est tirée
d'un changement artificiel de dénominateur.

Preuve Westmount : capture `zones-20260726T041319Z-532937-67d6dcba-6d23-4424-85ce-4adf14e3b787`,
SHA-256 `sha256:33ea4b2595be09f7b0129e85fabb76cc343fdabf953818a8d49f37f14cb82463`,
URL exacte ArcGIS `https://cartes.westmount.org/server/rest/services/Zonage_/FeatureServer/0/query?where=1%3D1&outFields=ZoneNumber&outSR=4326&geometryPrecision=6&resultOffset=0&resultRecordCount=1000&f=geojson`.
Backup servi : `normalized/ca-qc-zonage/_replaced/qc-zonage-westmount__subdir.2026-07-26T0413Z.geojson`.

**Gain net B' en preuve v2 exacte : +1 collection** (`westmount`).
