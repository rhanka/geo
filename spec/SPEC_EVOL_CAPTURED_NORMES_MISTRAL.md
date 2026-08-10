# Évolution — normes capturées → Mistral schéma

## D1 — Contrats capitalisés

`packages/qc-sources` expose des schémas Zod stricts pour la référence de
capture, la sélection de PDF, et le reçu d'extraction. La référence contient
le tuple exact de capture; le reçu conserve ce tuple, pages, budget plafonné,
moteur/méthode et parquet ou refus.

## D2 — Découverte sans capture locale

Un runner de découverte ne lit que le manifeste et le CAS HTML déjà capturés,
vérifie leur reçu, puis utilise les parseurs purs existants pour produire une
sélection S3 immuable. Il ne télécharge ni ne confirme aucune URL externe. Une
seconde sélection S3 peut contenir jusqu'à cinq sous-pages same-site textuellement
extraites; sa clé immuable est embarquée dans la worklist Kubernetes. Celle-ci
ne contient jamais d'URL inventée.

## D3 — Matérialisation contrôlée

Le matérialiseur accepte une référence, pas une URL. Avant d'écrire dans le
volume éphémère du job, il exige : exécution `cluster`, lane `normes`, run
réussi, ligne exacte, slug présent, GET 2xx, non-redacted, SHA et sidecar
vérifiés, taille bornée, et signature `%PDF-`. Sa matérialisation est refusée
hors du job distant. Toute autre réponse produit un refus, sans OCR ni parquet.

## D4 — Chemin OCR fermé

Le nouveau mode distant appelle seulement
`zonage-norms-schema-ingest.ts --engine mistral-schema`. L'annotation Mistral
est validée par Zod avant transformation; un chunk invalide/échoué interdit le
dépôt. Le fournisseur et endpoint sont figés Mistral pour ce mode.

## D5 — Dépôt et clôture

Le parquet reste parquet-only. Après relecture/validation, le job écrit son
reçu immuable; un parquet préexistant sans reçu arrête l'OCR avant coût. Une
fusion du manifeste est explicitement séparée, sérialisée, bornée aux reçus de
succès et réessaie de façon finie; un refus ne le modifie jamais. Chaque run de
découverte ferme sa partition par ville, y compris sans HTML admissible.

## Vérification minimale

- tests Zod et refus : mauvais run/lane/slug/index, non-2xx, redaction, HTML,
  CAS/sidecar altéré, taille et PDF invalides;
- test d'appel : seul `mistral-schema`, sans GPT/runner générique/`MODE=full`;
- test d'annotation invalide ou chunk échoué sans dépôt;
- test reçu S3/partition et absence de modification de manifeste sur refus;
- parcours Saint-Roch : HTML CAS → sélection → PDF CAS → job distant → reçu.
