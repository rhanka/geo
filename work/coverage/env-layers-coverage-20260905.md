# Couches environnement — couverture tracée (réel + source-gap nommé)

**Contexte** : owner GO (via i-cond, track `01M1RW3P2RZQD2AF1HPJ18T3ED --outcome go`) — « env-B : ratifier + BDZI+GRHQ + tracer le reste ». **Ownership owner** : « les couches environnement ça doit être côté geo » ⟹ env = **GEO-SIDE, OVERLAYS** (jamais des nœuds Zone ; directive : afficher uniquement les zones réglementaires réelles avec leur vrai numéro). Immo consomme.
**Auteur** : geo-zones (lane acquisition). **Date** : 2026-09-05. **Anti-invention fondateur** : nommer le RÉEL + le MANQUE, JAMAIS une couche hallucinée.
**Mesuré** : `packages/geo-sources-americas/src/ca-qc-constraints/` = **3 sources manifestées** (cptaq, bdzi, grhq) ; rien d'autre n'est manifesté.

## Couches env — statut tracé
| Couche | Source id | Source réelle (mesurée) | Statut | Phase |
|---|---|---|---|---|
| **CPTAQ zone-agricole** | `ca-qc/cptaq-zone-agricole` | CKAN `zone-agricole-transposee` (CPTAQ) → `zone_agricole_s` POLYGON | **SERVI** préprod (4 villes `ca-qc-constraints-<slug>`, agricole-only, constraint_ref=sha256(RAW géom), CC-BY) | **Phase-1 FAIT** |
| **BDZI zones inondables** | `ca-qc/bdzi-flood-zones` | EnviroWeb ArcGIS REST couche 22 (mesuré **621 poly** live 2026-09-04) ; normalizer `bdzi/normalizer.ts` existe | **NOT_ACQUIRED** (manifest+normalizer prêts) | **Phase-2 (a) — READY** |
| **GRHQ hydrographie** | `ca-qc/grhq-hydrography` | EnviroWeb couches 104 (plans d'eau, **3,76 M poly**) + 101 (réseau Strahler, live count timeout) ; normalizer `grhq/normalizer.ts` existe | **NOT_ACQUIRED** (province-scale) | **Phase-2 (a) — GATÉ design paged-vs-bulk (geo-archi)** |

## Le RESTE = source-gap nommé (PAS de couche hallucinée)
- **Milieux humides** : RÉFÉRENCÉ comme overlay-besoin (i-arch §C `overlay::milieux-humides`). **Source candidate** = Données Québec / MELCCFP (« milieux humides potentiels ») — **NON MESURÉE, NON manifestée** = source-gap (à mesurer live comme BDZI/GRHQ avant manifest). Ne PAS servir tant que non sourcé.
- **Toute autre couche env** (glissements de terrain, aires protégées, plaine inondable hors-BDZI, etc.) : **NON-INVENTORIÉE = source-gap explicite.** Je n'en manifeste AUCUNE sans (1) un besoin produit réel (owner/immo) ET (2) une source publique réelle mesurée. **Aucune couche inventée** — le besoin est scopé par le produit ; geo source si réel, sinon reste un gap nommé.

## ETA Phase-2 BDZI + GRHQ (pour phasage i-cond)
- **BDZI ≈ 1 jour** (startable MAINTENANT) : (1) build acquire-runner ~heures (trivial — 621 poly, 1 fetch, normalizer existe ; via sous-agent Claude borné + MA revue, Codex creditless) → (2) capture cluster→S3 owner-gated (design_sha+owner-paste) minutes → (3) deposit on-cluster → serve `qc-bdzi-flood-zones` overlay → (4) MON readback G5 + OGC (read-only). Dominé par le build+gate, pas la data.
- **GRHQ ≈ décision design (geo-archi) + 2-4 jours** : GATÉ sur la décision **paged-vs-bulk** (routée geo-archi ; reco bulk FGDB/GPKG). Une fois tranchée : bulk → ogr2ogr → serve `qc-grhq-waterbodies`/`-network` (3,76 M = traitement lourd). **NON-startable avant la décision geo-archi.**

## Discipline
Capture = **cluster→S3, JAMAIS locale** ; écritures prod = on-cluster/CI owner-gated (jamais agent local) ; overlays **geo-side** (immo consomme via le contrat geo→graphe : `overlay::<layer>::<muni>::<featureId>`, PAS des nœuds Zone). Exécution build = délégué (sous-agent Claude / codex-rescue) + MA revue ; capture/deposit = cluster.
