# Attestation d'absence-source re-jouable — L'Île-Dorval

Instantané : **2026-08-03** · slug `lile-dorval` · rang priorité **16/167** · lecture seule S3.

## Règle de verdict (Option A)

`present` → COMPLET ; `absent` prouvé → N-A PROUVÉ ; `source-inaccessible` → GAP/UNKNOWN. Une collection non servie, un portail protégé ou un zéro évènement non scrapé ne prouvent jamais une absence métier.

| Col. | Champ | Résultat d'attestation | Verdict | Source et sélecteur re-jouables |
|---:|---|---|---|---|
| 2 | Zonage propre | `source-inaccessible` | **GAP** | `https://liledorvalisland.ca/fr/portail/reglements` ; GET suivi des redirections → `/fr/connexion`, donc règlement non lisible publiquement. |
| 12 | `code_zone` par lot | `source-inaccessible` | **GAP** | S3 `normalized/qc-lots/qc-lots-lile-dorval/qc-lots-lile-dorval.geojson`, puis flat homonyme ; nested avant flat → aucun objet servi. `zonage-inspect --find lile-dorval` : 0 grille ArcGIS réattribuée (non concluant sur l'absence de zonage). |
| 13 | Normes pliées | `source-inaccessible` | **GAP** | `work/coverage/immo-folded-normes-city-matrix-20260802.json`, `cities[slug=lile-dorval]` → `unknown`, aucun stats Immo; portail règlement protégé. |
| 14 | Lots `qc-lots` servis | `source-inaccessible` | **GAP** | Outil ratifié, mêmes deux clés S3; rang 16 du dump 167 : `present:false`, toutes mesures `null`. C'est un GAP de dépôt, pas « zéro lot ». |
| 15 | `surface_m2` | `source-inaccessible` | **GAP** | Outil ratifié : `properties.surface_m2`, puis rôle MAMH `RL66092_2026.xml`, `RL0103Ax`/`RL0302A`; aucun `NO_LOT` servi pour joindre. |
| 16 | `code_postal` | `source-inaccessible` | **GAP** | Outil ratifié : `properties.code_postal`; le rôle foncier le déclare `null` par contrat, et la géométrie lot manque pour le FSA/RTA. |
| 17 | Adresse civique | `source-inaccessible` | **GAP** | Outil ratifié : `properties.adresse`, puis rôle MAMH `RL0103Ax`/`RL0101Ax,RL0101Ex,RL0101Gx`; aucun `NO_LOT` servi pour joindre. |

## Reproduction

```sh
NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
  npx tsx acquisition/src/cadastre-role-absence-attestation.ts \
  --slug lile-dorval --lots 0 --field lot,adresse,code_postal,surface \
  --date 20260803 --max-seconds 55

NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
  npx tsx acquisition/src/cadastre-role-absence-attestation.ts \
  --coverage-dump-167 --date 20260803 --max-seconds 55

NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
  npx tsx acquisition/src/zonage-inspect.ts --find lile-dorval
```

`0` est un sélecteur sentinelle imposé par l'interface de l'outil, non un numéro de lot allégué. La recherche des deux layouts précède ce sélecteur. Le rôle MAMH `RL66092_2026.xml` répondait HTTP 200, mais sa présence seule ne permet ni de choisir des lots ni d'attribuer surface/adresse.

Le site officiel indique aussi que la ville est « autonome depuis 1915 » et publie des avis de règlements. Ces éléments empêchent d'inférer une délégation à l'agglomération; ils ne prouvent toutefois pas l'existence ou l'absence d'un règlement de zonage propre. **Conclusion : L'Île-Dorval est GAP sur toutes les colonnes pertinentes, N-A PROUVÉ sur aucune.** Rappel : Kirkland reste GAP (403 anti-bot sur une source existante), jamais N-A.
