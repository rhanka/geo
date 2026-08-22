# INPUT (brut) — Re-spec §4 SPEC_GEO_PREPROD_SERVING (parité DATA · index-discipline · provenance durable · id=`datasetId??stem`)

> **Statut : INPUT BRUT (staging), PAS la SoT.** Déposé par **geo-archi (WP6)** sur `feat/cadre-acquisition`
> pour le **rapatriement socle** de `ADR-0027` / `SPEC_GEO_PREPROD_SERVING` (concern tronc-commun). **SoT durable
> = la spec socle rapatriée** ; le **plan de migration (partie E) la RÉFÉRENCE** (le plan pointe, la spec socle
> porte). Ce fichier = l'apport geo-archi à folder dans cette spec socle.
>
> **État 2026-08-22** : le cutover preprod est **FAIT** — gate mode-B vert **3882/3882** (`set_hash 9f7c887e…`),
> contrat consommateur immo réconcilié, régression immo-pertinente mesurée **= 0**. Les impls citées ci-dessous
> (#238 mirror-delete anti-mass-delete ; #240 index-discipline `isCanonicalGeojsonKey` ; #241/#242 served-id
> unifié `datasetId ?? stem`) sont **mergées `origin/main`**. Ce re-spec est donc la **capitalisation durable du
> contrat §4 tel qu'appliqué** — à graver dans la spec socle (ce n'est plus « à venir » : c'est le contrat vécu).

---

## Re-spec §4 / A5 — parité DATA (pas parité set-servi)

> Correction geo-archi (WP6) du contrat gelé (ADR-0027 §4/A5). À folder dans la spec socle rapatriée
> (§4, §4.1, A5) + addendum ADR-0027. Le re-spec ne dépend PAS d'une décision owner tierce.

### Défaut découvert (2026-08-21)
§4/A5 exigeait que geo-preprod serve **EXACTEMENT le set SERVI de geo-prod** (count + set_hash des ids servis).
Ce critère **conflate deux choses distinctes** :
1. **parité DATA** — les objets S3 de `normalized/` identiques prod↔preprod ;
2. **parité de dérivation/version** — le set SERVI, qui dépend de l'**image geo-api** + de la fraîcheur d'index.

Or **preprod tourne l'upgrade PAR DESIGN** (spec owner « merge main → écrase preprod + upgrade »). Deux images
serving dérivent légitimement des sets servis différents des **mêmes objets**. **Preuve live** : buckets
**object-identiques** (13343=13343, parité DATA atteinte) MAIS **4647 servis (preprod, image du jour) vs 3885
(prod, `f8b152b1` 08-07, index pré-août figé)**. Le critère set-servi était structurellement incompatible avec
le cycle d'upgrade. (Ironie : A4 avait déjà flaggé `f8b152b1` comme trop vieux pour l'expo coherence — c'est
l'image que prod tourne encore.)

### Re-spec
- **Invariant d'ACCEPTATION = parité DATA sur le SET CANONIQUE** : le set des clés **canoniques**
  (`isCanonicalGeojsonKey` — cf. §4bis) sous `normalized/` est **identique** prod↔preprod. (Raffiné 2026-08-21 :
  PAS all-objects — les backups/prebackups non-canoniques sont hors périmètre de parité, cf. §4ter.) C'est ça
  « preprod a la data SERVIE de prod ».
  - Empreinte **`data_set_hash`** = `computeSetHash` des **clés d'objets** (dédupées+triées). Le sync a déjà
    les 2 listings source+dest → il **asserte fail-closed** (source-set == dest-set post-miroir, sinon refus de
    stamper) + stampe `data_set_hash`. Le mirror-delete (#238) rend dest==source par construction.
- **`coherence.json` v2** : `{ coherence_id, data_set_hash (REQUIS = acceptation), served_count (INFORMATIF),
  served_set_hash (INFORMATIF), generated_at, prod_watermark }`.
- **Le set SERVI devient INFORMATIF, pas gating** : il enregistre ce que CETTE image dérive. Un delta
  prod-servi vs preprod-servi = **signal de REVUE** (« l'upgrade a changé la dérivation — voulu ou régression ? »),
  pas un échec de parité. C'est précisément ce que preprod doit RÉVÉLER (tester l'upgrade). Le delta 762 =
  ce signal qui a fait surface l'entropie de dépôt zones (Exemplar #4) — le mécanisme a bien joué son rôle de
  révélateur, il ne doit juste pas être un GATE d'acceptation binaire.
- **Gate mode B (verify-Job) révisé** :
  1. **fraîcheur** — `coherence_id` servi == attendu (inchangé).
  2. **parité DATA** — deux options d'impl (choix geo-socle/k8s) :
     - (a) **verify indépendant** : le verify-Job reçoit un accès **S3 read-only preprod**, liste `normalized/`,
       recompute `data_set_hash`, compare au stampé (vraie vérif indépendante ; petit recul du least-priv
       « zéro secret » — justifié). **Reco** (independence, « vert par omission = rouge »).
     - (b) **sync-side** : la parité DATA est prouvée fail-closed AU SYNC (assert source==dest + stamp) ; le
       verify ne fait que la fraîcheur. Plus léger mais writer-self-report.
  3. **served-delta LOGGÉ** (revue), jamais gaté.

### Interaction décision owner (nettoyage variants zones)
Si l'owner nettoie les variants non-canoniques zones à la source + fixe l'acquisition → prod ET preprod
servent le canonique 3885 → le delta servi disparaît (bonus). **Mais la parité DATA reste l'invariant
d'acceptation** indépendamment (robuste au cycle d'upgrade). Le re-spec ne dépend PAS de cette décision.

### Impl (coordination geo-socle) + landing (geo-cond)
- Sync : stampe `data_set_hash` (clés objets) + assert source==dest post-miroir (fail-closed) ; `served_*` informatif.
- Verify-Job : option (a) reco (S3 read-only preprod + recompute/compare) ; log served-delta.
- Landing : expose `data_set_hash` (+ `served_*` informatifs).
- Doc-fold : remplace §4/A5 « miroir-plein set-servi » → « parité DATA + served informatif » ; addendum ADR-0027.

## §4bis — Contrat d'INDEX-DISCIPLINE (served-index scope) — FIGÉ sur split geo-zones (record 466e096e)
> Découplé de la parité : la parité DATA mirrore TOUT (backups inclus) ; l'INDEX SERVI ne couvre que le
> canonique. Les ~765 servis en trop = backups/prebackups indexés à tort, PAS un surplus d'objets.

**Diagnostic serving (file:line, worker geo-zones 466e096e / 2806 clés)** : `S3Store.list()` = ListObjectsV2
**sans Delimiter** → récursion totale, push tout (`s3-store.ts:111-129`) ; le provider ne filtre que
`.endsWith(".geojson")` (`store-provider.ts:96`) ; `id = stemOf(basename)`, **répertoire ignoré**
(`store-provider.ts:231-234,246-250`) ; dédup sur id EXACT + tie-break flat/nested (`:255-278`). **PAS** de skip
`_`, **PAS** de regex canonique, **PAS** de collapse-by-slug → l'index sert backups + prebackups. **Inflation
servie = 765** = **342 backups recursés** (geo-api descend dans `_replaced/`) + **422 `.additive-prebackup`
in-namespace** + 1. (Les 895 snapshots `_zone-source-fold-backups/<ts>/…` ne gonflent pas : id=stem collisionne
le canonique → dédupliqués.) **backup↔canonique = 100% (1598/1598, 0 orphelin)** → exclusion SÛRE.

**Règle FIGÉE (family-agnostic)** — le served-index ADMET une clé objet **SSI** :
`(aucun segment de chemin ne commence par « _ »)` **ET** `(le stem du basename, avant le « .geojson » final, ne
contient NI « __ » NI « . »)`. Sidecars non-`.geojson` déjà exclus par le filtre existant.
- **Admit canonique** (ex. zonage) : `^qc-zonage-<slug>\.geojson$` (plat) + `^qc-zonage-<slug>/qc-zonage-<slug>\.geojson$`
  (nested), `<slug> = [a-z0-9]+(-[a-z0-9]+)*` (contient `-`/`--` homonymes, **jamais** `__` ni `.`).
- **Exclut** : tout segment `_*` (`_replaced/`, `_zone-source-fold-backups/`) ; tout basename à `__<token>`,
  `.additive-prebackup`, `.contour-auto-preclip`, ou infixe `.<ISO-ts>`.
- **SÛR** : les stems canoniques (toutes familles) n'ont NI `__` NI `.` dans le stem NI segment `_` → la règle
  tue les 765 sans faux-exclure un canonique.

**Fix à DEUX côtés (défense en profondeur ; la SERVING seule tue déjà les 765)** :
- **Serving [ceinture]** (`store-provider.ts`/`s3-store.ts`, geo-socle/storage) : appliquer la règle FIGÉE
  (skip `_`-segment + admit-canonique-stem). **Zéro mutation data** — geo-api cesse juste d'indexer les
  backups/prebackups. **Débloque le cutover sans toucher la data prod.**
- **Acquisition [bretelles]** (geo-zones) : stop écrire `.additive-prebackup`/`.contour-auto-preclip` dans le
  namespace servi → sous `_replaced/`. Stoppe la pollution à la source (forward).

**Lien parité + de-escalation owner** : la SERVING-fix seule → prod (sur redeploy) ET preprod servent le
canonique (~3885) → served-delta informatif → 0 (bonus). L'**acceptation reste la parité DATA** (objets S3
identiques, backups inclus — déjà verte). Les backups `_replaced/`/`_zone-source-fold-backups/` **RESTENT**
(provenance préservée, jamais servis). Déplacer les 422 prebackups in-namespace vers `_replaced/` = hygiène
OPTIONNELLE (la serving-fix les exclut déjà) → **AUCUNE mutation data prod requise pour le cutover**. La
question owner s'allège : ratifier l'index-discipline + l'hygiène acquisition, pas une mutation data.

## §4ter — Provenance DURABLE (backups) : décision archi (b) ; FAIT résolu 2026-08-21
> Remonté par geo-zones : provenance **preprod-only = FRAGILE** (un re-sync/wipe preprod perd la réversibilité).
> Principe fondateur : « toute donnée captée se dépose sur le stockage objet » = DURABLE.

**FAIT RÉSOLU (preuve logique k8s, zéro prod-access)** : (1) sync all-skip → prod-source ⊆ preprod-dest ;
(2) prune:0 → preprod-dest ⊆ prod-source ⇒ **object-identiques (13343)** ; (3) preprod sert les backups ⇒ ils
sont dans preprod ⇒ **dans prod aussi**. ⟹ **`_`-backups dans les 2 buckets, DURABLES, PAS preprod-only.**
(geo-socle avait INFÉRÉ « prod propre » du served-3885 — corrigé ; leçon : mesure directe/preuve > inférence.)
Prod sert 3885 via **index STALE** (f8b152b1, 6 sem) sur un bucket qui A les backups → **prod stale / le cycle
ne cycle pas** (finding owner).

**Décision archi (b)** : parité (§4) = set CANONIQUE seulement ; provenance = **store durable dédié** hors
index/prune/parité, jamais staging-only. Option (a) « mirrorer backups dans la parité » REJETÉE (conflate
provenance et servi). Une seule `isCanonicalGeojsonKey` aux 3 couches (index=prune=parité). **Remédiation = N-A**
(backups déjà durables dans les 2 buckets ; le prune-preserve #240 protège toute divergence future). Reste juste
à **documenter le principe (b)** comme convention forward — aucune action data.

## §4quater — Invariant de dérivation d'id (stamp == serving) — PR #241 (impl §4 parité DATA)
> Impl (b) : le sync stampe `served_count`/`set_hash` depuis le listing SOURCE canonique via `canonicalServedIds`
> (`isCanonicalGeojsonKey` + `stemOf` + dedup flat/nested + sort ; `stemOf` factorisé en lib partagée) — **plus de
> prod-api** (dépendance supprimée). Version-indépendant : le stamp == ce que le serving canonique dérive des mêmes
> DONNÉES → verify match par construction (mesuré 3882/9f7c887e post-#240).

**Drift nommé (geo-socle) PUIS CONFIRMÉ FAUX par #241** : le stamp dérivait l'id via `stemOf` ; le serving via
`meta.datasetId ?? stem` (`buildCollectionInfo`). **L'invariant `id == stem` que j'avais gravé était PRÉMATURÉ +
FAUX** : la mesure « match » d'avant #241 portait sur un stamp **prod-api** (ne testait PAS stemOf-vs-datasetId).
**#241 (stamp stem) l'a exposé** : **~186 collections canoniques ont `datasetId != stem`** — datasets DISTINCTS
partageant un stem mais de `datasetId` différents ; le serving les garde distincts À RAISON (immo les consomme).
Le stamp stem-based les collapsait → **under-count 3696 vs serving 3882**.

**Décision §4 CORRIGÉE (2026-08-21)** :
> **Contrat served-id** : l'id de collection servi = **`datasetId ?? stem`** (dédup par id). PAS `id == stem`.
- **A (meta-exact) retenu ; B (stem-only) REJETÉ** : stem-only mergerait des datasets distincts = **perte de
  données** + casse immo — non négociable (correction-données, indépendant d'immo).
- **UNE fonction pure partagée** `servedDatasetIds(entries {key, datasetId?})` → `id = datasetId ?? stemOf(key)`
  → dédup par id — appelée par **serving + stamp (+ prune)**. Le stamp lit les meta source des clés canoniques →
  match par construction. Fin des DEUX implémentations divergentes : la « une règle » devient littéralement UNE
  fonction. Test : `stamp-set == served-set` sur fixture incl. `datasetId != stem` (`ca-qc-regions`).
- **Serving (3882) = ground truth** (ce qui est SERVI ; check i-arch : immo query bien cette forme).
- **Leçon rigueur** : un invariant « mesuré » sur une mesure qui ne testait pas le cas = prématuré. geo-socle
  l'avait flaggé ; #241 l'a prouvé ; corrigé au contrat réel. **L'assertion index reste déclinée** (verify
  auto-gate + doc = deux ancres) ; la « transition datasetId » qui la justifierait est justement CE moment —
  mais la fonction partagée la rend inutile (match par construction, pas par gate).
