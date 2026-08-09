# Murs robots grandes villes — PV

Date découverte : 2026-08-03 | Date documentation : 2026-08-09

## Résumé

Lors de la découverte du 2026-08-03 (lot 8 grandes villes), 6 grandes villes ne
présentent aucun candidat PV observable par un agent GET sans session ni cookies.
**Aucune re-tentative prévue** — ce sont des murs robots confirmés.

## Villes bloquées (no_candidate)

| Slug | Région | Motif |
| --- | --- | --- |
| quebec | Capitale-Nationale | no_candidate — portail JS/auth requis |
| laval | Laval | no_candidate — portail nécessite session |
| sherbrooke | Sherbrooke | no_candidate — aucun PV observable GET |
| saguenay | Saguenay-Lac-Saint-Jean | no_candidate — aucun PV observable GET |
| trois-rivieres | Mauricie | no_candidate — aucun PV observable GET |
| saint-hyacinthe | Les Maskoutains | no_candidate — aucun PV observable GET |

Résultat rimouski : **indeterminate** (DNS/transport instable au moment de la
découverte — peut être re-tenté mais n'a pas produit de candidat).

Source : `work/coverage/pv-decouverte-grandes-villes-20260803T190000Z.json`

## Décision

Ces 6 villes restent `unknown` dans la mesure de couverture. Elles NE SERONT PAS
re-scannées par le flux de découverte automatique. Une couverture future
nécessiterait un accès humain authentifié ou un portail alternatif (MDQ, Wix,
scan.procesverbaux.inc.php).
