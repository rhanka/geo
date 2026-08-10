# Dépôt v2 ESTABLISH — brossard + boucherville (SIG Agglomération de Longueuil)

**Date** : 2026-08-10 · **run-stamp capture** : `20260810T230000Z` (OVH, Job `geo-capture-zones-20260810t230000z`, 2/2 Complete, 27 s)
**Cibles** : g-cond col-2 rank-8 (brossard, incomplet 6,7 %) et rank-14 (boucherville, incomplet 6,07 %).
**Verdict** : **FOUND + DEPOSITED** pour les DEUX. Découverte fraîche (aucune n'était dans
`zones-v2-upgrade-scoping-20260810.json`).

## Source découverte (couverte pour toute l'agglo)

ArcGIS Server **on-prem** de la Ville / Agglomération de Longueuil :

```
https://geomatique.longueuil.quebec/public/rest/services/CarteInteractive/Amenagement_du_territoire/MapServer/3
```

- Couche **« Zonage »** (layer id 3), `esriGeometryPolygon`, `maxRecordCount=2500`, SR native 32188 (MTM 8).
- **PARTAGÉE** : le champ `GROUPEUSAGE` discrimine la municipalité —
  `VLO`/`GPK`/`STH` = arrondissements de Longueuil, **`BRO` = Brossard**, **`BOU` = Boucherville**,
  `STB` = Saint-Bruno, `STL` = Saint-Lambert (7 valeurs distinctes, 3542 features au total).
- Champ code-zone **autoritaire** : `ZONAGEMUNICIPALID` (valeur brute, jamais dérivée).
  `DISPOSITIONSPECIALE` pointe vers `…/hotlink/Logo/Zonage/<CODE>/<id>.pdf` — corrobore la nature « zonage » per-muni.
- Capture par muni : `…/MapServer/3/query?where=GROUPEUSAGE=%27BRO%27&outFields=*&outSR=4326&f=geojson`
  (idem `BOU`). `f=geojson` rend WGS84 lon/lat ; les deux comptes (694 / 463) < `maxRecordCount`
  ⇒ requête mono-passe, `exceededTransferLimit=false`.
- Preuve : `type=arcgis`, `method=natif`, `reliability=directe`, `schema_version=2.0`.

## Résultat par municipalité

| muni | statut | source features | live count | grain | zone_code (champ) | overlap servi | servi→UNKNOWN | nearest (anti-homonyme) | byte-exact | readback |
|---|---|---:|---:|---|---|---:|---:|---|---|---|
| **brossard** | DEPOSITED | 694 | 694 | zone-polygon | `ZONAGEMUNICIPALID` | 77,5 % | 69 | brossard 0,48 km ✓ | ✓ | VERT |
| **boucherville** | DEPOSITED | 463 | 463 | zone-polygon | `ZONAGEMUNICIPALID` | 100 % | 0 | boucherville 0,14 km ✓ | ✓ | VERT |

- **sha256** capture : brossard `e6d0c6a0…474358b`, boucherville `02b5af5a…2bf6288`.
- **Servi AVANT** (les deux) : `zone_source_level=legacy-traceable`, `zone_source_url=null`, **aucune** preuve v2
  (feature ni collection) ⇒ cibles **UNPROUVÉES**, éligibles à un v2 frais (ÉTABLISSEMENT).
- **Servi APRÈS** : `zone_source_level=documented`, `zone_source_url` = l'URL de preuve, `geometry_grain=zone-polygon`,
  bloc `proof.geometry_source` (sha256 + retrieved_at) par-feature ET collection. `populatedProperties`
  ne régresse pas (brossard 3882→12053, boucherville 6360→9327).
- **Backups** `_replaced/` : `qc-zonage-brossard__flat.2026-08-10T1848Z.geojson`,
  `qc-zonage-boucherville__flat.2026-08-10T1849Z.geojson`.

## ÉTABLISSEMENT vs upgrade — décision anti-invention

Les deux cibles sont UNPROUVÉES : un v2 frais **établit** la géométrie servie, il n'exige donc
**pas** ≥90 % de recouvrement (l'overlap est **rapporté**, jamais opposé comme garde — contrairement
à la recette AGOL sur cibles déjà prouvées). Le gate d'identité PROVENANCE-AWARE de
`depositCapturedZones` ne bloque que sur un code servi **réellement prouvé v2** ; aucun ici.

- **boucherville** : la couche live est un **sur-ensemble strict** du servi (386 codes tous présents parmi 463) —
  0 code servi-seulement. Corroboration forte (ex. `A-2004` présent des deux côtés).
- **brossard** : 69 codes servi-seulement (canoniques `PL4,HL39,CL46,…`) absents de la couche amont courante
  (rezonage/renommage depuis la dérivation legacy) → **status UNKNOWN (recalage-flagged), JAMAIS N-A** ;
  géométrie antérieure sauvegardée octet-pour-octet sous `_replaced/`. Le remplacement n'atteste pas l'abolition.

## Gardes vérifiées (par muni, isolation stricte)

G2 byte-exact (rehash CAS == manifeste == clé CAS + `verifyRawCapturePayload`) ✓ ; FC non vide ✓ ;
100 % polygonal ✓ ; anti-homonyme `nearest_registre_muni===slug` ✓ ; grain `zone-polygon` (aucun marqueur UEV) ✓ ;
`ZONAGEMUNICIPALID` présent, **0 valeur vide** ✓ ; anti-troncature ArcGIS (`returnCountOnly[MÊME where]==features`
& `!exceededTransferLimit`) ✓ ; servi ne portait PAS déjà une preuve v2 ✓ ; readback G5 (géométrie octet-exacte,
`level=documented`, `url=proof.url`, sha==capture, grain uniforme, backup présent) ✓.

## Reproductibilité

- Worklist : `work/coverage/zones-vnatif-capture-worklist-brossard-boucherville-20260810.json`
- Sonde servi (lecture seule) : `acquisition/src/_zones-vnatif-inspect-brossard-boucherville-20260810.ts`
- Runner de dépôt : `acquisition/src/_zones-vnatif-deposit-agglo-longueuil-20260810.ts`
  (`--dry-run` par défaut, `--commit` pour déposer, `--only <slug>`).
- Record machine : `work/coverage/zones-vnatif-deposit-record-brossard-boucherville-20260810.json`.
- Typecheck acquisition : delta 0 (seules subsistent les 2 erreurs pré-existantes
  `capture-e2e-probe.test.ts` et `zones-vecteur-natif-manifest-run.ts`).
