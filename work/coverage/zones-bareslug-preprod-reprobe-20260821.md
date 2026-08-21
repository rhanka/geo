# Bare-slug 220 — re-probe PREPROD `sentropic-geo-preprod` (lecture seule) — ACCÈS REFUSÉ

- Généré : 2026-08-21T16:07:06.692Z
- Endpoint (garde) : https://s3.bhs.io.cloud.ovh.net — bucket ciblé : `sentropic-geo-preprod` (override du défaut prod `sentropic-geo`, même endpoint OVH → garde d'endpoint passe)
- Worklist : `work/coverage/zones-bareslug-alias-worklist-20260821.json` (220 slugs)
- **Preuve accès preprod : ÉCHEC**

## Erreur exacte

| champ | valeur |
|---|---|
| name | AccessDenied |
| http_status | 403 |
| message | Access Denied. |
| classé accès/bucket | true |

## Verdict

STOP — creds SANS accès à sentropic-geo-preprod (AccessDenied 403). Escalade geo-archi (accès preprod/cluster). Aucun résultat par-slug fabriqué ou inféré.

> Le join par-slug/nature-zonage/totaux n'a PAS été exécuté : la LIST du préfixe a échoué avant tout HEAD/GET.
