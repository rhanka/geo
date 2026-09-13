# normes-job — extraction Kubernetes des grilles

Cette image conserve les trois modes du runner de normes et s'exécute sur le
cluster OVH déclaré dans `acquisition/config/k8s-target.json`. Les données restent
sur le stockage objet OVH déclaré dans `acquisition/config/s3-target.json`.

| Mode | Entrée | Exécution |
|---|---|---|
| `captured` | référence immuable `registry/normes-captured-references/…json` et PDF CAS | `captured-normes-extract.ts`, OCR Mistral avec schéma strict, reçu durable déposé ou refusé |
| `extract` (défaut) | PDF et manifestes pré-stagés sous `sources/qc-zonage-grilles/` | `pull-grilles-s3.ts` puis `zonage-norms-batch.ts` |
| `full` | découverte des grilles municipales dans le pod | découverte puis batch, accès aux sites municipaux nécessaire |

Les modes `extract` et `full` gardent leur contrat existant. Le mode `extract`
de `deploy/acquisition-job/` ne recharge pas les PDF pré-stagés : il ne remplace
donc pas celui de cette image. Le dossier reste nécessaire au chemin `captured`
qui a produit des reçus S3 en août 2026. Aucun refresh périodique n'est activé par
la migration du registre. Le lancement reste manuel et borné.

Les parquets restent sous `registry/qc-zonage-norms/`. Le mode `captured` écrit
aussi un reçu sous `registry/normes-captured-receipts/`. Un refus durable clôt le
Job sans relancer une extraction payante. Le ban de vision-chat Mistral
(ADR-0024) reste appliqué ; seul `/v1/ocr` est sanctionné.

## Construction

`.github/workflows/docker-publish.yml` construit et publie
`ghcr.io/rhanka/normes-job` sur tag de release ou dispatch explicite :

```bash
gh workflow run docker-publish.yml --ref main -f tag=<tag>
```

Le Dockerfile résout le véritable module `captured-normes-extract.ts` pendant
le build : sources, contrats S3/Kubernetes et dépendances ESM doivent être
présents. Le package GHCR est public. Utiliser le digest immuable retourné par
le build, sans secret de registre.

## Lancement d'une référence capturée

```bash
NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
npx tsx acquisition/src/k8s-captured-normes-run.ts \
  --kubeconfig "$HOME/.kube/ovh.conf" --namespace geo \
  --reference-key registry/normes-captured-references/<run>/<reference>.json \
  --image ghcr.io/rhanka/normes-job@sha256:<digest> --dry-run
```

Retirer `--dry-run` pour soumettre le Job autorisé. Le lanceur vérifie le cluster
déclaré, soumet le Job puis se termine ; Kubernetes porte la durée et les retries.
Le nom du Job dépend de la référence et de l'image pour permettre une reprise
après correction sans supprimer l'ancien diagnostic.

Secrets injectés par `envFrom` : `geo-s3-credentials` (`S3_ENDPOINT`, `S3_BUCKET`,
`S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`) et `mistral-credentials`
(`MISTRAL_API_KEY`). Aucune valeur n'est committée ou affichée.

Le chemin Serverless historique est retiré des instructions. L'inventaire du
12 septembre 2026 n'y trouvait aucune définition `normes-job` ni run actif ;
le packaging Kubernetes et ses capacités restent conservés.
