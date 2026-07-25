# Recalage PDF — shard 0/1 — lot 2

Horodatage : 2026-07-18T09:45:07Z. Aucun zonage n'a été servi dans ce lot : les garde-fous ont été conservés.

| Slug | Source / méthode | Décision et preuve |
|---|---|---|
| `bouchette` | PDF municipal `reglement-85-zonage-partie-iii.pdf`, T1 puis T2/T3 | **Rejeté.** T1 sans géoréférencement. Le registre raster produit bien 17 GCP (résidu 15,466 m, holdout 18,949 m), mais les coordonnées `fy` du GCP sont hors page (jusqu'à 1,51) : correspondance page/orientation non fiable, donc pas de build. `work/zones-recalage/root-shard0of1-20260718T1015Z/bouchette-p1.t3.report.json`. |
| `bois-franc` | Plan local, T1 puis T2/T3 | **Rejeté.** T1 sans géoréférencement; 9 correspondances indépendantes après pruning, sous le minimum de 12. `work/zones-recalage/root-shard0of1-20260718T1015Z/bois-franc-p1.t3.report.json`. |
| `bowman`, `brome`, `bryson`, `cacouna`, `campbells-bay`, `caniapiscau`, `cayamant` | Discovery reprise | **Pas de source officielle de plan de zonage exploitable identifiée** dans les relevés bornés existants; aucun plan ni géométrie n'est inventé. |
| `cap-chat` | Artefacts officiels existants | **Rejeté sémantiquement.** Les GeoPDF disponibles sont des cartes de contraintes d'érosion côtière, pas le plan de zonage municipal. |
| `chapais` | T2 existant | **Rejeté.** `svg_points=0`, aucune semence T2 vérifiable. `work/zones-recalage/shard1of2/chapais-t2-report.json`. |
| `chartierville` | T2 existant | **Rejeté.** `svg_points=0`, aucune semence T2 vérifiable. `work/zones-recalage/shard0of1-20260717T225517Z/chartierville-t2.report.json`. |
| `chertsey` | PDF municipal carte 1 | **Rejeté.** Plan raster sans GCP indépendants; les preuves antérieures ne franchissent pas le gate. `work/delegation-mass/zones-recalage-2/chertsey.json`. |
| `gaspe` | Source officielle actuelle : [Ville de Gaspé — Annexe 1, Zonage 1 de 4](https://ville.gaspe.qc.ca/wp-content/uploads/2026/03/Zonage_1_de_4.pdf); T1 puis T2 avec arbitrage anisotropie | **Rejeté.** PDF officiel vérifié (SHA-256 `b10112a1…b679f56`), 17 GCP et résidu/holdout jusqu'à 19,108/22,548 m, mais anisotropie 1,256–1,346. L'arbitrage cadastral donne seulement 56,13 % de couverture servante, sous le seuil strict de 85 %. `work/zones-recalage/root-shard0of1-20260718T1015Z/gaspe-p1.aniso-autogcp.report.json`. |
| `lac-edouard` | Relecture du plan scanné et des preuves T3 | **Rejeté.** Le précédent essai vision contrôlé ne couvre que 20/490 lots (4,08 %), donc feuille partielle impropre à servir. `work/delegation-mass/zones-recalage-2026-07-17T22-35-41Z-shard0of1.md`. |

Le superviseur relancé après le lot indique `zones=868/1106`; aucune utilisation d'AGOL owner harvest.
