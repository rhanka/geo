# Recalage PDF zones — shard 0/1 — 2026-07-18T09:35:14Z

Lot examiné : `amherst`, `austin`, `bethanie`, `belcourt`, `chertsey`,
`metabetchouan-lac-a-la-croix`, `saint-boniface`, `saint-michel-des-saints`.

| Slug | Source / voie | Verdict et preuve |
|---|---|---|
| `saint-boniface` | PDF municipal `https://saint-bo.ca/file-16589` (PZ-1-2000), T1 → T3/T2 texte dict-validé | **Déposé**. T1 rejeté (pas de `/VP /Measure /GEO`). 36 GCP indépendants, résidu max 19,797 m; dictionnaire Annexe B #337 (127 numéros non séquentiels), 34 codes exacts; 21 zones, 1 904/3 842 lots (49,56 %). Jointure lots et enrichissement terminés. |
| `saint-michel-des-saints` | plan officiel local municipal/MRC Matawinie, T3/T2; grille officielle locale | **Déposé, couverture partielle explicitement connue.** Texte : 3 codes (<10), puis vision Claude dict-validée : 14 lectures, 13 exactes; 14 GCP indépendants, résidu max 16,642 m, holdout 17,879 m; 6 zones, 856/3 547 lots (24,13 %). Le dictionnaire local ne couvre que 34 codes/familles du plan; aucune extrapolation. Jointure lots et enrichissement terminés. |
| `amherst` | `https://municipalite.amherst.qc.ca/wp-content/uploads/2023/05/352-02-Zonage-revise-2017.pdf` | Rejet T1 : aucun géoréférencement embarqué. Le PDF de règlement indique deux feuillets annexes, absents du fichier; donc aucun plan géoréférençable à servir. |
| `austin` | `https://municipalite.austin.qc.ca/wp-content/uploads/reglement_zonage.pdf` | Rejet T2 : le plan annexé est réel, mais le cadastre requis est absent de `normalized/qc-cadastre-lots/austin.geojson` (`NoSuchKey`), donc aucun GCP ni géométrie ne peut être fabriqué. |
| `bethanie` | `https://municipalitedebethanie.ca/wp-content/uploads/2023/10/Reglement-Zonage-Bethanie.pdf` | Rejet T3 : `work/zones-recalage/shard0of1-20260718/bethanie-p190-chamfer-report.json` montre un seed à la borne d'échelle (ratio 0,30), 242,805 m et marge 1,16 %; les essais raster n'ont aucun holdout indépendant. |
| `belcourt` | plan officiel déjà analysé | Rejet T2 : `work/zones-recalage/shard0of2/belcourt-rural-t2-report.json` — les seeds qui passent résidu/holdout échouent l'orientation ou l'isotropie; aucun fit ne franchit le gate. |
| `chertsey` | `https://www.chertsey.ca/storage/app/media/urbanisme_et_environnement/urbanisme/reglements_urbanisme/Carte-1-Plan-de-zonage-A0.pdf` | Rejet : plan raster A0 sans géoréf; preuve existante `work/delegation-mass/zones-recalage-2/chertsey.json` (T2/T3 sans GCP indépendants admissibles). |
| `metabetchouan-lac-a-la-croix` | règlement municipal publié : `https://ville.metabetchouan.qc.ca/wp-content/uploads/2025/02/Reglement-de-zonage-22-99.pdf` | Rejet de l'artefact GCP antérieur : le PDF associé à `work/gcp/metabetchouan-20260717.t3.gcp.json` porte le titre `zonage shipshaw`, donc ne correspond pas à la municipalité; il ne peut pas être servi. |

Le superviseur après dépôt rapporte 868 collections de zones (+2 depuis le début du lot); le focus-30 ne contient plus de zone manquante.
