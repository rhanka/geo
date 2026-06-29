# @geo/qc-status-report

Générateur de **rapport de statut** réutilisable et automatisable pour le socle
de données foncières du Québec (reporting client immobilier).

Il collecte la **couverture LIVE depuis S3** (Scaleway Object Storage, lecture
seule), produit un **markdown FR tracé** orienté client, puis le convertit en
**DOCX avec un tableau soigné** (lib [`docx`](https://www.npmjs.com/package/docx),
construction programmatique). 100 % TypeScript / Node — **aucun Python**.

## Ce qu'il fait

1. **Collecte** (lecture seule) le nombre de municipalités couvertes par préfixe
   S3 : lots cadastraux (`normalized/qc-cadastre-lots/*.geojson`), clip/frontière
   (`normalized/qc-cadastre-lots-preclip/`), rôle foncier
   (`registry/role-foncier/*.parquet`), index immo (`registry/index-immo/*.parquet`),
   grilles de zonage (`normalized/ca-qc-zonage/*.geojson`) + combien portent un vrai
   `code_zone` (échantillon HTTP Range), normes (`registry/qc-zonage-norms/*.parquet`),
   tuiles (`pmtiles/*.pmtiles`). Dénominateur province = nb de lots cadastraux.
2. **Génère le markdown** : titre + date + résumé exécutif + tableau des lots de
   travail (Donnée | Munis OK | % province | Méthode | État) + couverture détaillée
   par type de donnée × fiabilité + méthodes d'acquisition. **Tous les chiffres sont
   collectés en direct**, jamais codés en dur.
3. **Convertit en DOCX** avec un tableau présentable client : en-tête à **fond bleu
   sentropic** + texte **blanc gras**, **bordures `single`** cohérentes, **largeurs de
   colonnes lisibles**, **lignes alternées** (banding gris-bleu clair), titre + date +
   résumé au-dessus.
4. **Sorties tracées + idempotentes** dans `out/` (voir plus bas).

## Lancer

```bash
cd packages/qc-status-report
npm install          # une fois (ajoute docx + tsx + types)
npm run report       # collecte live S3 + génère md + docx
```

Équivalents :

```bash
npx tsx src/index.ts            # idem que npm run report
npx tsx src/index.ts --offline  # smoke-test : NE contacte PAS S3 (couverture nulle)
```

### Credentials S3

Lues **au runtime** depuis `/home/antoinefa/src/_acquisition-shared/s3.env`
(jamais committées, jamais réécrites). Le client utilise `forcePathStyle`. Le
générateur fait **uniquement** `ListObjectsV2` + `GetObject` (Range) — **aucune
écriture S3**.

## Sorties

Écrites dans `packages/qc-status-report/out/` :

| Fichier | Rôle |
| --- | --- |
| `status-quebec-<YYYY-MM-DD>.md` | markdown daté (tracé) |
| `status-quebec-<YYYY-MM-DD>.docx` | DOCX daté (tracé) |
| `status-quebec-latest.md` | alias stable (dernier run) |
| `status-quebec-latest.docx` | alias stable (dernier run) |

La date est calée sur le **fuseau local** (rapport québécois). Re-run = régénère
proprement (idempotent).

## Automatiser

### Option A — cron (poste / serveur)

Exemple : tous les lundis à 8 h (heure locale).

```cron
0 8 * * 1  cd /home/antoinefa/src/geo/packages/qc-status-report && /usr/bin/env npm run report >> out/cron.log 2>&1
```

`npm install` une seule fois au préalable. Le job ne dépend que de `s3.env` +
node ; il est sans état (chaque run repart de la couverture live).

### Option B — skill `/schedule` (agent cloud planifié)

Créer une routine qui exécute le générateur sur un cron :

```
/schedule cron "0 8 * * 1" — Dans /home/antoinefa/src/geo/packages/qc-status-report,
lance `npm run report` puis confirme les chemins out/ générés.
```

Le skill crée un agent planifié qui ré-exécute la commande à l'intervalle voulu.

### Option C — wrapper one-shot

`npm run report` est lui-même l'unité d'automatisation : n'importe quel
orchestrateur (systemd timer, CI nightly, GitHub Actions self-hosted) peut
l'appeler tel quel tant que `s3.env` est lisible.

## Contraintes respectées

- **0 Python** — 100 % TypeScript exécuté via `tsx`.
- **0 secret** dans le code et les sorties — `s3.env` lu au runtime, jamais écrit ni
  copié ; le DOCX/MD ne contiennent ni endpoint ni clés.
- **Lecture seule S3** — list + get uniquement, aucune écriture, aucun process
  détaché touché.
- **Écrit uniquement** dans `packages/qc-status-report/`.

## Structure

```
packages/qc-status-report/
├── package.json        # @geo/qc-status-report (docx, @aws-sdk/client-s3, tsx)
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts        # orchestration : collect → render md + docx → write out/
    ├── s3.ts           # client Scaleway lecture seule (list / range get)
    ├── collect.ts      # comptes live par préfixe + détection code_zone réel
    ├── markdown.ts     # rendu markdown FR (tableau WP, détail, méthodes)
    └── docx.ts         # rendu DOCX (tableau soigné : en-tête bleu, banding, bordures)
```
