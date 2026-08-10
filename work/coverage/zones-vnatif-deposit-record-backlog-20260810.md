# Dépôt zones — CLOSE-OUT BACKLOG (récupération file SKIP campagne upgrade v2) — 2026-08-10

**7 RECOVERED-DEPOSITED** (readback VERT sur les 7) + **12 FINAL-SKIP** documentés
(résidu irrécupérable, jamais forcé). Capture `geo-capture-zones-20260810t220000z` (Complete 11/11 shards, cluster OVH poc-ca).

Réplique EXACTE de la recette de dépôt géoCentralis lot-B (`dd7e4cf9`) / AGOL (`5cc7e680`) — G2 byte-exact,
grain zone-polygon, gate PROVENANCE-AWARE, `level→documented`, `url=proof.url`, backup `_replaced/`, dropped→UNKNOWN
(jamais N-A), readback G5, anti-troncature. **Deux ajouts contrôlés, anti-invention, jamais forcés** :

1. **Override anti-homonyme sur identité FORTE VÉRIFIÉE** — le garde bbox-centroïde `nearest==slug` est un
   FAUX-NÉGATIF pour un muni rural adjacent. Override SEULEMENT si : `wfs-id-verified` (le filtre WFS
   `id_municipalite=<id>` égale le `mamhCode` du slug dans `qc-municipal-directory.json` ET le mamhCode du
   muni-nearest flaggé est DIFFÉRENT), OU `agol-name-match` (le filtre `MUNI='<Nom>'` égale le `name` du slug,
   NFD). Overlap source-identity ≥90% reste EXIGÉ dans les deux cas.
2. **Drop empty-code borné** — quelques features à code vide retirées ssi fraction ≤10% ET overlap non-vide
   ≥90%. RÉSULTAT : bloqué par le **coverage-gate anti-perte** de `depositCapturedZones` (le servi legacy
   RETIENT les features à code vide ; les droper réduirait le nombre de features servies). → FINAL-SKIP.

Scripts : `acquisition/src/_zones-vnatif-select-backlog-20260810.ts` (sonde live + worklist),
`acquisition/src/_zones-vnatif-deposit-backlog-20260810.ts` (dépôt), `..._record-finalize-backlog-20260810.ts` (ce record).
Worklist : `work/coverage/zones-vnatif-capture-worklist-backlog-20260810.json` (11 munis capturés).

## 1. RECOVERED-DEPOSITED (7) — candidate/legacy-traceable → documented v2, readback VERT

| # | muni | plateforme | preuve | champ code | overlap | features | override (identité vérifiée) | sha256 (court) |
|---|---|---|---|---|---:|---:|---|---|
| 1 | pointe-aux-outardes | géoCentralis WFS | wfs | etiquette_1 | 100% | 59 | wfs-id-verified | 1743aa1a |
| 2 | saint-anaclet-de-lessard | géoCentralis WFS | wfs | etiquette_1 | 100% | 5 | wfs-id-verified | 3f9e3b80 |
| 3 | saint-camille-de-lellis | géoCentralis WFS | wfs | etiquette_1 | 100% | 4 | wfs-id-verified | ae878bff |
| 4 | saint-ignace-de-loyola | géoCentralis WFS | wfs | etiquette_1 | 100% | 35 | wfs-id-verified | 388dbe70 |
| 5 | saint-marcel | géoCentralis WFS | wfs | etiquette_1 | 100% | 6 | wfs-id-verified | a011b6fc |
| 6 | saint-marcellin | géoCentralis WFS | wfs | etiquette_1 | 100% | 3 | wfs-id-verified | 832cf402 |
| 7 | saint-ludger | AGOL (ArcGIS Online) | agol | NO_ZONE | 100% | 68 | agol-name-match | 59242845 |

**Base d'identité (override anti-homonyme) — jamais deviné :**

- **pointe-aux-outardes** : wfs id_municipalite=96030 == mamhCode[pointe-aux-outardes]=96030 ET mamhCode[nearest chute-aux-outardes]=96035 != 96030 → nearest est un muni rural adjacent (faux-négatif centroïde)
- **saint-anaclet-de-lessard** : wfs id_municipalite=10030 == mamhCode[saint-anaclet-de-lessard]=10030 ET mamhCode[nearest saint-donat--la-mitis]=09030 != 10030 → nearest est un muni rural adjacent (faux-négatif centroïde)
- **saint-camille-de-lellis** : wfs id_municipalite=28070 == mamhCode[saint-camille-de-lellis]=28070 ET mamhCode[nearest saint-just-de-bretenieres]=18005 != 28070 → nearest est un muni rural adjacent (faux-négatif centroïde)
- **saint-ignace-de-loyola** : wfs id_municipalite=52045 == mamhCode[saint-ignace-de-loyola]=52045 ET mamhCode[nearest la-visitation-de-lile-dupas]=52050 != 52045 → nearest est un muni rural adjacent (faux-négatif centroïde)
- **saint-marcel** : wfs id_municipalite=17020 == mamhCode[saint-marcel]=17020 ET mamhCode[nearest sainte-apolline-de-patton]=18025 != 17020 → nearest est un muni rural adjacent (faux-négatif centroïde)
- **saint-marcellin** : wfs id_municipalite=10025 == mamhCode[saint-marcellin]=10025 ET mamhCode[nearest saint-gabriel-de-rimouski]=09025 != 10025 → nearest est un muni rural adjacent (faux-négatif centroïde)
- **saint-ludger** : agol filtre MUNI='Saint-Ludger' == name[saint-ludger]='Saint-Ludger' (NFD) → identité nom-exact prime le centroïde-nearest (nearest saint-robert-bellarmin = muni rural adjacent)

Tous à overlap 100 % (0 code droppé→UNKNOWN), grain zone-polygon, backup `_replaced/` présent, `zone_source_level=documented`, `url=proof.url`, byte-exact.

## 2. FINAL-SKIP — empty-code bloqué par coverage-gate anti-perte (4)

Anti-homonyme récupérable OU nearest OK, MAIS ≥1 feature à code vide que le servi legacy RETIENT :
droper = perte de features (refusée par `depositCapturedZones`) ; garder = code fabriqué (anti-invention). Irrécupérable.

| muni | features servies | dont vides | raison |
|---|---:|---:|---|
| saint-gabriel | 65 | 1 | coverage-gate anti-perte + anti-invention |
| saint-charles-garnier | 47 | 2 | coverage-gate anti-perte + anti-invention |
| saint-donat--la-mitis | 63 | 1 | coverage-gate anti-perte + anti-invention |
| beaupre | 78 | 1 | coverage-gate anti-perte + anti-invention |

> Note : `saint-gabriel` était un faux-négatif anti-homonyme RÉCUPÉRABLE (id 52080=mamhCode) mais son 1 feature
> à code vide le bloque via le coverage-gate — irrécupérable sous byte-exact+anti-perte+anti-invention.

## 3. FINAL-SKIP — résidu documenté hors worklist (8)

| muni | source | classe | raison |
|---|---|---|---|
| padoue | geocentralis-lotB | empty-code (non-minime) | 6/39 features à code vide (15.4%) > seuil minorité-minime 10% ; drop refusé ; garder=fabriquer un code (anti-invention) → FINAL-SKIP |
| saint-joseph-de-lepage | geocentralis-lotC | empty-code (non-minime) | 17/54 features à code vide (31.5%) > seuil 10% ; drop refusé ; garder=fabriquer un code (anti-invention) → FINAL-SKIP |
| otterburn-park | geocentralis-lotD | INVESTIGATE→HELD | id 57030 = mamhCode ET nearest OK, MAIS siadmin_pzon_99_s overlap 86.7% (<90%) et l'AUTRE couche evb:zonage_municipal rend 0 feature pour cet id (probe live 20260810T220000Z) → aucune couche ≥90% → HELD (pas de source-identity propre) |
| matapedia | altus | INVESTIGATE/RETRY→HELD | altus MapServer MRC060/06045_Publique répond 200 mais expose layers:[] (service sans couche — toujours down au retry live 20260810T220000Z) → source indisponible → HELD |
| saint-laurent-de-lile-dorleans | altus | INVESTIGATE→HELD | couche Zonage (MRC200/20020/17) = 34 features mais 42 codes servis ⇒ overlap≥90% arithmétiquement impossible (34<37.8) ; aucune autre couche polygonale ne porte de code-zone (hydro/cadastre/UEV) → HELD |
| gore | agol | INVESTIGATE→HELD | servi = 840 codes / 932 features (grain cadastral, pas zonage) ; meilleure partition co_mun de la couche partagée services9/Zonage/0 overlap 0% (nearest=lachute) → les codes servis ne reproduisent aucune partition → HELD (source-identity absente ; le servi lui-même est anormal) |
| havre-saint-pierre | agol | UNRECOVERABLE (portal) | item portal www.arcgis.com = Web Map ; couche opérationnelle HSP_Ligne = featureCollection EMBARQUÉE (aucune URL FeatureServer re-téléchargeable) ET géométrie LIGNE (pas des polygones de zone) → hors chemin FeatureServer → FINAL-SKIP |
| plessisville | agol | UNRECOVERABLE (portal) | item portal www.arcgis.com = Web Map ; couches (ZONAGE, UEV, cadastre) = featureCollections EMBARQUÉES (aucune URL FeatureServer) → hors chemin FeatureServer → FINAL-SKIP |

## 4. Anti-invention & discipline

- Dépôt UNIQUEMENT sur identité confirmée (nom-exact OU id==mamhCode vérifié contre le registre MAMH) ET overlap≥90%.
- Un faux-négatif centroïde-nearest est overridé UNIQUEMENT par une identité forte vérifiée, JAMAIS par supposition.
- Jamais fabriqué de code pour une feature vide ; jamais réduit le nombre de features servies (anti-perte).
- Codes servi-seulement → UNKNOWN, jamais N-A. Byte-exact, backup, gate provenance-aware sur les 7.

## 5. Typecheck

`npx tsc --noEmit -p acquisition/tsconfig.json` → **2 erreurs, les 2 préexistantes connues**
(`acquisition/src/lib/capture-e2e-probe.test.ts` TS2305 ; `acquisition/src/zones-vecteur-natif-manifest-run.ts:165` TS2322).
**Delta = 0** : les 3 scripts backlog n'ajoutent aucune erreur.

## 6. Slugs déposés (pour re-fold)

`pointe-aux-outardes`, `saint-anaclet-de-lessard`, `saint-camille-de-lellis`, `saint-ignace-de-loyola`, `saint-marcel`, `saint-marcellin`, `saint-ludger`

