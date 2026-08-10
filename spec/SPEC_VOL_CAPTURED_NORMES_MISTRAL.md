# Volition — normes capturées → Mistral schéma

## Direction retenue

Le pipeline adopte l'option C de l'étude : capture cluster en deux phases puis
extraction distante depuis le CAS. Les analyses du poste sont des lectures S3
en mémoire ; elles ne font aucun appel municipal et ne persistent aucun octet
source.

## Décisions

1. La sélection d'un PDF est un objet S3 `registry/` immuable et strictement
   typé. Git contient le code et les tests, jamais le seul reçu opérationnel.
2. L'entrée de l'extracteur est une référence exacte : `run_id`, clé de
   manifeste, index de ligne, slug, URL, SHA et clé CAS. Une recherche « dernier
   run » ou par URL est interdite.
3. La matérialisation et l'OCR ne tournent que dans le job distant. Elles
   valident run cluster `normes` terminé avec succès, slug, GET 2xx, absence de
   rédaction, CAS et sidecar, type/tête PDF et limite de taille.
4. Le seul moteur admis est `mistral-schema`, appelé directement. Aucun runner
   multi-route, aucune route GPT ni configuration OCR non-Mistral ne peut être
   sélectionné par ce mode.
5. Chaque issue (parquet ou refus) produit un reçu immuable S3. Le manifeste
   agrégé reste une étape séparée, bornée aux reçus réussis du lot.

## Revue contradictoire

La revue capture a relevé l'absence actuelle de lien parquet→CAS, l'ambiguïté
possible par URL et le risque de mutation concurrente du manifeste. La revue
OCR a ajouté le risque de configuration non-Mistral, de sortie annotation non
Zod et de dépôt partiel. Les cinq décisions ci-dessus couvrent ces risques ;
les tests de refus sont obligatoires dans l'évolution.
