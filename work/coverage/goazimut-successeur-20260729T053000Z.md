# GoAzimut — successeur (enquête bornée)

Généré le 2026-07-29T05:24:33Z. Portée : 186 URL GoAzimut pour 186 municipalités; échantillon inter-MRC de 10. Toutes les pages ci-dessous ont été capturées par le chokepoint avec UA navigateur; la classification ouvre les octets. Aucun objet servi n'a été lu/écrit, aucun re-stampage.

## Fait fournisseur

- `https://www.goazimut.com/` redirige vers `https://www2.goazimut.com/`. Les octets HTML donnent le titre « Azimut par PG Solutions | Solutions géomatiques pour municipalités » et la description « AZIMUT, par PG Solutions… ».
- L'avis capturé [d'acquisition](https://www2.goazimut.com/2024/10/31/pg-solutions-inc-acquiert-groupe-de-geomatique-azimut-inc/) dit que PG Solutions, filiale à part entière de Harris, a acquis Groupe de géomatique Azimut inc. L'avis [GOnet](https://www2.goazimut.com/2025/01/27/gonet-continuera-de-fonctionner-normalement/) dit explicitement « GOnet continuera de fonctionner normalement ». La page [Services en ligne GOnet](https://www2.goazimut.com/gonet/) est une page HTML qui demande les informations pour utiliser l'outil.
- Cela prouve une continuité de fournisseur sous PG Solutions et une continuité GOnet, pas la résurrection des endpoints ArcGIS REST historiques. Le registre committé `served-zonage-proof-url-survival-20260728T120011Z.json` classe déjà 149 URL GoAzimut échantillonnées en 404 sur octets; cette enquête ne les re-mesure pas.

## Échantillon SIG actuel — 2/10 vérifiés

Les deux URLs ci-dessous retournent actuellement la coque HTML GOnet6/ArcGIS (titre `GOnet`, méta-description `GOnet 6`, conteneur de carte), sans `FeatureCollection` ni géométrie : ce sont des portails actuels, pas une preuve de données.

| Municipalité | MRC | Résultat actuel / URL |
|---|---|---|
| Albanel | Maria-Chapdelaine | même fournisseur, GOnet6 : `https://www.goazimut.com/GOnet6/index.html?m=92030&pl=1` |
| Sainte-Anne-des-Monts | La Haute-Gaspésie | même fournisseur, GOnet6 : `https://www.goazimut.com/GOnet6/index.html?m=04037&pl=1` |
| Baie-Saint-Paul | Charlevoix | aucun SIG actuel identifié dans le site officiel + une page pertinente capturés |
| Chandler | Le Rocher-Percé | aucun SIG actuel identifié dans le site officiel capturé |
| Bromont | Brome-Missisquoi | inconnu : `fetch failed` malgré l'UA navigateur; aucune observation `ENOTFOUND` |
| Saint-Thomas | Joliette | aucun SIG actuel identifié dans le site officiel + une page pertinente capturés |
| Papineauville | Papineau | aucun SIG actuel identifié dans le site officiel + une page pertinente capturés |
| Saint-Pascal | Kamouraska | aucun SIG actuel identifié dans le site officiel + une page pertinente capturés |
| Saint-Prosper | Les Etchemins | inconnu : `fetch failed` malgré l'UA navigateur; aucune observation `ENOTFOUND` |
| Waterloo | La Haute-Yamaska | aucun SIG actuel identifié dans le site officiel + une page pertinente capturés |

« Aucun identifié » est inconnu, pas une conclusion d'absence. Aucun autre fournisseur et aucun successeur PDF n'ont été vérifiés dans cet échantillon.

## Relance recommandée et coût

Relance par **ré-acquisition**, jamais par substitution d'URL ni re-stampage. D'abord, ouvrir une session navigateur GOnet6 pour les 2 portails vérifiés, découvrir le `MapServer` proxifié et capturer sa vraie réponse de features; ensuite, 8 passes de découverte municipalité/MRC, avec re-acquisition depuis le PDF de zonage courant seulement s'il n'y a pas de vecteur vivant. Coût : 2 acquisitions GOnet6 à état + 8 découvertes, toutes capturées et validées; aucune mesure HTTP des 186 URL n'est requise. Wayback, si retenu un jour, serait une **preuve historique à une date d'archive**, donc un changement de nature de preuve, pas une source actuelle.
