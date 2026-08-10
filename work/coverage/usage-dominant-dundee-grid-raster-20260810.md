# Dundee — grille de règlement sans couche texte (2026-08-10)

Statut : **non-dérivation** de `usage_dominant`.

La grille officielle est déjà capturée par le cluster dans S3 :

- URL publiée : `https://www.cantondundee.ca/_files/ugd/d43ad5_40b3064f9057437e965df138d599652f.pdf`
- objet brut : `raw/usage-dominant-reglement-grid/cas/94da96ee3c370777aaec358adfb4b307eac5323564768a1f73583426e798241b.pdf`
- SHA-256 : `94da96ee3c370777aaec358adfb4b307eac5323564768a1f73583426e798241b`
- taille : 4 309 224 octets ; 13 pages.

La sonde lecture-seule `_ud-s3-pdf-grep.ts` lit cet objet seulement en mémoire
et envoie ses octets à `pdftotext` par stdin. Le 2026-08-10, la recherche
générique `--find '.'` retourne `hits=0` sur les 13 pages. La recherche ciblée
sur `zonage|zone|usage|résidentiel|residentiel|commercial|industriel|agricole|grille|règlement|reglement`
retourne également `hits=0`.

Ce résultat établit l'absence de couche texte, **pas** l'absence d'une légende
visuelle. Aucune correspondance de dominance ne peut donc être produite. Une
future analyse OCR/vision devra être exécutée dans une voie cluster qui dépose
ses artefacts et son manifeste sur S3 avant toute proposition de carte.
