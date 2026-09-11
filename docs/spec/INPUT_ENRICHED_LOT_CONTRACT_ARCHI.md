# INPUT ARCHI — Contrat lot enrichi canonique `qc-lots-*` (§2 schéma + §4 placement + provenance + millésime)

> **Statut : INPUT SPEC read-only (working-doc, PAS de PR).** Input archi (wp6/geo-archi) pour la spec
> 8-sections rédigée par Codex sol (chantier GEO-consolidation, geo-cond, go-owner-validé via i-cond).
> **0 build, 0 prod, 0 ratification.** geo-cond agrège cet input avec geo-lot (sémantique champs) /
> geo-jointures (méthode calc) / geo-zones / geo-socle (serving) → i-cond → sol §2/§4.
>
> **Périmètre de CE doc = la FORME du contrat** : schéma OGC additif, forme de provenance canonique,
> placement pré-calc, millésime/versioning. **PAS** les méthodes (geo-jointures) ni la sémantique
> champ-par-champ (geo-lot) ni le serving (geo-socle) — cités comme owners.
>
> **Principe measure>infer** : ce design **s'aligne sur l'existant mesuré** (Explore grounding
> 2026-09-10), il n'invente pas. Refs `file:line` verbatim.

---

## 0. Fait-pivot : le produit lot enrichi EXISTE déjà (c'est une EXTENSION, pas un greenfield)

`acquisition/src/lots-enriched-run.ts` matérialise **déjà** `qc-lots-<slug>` = left-join attributaire
par `lot_id` de deux parquets (`normalized/qc-lot-zonage/<slug>.parquet` + `normalized/qc-lot-tod/<slug>.parquet`),
écrit `normalized/qc-lots/qc-lots-<slug>.geojson` (plat + sous-dossier nested + `.stats.json`) via
`guardedQcLotsUpload`. Il porte cadastre + zonage + norms + **`in_tod`** + `surface_m2`/`adresse`/`code_postal`
(`enrichProperties` L537-587). ⟹ Le contrat canonique = **étendre ce produit**, pas en créer un.

**Distinction de modèle de preuve (mesurée) :** `qc-lots` est **cadastre** → écrit par `guardedQcLotsUpload`,
**PAS** la garde `putServedZone*`/preuve-v2 (celle-ci régit la **géométrie zonage**). La géométrie lot porte
sa provenance par le `.meta.json` cadastre (CC-BY 4.0, `© Gouvernement du Québec — Cadastre allégé (MRNF/BDGQ)`,
`fetchedAt` ; `scripts/run-cadastre-lots.mjs:407-423`). ⟹ **la provenance des CHAMPS enrichis est un modèle
distinct** : source-dataset + méthode-de-join + millésime (attributaire), **pas** un geometry-proof v2.

---

## 1. Currency per-champ (résout le point geo-cond §1 → cadre le §7 migration)

| Champ | État mesuré | Currency | Scope build |
|-------|-------------|----------|-------------|
| **`in_tod`** | GEO-SIDE, **déjà produit** (`tod-ingest.ts` `LOT_TOD_SCHEMA.in_tod` L71 ; `lots-enriched-run.ts:576/584`, `null` si muni sans TOD — **jamais `false`**) | **RE-MATÉRIALISER** (objets S3 servis antérieurs — mesure geo-lot) | 0 nouvelle logique : re-run producteur + re-déployer |
| **`zone_family`** | **ABSENT** geo ET immo. Analogue = `ZoneKind` immo `"H"\|"MIXTE"\|"C"\|"I"\|"P"\|"A"\|"CONS"\|"REC"\|"U"\|"AUTRE"` via `zoneKindFromCode` (immo `api/src/services/geo/simulation/zone-kind.ts`), exposé `zone.kind` (« multi-letter family », `graph-store.ts:420`) | **NOUVEAU** | **PORT** de `zoneKindFromCode` (canonicalise `zone_code`→family) côté producteur geo |
| **`multifamilial4plus`** (+ `_source`) | IMMO-SIDE serve-time (`zone-allows-4plus.ts` : densité réelle >20 log/ha ∨ multi-usages → `"grille"`, sinon heuristique par kind → `"heuristique"`) | **NOUVEAU** | **PORT** de la règle immo + son `multifamilial4plusSource` (honnêteté provenance déjà modélisée immo) |
| **`priorite`** | IMMO-SIDE serve-time, `= multifamilial4plus ∧ tod`, émis **seulement si les deux existent** (`lot-zone-enrichment.ts:27-28`) | **NOUVEAU** | **PORT** ; ⚠ **règle de composition = OWNER** (voir §6) |

**Seam fermé par ce contrat (mesuré) :** immo calcule `priorite` **au serve-time** mais son `priorite` est
**inatteignable sur données live** car immo n'a **aucune donnée TOD live** (`lot-zone-enrichment.ts:25-26`),
alors que **geo calcule déjà `in_tod`**. ⟹ le contrat canonique geo **pré-calcule les 4 champs** et **élimine
la jointure-au-serve-time immo** (principe : capture-on-cluster, jamais jointure-par-requête).

**Résiduel LEVÉ (mesuré geo-socle, 2026-09-10)** : le serving `qc-lots-*` est **PASSTHROUGH INTÉGRAL** —
`parseFeatureCollectionStream` yield chaque feature stockée **telle quelle**, `app.ts` `JSON.stringify(feature)`
**entier**, **0 whitelist/strip**. ⟹ **PAS de projection OGC** qui droppe les champs. Combiné au stale-S3
(mesure geo-lot : `in_tod` produit mais S3 servis antérieurs), la cause est **stale-S3 seul** ⟹ **PHASE A
re-matérialisation SUFFIT pour `in_tod`, sans fix projection**. *(Confirmable via `geo-verify-served-collections.mjs`
— déjà mesuré côté serving-code.)*

---

## 2. Schéma OGC — additif pur

**Géométrie + id : INCHANGÉS.** Géométrie = polygone cadastre (`NO_LOT`), CRS `EPSG:4326`. Id de jointure =
`lot_id` (déjà porté). Additif strict : **aucune** collection/endpoint/géométrie/feature-count modifié — même
garde d'esprit que `putServedZoneAdditive` (géométrie byte-for-byte, whitelist de props).

**4 champs-VALEUR = scalaires flat OBLIGATOIRES** (filtrables CQL + tile-safe MVT, cf. ADR-0021 tuilage) :

| Champ | Type | Sémantique (owner = geo-lot) | Anti-invention |
|-------|------|------------------------------|----------------|
| `in_tod` | `boolean \| null` | lot dans une aire TOD (PMAD/CMM) | **`null` si muni sans produit TOD**, jamais `false` (convention existante) |
| `zone_family` | `string \| null` (vocab fermé) | famille de zone canonique (port `ZoneKind`) | `null`/`"AUTRE"` si `zone_code` non-mappable — **jamais deviné** |
| `multifamilial4plus` | `boolean \| null` | la zone autorise le 4+ logements | `null` si indéterminable |
| `priorite` | `boolean \| null` | lot prioritaire (règle composite, §6) | émis **seulement si les conjoints existent** (sinon `null`) |

Vocabulaire `zone_family` fermé (partition nommée, style `ZoneSourceLevel`) = à figer avec **geo-lot** (base
= l'enum `ZoneKind` immo ; le geler geo-side canonique).

---

## 3. Forme de provenance canonique — SPLIT 2-NIVEAUX (uniforme→collection / variable→feature)

> **Raffinement post-figeage (geo-lot, sur mesure socle : payload Varennes 10.3MB — prov per-champ ×
> per-feature explose ; ~8 287 lots × strings source/méthode uniformes = redondance massive).** Le split
> NORMALISE : l'INVARIANT per-muni → **collection-level** (servi 1×) ; le VARIABLE-par-lot → **feature-level
> flat**. **Convergent avec ma règle** : moins de clés per-feature ⟹ moins de risque drop-au-tuilage
> (ADR-0021) + payload compact. **Key-names = geo-lot ; forme/placement/OGC-validité/binding = geo-archi.**

**NIVEAU COLLECTION — `field_provenance` dans le CollectionInfo servi (`/collections/<id>`).** La part
**UNIFORME per-muni per-champ** : `{source, method, layer_version, norms_vintage, crs, definition}`.
**Nested OK ici** (CollectionInfo n'est **ni tuilé ni CQL-filtré**). **Home OGC-valide RATIFIÉ (geo-archi)** :
le CollectionInfo admet des propriétés d'extension, et le **précédent existe** — `coherence_id` est **déjà
servi OGC top-level** sur `/collections/<id>` (ADR-0027 §5). ⟹ `field_provenance` y est un home servi légitime.

> **⚠ Mécanisme = EXTENSION SERVING (B), PAS « as-is » (mesure geo-socle).** Le `CollectionMeta` ACTUEL est
> un type **FERMÉ** (`{sourceId,datasetId,title,license,attribution,crs,fetchedAt,count,rights?,checksum?}`,
> **pas** de `[key:string]:unknown`) → un `field_provenance` ajouté sans code serait **silencieusement ignoré /
> NON-servi** = « vert par omission » banni. ⟹ le bloc exige une **petite extension serving** (CollectionMeta
> + `buildCollectionInfo` + `CollectionInfo` + `renderCollection`), **additive** (consumers existants inchangés),
> **owner-gated au build**. *Préférence forme (geo-socle tranche l'impl) : réutiliser le MÊME seam
> collection-response que `coherence_id` (ADR-0027) plutôt qu'étendre le `CollectionMeta` fermé, si plus propre.*
> **Fallback A (`field_provenance` per-feature) = REJETÉ** : réintroduit le ~10.3MB Varennes que le split tue.

**NIVEAU FEATURE — `feature.properties`, flat scalaire compact.** **SEULEMENT le VARIABLE-par-lot** : les
**4 valeurs** + `{overlap_fraction, matched_id, method(area|centroid), zone_join_path, dominant_fraction,
multi_zone, densite_value, densite_unit, determinable, null_conjoint}`. **Flat scalaire = ma règle
CQL-filtrable + tile-safe honorée** ; l'**anti-invention par-lot** (`determinable`, `null_conjoint`, `null`≠`false`)
reste au feature (elle est variable-par-lot, ne peut PAS remonter en collection).

**CONDITIONS DE GEL (gouvernance geo-archi) :**
1. **Binding re-dérivable** : le `field_provenance` collection est **keyé par nom-de-champ** matchant les
   champs feature ; **les 2 niveaux ENSEMBLE = provenance complète re-dérivable** (uniforme = source/méthode/
   définition/millésime-source ; variable = inputs/overlap/matched). **Ni l'un ni l'autre seul.** Le contrat
   grave ce join collection↔feature par nom-de-champ.
2. **Fraîcheur (anti « vert par omission »)** : le `field_provenance` collection est **re-matérialisé dans
   la MÊME passe** que les features + **rattaché à `coherence_id`/`data_set_hash`** (ADR-0027) → un
   collection-meta **stale échoue la gate de fraîcheur**. L'uniforme ne doit JAMAIS dériver silencieusement
   des features.
3. **4 valeurs + anti-invention** restent **flat scalaire au feature** (filtrables/tileables ; `null`≠`false`).

⟹ **Split RATIFIÉ** : il **améliore** mon flat-tout-au-feature (le 10.3MB montrait qu'il était trop lourd)
tout en honorant flat-où-ça-compte (le variable filtrable/tileable). Le `lot_contract_version` +
`coherence_id`/`data_set_hash` restent collection-level (§5).

---

## 4. Placement pré-calc dans le pipeline s3-dag

**Où l'enrichissement se matérialise (mesuré) :** dans `lots-enriched-run.ts` (le job pré-calc EXISTANT),
**étendu** pour les 3 champs nouveaux. **Sur cluster → écrit S3 `normalized/qc-lots/<slug>.geojson` → geo-api
sert.** **JAMAIS de jointure-par-requête** (élimine le serve-time immo).

**Chaîne souveraine (`@sentropic/s3-dag`, D-moteur-1 ratifié)** : Capture → Normalize → Extract →
**Join (`lotZoneJoin`, EXISTE/testé lot×zone ; lot×TOD = même moteur)** → **Gate (verify)** → **Promote
(`coherence.json`)**. Le pré-calc lot enrichi = un **nœud Join+Promote** de cette chaîne, jamais un
appel-au-serve. (Réf `docs/design/PIPELINE_FULLAUTO_GEO_SECTION.md:81-84`.) Un capture-Job n'écrit **jamais**
`normalized/` (règle C-5, `SPEC_CAPTURE_ON_CLUSTER.md`) — le pré-calc est un nœud DAG distinct, pas la capture.

**Migration §7 (dérivé de la currency §1) :**
- **PHASE A — RE-MATÉRIALISER** : re-run producteur existant (in_tod déjà codé) + re-déployer → ferme le
  constat sol v3 (`in_tod` absent du payload) **sans build-champ**. *(Résiduel projection **LEVÉ** : serving =
  passthrough intégral, mesuré geo-socle — **pas de fix projection**, cf. §1.)*
- **PHASE B — 3 NOUVEAUX (ports)** : intégrer `zoneKindFromCode` (`zone_family`), `zone-allows-4plus`
  (`multifamilial4plus`+source), la règle composite (`priorite`, §6) dans le producteur + matérialiser.

---

## 5. Millésime / versioning — réutilise les conventions existantes (n'invente pas)

**Deux axes ORTHOGONAUX (mesure : déjà distingués repo-side) :**

1. **Version de la FORME (contrat/schéma)** — `lot_contract_version` = **semver** (aligné `schema_version:"1.0.0"`
   du served-contract `SPEC_GEO_SERVED_CONTRACT.md:41-44`). **Additif ⟹ bump MINEUR** (règle semver-sur-seam
   ADR-0026/0029). Endpoint/collection/géométrie inchangés.
2. **Fraîcheur DONNÉE** — **PAS un `materialized_at` inventé** : **aligner sur le watermark `coherence_id` /
   `data_set_hash`** (ADR-0027 §5-6 ; `coherence.json` v2 = `{coherence_id, data_set_hash (REQUIS), served_count}`).
   L'amendement en vol **étend `coherence_id` aux collections produites par le DAG** (`SPEC_PIPELINES_MIGRATION.md:194`)
   — le lot enrichi s'y raccorde (lineage run→collection). Si un `materialized_at` ISO est voulu en plus, il est
   **dérivé du run DAG**, pas une source parallèle.
3. **Millésime MÉTIER per-source** (déjà porté, à conserver) : `reglement_millesime` (distinct de `generated_at`,
   `SPEC_GEO_SERVED_CONTRACT.md:109`), `ROLE_MILLESIME=2026` (`lots-enriched-run.ts:107`), millésime PMAD/TOD.
   ⟹ `<field>_prov_millesime` = le millésime de la **source** du champ, pas la date de run.

---

## 6. Décision OWNER en attente (NON tranchée ici — hors forme)

**Composition de `priorite` : 2 conjoints (`multifamilial4plus ∧ in_tod`, l'actuel immo) vs 3 conjoints**
(discordance remontée par geo-lot). = **sémantique/règle métier = OWNER** (via geo-cond/i-cond), **pas** ma
forme. Mon schéma est **agnostique** : `priorite` = booléen dérivé d'une **règle composite** dont les conjoints
sont listés dans `priorite_prov_inputs` (traçable quel que soit le nombre). ⟹ le schéma tient pour 2 OU 3 ;
l'owner fixe la règle, le contrat la **porte + trace**.

---

## 7. Frontières de coordination

- **geo-archi (moi, wp6)** = FORME : schéma additif (§2), provenance flat canonique (§3), placement s3-dag (§4),
  versioning aligné (§5). **wp6 = règles/contrats, pas de build.**
- **geo-lot** = sémantique/définition champs + vocab `zone_family` (fige l'enum) + remontée règle `priorite`.
- **geo-jointures** = méthode calc (intersections, `overlap_fraction`, règle 4+, `lotZoneJoin`).
- **geo-socle** = serving (confirme projection/pass-through ; matérialise ; `coherence_id`).
- **owner** = règle `priorite` (§6) + go-build (via geo-cond/i-cond).

**Process** : Codex sol rédige la spec 8-sections, Gemini 3.8 double-revue immo+geo, freeze, build délégué sol.
Cet input = read-only, **pas** le build.
