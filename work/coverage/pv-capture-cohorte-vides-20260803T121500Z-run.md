# Run capture cluster — cohorte zéro-capture (8 grosses villes)

Soumission d'un Job Kubernetes Indexed de capture PV sur le cluster déclaré
(OVH `poc-ca`, ns `geo`), sans polling local (le contrôleur gère la concurrence).

- **Lane** : `pv`
- **Run stamp** : `20260803T121500Z`
- **Job** : `geo-capture-pv-20260803t121500z`
- **Worklist locale** : `work/coverage/pv-decouverte-cohorte-vides-20260803T041000Z-capture-lot-0001.json` (committée `486ff898`)
- **Worklist S3 (contrat soumis)** : `s3://sentropic-geo/registry/capture-worklists/pv-20260803T121500Z.json`
- **Cibles** : 8 municipalités, 24 URLs (3/ville), `source=pv-discovery`
- **shards/concurrency** : 1/1 — capture séquentielle, `delay_ms=2000`
- **Résultat apply** : `job.batch/geo-capture-pv-20260803t121500z created`

## Cohorte

boucherville, candiac, hampstead, longueuil, saint-basile-le-grand,
saint-bruno-de-montarville, varennes, westmount.

## Suite

1. Les octets bruts + manifeste de capture (`url`, `retrieved_at`, `sha256`,
   robots, statut HTTP) se déposent sur S3 par le pod — **preuve v2 par
   construction**.
2. Indexation (`pv-index-run.ts`) sur les CAS déposés → verdict `INDEXED`.
3. Re-mesure `pv-couverture-municipale.ts` : ces villes passent de zéro-capture à
   captées strict seulement si ≥1 PV réellement indexé avec propriétaire imprimé.
   Vert déclaratif interdit (principe fondateur).
