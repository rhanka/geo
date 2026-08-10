# PV — six murs `robots.txt` observés

## Portée

Ce registre couvre les **six** refus `robots.txt` observés dans la première
campagne territoriale `pv-territorial-20260729t222149z`. Il ne conclut ni à
l'absence d'un PV, ni à l'absence de la source : chaque ligne est un état
fermé `robots-disallowed` de la capture `pv-index`.

Les octets de cette campagne, les manifestes et les journaux résident sous
`s3://sentropic-geo/capture/_runs/`. Les identifiants ci-dessous permettent de
relire l'évidence sans refaire une requête HTTP.

| Municipalité | URL refusée | Manifeste S3 / ligne |
| --- | --- | --- |
| East Farnham | `https://www.municipalite.eastfarnham.qc.ca/docs/fichiers_documents/100.pdf` | `capture/_runs/pv-geo-capture-pv-pv-territorial-20260729t222149z-0001-0-d6ddba6b-2cc7-46cb-95c0-692f20a770d4/manifest.jsonl` / 7 |
| Esprit-Saint | `https://www.municipalite.esprit-saint.qc.ca/docs/fichiers_documents/366.pdf` | `capture/_runs/pv-geo-capture-pv-pv-territorial-20260729t222149z-0001-0-d6ddba6b-2cc7-46cb-95c0-692f20a770d4/manifest.jsonl` / 18 |
| Longueuil | `https://www3.longueuil.quebec/sites/longueuil/files/proces-verbaux/carpl-260114-pv_adopte_et_signe_0.pdf` | `capture/_runs/pv-geo-capture-pv-pv-territorial-20260729t222149z-0003-0-357366c4-eca4-4768-b11e-3868f80f5146/manifest.jsonl` / 53 |
| Québec | `https://gpddocs.ville.quebec.qc.ca/gpdblob/PV_CV_EX_2025-12-04_00h00.pdf` | `capture/_runs/pv-geo-capture-pv-pv-territorial-20260729t222149z-0005-0-b0e1479e-80b5-424f-95ea-d280b5005637/manifest.jsonl` / 48 |
| Saint-Basile-le-Grand | `https://www.villesblg.ca/wp-content/uploads/2023/12/2023-11-06-extra-PTI-PV-signe.pdf` | `capture/_runs/pv-geo-capture-pv-pv-territorial-20260729t222149z-0006-0-f73a3f34-4e8c-4a45-9413-340f5cf60e2b/manifest.jsonl` / 72 |
| Saint-Bruno-de-Montarville | `https://saintbruno-site.s3.ca-central-1.amazonaws.com/wp-content/uploads/2026/01/pv-2026-01-20-1.pdf` | `capture/_runs/pv-geo-capture-pv-pv-territorial-20260729t222149z-0006-0-f73a3f34-4e8c-4a45-9413-340f5cf60e2b/manifest.jsonl` / 93 |

## Consigne de traitement

- Ne pas réémettre ces six URLs tant que le même verdict robots est en vigueur.
  Un refus est une donnée de production, pas une lacune à masquer.
- Les voies MDQ et Wix peuvent ajouter des URLs littéralement découvertes à
  `pv-index`; elles ne constituent pas une autorisation de contourner ces six
  refus, ni de remplacer leur état.
- Toute nouvelle capture autorisée passe par la worklist immuable et le Job
  Kubernetes, avec `NODE_OPTIONS=--dns-result-order=ipv4first` et
  `AWS_MAX_ATTEMPTS=10`, puis dépose directement ses octets et son manifeste
  sur S3. Voir [la spécification de capture](../spec/SPEC_CAPTURE_ON_CLUSTER.md).
