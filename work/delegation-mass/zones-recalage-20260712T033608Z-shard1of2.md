# Recalage PDF zones — shard 1/2 — 2026-07-12T03:36:08Z

Shard strict : `(index dans la liste triée) % 2 == 1`. Aucun AGOL owner harvest. Aucun code inventé. Runtime Node/TS uniquement.

## Résultat

Un dépôt net a été réalisé pour `saint-honore` après lecture Claude des glyphes, dictionnaire extrait des légendes et fusion des deux feuillets officiels. Les autres preuves du shard restent celles du rapport antérieur consolidé, référencé ci-dessous ; son entrée `saint-honore` est remplacée par le dépôt réussi de cette passe.

## Dépôt net

| index | slug | voie | preuves de gates |
|---:|---|---|---|
| 711 | saint-honore | T1 GeoPDF multi-feuillets + Claude vision dict-validé | C-787-1/C-787-2 officiels ; résidus `0,066 m` et `0,121 m` ; 111 lectures validées, 109 codes distincts ; spatial `0,974 km` ; 87 features polygonales sur cadastre réel ; 3 321/3 569 lots (`93,05 %`) |

S3 : `normalized/ca-qc-zonage/qc-zonage-saint-honore.geojson` et son sidecar stats. Aucun code purement numérique et aucun token `affectation/CMM/MRC/SAD/PMAD` dans la couche. La géométrie provient exclusivement des lots cadastraux.

Source officielle : `https://www.ville.sthonore.qc.ca/wp-content/uploads/2020/11/C-787-1_zonage_Territoire_Aout-2019_Rev_Mars-2020.pdf` et `https://www.ville.sthonore.qc.ca/wp-content/uploads/2020/11/C-787-2-Zonage-Urbain-Aout-2019.pdf`.

## Chaîne immo inline

- `lot-zone-join-run.ts --slugs saint-honore --simplify-zones-m 1` : dépôt vérifié, 3 569 lignes, `95,26 %` assignées ; correspondance normes `0 %` car aucune grille autoritaire n’est disponible pour ces codes, valeur laissée nulle.
- `lots-enriched-run.ts --slugs saint-honore` : dépôt vérifié, 3 569 lots, `zone_code=95,26 %`, surface `100 %`, code postal RTA `100 %`, adresse `89,91 %`.

## Escalade et preuves de ce lot

La sélection initiale `zones-recalage-shardN-select.ts --mod 2 --rem 1 --limit 12` a donné `aguanish`, `ange-gardien`, `austin`, `baie-johan-beetz`, `begin`, `blanc-sablon`, `boileau`, `bois-franc`, `bonne-esperance`, `bowman`, `brome`, `bryson`. Le discovery officiel borné documente l’absence de lien PDF de plan pour les autres, et `begin` ne fournit que des règlements texte ; son T1 a rejeté l’absence de `/VP /Measure /GEO`.

Pour le lot PDF suivant, les probes T1 et les rapports T2 disponibles ont été contrôlés : `labrecque` (T1 sans géoréf ; T2 orientation/isotropie rejetée), `lac-superieur` (T1 sans géoréf ; aucun seed T2 résidu+holdout), `matane` (T1 sans géoréf ; rotation ambiguë et couverture rejetée), `sacre-coeur` (plans sans géoréf, glyphes ; aucune voie T2 dict-validée honnête disponible), `saint-ambroise` (plans raster-scan, seed T3 absent), `saint-sixte` (T1 sans géoréf ; T2 iso/anisotropie rejetée). Pour `chambord`, les liens officiels ont été tentés mais le serveur a réinitialisé les téléchargements ; le discovery/rapport antérieur ne fournit pas de plan complet recal able.

Preuve consolidée inchangée pour les autres slugs du shard : `work/delegation-mass/zones-recalage-20260712T025725Z-shard1of2.md` (139 slugs non terminés couverts par dépôt antérieur ou preuve d’échec). Cette passe ne réattribue pas les dépôts antérieurs et ne relance pas un gate déjà documenté sans nouvel artefact.

## Artefacts locaux de la voie réussie

- `work/zones-recalage/shard1of2/saint-honore.codes.json`
- `work/zones-recalage/shard1of2/saint-honore-territoire.fullpage-reads.json`
- `work/zones-recalage/shard1of2/saint-honore-urbain.fullpage-reads.json`
- `work/zones-recalage/shard1of2/t1ms-saint-honore/qc-zonage-saint-honore.geojson`
- `work/zones-recalage/shard1of2/t1ms-saint-honore/qc-zonage-saint-honore.stats.json`
