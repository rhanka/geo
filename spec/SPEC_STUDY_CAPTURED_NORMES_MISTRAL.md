# Étude — normes capturées → Mistral schéma

## But

Rendre une grille de normes disponible depuis une source municipale sans jamais
capturer sur le poste : tout octet vient d'un Job Kubernetes et reste sous
`raw/<source>/cas/`; la grille est ensuite extraite avec le seul moteur
`mistral-schema` et son schéma Zod strict.

## Faits vérifiés

1. `k8s-capture-run.ts` valide une worklist Zod et le Job dépose le corps et le
   manifeste sous S3. Il ne sert aucun produit normalisé.
2. `pull-grilles-s3.ts` ne lit que l'ancien préfixe
   `sources/qc-zonage-grilles/<slug>.pdf`; il ne peut pas lire un CAS ni son
   manifeste de capture.
3. `zonage-norms-schema-ingest.ts` est le chemin Mistral strict déjà disponible.
   Il accepte un PDF explicite, applique les garde-fous SIG / trois zones / champs
   publiés, et dépose uniquement le parquet par défaut.
4. Le mode `full` de `normes-job` effectue un crawl non journalisé par
   `capturedFetch`; il est donc exclu pour cette lane.

## Options

### A. Réutiliser `MODE=full`

Rejetée : le fetch n'est pas capturé sous CAS avec manifeste de run.

### B. Télécharger le CAS sur le poste puis exécuter l'OCR localement

Rejetée : les octets sortiraient de l'exécution distante de production et la
clé Mistral locale serait requise.

### C. Pont explicite, en deux phases

1. Le poste analyse en lecture seule le HTML/PDF déjà capturé sur S3, avec les
   parseurs de `packages/qc-sources`, et produit une worklist versionnée pour le
   prochain Job Kubernetes. Aucun octet municipal n'est écrit localement.
2. Le Job de capture récupère chaque PDF retenu. Un nouveau mode distant
   `captured` du job normes lit le manifeste de capture, matérialise le CAS dans
   son volume éphémère, puis appelle directement `zonage-norms-schema-ingest.ts`
   avec l'URL réellement capturée. Il ne sélectionne jamais le routeur GPT.

Cette option respecte les contrats existants et rend le lien
`capture-manifest → source_url → parquet` opposable. C'est l'option candidate.

## Questions à fermer avant réalisation

1. La worklist dérivée de l'analyse S3 doit-elle être un objet `registry/`
   immuable (recommandé) ou seulement un fichier Git committé puis publié par
   l'orchestrateur ?
2. Le mode `captured` doit-il prendre un `capture run-id` précis (recommandé,
   rejouable) plutôt qu'un préfixe de recherche ?
3. Après dépôt parquet, qui déclenche la fusion du manifeste partagé : le même
   job, ou un passage séparé explicitement séquencé ?
