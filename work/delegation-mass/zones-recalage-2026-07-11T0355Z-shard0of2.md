# Recalage PDF zones — shard 0/2 — 2026-07-11T0355Z

Règle appliquée : slug d'index pair dans la liste complète triée (`index % 2 == 0`).
Aucun harvest AGOL owner. Toutes les sources nouvelles proviennent des sites municipaux
officiels du répertoire MAMH. Les traitements sont Node/TypeScript; aucun code, GCP ou
géoréférencement n'a été inventé.

## Résultat

- Candidats non-done au départ : 153.
- Preuves déjà consolidées avant ce run : 67 échecs de gate et 4 blocages, dans
  `zones-recalage-2026-07-10T232036Z-shard0of2.{md,json}`.
- Résidu repris ici : 82 slugs, parcourus en 7 lots de 10 à 12 avec relance de
  `loop-supervise` entre les lots.
- Dépôts nets : 2 (`saint-epiphane`, `saint-hubert-de-riviere-du-loup`).
- Nouveaux échecs techniques ou sémantiques : 10.
- Blocage fournisseur après exécution de la voie prescrite : 1 (`sainte-henedine`).
- Découverte officielle bornée sans plan de base récupérable : 69.
- Scoreboard zones observé : 812 au départ, 815 à la dernière relance (d'autres agents
  travaillaient simultanément; deux dépôts ci-dessous sont imputables à ce run).

## Dépôts nets

### saint-epiphane — T1 GeoPDF

- Source officielle : `https://saint-epiphane.ca/documents/pdf/2023/zonage_2500_st-epi_aout2023.pdf`.
- Géoréf : `NAD_1983_CRS_MTM_7`, résidu 0,025 m; spatial 2,149 km.
- Labels texte : 24 occurrences, 21 codes réels distincts; 21 entités servies.
- Cadastre : 456/1066 lots assignés (42,78 %), feuillet urbain uniquement.
- Le feuillet territorial 1:20 000 a été rejeté malgré sa géoréf valide parce que
  l'extraction contenait `no.12` et `no.27`, non démontrés comme codes de zone.
- Dépôt : `normalized/ca-qc-zonage/qc-zonage-saint-epiphane.geojson`.
- Inline : jointure lots vérifiée (`rows=1066`, `assigned=42.78%`); lots-enriched
  déposé (`zone_code=42.78%`, `surface=100%`, `code_postal=100%`).

### saint-hubert-de-riviere-du-loup — T2 auto-GCP

- Source officielle : `http://www.municipalite.saint-hubert-de-riviere-du-loup.qc.ca/documents/urbanisme/zonage_st-hubert_pu_2500.pdf`.
- 15 GCP indépendants, 0 GCP de bbox; résidu 9,644 m, holdout 10,553 m.
- Désambiguïsation : rot0 décisif, couverture serrée 30,77 % contre 15,59 %
  (+15,18 points); spatial 0,655 km.
- Labels texte : 115 occurrences, 45 codes distincts; 39 entités servies.
- Cadastre : 1625/1706 lots assignés (95,25 %), surface couverte 89,44 %.
- Dépôt : `normalized/ca-qc-zonage/qc-zonage-saint-hubert-de-riviere-du-loup.geojson`.
- Inline : jointure lots vérifiée (`rows=1706`, `assigned=95.25%`); lots-enriched
  déposé (`zone_code=95.25%`, `surface=100%`, `code_postal=100%`).

## Nouveaux échecs probants

- `aumond` : les PDF officiels sont des règlements modificatifs scannés; aucun T1.
- `bouchette` : trois parties officielles du règlement 85, scans sans T1; aucun plan
  autonome ni seed réel T3.
- `notre-dame-des-sept-douleurs` : plan officiel vectoriel, 7571 points SVG, mais
  aucune seed ne franchit résidu+holdout; annexe 2023 raster (`svg_points=0`).
- `saint-alexandre` : plan général, 11 seeds résidu+holdout mais aucune orientation/
  isotropie valide; feuillet urbain raster (`svg_points=0`).
- `saint-ferdinand` : deux recalages géométriques passent, mais l'extraction produit
  des centaines de pseudo-codes séquentiels de parcelles (`734-P`, `672-P`, etc.);
  rejet sémantique anti-invention faute de dictionnaire réglementaire.
- `saint-francois-xavier-de-viger` : quatre seeds passent résidu+holdout, aucune ne
  passe orientation/isotropie.
- `saint-louis-de-gonzague--beauharnois-salaberry` : deux plans officiels raster,
  `svg_points=0`.
- `saint-sebastien--le-haut-richelieu` : deux plans officiels raster,
  `svg_points=0`.
- `saint-valerien-de-milton` : annexe A officielle raster, `svg_points=0`.
- `sainte-brigide-diberville` : feuillets officiels avec seeds résidu+holdout, mais
  aucun ne passe orientation/isotropie; couverture labels nulle sur le feuillet complet.

## Voie glyphes Sainte-Hénédine

Les deux GeoPDF officiels sont valides (résidus 0,274 m et 0,08 m), mais les codes sont
majoritairement des glyphes. Le dépôt normes existant ne fournit que `RA`, donc un
dictionnaire insuffisant. Un dictionnaire restreint de 18 codes a été tiré des textes/
légendes des plans officiels, puis les deux crops Claude ont été rendus. L'appel
`claude-sonnet-4-6 --effort xhigh` a ensuite répondu :
`You've hit your session limit · resets 1:10am (America/Toronto)`.
Aucun fallback Mistral/GPT n'a été utilisé et le feuillet partiel `I-1..I-4` a été rejeté
car il aurait attribué abusivement 60,22 % des lots à quatre zones industrielles.

## Découverte officielle sans plan récupérable

Les 69 autres slugs du résidu ont été crawlé sur leur site MAMH officiel avec délais
bornés : site absent/inaccessible, page dynamique sans lien statique, ou seulement
règlements/amendements sans carte de base. Leur liste exhaustive figure dans le JSON
compagnon. Cette disposition prouve le résultat du passage borné; elle ne prétend pas
qu'aucun document ne pourra jamais être publié.

