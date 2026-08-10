# Diagnostic — régression S3 < prod du feed graphe (3 villes)

**Auteur** : lane geo-jointures (WP5), conducteur claude. **Date** : 2026-08-02.
**Mandat** : claude:geo (data-integrity, hors v3.4 mais domaine émission/S3).
**Statut** : diagnostic COMPLET (données autoritaires réunies) ; exécution du
re-dépôt = **décision de frontière ouverte** (voir §5). Aucune écriture faite
(gel S3 403 respecté ; tout ci-dessous est lecture seule).

## 1. Fait observé (risque)

Le `graph/<ville>/latest.json` servi sur S3 pour 3 villes a RÉGRESSÉ sous l'état
prod PG : **saint-urbain-premier, saint-jean-baptiste, saint-mathieu**.

Risque porté par le conducteur immo : si le cronjob `project-graph-from-s3`
(`radar-refresh-projection`) se réactive, il projette le S3 (maigre) dans la prod
PG et **écrase 15 signaux éligibles** présents en prod. immo garde le cron
**SUSPENDU** en attendant. Anti-régression exigée : **S3 doit être ≥ prod**
(prod PG = source de vérité).

## 2. Comptes (verbatim des sources, non reconstruits)

| Ville | Prod PG (recette, autoritaire) | S3 courant | Écart |
|---|---|---|---|
| saint-urbain-premier | 47 nœuds (22 Signal/DE), 52 arêtes | 24 nœuds total | S3 < prod |
| saint-jean-baptiste | 50 nœuds (22 Signal/DE), 47 arêtes | 24 nœuds total | S3 < prod |
| saint-mathieu | 40 nœuds (18 Signal/DE), 51 arêtes | 23 nœuds total | S3 < prod |

- Prod PG `created` 2026-06-13..06-15 ; **15/15 ids autoritaires présents**.
- S3 : `generated_at` 2026-06-14, `LastModified` 2026-06-20 (relais extraction).
- Timestamp prod signalé par extraction : ingestion prod **2026-06-21**. (Les deux
  dates sont reportées telles quelles ; la régression est établie sans ambiguïté
  par le **compte de nœuds** S3 24/24/23 < prod 47/50/40, indépendamment des dates.)

## 3. Les 15 signaux manquants (relais recette via extraction)

- **saint-urbain-premier** : `rezonage-R4-H2-2026-03-30`, `piia-12-terrasse-vincent-2026-03-09`, `piia-213-215-principale-2026`, `densification-R4-bifamiliale-2026`, `piia-243a-principale-2026-05-04`
- **saint-jean-baptiste** : `rezonage-R2-multifamilial-2026-05-05`, `modif-lotissement-R2-2026-05-05`, `cptaq-1006-26-2026-05-05`, `derogation-DPDRL260017-2026-04-07`, `piia-projet-integre-2026-02`
- **saint-mathieu** : `derogation-2025-00034`, `derogation-2026-00001`, `lotissement-2427246`, `modification-zonage-315-2024-01`, `derogation-mineure-lotissement`

## 4. Cause racine — défaut de capitalisation

Le graphe prod PG a avancé (nœuds créés 06-13..06-15, état ingéré/rafraîchi côté
prod), mais le `graph/<ville>/latest.json` S3 est resté figé sur un snapshot plus
ANCIEN et plus MAIGRE (`generated_at` 06-14, 24/24/23 nœuds). Le dépôt S3 qui
aurait rafraîchi `latest.json` à ≥ prod **n'a jamais été rejoué** après que la
prod a avancé. C'est le défaut de capitalisation type : un état produit qui n'est
pas redéposé sur le stockage objet devient une régression silencieuse, dangereuse
dès que le flux inverse (cron S3→prod) se réveille.

## 5. Vérité autoritaire réunie + FRONTIÈRE d'exécution (décision ouverte)

**Vérité autoritaire prête** (recette, prod PG lecture seule, SCW fr-par
`979c11ad…scw.cloud`, baseline documentée 7221/6777), stagée en lecture seule :
```
/home/antoinefa/src/radar-immobilier/tmp/handoff/recette-prod-3cities/
  {saint-urbain-premier,saint-jean-baptiste,saint-mathieu}.subgraph.json
```
Format = sortie exacte de `subgraphForCity` (consommée par
`snapshotFromExistingCity`) : `{ citySlug, node_count, signal_desig_count,
min_created, max_created, nodes[{id,type,label,citySlug,props,sourceRef,createdAt}],
edges[{srcId,dstId,kind,props}] }`. `props` porte la vérité complète →
re-émission d'un `latest.json` IDENTIQUE-≥-prod, **zéro reconstruction**.

**LEURRE écarté** : copie locale tmp 2026-06-13 de saint-urbain-premier
(140 Signal / 0 DE, structure ANORMALE, aucun des 15 ids) — NON valide comme
source. La prod PG recette (22 Signal/DE, structure normale) est la vérité.

**Frontière d'exécution (à trancher par claude:geo)** :
- L'outillage `snapshotFromExistingCity` / `subgraphForCity` /
  `project-graph-from-s3` **n'existe pas dans le repo geo** — il est côté immo
  (radar-immobilier). La v3.4 verrouille **immo = SEUL écrivain du graphe**
  (`upsertGraphAtomic`). Re-déposer `graph/<ville>/latest.json` EST une écriture
  du feed graphe, avec l'outillage immo.
- **Question de cluster** (recette) : prod PG = SCW fr-par ; la cible S3 du
  re-dépôt (OVH évoqué par extraction, creds gelés 403) doit être confirmée.

**Recommandation** :
1. **Diagnostic + coordination + données autoritaires** = geo (fait, ce document).
2. **Exécution du re-dépôt** (`snapshotFromExistingCity(subgraph)` → S3 `latest.json`,
   gaté 403) = **immo** (son outillage, son domaine d'écriture graphe).
3. **Garde anti-régression** (candidate geo, lecture seule) : avant toute
   ré-activation du cron, vérifier `S3.node_count ≥ prod.node_count` par ville
   (47/50/40) et refuser sinon. Ce contrôle ne réécrit pas le graphe.

## 6. Ce qui reste (dépendances)

- Décision claude:geo sur §5 (qui exécute le re-dépôt) + cible cluster.
- Dégel S3 403 avant tout dépôt.
- Rien ne doit partir d'une reconstruction : la source est EXCLUSIVEMENT les
  3 `*.subgraph.json` prod PG de recette.
