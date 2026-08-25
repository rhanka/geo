# Runbook — scoping IAM OVH des credentials S3 geo (mécanisme, empreintes only)

Capitalise le MÉCANISME de scoping IAM OVH des credentials S3 de geo
(`geo-s3-credentials`, `geo-s3-credentials-prod-ro`, `geo-s3-credentials-preprod`).
Documente le MÉCANISME, **jamais une valeur de cred** (celles-ci vivent en trois
exemplaires HORS dépôt — cf `acquisition/config/s3-target.json` + `work/s3-cred-resync-runbook.md`).

**Provenance** : poc-k8s (qui provisionne les secrets, cf `deploy/k8s/preprod/README.md`
§ « Ce que poc-k8s possède »), relayé 2026-08-25 via i-infra ; liste d'actions EXACTE
confirmée par poc-k8s. Fait via **l'API OVH**, zéro geste console owner. Le cross-denial
(ci-dessous) a été **vérifié par poc-k8s**.

> ⚠ NE PAS confondre avec `docs/decisions.md` ADR-0012 (provisioning **Scaleway** d'origine :
> App IAM `geo-s3` + policy `ObjectStorageFullAccess`) — c'est **SCW + full-access,
> PRÉ-migration OVH** (2026-07-29). Le mécanisme ci-dessous est le mécanisme **OVH** courant,
> DIFFÉRENT. Ne pas calquer la recette SCW sur OVH.

## Mécanisme (OVH Object Storage BHS)

1. **Un user OVH DÉDIÉ par (bucket × environnement)**, doté du rôle **`objectstore_operator`**.
   Ce rôle **OUVRE** l'accès S3 mais ne le **borne pas**. Convention de nommage
   `<app>-<env>-<RO|RW>` (ex. immo : `immo-graph-prod-RW` / `immo-graph-preprod-RW`).

2. **Bornage = policy S3 PER-USER** (le rôle ouvre, **la policy RESTREINT**) :
   `POST /cloud/project/{projectId}/user/{userId}/policy`

   ```json
   { "policy": { "Statement": [ {
       "Sid": "RWContainer",
       "Effect": "Allow",
       "Action": [
         "s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket",
         "s3:ListMultipartUploadParts", "s3:ListBucketMultipartUploads",
         "s3:AbortMultipartUpload", "s3:GetBucketLocation"
       ],
       "Resource": ["arn:aws:s3:::<bucket>", "arn:aws:s3:::<bucket>/*"]
   } ] } }
   ```

   - **RW** (destination / écriture) — **8 actions** (ci-dessus) : lecture + écriture +
     multipart (upload de gros objets) + `GetBucketLocation`.
   - **RO** (source / lecture seule, ex. `geo-s3-credentials-prod-ro`) — **4 actions**,
     sous-ensemble SANS écriture :
     `s3:GetObject, s3:ListBucket, s3:ListMultipartUploadParts, s3:ListBucketMultipartUploads`
     (JAMAIS `PutObject` / `DeleteObject` / `AbortMultipartUpload`).
   - `Resource` borne au **SEUL** bucket du user (`<bucket>` + `<bucket>/*`).

3. **Cross-denial (isolation prod/preprod + inter-app)** : chaque user étant scopé à SON
   bucket, une clé d'un env/app renvoie **403** sur tout autre bucket (y compris
   `sentropic-geo`). **Vérifié poc-k8s** : clé prod → 403 sur l'autre bucket ET sur
   `sentropic-geo` ; symétrique préprod.

## Application à geo (état des creds)

| secret kube | user OVH | policy | bucket |
|---|---|---|---|
| `geo-s3-credentials` (prod write) | RW (8 actions) | Get/Put/Delete/List + multipart + GetBucketLocation | `sentropic-geo` |
| `geo-s3-credentials-prod-ro` (source sync) | **RO (4 actions)** | Get/List + 2 multipart-list (no write) | `sentropic-geo` |
| `geo-s3-credentials-preprod` (dest sync) | RW (8 actions) | Get/Put/Delete/List + multipart + GetBucketLocation | `sentropic-geo-preprod` |

Défense en profondeur côté client : `acquisition/src/lib/s3.ts` REFUSE tout endpoint ≠ la
cible déclarée (`acquisition/config/s3-target.json`) — complémentaire du bornage IAM.

## Réplication (immo-graphe — modèle identique)

User `immo-graph-<env>-RW` + rôle `objectstore_operator` + policy per-user (Sid `RWContainer`,
les 8 actions) bornée au bucket `radar-immobilier-graph(-preprod)`, cross-denied prod/preprod
ET vs geo/docs. Même recette, un bucket par (app × env).

---

Empreintes only — **aucune valeur de cred ici**. Les valeurs vivent hors dépôt (secret kube
provisionné par poc-k8s, `.env` local, GitHub secrets), synchronisées via
`work/s3-cred-resync-runbook.md`.
