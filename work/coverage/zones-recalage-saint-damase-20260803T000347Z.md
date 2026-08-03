# Recalage zones — Saint-Damase-les-Maskoutains

- **Stamp** : `20260803T000347Z`
- **Statut** : obstacle nommé `PAS_DE_CARTE`
- **Dépôt** : aucun ; `putServedZoneGeojson` non appelé.

## Obstacle exact

Le PDF capturé est un document de texte réglementaire intitulé « Extraits des
règlements de zonages chapitre 16Z (Rives et littoral des cours d’eau) et
chapitre 17Z (articles 17 à 17.5) ». Il ne contient pas le plan cartographique
de zonage de Saint-Damase-les-Maskoutains. Les 9 pages sont du texte continu ;
le rendu des pages 1 et 9 confirme l’absence de carte, et `pdfimages -list`
ne révèle aucune image embarquée. Il n’existe donc ni carte à géoréférencer ni
GCP indépendants réels à contrôler.

T1, T2 et T3 n’ont pas été lancés : fabriquer une géométrie à partir de ce PDF
serait une invention et est refusé par le banc.

## Capture probante

- URL : `https://www.st-damase.qc.ca/wp-content/uploads/2021/09/zonage.pdf`
- Run : `zones-20260802T234500Z-0-bb641b10-d921-47e4-8f8e-719d596a798f`
- `retrieved_at` : `2026-08-02T23:43:59.444Z`
- SHA manifeste : `sha256:13e1d63741a75ab2201df99e52b2b720a845b75b3f32bc1f1f7f43202879810f`
- HTTP : `200`
- Taille : `93719` octets

## Métriques banc

Pas de recalage exécuté : `RMS=null`, `inliers=null`, `mean_dist=null`,
`fx=null`, `independent_gcps=0`. Ces valeurs sont explicitement nulles car le
document n’atteint pas la précondition « carte ».
