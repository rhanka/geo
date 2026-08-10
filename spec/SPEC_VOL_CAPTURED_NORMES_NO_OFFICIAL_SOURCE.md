# Volition — clôture NORMES sans source officielle déclarée

## Constat

Pour Bonne-Espérance, Bryson et Caniapiscau, le répertoire MAMH committé ne
déclare aucune URL municipale (`website: null`). Une URL construite depuis le
nom de la ville serait une invention; classer cette absence comme erreur HTTP
mentirait aussi sur l'absence de tentative réseau.

## Décisions

1. Une absence de source officielle devient l'issue explicite
   `no-official-source`, distincte de `unreachable`, `http-forbidden` et
   `no-grid`.
2. Elle exige un reçu S3 immuable, content-addressé, qui embarque l'entrée
   exacte du répertoire MAMH, son empreinte SHA-256 et sa provenance. Git ne
   reste donc pas la seule preuve opérationnelle.
3. Le publieur refuse une entrée qui a une URL, dont le slug diffère, ou qui
   n'est pas issue du répertoire MAMH. Il n'appelle jamais le réseau et ne
   produit ni capture PDF ni OCR.
4. La clôture de campagne joint ce reçu exact au slug concerné. Toutes les
   autres issues conservent l'obligation d'un reçu de découverte cluster;
   aucun parquet ni manifeste global n'est écrit par ce chemin.

## Revue contradictoire

Les revues capture et Mistral exigent qu'une absence soit un résultat S3
immuable, jamais une omission, et que l'OCR reste relié à une capture CAS
exacte. Ces décisions satisfont ce premier invariant sans créer de fausse
capture ni élargir le routeur OCR.
