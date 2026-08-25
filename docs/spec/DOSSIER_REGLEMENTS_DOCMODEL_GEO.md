# DOSSIER RÈGLEMENTS — §1+§2 : modèle documentaire & données servies (volet geo-archi)

> **Volet geo-archi (WP6)** pour le dossier de décision « structure documentaire & modèle de données des
> règlements » (owner ; pilote geo-cond ; co-produit immo/extraction + vue). **Design-only — HOLD owner sur toute
> liaison règlement.** Groundé `fichier:ligne` sur `origin/main` (`1ce772ab`) via une passe de cartographie
> lecture-seule. Complémentaire : **§2-immo (extraction)** = severance de projection ; **§3 (vue)** = présentation
> 3-niveaux (consomme le discriminant §2.3). **§4 (reco) s'appuie sur le contrat « geo sert X ⟺ immo projette X »
> du §2.4.** Terme proscrit = 0.

## §1 — La pile documentaire des règlements (ce que geo modélise / sert)

**Pile canonique cible** (`docs/spec/geo/zonage-acquisition-en-vigueur.md:28-34,47`) : **BASE** (n°+année) → **ADOPTION**
→ **AMENDEMENTS** (listés + rattachés au base — « un n° d'amendement n'est pas un règlement rival ») →
**CONSOLIDATION** (grille complète) ; gate G3 = provenance 100 % « règlement + n° amendement + date + URL ».

**Niveaux RÉELLEMENT servis / registrés :**

| Niveau | Où (geo) | État |
|---|---|---|
| **BASE** | `qc-zonage-<slug>` : 4 champs verbatim `reglement_{numero,millesime,page_source,url}` (`fold-reglement-to-zonage.ts:36`), **constants par muni** (`:9-11`), whitelist `PROVENANCE_PROP_WHITELIST` via `putServedZoneAdditive` (`zonage-proof.ts:333-337,744-842`). Registre curé `reglement-provenance.json` (**944 villes**, keyé slug). | **Servi** (BASE seule) |
| **ADOPTION** | `reglement_millesime` (année EEV verbatim quand dispo) | **Partiel** (souvent null ; typage non-uniforme : 315 string vs int/null) |
| **AMENDEMENTS** | **Aucun champ servi** (`reglement_amendement*` = grep vide). N'existent que comme `ZoningEvent.bylaw_numero` (contrat `SPEC_QC_ZONING_EVENTS_V2`, geo=producteur unique / immo=consommateur, seul écrivain du graphe) | **Contrat défini + outillé, mais collection `qc-zoning-events` NON PEUPLÉE / NON SERVIE** (aucune instance) |
| **CONSOLIDATION** | grille normes complète `qc-zonage-norms` + effet-densifiant = **diff de 2 versions normes** (`SPEC_PIPELINES_MIGRATION.md:102-103`) | Implicite (pas un historique règlement) |

**Le modèle `ZoningEvent`** (`zoning-events-emit.ts:94-116`) : `event_id=sha256(muni|source_ref|detection_anchor)`
— `bylaw_numero` **interdit dans l'identité** car il bouge après détection (`:11-19`). Champs : `bylaw_numero,
muni, type, date_iso, state(active|corrected|retracted), version, supersedes, zone_codes_resolus[]` (match **EXACT**
au `zone_code` servi, jamais fuzzy — `:14-16,66-81`), `zone_codes_non_resolus[], effet_densifiant_ref{collection,
zone_code}, url_pdf, extrait_brut, confidence, provenance{producer, source_span, source_url, as_of_date}`.
Taxonomie neutre (`ppcmoi | changement-de-zonage | projet-reglement | entree-en-vigueur | derogation-mineure |
cptaq | …`, `:38-48`).

**[FACT décisif]** geo sert **1 niveau** (BASE + adoption partielle). Les amendements/événements sont un **contrat
producteur défini mais non peuplé/servi** → la pile 4-niveaux n'est **pas** matérialisée servi-side.

## §2 — Tagging, requête, gaps, cible

### §2.1 — Tagging & jointures actuels
- **BASE vs AMENDMENT = par COLLECTION, pas par champ** : BASE = `reglement_numero` (registre + `qc-zonage`) ;
  AMENDMENT = `bylaw_numero` (`ZoningEvent`). **Aucun flag `is_base`/`is_amendment`** sur un enregistrement servi.
- **Tuple naturel** de requête d'un règlement : `citySlug` (+ `reglement_numero` + `reglement_millesime`).
- **Joints existants** : `qc-zoning-events ↔ qc-zonage` = `muni`/slug + `zone_code` **EXACT** (`zone_codes_resolus`) ;
  `reglement-provenance ↔ qc-zonage` = slug ; `qc-pv ↔ event` = `source_url` + `source_span` verbatim +
  `detector_reglement_numero` (`zoning-event-remediation.ts:46-51,172-203`, span verbatim exigé, zéro inférence).
- **Jointure MANQUANTE (structurelle)** : `reglement-provenance`/`qc-zonage` ↔ `qc-zoning-events` — `reglement_numero`
  (base) **≠** `bylaw_numero` (amendement) **par conception**. C'est la jointure absente qui matérialise le gap
  base↔amendement (§2.2a).

### §2.2 — Gaps
- **(a) base-floor ≠ per-event PV** : le servi estampille la **BASE** (constante par muni) ; les `_note` du registre
  **ÉCARTENT** systématiquement les amendements (**542** occurrences `ECARTE|MODIFIANT|AMENDEMENT` dans
  `reglement-provenance.json` ; ex. `saint-dominique:2228` « ECARTE 2023-399.1 = le MODIFIANT »). Les amendements
  portent `bylaw_numero` (≠ `reglement_numero`), **aucune jointure** ne les rattache à la zone/grille servie → le
  règlement servi est un **plancher**.
- **(b) 2 dettes de curation d'URL** (numéro curé OK, URL = proxy — invisible au KPI-numéro, dégrade le
  KPI-capture-URL `reglement-capture-kpi.ts:69-71`) : `saint-dominique` (`reglement-provenance.json:2223-2229`) —
  `reglement_url` pointe le PDF de l'**amendement** 2023-399.1, pas le corps de base 2017-324 ; millésime `"2017"`
  = **string** dérivée du segment-année. `farnham` (`:3602-3608`) — `reglement_url` = **page-titre seule** de la
  refonte, pas le corps.
- **(c) `qc-zoning-events` non peuplé/servi** → l'ancre amendement (Bylaw) + la lignée PV n'ont **aucun home servi
  geo** ; les consommateurs (immo) self-extraient des PV bruts → **racine servi-side du fantôme** (§2.4).
- **(d) typage millésime non-uniforme** (315 string vs int/null) — durcir le schéma cible.

### §2.3 — Cible (contrat servi doc-model)
1. **Lignée de provenance NON-DROPPABLE + jointe** — l'ancre **Bylaw** (règlement/amendement) + l'edge
   **`derived_from`** + le **`docSha`** (preuve-v2) = **contrat servi**, pas un champ optionnel droppable, avec
   **clés de join explicites**. ⟹ **peupler + servir `qc-zoning-events`** (le producteur SPEC) **+ AJOUTER
   `provenance.docSha`** au `ZoningEvent` (le sha `capturedFetch`, déjà en `raw/proces-verbaux-<city>/cas/<docSha>.pdf`)
   — c'est le **maillon manquant** côté servi.
2. **Discriminant servi (severance-de-projection vs absence-réelle) — partition fermée, `unknown ≠ absent`** :
   `has-bylaw` / `no-bylaw:<raison>` (`source-gap` | `non-adopte` | `unknown`), **jamais un null nu**. La **présence
   de l'ancre retenue** rend la severance **diagnosticable** (servi-a-l'ancre ∧ projection-sans-ancre = severance).
   *(consommé par §3 vue, pas inventé par elle.)* **Déjà partiellement contractualisé** : `ZoningEvent.detection_state
   ∈ {detected | detection_incomplete | no-event}` (`SPEC_QC_ZONING_EVENTS_V2.md:91`) EST conçu comme ce discriminant
   (distingue l'absence-réelle `no-event` de la détection-partielle) — **mais non servi** (collection vide) ⟹ le
   **servir** fait partie de la cible. La BASE zonage n'a **aucun** équivalent → d'où le flag §2.3.3.
3. **Flag « source amont non-projetée ici » — EXIGENCE explicite** : réponse au test geo-cond = **NON**, geo ne sait
   **pas**, servi-side, qu'il existe des événements/amendements en registre **non projetés** dans le zonage de base
   (le zonage de base n'expose aucun indicateur). ⟹ le contrat cible doit exposer, sur la zone servie, un **flag
   explicite** signalant que des événements amont existent — sinon la **severance base-floor est indétectable
   servi-side**.
4. **Jointure base↔amendement** — matérialiser la clé rattachant l'amendement (`ZoningEvent`, `zone_codes_resolus`)
   à la base servie (`muni` + `zone_code`) : la jointure aujourd'hui **absente** (§2.1).
5. **Write-path servi GATÉ PAR CONSTRUCTION (authz)** — *exigence ratifiée (geo-socle + geo-archi, sur le catch
   ≥2-pairs Model A)*. Toute écriture servie de `qc-zoning-events` (y compris l'émetteur-complétude §2.5) passe par
   la **frontière gatée UNIQUE** (owner-go, `executeZoningEventRemediation`), **JAMAIS** via un writer non-gaté
   (`serveZoningEvents`). **Une discipline n'est pas un gate** : le HOLD « zéro écriture servie sans write-go » doit
   être **enforced par CONSTRUCTION**, pas par convention. Symétrie : **gate de complétude producteur (§2.5 / S2)**
   **+** **gate d'autorisation d'écriture (ce point)**. **Scoping** (pour ne pas faire baller Model A) : (a) ce
   doc-model = la **CIBLE** (authz par construction) ; (b) **Model A réalise le ROUTAGE** — tout write → la
   frontière gatée unique = **critère d'acceptation Model A** (`SPEC_EVOL`) ; (c) le **durcissement crypto**
   (remplacer le field-bound-sur-reader-injecté par une **vérif de signature** dans le module **#258 PARTAGÉ**) =
   **lot / décision-owner DISTINCT** (changement de modèle de sécurité, revue dédiée), **jamais en douce dans
   Model A**. **Séquence — principe général** *(endossé geo-socle sur la revue firewall #267 ; décision de lot =
   geo-cond)* : **un gate d'autorisation FIELD-BOUND ne doit PAS être câblé sur des écritures irréversibles RÉELLES
   avant Q-CRYPTO-HARDEN.** Tant que le gate reste field-bound (avant la vérif de signature), le **resolver réel**
   (lecture du store d'autorisation réel) **reste absent = refuse-by-construction** ; le câbler = un **lot SÉPARÉ
   gaté sur Q-CRYPTO-HARDEN**, revue adversariale dédiée. S'applique généralement (Model A L4 · campagne
   object-store #266 · futur) ; le spec campagne #266 porte le campaign-specific (« Q-CRYPTO-HARDEN plus prioritaire
   ICI »), ce point = le **principe général** qui le sous-tend.
6. **Runner-VÉRIFICATION sémantique par construction (Q-SEMANTIC-VERIFY)** — *proposée geo-archi, endossée
   geo-socle (findings adversarial #264 sur le runner #258 PARTAGÉ) ; décision de lot / présentation owner =
   geo-cond*. **Orthogonale au write-gate (pt5)** : pt5 = **AUTORISATION** (qui écrit) ; ce point = **VÉRIFICATION**
   (ce qui est écrit est **byte-vrai**). Le runner doit **re-dériver la claim des octets capturés**, jamais
   **s'en remettre à l'assertion du producteur** — même principe fondateur (vérifier **par construction** ≠
   compter sur un **producteur de confiance / non-malveillant**). Deux gaps mesurés :
   - **(finding 2, PRIORITÉ) RETRACT déclaratif** : retirer un event servi = **perte de donnée** (un amendement
     valide disparaît ; le tombstone guard ne couvre pas — le RETRACT EST le chemin de retrait autorisé), et c'est
     aujourd'hui **non re-vérifié** sur les octets, contrairement au LINK. **Fix borné + symétrique** : le runner
     re-run le détecteur sur les octets no-match **et confirme zéro match** (miroir du re-run LINK). *« Le plus
     destructif est le moins vérifié. »*
   - **(finding 1) LINK ≠ identité** : tie au règlement **RÉEL** de l'event — cross-check `target_bylaw_numero ==
     servedEvent.bylaw_numero` (reader injecté) + `detector_reglement_numero == target_bylaw_numero` ; le tie à
     l'identité ancrée-source (`sha256(muni|source_ref|detection_anchor)`) = à cadrer en **L3** (récupération de
     phantom).
   **Scoping** : runner #258 **PARTAGÉ** ⟹ **lot owner-décision DISTINCT** (revue dédiée), **jamais en douce dans
   Model A**. **Model A avance** (producteur de confiance) ; ce gap de trust-model = **LIMITATION connue + lot
   tracké** (capitaliser, pas un TODO perdu). Symétrie : **Q-CRYPTO-HARDEN** (autorisation, pt5) **+
   Q-SEMANTIC-VERIFY** (vérification, ce point).

### §2.4 — Contrat de format geo↔immo (pivot reco §4) — « geo sert X ⟺ immo projette X »
*(Accord **LOCKÉ avec extraction [d52af7]** : mapping confirmé + séquence **B→A** ; shapes immo mesurées sur
`graph/<city>/latest.json`. Reste : la table champ-exact que extraction clôt avec les enums geo `ZoningEvent.type`
/ `detection_state` que je lui envoie.)*

**Diagnostic partagé (racine du fantôme)** : l'ancre « Bylaw » d'immo (ex. `bylaw-sainte-martine-026-511`) est un
**amendement** (= `ZoningEvent.bylaw_numero`), pas la base `reglement_numero` servie sur `qc-zonage`. Comme
`qc-zoning-events` est **vide**, immo self-extrait des PV bruts, puis sa **projection servie DROPPE** les nœuds
Bylaw+Source et les edges `derived_from` (garde `Signal|DesignationEvent` seuls) → `refs.docSha` perdu →
`hasPdfLink=false` = **fantôme** (extraction : `project-graph-from-s3.ts` / `graph-signals.ts:145-205,682-687`).

**Mapping (immo ⟺ geo) :**

| immo (graphe / projection) | geo (servi / produit) | statut |
|---|---|---|
| `Bylaw.id = bylaw-<city>-<numero>` · `{numero, date, municipality}` | `ZoningEvent.bylaw_numero` + `muni` + `date_iso` | **cible** (zoning-events à peupler+servir) |
| `derived_from {source, target, refs:[{docSha}]}` (Signal/DE → Bylaw) | event→zone (`zone_codes_resolus`) + `provenance.docSha` | **`docSha` à AJOUTER** = clé de liaison du fix 71/137 |
| `Source {docSha, date, sourceKind:pv}` | `provenance.{source_url, as_of_date}` + docSha → `raw/proces-verbaux-<city>/cas/<docSha>.pdf` | preuve-v2 |
| nœud servi immo matérialise l'edge → `props.refs` / `sourceRef` | — | **fix projection immo** (mesuré : 71/137 sources fantômes récupérées, anti-invention vérifiée) |

**TROIS axes distincts (raffinement extraction — à NE PAS confondre) :**
- **Bylaw lifecycle STATUS** (état du DOCUMENT) : `projet → en_cours → adopte → en_vigueur → abroge`. **geo n'a
  AUCUN home servi pour ça** → **champ candidat `bylaw_lifecycle`** sur l'ancre si le servi doit porter le statut
  (maillon manquant côté geo, à AJOUTER au contrat).
- **Event procedural ETAPE** (l'événement citant, Signal/DE) : `avis_motion → projet_reglement → second_projet →
  adoption` (+ piia/ppcmoi/usage-conditionnel/derogation-mineure/inconnu) ⟺ geo `date_iso` + `detection_state`/`type`.
- **kind (instrument)** ⟺ geo `ZoningEvent.type` : modification-zonage/rezonage→zoning-amendment ·
  derogation(-mineure)→derogation · piia · ppcmoi · usage-conditionnel · densification · cptaq/alienation/lotissement→respectifs.

**Reco §4 = séquence B→A** (mesurée par extraction ; **l'owner ratifie la séquence** — Model A/B = décision d'archi
OWNER, extraction et moi donnons l'analyse, pas la décision) :
- **Model B — patch CETTE-SEMAINE** (couverture) : immo garde le self-extract ; la **projection matérialise**
  `derived_from → Bylaw refs[{docSha}]` (+ Source-by-date) dans le nœud servi (`props.refs`/`sourceRef`). Corrige
  les 137 live (71 + pass-3), ≤2 PR, **zéro dépendance geo**. **Non-optionnel court-terme** précisément parce que
  `qc-zoning-events` est **vide** (gap §2.2c) — immo n'a encore rien de servi-geo à consommer.
- **Model A — cible DURABLE semaine-prochaine** (SPEC producteur/consommateur) : geo **peuple + sert
  `qc-zoning-events` avec `provenance.docSha`** ; immo **consomme** l'ancre servie **non-droppable** au lieu de
  re-extraire → **le fantôme ne peut plus récidiver**. Gaté sur le peuplement geo de la collection.

⟹ **geo sert la lignée ⟺ immo la projette 1:1** ; B ferme la fuite maintenant, A la rend **récurrence-proof**
(ancre servi-geo). C'est la **colonne de la reco §4**.

**Table champ-exact — CLÔTURÉE avec extraction :**

*Mapping `geo ZoningEvent.type` → {immo `kind`, immo `stage`} (many-to-two) :*

| geo `type` | immo `kind` | immo `stage` (étape) |
|---|---|---|
| `ppcmoi` | ppcmoi | (étape=ppcmoi) |
| `changement-de-zonage` | modification_zonage / rezonage | — |
| `derogation-mineure` | derogation / derogation_mineure | (étape=derogation_mineure) |
| `cptaq` | cptaq | — |
| `alienation` | acquisition / expropriation | — |
| `projet-reglement` | — | projet_reglement (+ avis_motion, second_projet) |
| `entree-en-vigueur` | — | adoption (⟺ `bylaw_lifecycle=en_vigueur`) |
| `consultation` | — | consultation publique |
| `registre-referendaire` | — | registre référendaire |
| `autre` | (fallback) | inconnu |

*Mapping `detection_state` → buckets discriminant immo :* `detected` ⟺ source existe+vérifiée · `no-event` ⟺
absence **RÉELLE** (après épuisement) · `detection_incomplete` ⟺ candidat-non-vérifié / PIIA-pending. ⟹ c'est le
**discriminant §2.3, à SERVIR (Model A)**.

**3 ajouts au contrat servi (Model A) — gravés :**
1. **`provenance.docSha`** (sha256 preuve-v2) = clé de liaison du fix 71/137.
2. **`bylaw_lifecycle`** (`projet → en_cours → adopte → en_vigueur → abroge`) = statut du **DOCUMENT** ; **aucun home
   servi geo** aujourd'hui.
3. **`subject`/`address` ref pour la classe d'événements SANS bylaw** *(3ᵉ finding extraction)* : les événements
   **PIIA / plan-de-site address-keyed** (mesurés : sainte-martine 13, saint-michel ~10) ont `bylaw_numero = null`
   — leur ancre/lignée est **`address` + `date`**, PAS un bylaw. `ZoningEvent` n'a **aucun** champ sujet/adresse
   (il porte `zone_codes` zone-level) ⟹ **ajouter un `subject` ref** (adresse/lot) sinon cette classe est
   **structurellement non-ancrable** = un fantôme que le modèle bylaw-only rate.

**Note taxonomie** : geo `type` est **plus grossier** que le `kind` immo (manque `piia`, `usage-conditionnel`,
`densification`, `lotissement`, `rezonage`-distinct → tombent en `autre`). Le **split `type` → `kind` + `stage`
(Model A)** doit aussi **élargir l'enum `kind`** pour couvrir ces instruments. *(Table close ; extraction dépose
son §1-exemples + §2-immo data-model à geo-cond pour le fold §4.)*

### §2.5 — Cause racine PRODUCTEUR (escalade extraction) : la lignée doit être ÉMISE, pas seulement servie

**[FACT mesuré — extraction]** Sur la cohorte des 137 fantômes : **seuls 36/137 ont un edge `derived_from` portant
le `docSha`** ; **101/137 n'ont AUCUN lien event→Source** dans le graphe (saint-jean 39, bouchette, saint-raymond,
30/46 sainte-martine, …). Leur PV source **EXISTE** (récupéré+vérifié par Source-by-date / corpus-probe /
PIIA-adresse), mais le producteur (graphify) **n'a jamais émis l'edge** → la projection **ne peut pas porter une
lignée jamais produite**. C'est **la severance de §2.2, un hop plus haut** — au **producteur**.

**Chaîne causale (3 hops)** : (1) **non-émission producteur** (edge émis pour 36/137 seulement → 101 sans-source
à la SOURCE) → (2) **severance de projection** (§2.2 : la projection droppe l'edge des 36 qui l'ont) → (3)
**fantôme servi** (`hasPdfLink=false`).

**Exigence de contrat cible — COMPLÉTUDE du producteur** : la lignée `event → Source/Bylaw` (`refs.docSha`) doit
être **émise pour 100 % des événements**, pas 36/137. Un producteur partiel **régénère la classe de fantômes à
chaque run**. En **Model A**, c'est **geo** le producteur : l'émission `qc-zoning-events` (`zoning-events-emit.ts`)
doit porter `provenance.docSha` (dispo dans le manifeste de capture `raw/proces-verbaux-<city>/cas/<sha>.pdf`) pour
**chaque** événement — un gate de complétude à l'émission, sinon on ne stampe pas (anti-fantôme par construction,
même logique que le VETO §4-fold). En **Model B**, c'est le graphify d'immo qui doit émettre l'edge par événement.

**Les 3 moitiés à APPAIRER en §4** (aucune ne suffit seule) : **producteur ÉMET** (100 %) ⟺ **projection
MATÉRIALISE** (immo) ⟺ **nœud servi PORTE** (contrat). *(Données §4 : 36 edge-linked / 101 unlinked sur 137 ;
la ventilation par-ville + node-ids des 101 = input d'implémentation, à prendre quand geo possède le producteur
Model A.)*
