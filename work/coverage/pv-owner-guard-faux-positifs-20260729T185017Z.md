# Garde propriétaire PV — Hébertville-Station (étape 1)

Lecture S3 seule, sans capture, indexation ni écriture S3; chaque CAS fait moins de 5 Mo.

- Les manifestes terminaux actuels rattachent 10 CAS distinctes au scope, alors que le classement signalé en annonce 8; les fichiers live de lane ne sont pas lus, donc les huit clés ne sont pas devinées.
- Les six en-têtes textuels lisibles disent Hébertville, jamais Hébertville-Station — par exemple `raw/pv-index/cas/0f50568c6fb21a1831fee09218e5cf4ac4a82bec4a58f953157bde72155b65d8.pdf`, p. 1, l. 1 : « MUNICIPALITÉ D'HÉBERTVILLE ».
- Quatre CAS ont un en-tête municipal non extractible; ils sont `unknown` pour la preuve d'en-tête, même si la garde y lit des mentions municipales dans des points d'ordre du jour. « Municipalité de Saint-Bruno » (CAS `bc223…1eda`, p. 1, l. 45-46) est un acte d'échange, pas un en-tête.
- Conclusion: contamination réelle documentée, pas faux positif de troncature; aucune modification de la garde proposée à cette étape.
