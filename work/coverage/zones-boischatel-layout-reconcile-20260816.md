# boischatel — réconciliation-layout capture-free : EXECUTED option A

**Date** : 2026-08-16 · **Statut** : **EXECUTED-option-A** (2026-08-16T0503Z) — nested backupé + SUPPRIMÉ, geo-api sert désormais le flat.
(Historique : d'abord **BLOCKED-STOP** ; geo-cond a ensuite LEVÉ « pas de delete-only » POUR CE CAS PRÉCIS — nested-affectation-null-prouvé-bug, backup réversible, scopé.)

## Résolution (option A exécutée)

- **Script** : `acquisition/src/_zones-boischatel-layout-reconcile-optA-20260816.ts --commit`
  · **Record machine** : `work/coverage/zones-boischatel-layout-reconcile-optA-record-20260816.json`
- **BACKUP D'ABORD (garde dure)** : tout le dossier nested (2 objets) copié vers `_replaced/` sous le stamp
  `2026-08-16T0503Z`, **chaque backup VÉRIFIÉ** (exists + non-vide + JSON.parse OK ; la geojson servie = 17 feat
  affectation) **AVANT tout delete** :
  - `normalized/ca-qc-zonage/_replaced/qc-zonage-boischatel__nested-misdeposit.2026-08-16T0503Z.geojson` (154523 o, 17 feat affectation)
  - `normalized/ca-qc-zonage/_replaced/qc-zonage-boischatel__nested-misdeposit.2026-08-16T0503Z.meta.json` (805 o)
- **DELETE** : `qc-zonage-boischatel/qc-zonage-boischatel.geojson` + `…/qc-zonage-boischatel.meta.json` supprimés.
- **VÉRIF post-delete** : préfixe nested **vide** (`exists==false`) ; **FLAT présent + intact** (55 feat / 55 codes réels / 0 vide).
  geo-api sert désormais le **flat** (layout unique, comme amherst) → les 4072 hors-zone doivent se replier sur le vrai zonage.
- **Anti-invention** : **aucune preuve v2 fabriquée** ; la provenance du flat reste `legacy-traceable` (v2-proof différée recalage — KPI séparé).
  **Flat non touché.** Réversible via les backups `_replaced/`.

---

## Contexte initial (inspection, avant GO)

**Écritures S3 (phase inspection)** : AUCUNE
**Triage** : `work/coverage/zones-col2-source-triage-20260816.json` (2c741540) · **Scan layout** : `work/coverage/zones-layout-authority-scan-20260816.json` (3d1b3353)
**Sonde inspection (read-only S3)** : `acquisition/src/_zones-col2-source-triage-20260816.ts` (EXIT 0, boischatel status=OK, 2026-08-16T04:51Z)

## Le bug (confirmé sur S3, pas seulement dans les records)

geo-api sert le layout NESTED quand flat+nested coexistent. Pour boischatel le NESTED est une couche
MRC-affectation MAL-DÉPOSÉE (17 polys, `zone_code`=null, champ `Affectatio`), alors que le vrai zonage
municipal (55 zones georéférencées t2-gcp3) n'existe que dans le FLAT. geo-api sert donc l'affectation
sans code → **4072 lots hors-zone**.

| layout | clé | feat | codes distincts | code vide | zone_source_url | level | v2 proof | collection proof |
|---|---|---:|---:|---:|---|---|---:|---|
| **FLAT** (vrai zonage) | `qc-zonage-boischatel.geojson` | 55 | 55 | 0 | null | legacy-traceable | 0/55 | null |
| **NESTED** (affectation, servi) | `qc-zonage-boischatel/qc-zonage-boischatel.geojson` | 17 | 0 | 17 | null | legacy-traceable | 0/17 | null |

- FLAT : MultiPolygon, codes réels (`Cn1-105, V1-106, Dd-008, H1-007…`), source=`t2-gcp3`/`contour-manual-gcp`
  (georéférencé d'un plan PDF, GCP manuels), preuve = enveloppe **legacy v1** (`artifact_uri` = `s3://…`
  auto-référentiel, PAS d'upstream, PAS de sha256). **bbox** `[-71.1925, 46.8828 → -71.1087, 46.9519]`
  (35011 points) — **couvre bien la municipalité** (~46.9N/-71.15W), aucun offset.
- NESTED : `Affectatio` = Forêt et récréation / Récréation intensive 2 / Conservation ;
  source=`ca-qc-zonage-claudialarrotamrccdb-arcgis` ; `Categorie=Affectations_forestier_recreation_conservation_MAJ062023.shp`.

Cible **VÉRIFIÉE** avant toute écriture : correspond exactement à la signature de mis-dépôt attendue
(nested affectation-null / flat vrai zonage). Aucune surprise (le nested ne porte pas déjà de vrais codes ;
le flat n'est ni vide ni décalé).

## Décision de provenance (step 2)

Le FLAT **ne porte PAS de preuve v2** → branche « propager le contenu + provenance du flat, byte-preserve,
re-stamper `zone_source_url=null` / `zone_source_level=legacy-traceable` sur les 2 layouts ». Niveau de
preuve atteignable = **legacy-traceable** (jamais documented/v2 — aucune fabrication).

## Pourquoi c'est BLOQUÉ (pas de primitive sanctionnée sans fabriquer une preuve)

Rendre `nested == flat` implique d'introduire une **géométrie NOUVELLE** sur la clé servie nested
(17 features affectation → 55 features zonage, géométrie entièrement différente). La surface d'écriture
d'une clé servie est fermée :

1. **`putServedZoneGeojson(nested, flatFc)`** — `assertServedZoneGeojson` EXIGE `fc.proof.schema_version==2.0`
   + `geometry_source` valide (URL http(s) réelle + sha256 + retrieved_at ISO) + preuve v2 par-feature.
   Le flat a collection proof=null et des preuves feature en schema **1.0** → **REFUSÉ**. Pour passer, il
   faudrait **FABRIQUER** une preuve v2. Or aucune source vecteur live (MRC Côte-de-Beaupré ne publie aucun
   zonage vecteur par-municipalité ; PDF-only) et la passe est **capture-free** (aucun fetch/cluster) : pas
   de ligne de manifeste, pas d'octets/sha honnêtes. **Interdit** par step 2 (« DO NOT fabricate one ») et par
   `assertGeometryProof` (rejette `s3://` / null / hôte object-storage).
2. **`putServedZoneAdditive(nested, flatFc)`** — exige même count/ordre (17 vs 55 → **REFUSÉ**) et géométrie
   byte-identique par-feature (**REFUSÉ**). Chemin géométrie-immuable par conception. La route
   `allowProofV2Promotion` est aussi inapplicable (le v1 du flat a un `artifact_uri` `s3://` et **aucun** sha256).
3. **Écritures brutes** (`putBytes`/`putStream`/`copyObject`/`putBytesIfMatch`/`putBytesIfAbsent`) — toutes
   gardées par `isServedZoneKey` → **REFUSÉES** en destination servie (s3.ts 323/372/437/497/527).
4. **`deleteObject(nested)`** — seule voie non-gardée capture-free, mais c'est du **delete-only**, **exclu
   explicitement** par le méta-conducteur (« NOT a delete-only »).

**Aucune preuve v2 honnête n'est possible** : une preuve method=georeference/type=pdf-zonage exigerait de
fetch+hasher le PDF du règlement (une capture, interdite ici) et **mésreprésenterait** la provenance — le
GeoJSON 55-polys a été georéférencé manuellement (GCP) depuis un plan raster, il n'est pas dérivé octet-pour-octet
du PDF par un pipeline rejouable. Mint = fabrication.

Garde-fou invoqué (step 2) : « If the only correct primitive would force fabricating a proof or a code, STOP
and report the blocker instead. »

## Options rendues au conducteur

- **A (capture-free ; nécessite de lever la contrainte « NOT delete-only »)** : SUPPRIMER la clé nested
  affectation → geo-api retombe sur le FLAT (vrai zonage 55). Résout les 4072 hors-zone par construction ;
  layout unique flat (comme amherst). Réversible via backup pré-suppression `_replaced/`. Donne **UN** layout
  correct (flat), pas deux.
- **B (garde 2 layouts ; nécessite un changement de lib + accord conducteur)** : ajouter une primitive
  sanctionnée de « réconciliation-layout legacy / copy-forward » portant une collection NON-v2 du flat vers le
  nested avec géométrie byte-préservée et provenance honnête (`zone_source_url=null`,
  `zone_source_level=legacy-traceable`), sans jamais minter de preuve. Ouvre volontairement une voie d'écriture
  servie sans preuve (aujourd'hui interdite par conception) — à gater strictement. **Hors périmètre** d'un
  worker de réconciliation capture-free : c'est un changement lib/spec.
- **C (ré-acquisition, PAS capture-free)** : si une source vecteur couvrante est un jour trouvée, ré-acquérir
  avec preuve v2 et déposer sur 2 layouts (recette beaupré). Aucune n'existe aujourd'hui (PDF-only ;
  classé PDF-RECALAGE-T3 est).

## État final

**Option A EXÉCUTÉE** (après GO geo-cond). Le dossier nested affectation-null a été **backupé (vérifié) puis
supprimé** ; le **flat 55-zones est intact** et **geo-api le sert désormais** (layout unique). Le bug de
served-layout-authority est **corrigé** capture-free, sans fabriquer de preuve v2. Réversible via `_replaced/`.
La preuve v2 (recalage du plan 2014-976 Annexe I) reste différée — KPI séparé.
