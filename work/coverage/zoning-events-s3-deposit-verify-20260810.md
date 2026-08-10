# qc-zoning-events — vérification indépendante du dépôt S3 (col-20, 2026-08-10)

## Objet

Vérifier — sans faire foi de l'attestation locale — que le dépôt S3
`qc-zoning-events-<slug>` pour les 2 villes **measured** (saint-eustache,
saint-mathieu-de-beloeil) est **réellement servi et consommable par immo**.

Attestation locale à vérifier : `work/coverage/zoning-events-col20-serve-prod-000.json`
(`dry_run:false`, `emitted:true`, 2026-08-08, runner WIP `zoning-events-col20-serve.ts`).
Émission source : `qc-zoning-events-dryrun-action-grain-20260803/documents.json`
(provenance **réelle** : `url_pdf` + `extrait_brut` verbatim + `source_url` par event).
Mesure source : `zoning-events-col20-167-fresh-geofix-20260807.json` (b16d7947, recall
directionnel immo→geo **91,2 %** là où geo émet).

## Preuve

**HEAD S3** (`acquisition/src/_verify-zoning-events-served.ts`, read-only) :

| clé | présent | octets | lastModified | etag |
| --- | :---: | ---: | --- | --- |
| `ca-qc-zonage/qc-zonage-saint-eustache.geojson` (contrôle) | ✅ | 1 331 190 | 2026-08-02 | — |
| `ca-qc-zoning-events/qc-zoning-events-saint-eustache.geojson` | ✅ | 1 703 747 | 2026-08-08T16:16:12Z | 4f9bc846… |
| `…/qc-zoning-events-saint-eustache/qc-zoning-events-saint-eustache.geojson` | ✅ | 1 703 747 | 2026-08-08T16:16:12Z | 4f9bc846… |
| `ca-qc-zoning-events/qc-zoning-events-saint-mathieu-de-beloeil.geojson` | ✅ | 146 513 | 2026-08-08T16:16:10Z | 332c1192… |
| `…/qc-zoning-events-saint-mathieu-de-beloeil/…-saint-mathieu-de-beloeil.geojson` | ✅ | 146 513 | 2026-08-08T16:16:11Z | 332c1192… |

**OGC geo-api** (`https://api.geo.sent-tech.ca`) :

| requête | résultat |
| --- | --- |
| `/collections/qc-zonage-saint-eustache/items` (contrôle) | **200**, numberMatched=321 |
| `/collections/qc-zoning-events-saint-eustache/items` | **404** |
| `/collections/qc-zoning-events-saint-mathieu-de-beloeil/items` | **404** |
| `/collections` (index ~500) | **aucune** collection `qc-zoning-events-*` |

## Verdict

- **Dépôt S3 = LIVE.** Les 4 clés (2 munis × flat+sous-dossier) sont présentes,
  octets et horodatage conformes à l'attestation serve-prod du 2026-08-08. Le
  contrôle qc-zonage confirme que les creds/bucket lisent bien la cible servie.
  Les events portent une provenance réelle (PV municipaux, extraits verbatim) —
  **anti-invention #1 satisfait** : rien de fabriqué.
- **Exposition OGC = MANQUANTE.** geo-api n'expose pas la famille
  `qc-zoning-events` → **immo ne peut pas consommer** la collection malgré des
  octets réels sur S3. Ce n'est pas un défaut du dépôt jointures ; c'est un gap
  **geo-api/infra** : le serveur OGC ne scanne/ne sert pas le préfixe
  `normalized/ca-qc-zoning-events/` comme il sert `ca-qc-zonage`.

## Suites

1. **Escalade geo-cond/owner** — exposer `qc-zoning-events` via geo-api (scanner
   le préfixe `normalized/ca-qc-zoning-events/`, ou re-scan/redeploy). Sans cela
   le dépôt reste invisible pour immo. **Hors lane jointures.**
2. **Capitalisation (principe fondateur)** — le runner `zoning-events-col20-serve.ts`
   et les manifestes `serve-prod-*.json` ne sont pas committés (WIP session
   concurrente). La logique de dépôt doit être committée→PR→merge par la session
   propriétaire pour être rejouable sur checkout propre.
