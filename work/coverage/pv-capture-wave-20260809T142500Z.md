# Vague de capture PV — 2026-08-09

## Contrat d'exécution

- Cible : `https://hlhedx.c1.bhs5.k8s.ovh.net`, namespace `geo` ; droit `create jobs` vérifié.
- Image : `ghcr.io/rhanka/geo-capture@sha256:60f048b5ac667805bf90b3e1a1e75b3b85fd2a4dc634aa11c13fee8b27fa629b`.
- Limite mémoire : `256Mi` ; aucun pod OOM observé.
- Les valeurs S3 ci-dessous sont les **réceptions de manifeste avec CAS**,
  vérifiées par `_capture-e2e-probe.ts` (CAS, sidecar et preuve v2). Une même
  clé CAS peut être dédupliquée pour plusieurs URL : ce ne sont donc pas des
  clés physiques distinctes déduites. Une ligne HTTP sans octet n'est jamais
  comptée.
- `acquisition/src/capture-run-resolve.ts` était absent du checkout. Les `run_id`
  ont donc été résolus de façon déterministe depuis le pod terminal :
  `pv-<RUN_STAMP>-<SHARD>-<POD_UID>`, conformément à
  `deploy/capture-job/run-capture-job.sh`, puis sondés avec
  `_capture-e2e-probe.ts`.

| Worklist | Villes soumises | Job / runs | Pods OK / Pending / OOM | Réceptions CAS S3 vérifiées |
| --- | ---: | --- | --- | ---: |
| `pv-decouverte-vides-20260808T173612Z-capture-lot-0001.json` | 0 | Non soumis : garde `CaptureWorklistSchema.min(1)` | 0 / 0 / 0 | 0 |
| `pv-decouverte-vides-20260808T173612Z-capture-lot-0002.json` | 0 | Non soumis : garde `CaptureWorklistSchema.min(1)` | 0 / 0 / 0 | 0 |
| `pv-decouverte-vides-20260808T173612Z-capture-lot-0003.json` | 4 | `geo-capture-pv-20260809t142500z` — `pv-20260809T142500Z-0-ff0ea487-1bf3-4c77-ae6f-e368fef9bcfa`, `pv-20260809T142500Z-1-c4fa42fc-e261-49b2-87b2-225b8d039291`, `pv-20260809T142500Z-2-d8c4317a-71ee-4023-8dc8-6685fea83e79`, `pv-20260809T142500Z-3-e7f2ff0f-0f36-4cf9-9dff-dc07d2cecae5` | 4 / 0 / 0 | 238 |
| `pv-decouverte-vides-20260808T173612Z-capture-lot-0004.json` | 1 | `geo-capture-pv-20260809t142501z` — `pv-20260809T142501Z-0-d2301cb4-1b1c-4e7f-89cb-baec91a82bc7` | 1 / 0 / 0 | 107 |
| `pv-decouverte-vides-20260808T202000Z-capture-lot-0001.json` | 5 | `geo-capture-pv-20260809t142502z` — `pv-20260809T142502Z-0-32353fdf-bd89-4033-be82-e60f95d581fa`, `pv-20260809T142502Z-1-91ac3178-5874-4cbf-aa1a-defbc277f76f`, `pv-20260809T142502Z-2-de16a03c-c113-47b2-a628-f205aeeb7305`, `pv-20260809T142502Z-3-fac9fab9-743d-4982-acda-c3683d3be4f4`, `pv-20260809T142502Z-4-97ab9fa2-40fa-41fc-9d77-50231ec5dc76` | 5 / 0 / 0 | 125 |
| `pv-decouverte-vides-20260808T202000Z-capture-lot-0002.json` | 4 | `geo-capture-pv-20260809t143000z` — `pv-20260809T143000Z-0-e24d015a-9446-42f2-b257-1509dee33165`, `pv-20260809T143000Z-1-83b77a39-a66f-42a2-a207-2aab999c7579`, `pv-20260809T143000Z-2-bfb299b0-d4e7-4490-88d1-e70292f72ea1`, `pv-20260809T143000Z-3-19f6bee4-e909-48d6-9752-4def87a1c9c1` | 4 / 0 / 0 | 220 |
| `pv-decouverte-vides-20260808T202000Z-capture-lot-0003.json` | 2 | `geo-capture-pv-20260809t143001z` — `pv-20260809T143001Z-0-dde166c4-eeff-4ba3-b336-e2ebd08fe196`, `pv-20260809T143001Z-1-003effd9-5223-48d3-813b-91696d22292e` | 2 / 0 / 0 | 212 |
| `pv-decouverte-vides-20260808T202000Z-capture-lot-0004.json` | 1 | `geo-capture-pv-20260809t143002z` — `pv-20260809T143002Z-0-bf0a7095-ed7a-4607-80e6-7895d4b16dd1` | 0 / 1 / 0 — `Running`, non terminal | Non vérifié, non compté |

## État arrêté pour ce reçu

- Villes avec au moins un dépôt S3 prouvé : **16**.
- Réceptions CAS prouvées via E2E : **902** (le décompte de clés CAS physiques
  distinctes reste indisponible sans le résolveur absent).
- Rejets de garde : les lots `173612Z-0001` et `173612Z-0002` sont vides et
  refusés avant tout PUT ou Job.
- Pending/OOM : seul Macamic (`202000Z-0004`, 257 URL, délai nominal 2 s)
  était encore `Running` au moment du reçu ; **0 OOM**. La vague a aussi connu
  des Pending transitoires dus à `Insufficient cpu` (deux nœuds disponibles,
  un troisième `NotReady`), tous résorbés sauf ce Job long encore actif.
