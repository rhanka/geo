# SPEC — La capture est de la donnée de production (scraping sur cluster)

> **Statut** : spécification normative · **Date** : 2026-07-25 · **Portée** : toute l'acquisition QC
> (zones, normes, PV, règlement, usage dominant, effet densifiant, cadastre/rôle, immo-lots),
> 1106 municipalités.
> **Référencée par** : `CLAUDE.md` §« Principe fondateur », ligne 32. Ce fichier comble une
> **référence pendante** : `CLAUDE.md` le citait déjà, il n'existait pas.
> **Vocabulaire** : DOIT / NE DOIT PAS / PEUT au sens RFC 2119.

---

## 0. Thèse en une phrase

Le KPI **« Provenance zones — preuve v2 exacte » est à 0 / 1106** non pas parce que la preuve est
difficile à produire, mais parce qu'elle est **détruite au moment même où elle existe** : les octets
et le contexte du fetch vivent dans des répertoires gitignorés d'un seul poste, et rien ne les
journalise. **Une capture journalisée sur cluster PRODUIT MÉCANIQUEMENT la preuve v2** — il n'y a
pas d'étape supplémentaire à inventer. La capture n'est donc pas un log annexe : c'est **la source**
de la preuve.

---

## 1. Constat chiffré de l'existant (tout vérifié dans le dépôt)

### 1.1 Où tourne le scraping

| Lane | Où ça tourne aujourd'hui | Manifeste / entrée |
|---|---|---|
| 3 jeux SDA Québec (régions, MRC, municipalités) | **k8s**, namespace `geo` | `deploy/k8s/job-fetch.yaml` — Job `geo-fetch` (image `geo-api:0.1.4`) + CronJob **`suspend: true`** |
| normes (extraction seule, PDF pré-stagés) | **Scaleway Serverless Job**, `MODE=extract` | `deploy/normes-job/` |
| normes (discover + extract, ≤ 2 pods) | **k8s**, orchestré depuis le poste | `deploy/acquisition-job/` + `acquisition/src/k8s-shard-run.ts` |
| **tout le reste** — zones, PV, règlement, usage dominant, effet densifiant, immo-lots | **le poste du propriétaire**, `npx tsx acquisition/src/*.ts` | `acquisition/config/fleet.json` (6 lanes) piloté par `acquisition/src/geo-fleet.ts` |

`deploy/k8s/job-fetch.yaml` ne couvre que **3 appels `geo fetch`** (`ca-qc/sda` × 3, lignes 57-59) —
soit une fraction négligeable du périmètre. `deploy/normes-job/README.md` (lignes 22-31) **écarte
explicitement** le crawl municipal depuis le cluster (« slow, fragile … prefer `extract` against
pre-staged PDFs ») : la décision historique a été de **garder le fetch en local**. C'est cette
décision que la présente spec renverse.

### 1.2 Volumétrie du code d'acquisition

- **560** fichiers `.ts` sous `acquisition/src/` : **496** à la racine, **56** dans `lib/`, **8** dans `bench/`.
- **73** fichiers appellent le `fetch()` global (**96** occurrences) — **tous à la racine, aucun dans `lib/`**.
  7 fichiers de plus sortent via `node:http` / `node:https` / `undici`
  (`_diag-fetch-lenient.ts`, `_fetch-pdf-tolerant.ts`, `_reglprov-cms-flux-probe.ts`,
  `_reglprov-mrc-pv-sweep.ts`, `norms-vplus-grille-enum.ts`, `pdf-fetch.ts`, `t2-georef-ui.ts`).
- **Aucun point de passage unique** : `acquisition/src/lib/` ne contient ni `fetch.ts`, ni `http.ts`,
  ni `download.ts`, ni `robots*.ts`. Les helpers existent mais sont **facultatifs et peu adoptés** —
  `RobotsCache` (`packages/qc-sources/src/sources/robots-txt.ts`) n'a que **4 consommateurs**
  (`grille-discovery-run.ts`, `pv-gonet-run.ts`, `pv-index-run.ts`, `zones-gdal-discover.ts`).
  Face à eux, 73 fichiers appellent `fetch()` nu, chacun avec son User-Agent bricolé
  (`"Mozilla/5.0 geo-diagnostic"`, `"Mozilla/5.0"`, `PV_USER_AGENT`, `HTTP_UA`, …).

### 1.3 Ce qui est perdu — règles gitignore réelles

| Chemin d'atterrissage | Règle `.gitignore` | Contenu perdu |
|---|---|---|
| `work/zonage-norms/<slug>/grille.pdf` | `.gitignore:39` `*.pdf` | tous les PDF de grilles (`acquisition/src/fetch-grille-pdf.ts:21,57-60`) |
| `.cache/`, `.cache/geo/<sha256(url)>` | `.gitignore:13` | cache de `packages/geo/src/acquire/download.ts:14,95` |
| `/data/raw/`, `/data/tmp/` | `.gitignore:36-37` | téléchargements bruts |
| `work/delegation-mass/**` (logs de workers) | `.gitignore:65` | `scripts/geo-worker.sh:17,61,96,172` |
| `work/**/run.log`, `work/**/run.err`, `work/**/run.out` | `.gitignore:40,81,82` | (voir 1.4 — n'existent même pas) |
| tout `*.log` | `.gitignore:55` | `work/coverage/geo-loop.log`, `qc-lots-loop.log` |
| `/home/antoinefa/.cache-tmp/claude-1000/…/scratchpad` **codé en dur** dans ~20 fichiers `_*.ts` | hors dépôt | ex. `acquisition/src/_reglprov-batch-extract.ts:22`, `_fetch-wayback-range.ts:20`, `_render-crop.ts:13` — **irreproductible par construction** (chemin porteur d'un UUID de session) |

### 1.4 Le fait le plus grave : le log de fetch n'existe pas

Le brief supposait des `run.log` gitignorés. **Vérification : `run.log` n'est écrit par AUCUN code
committé** — 0 occurrence dans `acquisition/src/**`, `packages/**`, `scripts/**`. Les seules
occurrences du dépôt sont les **règles d'ignore elles-mêmes** (`.gitignore:40,83`). C'est un artefact
fantôme.

Les vrais journaux existants ne journalisent **pas le réseau** : `geo-fleet.ts:226-229` écrit des KPI
dans `work/coverage/fleet-timeline.jsonl` ; `qc-lots-backfill.ts:104,152-153` écrit une progression.
**Pas une seule ligne du dépôt n'enregistre `url` + `http_status` + `retrieved_at` + `sha256` par
requête.** La capture n'est donc pas « perdue à cause de gitignore » : elle **n'est jamais produite**.

### 1.5 Les préfixes S3 réellement écrits

Bucket unique `sentropic-geo` (`acquisition/src/lib/s3.ts:29`). 94 sites d'appel `putBytes` /
`PutObjectCommand` dans `acquisition/src`.

| Préfixe | Occurrences | Nature |
|---|---|---|
| `normalized/` | 150 | **résultat servi** (`ca-qc-zonage`, `qc-lots`, `qc-zonage-norms`, …) |
| `registry/` | 31 | registres / manifestes |
| `sources/qc-zonage-grilles/` | 6 | **seul pont octets-bruts → S3**, voir ci-dessous |
| `exchange/` | 3 | contrat geo↔immo |
| **`capture/`** | **0** | n'existe pas |
| **`raw/`** | **0 écrivain** | le schéma est **déjà défini** — voir §2.1 |

`acquisition/src/stage-grilles-s3.ts:23,62,71-73` relit **a posteriori**
`work/zonage-norms/<slug>/grille.pdf` et le pousse en `sources/qc-zonage-grilles/<slug>.pdf`. La clé
est le **slug**, pas le sha256 ; l'URL d'origine, le statut HTTP et l'horodatage du fetch sont perdus
entre les deux étapes. **C'est exactement le maillon rompu qui explique 0 / 1106.**

### 1.6 État de la preuve — chiffres opposables

| Mesure | Valeur | Source |
|---|---|---|
| Univers municipalités | **1106** | `packages/geo-sources-americas/src/ca-qc/municipalities/municipalities.qc.json` ; verrouillé par `registry-statcan.test.ts:33` |
| **Preuve v2 exacte** | **0 / 1106** | `scripts/portfolio-city-report.mjs:37,268-284,381` ; `docs/spec/SPEC_PORTFOLIO_REPORT.md:81` |
| Partition provenance retained | 727 acceptable · 32 candidate · 109 orphan · **0 v2** · 238 unknown = 1106 | `work/coverage/zone-provenance-quality-summary-20260723-74345365.md` |
| Collections `qc-zonage` servies | **871** logiques (876 objets : 803 plats + 73 imbriqués, 10 ignorés) | `work/coverage/served-proof-summary-20260722.json:5-36` |
| `zone_source_url` stampée | 529 http · 341 null explicite · 1 non stampée · 0 erreur (sur 871) | `work/coverage/zone-source-readback-audit-20260724.json` (**version committée HEAD** ; la copie de l'arbre de travail est un spot-check à 10 lignes — ne pas la citer) |

Lecture : **529 collections portent une URL de source, et pourtant 0 porte une preuve v2.** L'écart
est précisément la capture — l'URL est déclarative (on l'a notée), les octets et l'horodatage ne sont
nulle part.

---

## 2. Layout du stockage de capture

### 2.1 DÉCISION — réutiliser `raw/<source>/cas/<sha256>.<ext>`, ne PAS créer `capture/<lane>/<slug>/`

Le dépôt **contient déjà** le schéma canonique, écrit, typé (zod) et testé, mais **sans aucun
écrivain** : `packages/qc-sources/src/RawDocument.ts`.

```
raw/<source>/cas/<sha256>.<ext>            # octets bruts, content-addressed   (rawStorageKey, l.109-116)
raw/<source>/cas/<sha256>.<ext>.meta.json  # RawDocumentRecord                 (rawMetaKey,     l.119-121)
```

Le `RawDocumentRecord` (l.37-63) porte déjà `sourceUrl`, `sha256`, `fetchedAt`, `storageKey`,
`contentType`, `bytesLen` et une `provenance { version, userAgent, viaObscura }`. C'est **99 % du
manifeste demandé par le brief**.

Le layout `capture/<lane>/<slug>/<sha256>.<ext>` proposé dans le brief DOIT être écarté :

1. **Il casse la déduplication.** Un même PDF de MRC (gisement « certificat de conformité »,
   régulièrement partagé par 10-15 municipalités) produirait 10-15 copies d'octets identiques.
   Le content-addressing pur en produit **une**.
2. **La clé cesse d'être dérivable des octets.** Avec `<lane>/<slug>` dans le chemin, on ne peut plus
   répondre à « ai-je déjà ces octets ? » par un simple `HEAD` — il faut connaître le contexte. Le
   HEAD-skip idempotent (le mécanisme qui évite déjà de repayer une passe Mistral,
   `deploy/acquisition-job/README.md:19-21`) devient impossible.
3. **`lane` et `slug` sont du contexte, pas de l'identité.** Ils appartiennent au manifeste, où ils
   sont indexables et **multivalués** (les mêmes octets peuvent servir 12 slugs).

`<source>` DOIT être l'identifiant de lane-source (ex. `zones-arcgis`, `normes-grille`,
`reglement-mrc`, `pv-weblex`, `usage-dominant-sig`) et NE DOIT PAS être un slug municipal.

**Alternative écartée** : `capture/<lane>/<slug>/<sha256>.<ext>` — rejetée pour les 3 raisons ci-dessus.

### 2.2 Manifestes de run

```
capture/_runs/<run-id>/manifest.jsonl   # une ligne par TENTATIVE de fetch (voir §2.3)
capture/_runs/<run-id>/run.log          # stdout/stderr complet du pod, tel quel
capture/_runs/<run-id>/run.json         # en-tête du run : lane, image, git sha, worklist, début/fin, exit code
```

`<run-id>` DOIT être `<lane>-<YYYYMMDDTHHMMSSZ>-<shard>` — triable, lisible, sans collision.

Le préfixe `capture/_runs/` est **le seul emploi de `capture/`** retenu : il désigne l'**axe
temporel** (ce qui a été tenté, quand, avec quel résultat), tandis que `raw/` désigne l'**axe
contenu** (ce qui a été obtenu). C'est exactement la séparation documentée dans
`RawDocument.ts:104-107` (« The temporal axis lives in the run manifests instead »). Ce découpage
est structurant : un 404, un 403, un timeout n'ont **pas** d'octets, donc pas de clé CAS — ils
n'existent QUE dans le manifeste, et ce sont eux qui documentent l'épuisement d'une piste.

### 2.3 Schéma d'une ligne de `manifest.jsonl` (normatif)

Chaque ligne DOIT être un objet JSON valide portant **au minimum** :

| Champ | Type | Obligatoire | Note |
|---|---|---|---|
| `run_id` | string | oui | redondant avec le chemin, mais rend la ligne autoportante |
| `lane` | string | oui | `zones` \| `normes` \| `pv` \| `reglement` \| `usage-dominant` \| `effet-densifiant` \| `cadastre` \| `immo-lots` |
| `source` | string | oui | le `<source>` de la clé CAS (§2.1) |
| `slugs` | string[] | oui | **tableau** — les municipalités pour lesquelles ce fetch a été fait (peut être vide pour une sonde de découverte) |
| `url` | string | oui | l'URL **réellement appelée**, http(s), jamais une clé S3 ni un chemin local |
| `method` | string | oui | `GET` \| `POST` \| `HEAD` |
| `attempt` | int | oui | 1-based ; **chaque** tentative produit une ligne, y compris les échecs |
| `requested_at` | ISO-8601 | oui | avant l'appel |
| `retrieved_at` | ISO-8601 | si octets reçus | **le champ que la preuve v2 exige** |
| `http_status` | int \| null | oui | `null` ssi aucune réponse (DNS, TLS, timeout) |
| `redirect_chain` | string[] | oui | vide si aucune ; sinon la suite des `Location` traversés |
| `content_type` | string \| null | si octets reçus | tel que renvoyé par le serveur |
| `bytes` | int \| null | si octets reçus | longueur du corps |
| `sha256` | `sha256:<64 hex>` \| null | si octets reçus | **format exact de `zonage-proof.ts:60-62`** |
| `storage_key` | string \| null | si octets reçus | `raw/<source>/cas/<sha256>.<ext>` |
| `dedup` | bool | si octets reçus | `true` si l'objet CAS existait déjà (HEAD-skip du PUT) |
| `error` | string \| null | oui | message d'erreur normalisé, `null` en cas de succès |
| `user_agent` | string | oui | l'UA réellement envoyé |
| `via_obscura` | bool | oui | rendu via Chromium/CDP (cf. `RawDocumentRecord.provenance.viaObscura`) |
| `egress` | string | oui | `direct` \| `tor:<lane>` \| `proxy:<id>` — **l'IP de sortie est un fait de provenance**, voir §7.2 |
| `robots` | `allowed` \| `disallowed` \| `unknown` | oui | verdict `robots.txt` au moment du fetch |

Le manifeste NE DOIT contenir **aucune valeur de secret** (ni clé S3, ni `MISTRAL_API_KEY`, ni
cookie, ni `Authorization`). Une URL portant un paramètre de type token DOIT voir ce paramètre
remplacé par `<redacted>` **dans le manifeste**, mais le fetch DOIT utiliser l'URL complète — et
alors `url` NE PEUT PAS servir de preuve v2 (l'URL n'est pas re-téléchargeable telle quelle) : la
ligne DOIT porter `redacted: true` et le dépôt correspondant DOIT être stampé `zone_source_url: null`
(null honnête, cf. `zonage-proof.ts:35-37`).

### 2.4 Même bucket ou bucket séparé ?

**DÉCISION : même bucket `sentropic-geo`, sous les préfixes `raw/` et `capture/_runs/`.**

Justification vérifiable :
- `acquisition/src/lib/s3.ts:29` code en dur `export const BUCKET = "sentropic-geo"`, et les 94 sites
  d'appel `putBytes`/`getBytes` prennent ce défaut. Un second bucket impose un second client, un
  second jeu de creds, et une modification de chaque lecteur.
- Le Secret k8s `geo-s3-credentials` porte **un** `S3_BUCKET` (`deploy/k8s/README.md:75-80`), injecté
  en bloc par `envFrom` dans `job-fetch.yaml:46-48` et dans les Jobs d'acquisition. Un second bucket
  = un second Secret à créer, distribuer et faire tourner.
- Le bénéfice recherché d'un bucket séparé (rétention et ACL distinctes) s'obtient **par préfixe**
  chez Scaleway (règles de cycle de vie préfixées), sans coût structurel.

**Alternative écartée** : bucket `sentropic-geo-capture` dédié. Écartée tant que la capture reste
sous ~500 Gio. Elle redevient recommandable si (a) on veut une clé d'accès **write-only** pour les
pods de capture, distincte de la clé qui écrit `normalized/` — ce qui est un vrai durcissement — ou
(b) si la facturation par bucket devient nécessaire. **C'est un arbitrage à trancher (§8-A).**

### 2.5 Immuabilité — le content-addressing suffit-il ?

**Non, pas seul.** Le content-addressing garantit que la clé **désigne** un contenu donné ; il ne
garantit pas que l'objet **ne sera pas écrasé** par autre chose. Un `PutObject` sur
`raw/x/cas/<sha>.pdf` avec des octets différents réussirait sans bruit.

Mesures normatives :

1. Tout écrivain DOIT faire un `HeadObject` avant le `PutObject` et **passer son tour** si l'objet
   existe (HEAD-skip). C'est déjà le patron idempotent de `deploy/acquisition-job/README.md:19-21`.
2. Un garde de lib DOIT refuser tout `putBytes` sur une clé `raw/**/cas/**` dont le sha256 du corps
   ne correspond pas au sha256 du **nom de la clé**. Une clé CAS qui ment est un bug, pas une donnée.
   Ce garde est le pendant exact de `isServedZoneKey` (`lib/s3.ts:32-35`), qui refuse déjà l'écriture
   directe sur une zone servie (`lib/s3.ts:239-241`).
3. Le **versioning de bucket** DEVRAIT être activé sur `sentropic-geo` : il rend tout écrasement
   récupérable. À défaut, (1)+(2) sont le minimum non négociable.
4. Les objets sous `raw/` NE DOIVENT JAMAIS être supprimés par un script d'acquisition. Seule une
   règle de cycle de vie explicite, décidée par le propriétaire, PEUT les expirer.

### 2.6 Rétention et coût

`capture/_runs/**` (manifestes + logs) est **petit et de grande valeur** : il DOIT être conservé
**sans expiration**. Un `manifest.jsonl` d'une passe province-wide de ~5 000 fetches pèse ~2-3 Mio.

`raw/**` (les octets) est **gros**. Ordre de grandeur mesurable sur le corpus existant : le gisement
déjà stagé `sources/qc-zonage-grilles/` donne une base honnête, et la lane règlement seule vise des
PDF de règlements complets (typiquement 5-40 Mio). Une projection province-wide multi-lane à 1106
municipalités se situe **entre 50 Gio et 400 Gio** selon la profondeur retenue — l'incertitude est
trop large pour être annoncée comme un chiffre. La spec NE DOIT PAS prétendre le contraire :
**la première passe de capture DOIT être instrumentée pour mesurer** (`bytes` est dans le manifeste,
la somme est un `jq` sur `manifest.jsonl`), et la politique de rétention DOIT être décidée **après**
la première lane migrée, pas avant (§8-B).

Politique par défaut, en attendant cette décision :
- `raw/<source>/cas/**` : **pas d'expiration**, classe standard.
- `capture/_runs/<run-id>/run.log` : conservation 180 jours, puis expiration — le `manifest.jsonl`
  reste, lui, indéfiniment (c'est lui qui porte la preuve ; le `run.log` est du diagnostic).

---

## 3. Le contrat de capture EST la source de la preuve v2

### 3.1 De la ligne de manifeste au `GeometrySourceProof`

`acquisition/src/lib/zonage-proof.ts:13-20` exige exactement :

```ts
interface GeometrySourceProof { url; type; method; reliability; retrieved_at; sha256 }
```

La correspondance est **totale et mécanique** :

| Champ `GeometrySourceProof` | Origine dans la ligne de manifeste |
|---|---|
| `url` | `url` (validée par `isRealGeometryUrl`, `zonage-proof.ts:50-58`) |
| `retrieved_at` | `retrieved_at` (format ISO déjà vérifié par `ISO_TIMESTAMP_RE`, l.44) |
| `sha256` | `sha256` (déjà au format `sha256:<hex64>`, l.60-62) |
| `type` | dérivé de `source` (`zones-wfs`→`wfs`, `zones-arcgis`→`arcgis`, `zones-jmap`→`jmap`, …) |
| `method` / `reliability` | dérivés de la lane : natif/directe pour un flux vectoriel, georeference/georeferencee pour `pdf-zonage` — cohérence déjà imposée par `assertGeometryProof` (l.74-79) |

`proofFromFetched()` (l.64-71) accepte déjà `{ bytes, retrievedAt }`. **Aucune API nouvelle n'est
nécessaire** : il suffit que le producteur ait sous la main l'entrée de capture au lieu d'un
`Buffer` anonyme. C'est la raison pour laquelle ce chantier est bon marché — le contrat de preuve
est déjà écrit et déjà opposé au dépôt.

### 3.2 Règle normative

> **RÈGLE C-1.** Tout dépôt servi produit par une passe de géométrie DOIT référencer une **entrée de
> capture existante**. La preuve v2 attachée DOIT être dérivée de cette entrée, jamais construite à
> la main.
>
> **RÈGLE C-2.** Un `GeometrySourceProof` dont le couple (`url`, `sha256`) ne correspond à aucune
> ligne de `capture/_runs/**/manifest.jsonl` est **déclaratif** — au sens de `CLAUDE.md:33-35, « donc
> sans valeur »**. Il NE DOIT PAS être compté dans le KPI « preuve v2 exacte ».
>
> **RÈGLE C-3.** Un runner d'acquisition NE DOIT PAS écrire d'octets bruts ailleurs que sous `raw/`.
> Les répertoires `work/`, `.cache/`, `data/raw/` redeviennent ce qu'ils prétendent être : du
> **scratch jetable**, jamais la mémoire du système.

### 3.3 Comment un garde impose C-1 (analogue à `isServedZoneKey`)

Le dépôt a déjà le patron : `putBytes` (`lib/s3.ts:239-241`) **refuse** une écriture directe sur une
clé de zone servie et redirige vers `putServedZoneGeojson`, lequel appelle `assertServedZoneGeojson`
avant le moindre octet écrit.

Le garde de capture DOIT s'insérer **au même endroit**, dans `assertGeometryProof` ou juste avant
`putServedZoneGeojson` :

```
captureIndexHas(proof.url, proof.sha256) → bool
```

alimenté par un **index de capture** matérialisé à `capture/_index/by-sha256.jsonl` (une ligne par
couple (`url`, `sha256`) observé, reconstructible à tout moment par balayage des `manifest.jsonl`).
Le garde DOIT être **fail-closed en écriture** (pas d'entrée de capture ⇒ dépôt refusé) mais DOIT
disposer d'un échappement **explicite, horodaté et journalisé** : `GEO_ALLOW_UNCAPTURED_PROOF=1`,
qui écrit dans le dépôt un champ de provenance `capture: "none"`. Sans cet échappement, la migration
casse la production le premier jour (§6) ; avec lui non gardé, la règle ne vaut rien — d'où
l'obligation de le journaliser et d'en faire un **KPI décroissant** (§6.4).

Le garde NE DOIT PAS être appliqué à `putServedZoneAdditive` (`zonage-proof.ts:264`) : ce chemin
**prouve déjà** que la géométrie est octet-pour-octet inchangée et n'introduit aucune nouvelle
donnée captée.

---

## 4. Séparation des rôles — capture ≠ analyse

### 4.1 Ce qui bascule sur le cluster (NE DOIT PLUS tourner en local)

**Tout appel réseau sortant vers une source tierce** :
- crawl et découverte (sites municipaux, MRC, portails CMS, WebLex, OctoberCMS, WP REST) ;
- téléchargement de PDF (règlements, grilles, plans, PV) ;
- appels ArcGIS / AGOL / WFS / JMap / GoNet / geocentralis ;
- interrogation Wayback / CDX ;
- rendu Chromium/CDP (lanes obscura) ;
- lecture de `robots.txt`.

### 4.2 Ce qui reste légitime en local

| Activité | Verdict | Condition |
|---|---|---|
| Analyse, triage, lecture de corpus | **légitime** | **lecture seule** de `raw/` et `capture/_runs/` |
| Décision, arbitrage, rédaction de spec/statut | **légitime** | — |
| Parsing / extraction déterministe (pdftotext, parseurs de grille, géoréf, chamfer) | **légitime** | l'entrée DOIT être lue depuis `raw/`, jamais re-fetchée |
| **OCR / vision payante (Mistral, modèles)** | **légitime** | c'est de l'**inférence sur des octets déjà captés**, pas une capture. L'entrée DOIT venir de `raw/`. La sortie est un **résultat**, il va où vont les résultats (`registry/`, `normalized/`) |
| Écriture d'un dépôt servi (`putServedZoneGeojson`) | **légitime** | sous réserve de la règle C-1 (§3.2) |
| `curl`/`WebFetch`/`fetch()` ad-hoc vers un site municipal depuis un agent | **NE DOIT PLUS** | même « juste pour vérifier » : une vérification non journalisée est un fetch perdu |
| Sonde de diagnostic `_*.ts` faisant un `fetch()` | **NE DOIT PLUS** en tant que telle | elle DOIT passer par le chokepoint (§5.1), qui journalise même les sondes — **surtout** les sondes, car ce sont elles qui établissent les épuisements |

> **Point dur, à assumer.** La distinction n'est **pas** « batch vs. exploratoire ». C'est
> l'exploration qui produit aujourd'hui la connaissance la plus chère du projet (les dizaines de
> « faux négatifs » capitalisés : CDX sur chemin d'hôte, WebFetch 403, undici opaque, WPDM, 302
> `www.`…), et c'est elle qui est intégralement perdue. **Un fetch exploratoire journalisé vaut plus
> qu'un fetch batch journalisé.**

### 4.3 Accès des agents locaux

Les agents locaux DOIVENT lire `raw/` et `capture/_runs/` **en lecture seule**. Une clé S3
read-only distincte DEVRAIT être provisionnée à cet effet ; à défaut, la discipline repose sur la
règle C-3 et sur le garde de §3.3.

---

## 5. Manifestes k8s à créer (description, pas écriture)

### 5.1 Prérequis de code — le chokepoint de fetch

Aucun manifeste ne vaudra rien tant que 73 fichiers appelleront `fetch()` nu. **Avant** tout
déploiement, la lib DOIT exposer **un point de passage unique** :

- **Emplacement** : `packages/qc-sources/src/capture/capturedFetch.ts` (dans la **lib**, pas dans
  `acquisition/src/` — cf. `CLAUDE.md:25-27`, « ce qui sert deux fois se promeut dans la lib »).
- **Signature** : `capturedFetch(url, init, ctx: { lane, source, slugs, runId })
  → { response, record: RawDocumentRecord | null, manifestLine }`.
- **Comportement** : consulte `robots.txt` (via `RobotsCache` existant) → fetch → hash le corps →
  `HeadObject` sur la clé CAS → `PutObject` si absent → append d'une ligne au `manifest.jsonl` du run.
  **Journalise la ligne même quand le fetch échoue** (404/403/timeout : `sha256: null`).
- **Réutilise** : `buildRawDocumentRecord` / `rawStorageKey` / `rawMetaKey`
  (`packages/qc-sources/src/RawDocument.ts`) — **déjà écrits et testés**, jamais utilisés.
- **Gate** : un test de lib DOIT échouer si un fichier de `acquisition/src/**` contient un
  `fetch(`/`https.request(` nu hors du chokepoint. Sans ce gate, la règle est un vœu.

**Alternative écartée** : instrumenter chaque runner. 73 implémentations divergentes d'un format de
manifeste, aucune convergence possible, et un `manifest.jsonl` inexploitable. Rejetée.

### 5.2 `deploy/capture-job/` — le Job générique de capture

Dérivé de `deploy/acquisition-job/`, qui est déjà **exactement le bon patron** (image baked
`poppler-utils`, `npm ci` depuis le lockfile, `tsx`, secrets par `envFrom`, un shard par pod,
idempotence par HEAD-skip, aucun secret matérialisé sur disque).

**`deploy/capture-job/Dockerfile`** — identique à `deploy/acquisition-job/Dockerfile` (base
`node:22-bookworm-slim`, contournement du sandbox apt ligne 16, `--network=host` au build), plus :
`chromium` et `tor` pour la variante obscura (§5.4). Image
`rg.fr-par.scw.cloud/sentropic-geo/geo-capture:<tag>`.

**`deploy/capture-job/run-capture-job.sh`** — entrypoint paramétré par environnement, sur le modèle
de `run-acquisition-job.sh` (vérifications de présence de secrets **sans jamais afficher de valeur**,
lignes 41-45) :

| Variable | Rôle | Défaut |
|---|---|---|
| `LANE` | `zones` \| `normes` \| `pv` \| `reglement` \| `usage-dominant` \| `effet-densifiant` | **requis** |
| `WORKLIST` | clé S3 d'un JSON de travail : `[{slug, source, urls[]}]` — **pas** une CSV de slugs en env (une liste province-wide dépasse la taille pratique d'une variable d'environnement) | **requis** |
| `RUN_ID` | identifiant de run (§2.2) | dérivé de `LANE` + horodatage |
| `SHARD` / `SHARDS` | découpage de la worklist | `0` / `1` |
| `DELAY_MS` | politesse inter-requêtes | `2000` (valeur actuelle, `run-acquisition-job.sh:29`) |
| `EGRESS` | `direct` \| `tor` | `direct` |
| `MAX_BYTES` | plafond par objet, garde-fou coût | `104857600` |
| `DRY_RUN` | journalise sans PUT | `0` |

**Entrées** : `WORKLIST` depuis S3 ; secrets par `envFrom`.
**Sorties** : `raw/<source>/cas/**`, `capture/_runs/<run-id>/{manifest.jsonl,run.log,run.json}`.
Aucune écriture sous `normalized/` — **un Job de capture ne produit jamais de donnée servie.**

**Secrets** (noms uniquement, réutilisation de l'existant) :
- `geo-s3-credentials` — `S3_ENDPOINT S3_BUCKET S3_REGION S3_ACCESS_KEY S3_SECRET_KEY`
  (`deploy/k8s/README.md:75-80`). `lib/s3.ts:74-85` les lit **déjà** depuis `process.env` quand le
  fichier `s3.env` est absent : **aucune modification de code n'est nécessaire côté creds.**
- `geo-registry-pull` — imagePullSecret.
- **PAS** de `mistral-credentials` : un Job de capture n'appelle pas de modèle (§4.2).

**Ressources** : `requests 100m/192Mi`, `limits 500m/256Mi` par défaut — voir §5.3.

**`deploy/capture-job/job-capture.yaml`** — un `batch/v1` Job template (nom
`geo-capture-<lane>-<runId>-<shard>`, labels `app=geo-capture`, `lane=<lane>`),
`restartPolicy: Never`, `backoffLimit: 2`, `ttlSecondsAfterFinished: 86400` (plus long que les 3600
de `job-fetch.yaml:25` — on veut pouvoir lire les logs du pod le lendemain), `emptyDir` de 4 Gio en
`/scratch` (jetable : les octets vont sur S3, pas sur disque), `securityContext` identique à
`job-fetch.yaml:36-39,69-73` (`runAsNonRoot`, `seccompProfile: RuntimeDefault`,
`allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`).

**`deploy/capture-job/cronjob-capture-refresh.yaml`** — un CronJob par lane, **`suspend: true` par
défaut** (même prudence que `job-fetch.yaml:99`), `concurrencyPolicy: Forbid`. Ne se dé-suspend
qu'après validation de la lane correspondante (§6).

### 5.3 Orchestrateur et quota — la contrainte liante

`deploy/acquisition-job/README.md:77-93` documente le quota `tenant-quota` du namespace `geo` :

| Ressource | Quota | Utilisé (api+postgis) | Marge |
|---|---|---|---|
| pods | 6 | 2 | **4** |
| requests.memory | 1Gi | 768Mi | **~256Mi** |
| limits.memory | 4Gi | 3584Mi | **~512Mi** |
| requests.cpu | 500m | 175m | ~325m |
| limits.cpu | 1500m | 600m | ~900m |

**Conséquence dure : ~2 pods simultanés à 256Mi.** Augmenter le nombre de shards **ne fait pas
monter le parallélisme** — c'est déjà écrit noir sur blanc dans le README. Une capture province-wide
à concurrence 2 est un mur de débit (§7.3).

L'orchestrateur DOIT être `acquisition/src/k8s-capture-run.ts`, calqué sur
`acquisition/src/k8s-shard-run.ts` (mêmes options `--shards --limit --concurrency --req-mem
--lim-mem --req-cpu --lim-cpu --dry-run`), avec en plus `--lane` et `--worklist`. Il DOIT **écrire
la worklist sur S3** avant d'appliquer les Jobs, et **ne jamais** dépasser la concurrence passée.

### 5.4 Variante obscura / Tor

`acquisition/scripts/tor-fleet-gonet.sh` documente déjà le protocole, y compris **son installation
au runtime dans un pod** (`apt-get install -y tor chromium`, en-tête ligne 18) et le motif :
l'IP datacenter Scaleway est flaguée par reCAPTCHA v3 (GOazimut) ⇒ 0 dépôt ; un exit Tor **partagé**
sur une flotte est flagué aussi (90/90 sans zonage) ; un exit Tor **frais par ville** fonctionne.

**`deploy/capture-job/job-capture-obscura.yaml`** — variante du Job précédent :
- conteneur unique portant `tor` + `chromium` (les baker dans l'image, **pas** `apt` au runtime : le
  pod n'a pas forcément d'egress apt, cf. `deploy/acquisition-job/Dockerfile:7`) ;
- N lanes Tor, `SocksPort 9050+2i` / `ControlPort 9051+2i`
  (`tor-fleet-gonet.sh:74-75`), `CookieAuthentication 0`, `MaxCircuitDirtiness 10` ;
- `CHROME_PROXY=socks5://127.0.0.1:<socks>` — **la seule variable lue**, par
  `acquisition/src/zones-obscura-run.ts:238`, qui pose `--proxy-server` et
  `--proxy-bypass-list=127.0.0.1,localhost` (l.243) ;
- `SIGNAL NEWNYM` **par municipalité** (pas par run) ;
- `limits.memory` ≥ 1Gi (Chromium) ⇒ **1 seul pod obscura à la fois** dans le quota actuel ;
- chaque ligne de manifeste DOIT porter `egress: "tor:<lane>"` et `via_obscura: true`.

Le `REAL_UA` reste une **constante** (`zones-obscura-run.ts:67`, dupliquée dans `pv-obscura-run.ts:373`
et `normes-obscura-run.ts:349`) : il n'y a **aucune rotation d'UA** dans le dépôt, et cette spec n'en
introduit pas. La seule identité tournée est l'IP de sortie. C'est un fait, pas une lacune à combler
en douce : rendre l'UA aléatoire serait un changement de posture de scraping, pas une décision de
capture (§8-D).

### 5.5 Variante Scaleway Serverless Job

Pour les lanes **massives et non contraintes par le quota k8s**, la même image PEUT être exécutée en
Scaleway Serverless Job, comme `deploy/normes-job/`. Contraintes capitalisées :
`local-storage-capacity` **max 10240 MiB** (dur), `job-timeout` en durée Go (`2h`, pas `7200`),
`scw jobs definition start <id>` (pas `run create`), et le contournement du sandbox apt
(`APT::Sandbox::User "root"`). Comme les octets partent vers S3 au fil de l'eau et que rien n'est
conservé sur disque, le plafond de 10 Gio n'est **pas** un frein pour la capture — c'est précisément
l'avantage du modèle CAS-vers-S3 sur le modèle « télécharger tout puis traiter ».

---

## 6. Migration progressive et sans rupture

### 6.1 Principe

La production NE DOIT PAS s'arrêter. La bascule est **par lane**, et chaque lane suit le même
gabarit en 4 temps :

1. **Journaliser sans contraindre.** Le chokepoint (§5.1) est mis en place et la lane continue de
   tourner **en local**, mais tout passe par lui : les manifestes commencent à se remplir. Zéro
   changement de comportement, zéro risque.
2. **Basculer l'exécution.** La même lane tourne en Job de capture, en parallèle du local pendant
   une passe (comparaison des taux de succès, détection immédiate des blocages d'IP datacenter, §7.2).
3. **Couper le local.** Le fetch local de la lane est retiré ; le gate de §5.1 le rend impossible.
4. **Armer le garde.** Pour cette lane, `GEO_ALLOW_UNCAPTURED_PROOF` n'est plus toléré.

### 6.2 Ordre des lanes (du moins risqué au plus risqué)

| # | Lane | Pourquoi cet ordre | Risque IP datacenter |
|---|---|---|---|
| 1 | **normes** | Déjà partiellement sur cluster (`deploy/acquisition-job/`, `deploy/normes-job/`) ; l'entrypoint `run-acquisition-job.sh` fait déjà `discover` avec robots + `DELAY_MS`. Le chemin est prouvé. | faible |
| 2 | **règlement / provenance** | Sources majoritairement des PDF servis en HTTP simple (sites municipaux, gisements MRC, Wayback/CDX). Pas de JS-wall. Fort volume de sondes ⇒ fort gain de journalisation. | faible-moyen |
| 3 | **PV** | Même profil ; `pv-gonet-run.ts` est déjà en HTTP pur avec `RobotsCache`. | moyen |
| 4 | **usage dominant** | Dépend beaucoup de gisements SIG (ArcGIS/WFS) — API publiques, tolérantes. | faible |
| 5 | **zones — flux vectoriels** (WFS/ArcGIS/AGOL/JMap/geocentralis) | **La lane qui débloque le KPI v2.** Les octets fetchés sont *exactement* ceux déposés ⇒ `proofFromFetched` s'applique directement. | faible |
| 6 | **zones — obscura/CDP** | **En dernier**, parce que c'est la seule où la migration peut *dégrader* le résultat (reCAPTCHA v3 sur IP datacenter). Exige la variante Tor (§5.4) et une validation empirique avant de couper le local. | **élevé — vérifié** |

`cadastre` / `rôle foncier` / `immo-lots` sont hors scope immédiat : `work/coverage/TRACK-REPORT.md`
les donne à 1106/1106, et leurs sources sont des jeux provinciaux stables, pas du scraping municipal.
Ils suivent en dernier, par cohérence.

### 6.3 Que faire des captures locales existantes

**Critère de décision : une capture rétro-remontée peut prouver le CONTENU, jamais l'INSTANT.**

Un PDF trouvé aujourd'hui dans `work/zonage-norms/<slug>/grille.pdf` permet de calculer un `sha256`
honnête, mais son `retrieved_at` est inconnu et son `http_status` irrécupérable. Un
`retrieved_at = now()` posé sur des octets vieux de six mois est un **mensonge horodaté** — exactement
le genre de preuve déclarative que `CLAUDE.md:33-35` disqualifie.

| Corpus local | Décision | Justification |
|---|---|---|
| `work/zonage-norms/<slug>/grille.pdf` (~PDF de grilles) | **REMONTER** sous `raw/normes-grille/cas/<sha>.pdf`, avec `.meta.json` portant `backfilled: true`, `fetchedAt` = mtime du fichier, `sourceUrl` = celle du manifeste `discovered.json` quand elle est connue, sinon `null` | valeur d'usage forte (évite de repayer des passes vision) ; le flag empêche de compter ça comme v2 |
| `sources/qc-zonage-grilles/<slug>.pdf` (déjà sur S3) | **RE-CLÉER** en CAS `raw/normes-grille/cas/<sha>.pdf` par copie côté serveur, `backfilled: true` | déjà durable, il manque juste l'adressage par contenu |
| `.cache/`, `.cache/geo/<sha256(url)>` | **ABANDONNER** | clé = `sha256(url)`, pas `sha256(contenu)` (`packages/geo/src/acquire/download.ts:95`) ; re-fetchable |
| `/home/antoinefa/.cache-tmp/…/scratchpad` (~20 fichiers `_*.ts`) | **ABANDONNER** | scratch de session, chemins porteurs d'UUID ; irreproductible par construction |
| `work/delegation-mass/**` | **ABANDONNER** | scratch régénérable, déjà déclaré tel (`.gitignore:65`) |
| `<outDir>/cache/cas/<sha256>.pdf` de `lib/arcgis-zonepdf-stage-runner.ts:1223` | **REMONTER** | c'est déjà un CAS local avec receipts (`runs/<manifestSha256>`, l.1565) — le plus proche de la cible ; conversion mécanique |

> **RÈGLE C-4.** Une entrée `backfilled: true` NE DOIT PAS être comptée dans le KPI « preuve v2
> exacte ». Elle est comptée dans un KPI distinct, « adossement capture », qui mesure la
> **traçabilité** et non la **preuve**. Confondre les deux referait exactement l'erreur qui a mené à
> 0/1106.

### 6.4 Mesure de l'avancement

Trois KPI, à ajouter au générateur `scripts/portfolio-city-report.mjs` (**jamais** à la main — le
format est figé par `docs/spec/SPEC_PORTFOLIO_REPORT.md`, cf. `CLAUDE.md:42-44`) :

| KPI | Définition | Base | Cible |
|---|---|---|---|
| **K1 — Capture sur cluster** | % des lignes de manifeste du mois dont le `run_id` provient d'un Job cluster (vs. local) | 0 % (aucun manifeste n'existe) | 100 % |
| **K2 — Adossement capture** | % des collections servies dont le couple (`zone_source_url`, sha des octets) trouve une entrée dans `capture/_index/` (`backfilled` **inclus**) | 0 / 871 | 871 / 871 |
| **K3 — Preuve v2 exacte** | inchangé : `counts.v2` de `zone-provenance-quality-matrix-*.json`, dénominateur 1106 (`portfolio-city-report.mjs:37,268-284`) — `backfilled` **exclu** | **0 / 1106** | ≥ 871 / 1106 (le plafond structurel étant le nombre de collections servies, pas 1106) |

**Ne pas annoncer 1106/1106 comme cible de K3** : 235 municipalités n'ont aujourd'hui aucune
collection zone servie (871 servies vs. 1106 villes). Une cible fabriquée serait une invention, et
`CLAUDE.md:46-47` l'interdit.

Le premier jalon acceptable est **K3 > 0** — aujourd'hui strictement zéro. La première collection
zone re-acquise via un Job de capture, depuis un flux vectoriel, avec `proofFromFetched` alimenté par
la ligne de manifeste, **fait basculer le KPI de « jamais » à « prouvé »**. C'est le test
d'acceptation de cette spec.

---

## 7. Risques et limites — honnêtes

### 7.1 Coût S3

Non chiffrable de façon honnête avant la première passe (§2.6). Le risque réel n'est pas le prix au
Gio, c'est **la croissance non bornée** : un crawl qui capture chaque page HTML de chaque site
municipal remplit vite. Mitigations : `MAX_BYTES` par objet, dédup CAS (gain réel — les gisements MRC
sont massivement partagés), et **mesure obligatoire** de `sum(bytes)` à la première lane migrée
avant d'étendre.

### 7.2 IP de datacenter — le risque le plus sérieux, et il est DÉJÀ prouvé

Ce n'est pas une hypothèse. `acquisition/scripts/tor-fleet-gonet.sh` (lignes 6-9) enregistre le
résultat : depuis une IP datacenter Scaleway, reCAPTCHA v3 sur GOazimut ⇒ **0 dépôt** ; un exit Tor
partagé sur une flotte ⇒ **90/90 sans zonage** ; un exit Tor frais par ville ⇒ **succès**
(saint-pie-de-guire, 25 zones). `docs/spec/methodes-acquisition.md:158` note la même contrainte et
mentionne « sortie résidentielle autorisée ».

Conséquences à assumer :
- **Le poste local a une IP résidentielle ; le cluster n'en a pas.** Migrer sans compensation
  DÉGRADE mécaniquement certaines lanes.
- La lane obscura DOIT donc migrer **en dernier** (§6.2) et **avec** la variante Tor (§5.4).
- Certaines sources pourraient rester **non captables depuis le cluster**. Pour celles-là, deux
  options seulement : (a) un proxy de sortie résidentiel payant, (b) un carve-out documenté où la
  capture reste locale **mais journalisée par le même chokepoint et déposée sur le même bucket** —
  ce qui préserve la preuve tout en perdant la durabilité de l'exécution. **(b) est le repli
  acceptable ; « rien journaliser » ne l'est pas.** Arbitrage : §8-C.

### 7.3 Débit

Le quota `geo` autorise ~**2 pods simultanés** (§5.3). Avec un `DELAY_MS` de politesse à 2000 ms, une
passe province-wide multi-lane se compte en **jours**, pas en heures. Trois leviers, tous à arbitrer :
relever `tenant-quota` (décision poc-k8s, hors de ce dépôt) ; basculer les lanes lourdes en Scaleway
Serverless Jobs (§5.5, hors quota k8s) ; accepter la durée. Le levier « plus de shards » **ne
fonctionne pas** — `deploy/acquisition-job/README.md:88-93` l'écrit explicitement.

### 7.4 Secrets

Le patron existant est sain et DOIT être conservé : `envFrom.secretRef`, aucune matérialisation sur
disque (`lib/s3.ts:74-85` lit `process.env` en repli), vérifications de **présence seule** dans
l'entrypoint (`run-acquisition-job.sh:41-45`). Risque nouveau introduit par cette spec : le
`manifest.jsonl` et le `run.log` sont des **artefacts durables**. Un `run.log` qui affiche une URL
signée ou un en-tête `Authorization` **grave un secret sur S3 pour toujours**. D'où l'obligation de
rédaction de §2.3 — et le fait que `run.log` DOIT être traité comme du contenu potentiellement
sensible, avec une rétention plus courte que le manifeste.

### 7.5 Ce qui pourrait ne PAS être migrable

Honnêtement, sur la base de l'existant :

- **Les sources à JS-wall + anti-bot** (GOazimut/reCAPTCHA v3, portails VPlus/Modellium) — §7.2.
- **Les sources qui exigent une session interactive** ou un `POST` de formulaire construit à la
  main : `zones-obscura-run.ts` pilote un Chromium par CDP ; migrable, mais avec une empreinte
  mémoire ≥ 1 Gio qui sature le quota actuel à un seul pod.
- **Les sondes de diagnostic à latence humaine** (`_diag-fetch-lenient.ts`, `_fetch-wayback-range.ts`)
  : elles restent migrables, mais leur boucle d'itération devient nettement plus lente (build image →
  push → Job → logs). C'est le coût réel et le plus sous-estimé de cette spec : **on échange de la
  vélocité d'exploration contre de l'auditabilité.** Mitigation : le mode `DRY_RUN=1` et un Job
  interactif de courte durée réutilisant la dernière image, pour ne pas rebuilder à chaque sonde.
- **Le rendu et l'OCR payants** ne sont pas de la capture et n'ont pas à migrer (§4.2).

---

## 8. Ce qui exige un arbitrage du propriétaire

| # | Question | Options | Recommandation |
|---|---|---|---|
| **A** | Bucket unique `sentropic-geo` sous `raw/` + `capture/_runs/`, ou bucket dédié ? | (1) même bucket, préfixes ; (2) bucket `sentropic-geo-capture` avec une clé **write-only** pour les pods | (1) **maintenant** (aucun code à toucher), (2) plus tard **si** on veut isoler les droits d'écriture des pods de capture de ceux qui écrivent `normalized/` |
| **B** | Rétention de `raw/**` | (1) illimitée ; (2) expiration à N mois ; (3) transition classe froide | **Décider APRÈS la première lane migrée**, sur la volumétrie mesurée. Par défaut d'ici là : illimitée |
| **C** | Sources bloquées depuis une IP datacenter | (1) proxy résidentiel payant ; (2) Tor NEWNYM par ville (déjà prouvé, gratuit, lent) ; (3) carve-out : capture locale mais journalisée sur le même bucket | (2) d'abord ; (3) comme repli documenté ; (1) seulement si le blocage devient bloquant sur une lane à valeur |
| **D** | Posture de scraping : rotation d'UA ? | (1) statu quo — UA constant honnête ; (2) rotation | (1). `RawDocument.ts:23,26-28` inscrit déjà une posture explicite (« honest user-agent », obscura « for rendering reliability, never for circumventing access »). La changer est une décision de politique, pas d'ingénierie |
| **E** | Quota `tenant-quota` du namespace `geo` | (1) laisser à 6 pods / 1Gi ; (2) le relever (décision poc-k8s) ; (3) basculer les lanes lourdes en Scaleway Serverless Jobs | (3) pour le volume, (1) pour le reste — (2) crée une dépendance hors dépôt |
| **F** | `GEO_ALLOW_UNCAPTURED_PROOF` : durée de vie | (1) permanent ; (2) retiré lane par lane (§6.1 étape 4) ; (3) retiré à date fixe | (2). Un échappement permanent vide la règle C-1 de sa substance |
| **G** | Un backfill (`backfilled: true`) compte-t-il dans le KPI v2 ? | (1) non (règle C-4) ; (2) oui si l'URL est connue | (1). C'est la discipline qui rend le 0/1106 actuel *significatif* ; l'assouplir rendrait le KPI incomparable dans le temps |

---

## 9. Résumé normatif — les 8 règles

1. **C-0** — Tout appel réseau vers une source tierce DOIT passer par le chokepoint `capturedFetch`
   de la lib, qui journalise une ligne de manifeste **même en cas d'échec**.
2. **C-1** — Tout dépôt servi de géométrie DOIT référencer une entrée de capture existante.
3. **C-2** — Une preuve v2 sans entrée de capture correspondante est déclarative et NE DOIT PAS être
   comptée.
4. **C-3** — Les octets bruts NE DOIVENT être écrits que sous `raw/<source>/cas/<sha256>.<ext>` ;
   `work/`, `.cache/`, `data/raw/` sont du scratch jetable.
5. **C-4** — Une entrée `backfilled: true` compte pour la traçabilité (K2), jamais pour la preuve (K3).
6. **C-5** — Un Job de capture NE DOIT JAMAIS écrire sous `normalized/`.
7. **C-6** — Aucun secret, aucun token, aucun en-tête d'autorisation NE DOIT apparaître dans un
   manifeste ou un `run.log` déposé sur S3.
8. **C-7** — Les objets sous `raw/` NE DOIVENT JAMAIS être supprimés par un script d'acquisition.
