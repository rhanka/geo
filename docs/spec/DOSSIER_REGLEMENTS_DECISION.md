# DOSSIER DE DÉCISION FINAL — Structure documentaire & modèle de données des règlements

> **Dossier réconcilié (format present-decision) — 2026-08-24.** Fusion de deux passes de synthèse
> indépendantes (passe 1 « fable », passe 2 « opus », produites sans se voir, sur les 3 volets bruts
> geo-archi / extraction / vues), plus **deux résolutions arrivées après les passes** (preuve en main,
> citées ci-dessous). **Design-only : aucune écriture code/servie, aucun commit.**
> Chaque affirmation portante est taguée **[FACT]** (avec source et passe d'origine) ou **[JUGEMENT]**.
> Ce qui n'est pas su est marqué `unknown` — jamais deviné. Statuts employés : unknown / source-gap /
> non-couvert / partiel / vérifié / N-A.

---

## §0 — DÉCISION ENREGISTRÉE

> ### ✅ O2 RATIFIÉE PAR L'OWNER — 2026-08-24
>
> **O2 = séquence Model B → Model A, avec gate track daté et exigence 2-types-d'ancre
> (Bylaw-keyed + subject/address-keyed).**
>
> Concrètement, l'owner ratifie :
> 1. **Model B maintenant** — patch de la projection immo : matérialiser `derived_from → Bylaw`
>    (`refs[{docSha}]` + `Source`-by-date) dans le nœud servi (`props.refs`/`sourceRef`). ≤2 PR,
>    zéro dépendance geo, réversible.
> 2. **Model A comme cible** — geo peuple **et sert** `qc-zoning-events` avec l'ancre non-droppable,
>    les **3 ajouts de contrat servi** (`provenance.docSha`, `bylaw_lifecycle`, `subject`/`address`
>    ref), le **discriminant severance/absence servi** (partition fermée, jamais de null nu) — et,
>    depuis la résolution (b) ci-dessous, une **gate de complétude producteur** (§2.4-bis).
> 3. **Le gate track daté** (condition d'intégrité, §4.4) — O2 sans gate contraignant sur A
>    dégénère en O1 (« B seul ») sans que personne l'ait décidé ; le gate est constitutif de la
>    ratification, pas un accessoire.
> 4. **L'exigence 2-types-d'ancre** — les événements PIIA/plan-de-site à `bylaw_numero = null`
>    (ancre = adresse + date) sont couverts par la cible, sinon la classe reste structurellement
>    non-ancrable.
>
> **Portée** : la ratification porte sur la **cible et la séquence**. L'exécution démarre selon les
> jalons track du gate (§4.4). Le présent dossier reste design-only ; rien n'est écrit côté code ou
> servi par ce dossier.
>
> **Deux résolutions post-passes (§4.1-R) précisent le coût et le périmètre de A sans rouvrir la
> décision** : (a) la provenance PV est **preuve-v2 par construction** → la sous-décision
> A-strict/A-adossé s'effondre en **A-STRICT-CLEAN** (plus aucune posture dégradée à arbitrer) ;
> (b) **101/137 events sans edge `derived_from`** → Model A inclut une **gate de complétude
> producteur** (geo émet l'edge pour TOUS les events).

---

## Note de méthode — réconciliation des deux passes

Les deux passes **convergent** sur le diagnostic (severance de projection, 2 classes d'ancre,
pile 4-niveaux non matérialisée servi-side) et sur la recommandation (O2 = B → A + gate + 2 ancres).
Aucun désaccord de fond n'a été trouvé entre elles. Leurs apports complémentaires sont préservés :

| Apport | Passe d'origine | Repris en |
|---|---|---|
| **Contradiction de spec `event_id`** (SPEC_QC_ZONING_EVENTS_V2.md:16 vs :60) — à unifier AVANT tout peuplement A | opus (finding indépendant, vérifié) | §2.2 |
| Finding **`<source>` ≠ slug muni** (SPEC_CAPTURE_ON_CLUSTER.md:141-142) — chemin CAS à réconcilier | opus (finding indépendant, vérifié) | §2.6 |
| **Pré-mortem** à 5 branches (B livré / A jamais ; capture ; interface divergée ; event_id ; PIIA oubliée) | opus + fable (fusionnés) | §4.7 |
| **Divulgation d'intérêt du présentateur** (biais vers B→A-sans-gate) | fable §4.8 (repris dans la commande de réconciliation) | §4.8 |
| Cadrage **A-strict vs A-adossé** (arbre U1, règle C-4) — désormais **effondré** par la résolution (a) | fable §4.3 | §4.1-R(a), §4.3 |
| **Audit reçus « sans regret »** (lecture seule, transforme U1 en fait) — désormais **rendu** : c'est la résolution (a) | fable §4.3 | §4.1-R(a) |
| **Condition d'intégrité** du gate (O2-sans-gate ≡ O1) | fable §4.4 | §0, §4.4 |
| Détail **VETO 3-verdicts** du registre curé (anti-contamination homonyme) | opus §1.2 (vérifié `fold-reglement-to-zonage.ts:38-62`) | §1.2 |
| Option **O0/statu quo** steelmanée séparément du patch-vue | opus | §4.2 |

**Supersession explicite** : le §4-coût de la passe opus concluait « chaîne de reçus à 0 %,
`capturedFetch` inexistant, 73 `fetch()` nus » — grounding exact sur **l'état des lieux du
2026-07-25** documenté dans `SPEC_CAPTURE_ON_CLUSTER.md`. La résolution (a), **postérieure aux deux
passes et citée code**, établit que le chokepoint `capturedFetch` **existe désormais** et que les
octets PV captés par lui sont preuve-v2 par construction. Le constat opus reste exact **à sa date** ;
il est **supersédé** pour l'arbre de décision (§4.1-R).

---

# §1 — PILE DOCUMENTAIRE

## §1.1 La pile canonique (4 niveaux) et ce que geo sert (1 niveau)

**[FACT — volets A/B, convergent 2 passes]** La structure canonique d'un règlement d'urbanisme
municipal est à 4 niveaux :

| Niveau | Contenu | Cardinalité | État servi geo |
|---|---|---|---|
| **BASE** | le règlement de zonage cadre (n° + millésime) | 1 par muni | **SERVI** (4 champs verbatim) |
| **ADOPTION** | entrée en vigueur de la base | 1 | **partiel** (`reglement_millesime` souvent null ; 315 valeurs string vs int/null) |
| **AMENDEMENTS** | règlements modificateurs, rattachés à la base, chacun porté par un ou des PV | 0..N | **non-couvert** (aucun champ servi ; contrat `ZoningEvent` défini, collection `qc-zoning-events` non peuplée / non servie) |
| **CONSOLIDATION** | état courant des normes après amendements | 1 (implicite) | implicite (`qc-zonage-norms` + effet-densifiant) |

Gate G3 = provenance 100 % (règlement + n° amendement + date + URL) **[FACT — volet A §1]**.

**[FACT — vérifié passe 2, `fold-reglement-to-zonage.ts:36`]** geo sert la **BASE seule** : 4 champs
verbatim `reglement_{numero,millesime,page_source,url}` sur `qc-zonage-<slug>`, constants par
municipalité, écrits via la whitelist `putServedZoneAdditive`, adossés au registre curé
`reglement-provenance.json` (944 villes, keyé slug — count relayé volet A, non re-mesuré).

**[FACT décisif — convergent 2 passes]** La pile 4-niveaux n'est **pas matérialisée servi-side**.

## §1.2 Le registre curé — source de vérité durable de la BASE (logique VETO)

**[FACT — vérifié passe 2, `fold-reglement-to-zonage.ts:38-62`]** Le registre porte une logique
**VETO à 3 verdicts** : slug **absent** → non-instruit (repli grille autorisé) ; slug présent avec
`reglement_numero` null → **VETO** (un curateur a lu le document et conclu : aucun numéro servable —
on ne stampe rien ET on ne retombe pas sur la grille) ; slug présent avec numéro → 4 champs stampés.
Le VETO bloque une contamination homonyme mesurée (`notre-dame-de-lourdes--lerable` servait le
numéro d'une muni homonyme sur 38 polygones).

## §1.3 Ce que le graphe riche immo contient déjà : la pile complète

**[FACT — volet B §1, mesuré repo immo, relayé par les 2 passes]** La pile
base→adoption→amendement **existe déjà dans le graphe riche** d'extraction ; c'est la projection
servie qui la sévère (§2.3) :

- **Bylaw** (ancre) : `{id:"bylaw-<citySlug>-<numero>", props:{numero, date, municipality,
  status ∈ {projet,en_cours,adopte,en_vigueur,abroge}}}` ;
- **Signal | DesignationEvent** (événement citant) : `etape ∈ {avis_motion, projet_reglement,
  second_projet, adoption, piia, ppcmoi, usage_conditionnel, derogation_mineure, inconnu}` ;
  `kind ∈ {modification_zonage, rezonage, derogation, piia, densification, cptaq, lotissement, …}` ;
- **Source** (PV) : `{docSha, date, municipality, sourceKind:"pv", format}` ;
- **Edge `derived_from`** : `{source:<Signal|DE>, target:<Bylaw>, refs:[{docSha:<sha256>}]}`.

Exemples vérifiés (n° littéral dans le PV) : sainte-martine 2019-342 ↔ série 025/026 dont le canari
**026-511** (edge docSha `54d3d536` = PV 2025-12-16, vérifié) ; saint-jean 0651 ↔
2387/2402/2407/2434/2445 + série 2026-5xxx (34/39 du corpus) ; bouchette 2026-384 → `7af1d5d5`
vérifié ; saint-raymond **924-26** → `ff222f57` vérifié — **divergent du registre geo qui porte
922-26** (écart base/amendement à instruire — U3, pas une erreur prouvée d'un des deux côtés).

**Attention (résolution (b), §4.1-R)** : « la pile existe dans le graphe riche » est vrai **pour les
events porteurs d'edge** — soit **36/137** ; **101/137 n'ont pas d'edge `derived_from`** (jamais
émis par graphify). La complétude du graphe riche est donc **partielle**, pas acquise.

## §1.4 Deux classes d'ancre — pas une

**[FACT — volets A §2.4 + B §1, convergent 2 passes]** Le corpus contient **2 classes**
d'événements :

1. **Bylaw-keyed** : l'événement cite un n° de règlement modificateur → ancre = Bylaw. Majorité.
2. **PIIA / plan-de-site address-keyed** : « PIIA — \<adresse\> » **sans bylaw**
   (sainte-martine : 13 ; saint-michel : ~10, address-verify en cours) — `bylaw_numero = null`,
   ancre naturelle = **adresse + date**. **[FACT — vérifié passe 2,
   `zoning-events-emit.ts:94-116`]** `ZoningEvent` n'a **aucun champ `subject`/`address`** → sans
   cet ajout, la 2ᵉ classe est **structurellement non-ancrable** côté geo.

C'est le fondement de l'**exigence 2-types-d'ancre** ratifiée en §0.

---

# §2 — MODÈLE DE DONNÉES

## §2.1 Tagging par COLLECTION, pas par champ — et la jointure manquante

**[FACT — convergent 2 passes]** Aucun flag `is_base`/`is_amendment` servi. La discrimination est
**par collection** : BASE = `reglement_numero` (registre + `qc-zonage`) ; AMENDEMENT =
`bylaw_numero` (`ZoningEvent`). Tuple naturel de la BASE :
`citySlug + reglement_numero + reglement_millesime`.

Jointures existantes : `qc-zoning-events ↔ qc-zonage` = muni + zone_code EXACT ;
`reglement-provenance ↔ qc-zonage` = slug ; `qc-pv ↔ event` = source_url + source_span verbatim.

**Jointure MANQUANTE structurelle** : `reglement-provenance`/`qc-zonage` ↔ `qc-zoning-events` —
`reglement_numero` (base) ≠ `bylaw_numero` (amendement) **par conception** ; rien ne rattache un
amendement à sa base. À matérialiser en Model A.

## §2.2 Identité d'événement — et la CONTRADICTION DE SPEC à unifier avant A

**[FACT — vérifié passe 2, `zoning-events-emit.ts:10-16`]** Le **code** :
`event_id = sha256(muni | source_ref | detection_anchor)` — `bylaw_numero` **INTERDIT dans
l'identité** (il bouge après détection : absent en `detection_incomplete`, résolu plus tard).
immo **joint sur `event_id`**.

**[FACT — finding opus, vérifié — DETTE DE SPEC BLOQUANTE POUR A]** La spec porte **deux
définitions contradictoires** d'`event_id` :
- `SPEC_QC_ZONING_EVENTS_V2.md:16` (« A1 — the crux ») : `sha256(muni | source_ref |
  detection_anchor)` — `bylaw_numero` interdit (= le code) ;
- `SPEC_QC_ZONING_EVENTS_V2.md:60` (« amendment 2 ») : `sha256(muni | bylaw_numero | type |
  date_iso)` — `bylaw_numero` inclus.

Comme immo joint sur `event_id`, cette identité doit être **tranchée et unifiée AVANT tout
peuplement Model A** — sinon le join geo↔immo est bâti sur une identité non-stabilisée (pré-mortem
branche 4). **[JUGEMENT]** Dette de spec à solder dans le périmètre A, pas un détail rédactionnel.
Elle figure comme critère d'entrée du gate (§4.4).

**[FACT — volet B §2.4]** Côté graphe servi actuel, `event_id` est **irreconstructible**
(source_ref null après projection) ; jointure de secours = tuple naturel
`(city_slug, kind, etape, date_iso, label)`.

## §2.3 La SEVERANCE de projection — première racine du « fantôme »

**[FACT — volet B §2.1-2.2, repo immo (`project-graph-from-s3.ts` → `upsertGraphAtomic` ;
`graph-signals.ts:145-205, :682-687`), relayé par les 2 passes]** La projection servie SELECT
`type ∈ {Signal, DesignationEvent}` **seulement** : elle **droppe Bylaw + Source + les arêtes
`derived_from`** → `refs.docSha` perdu → `props.refs` vide → `hasPdfLink = false` (5 champs source
à null) = **fantôme « PV manquant »**.

**Ce n'est PAS une source manquante : c'est une lignée SÉVÉRÉE.** Le PV existe (docSha vérifié en
CAS pour les échantillons §1.3), le rattachement existe dans le graphe riche ; la projection le
supprime. **[FACT — volet A §2.2(c)]** La racine **servi-side** est symétrique : `qc-zoning-events`
vide → immo self-extrait des PV bruts, puis sa projection droppe l'ancre. Deux maillons, un même
fantôme.

## §2.4-bis ⟪RÉSOLUTION (b)⟫ La lignée non-droppable a TROIS moitiés — gate de complétude producteur

**[FACT — résolution post-passes, geo-archi, mesuré]** Sur la cohorte de 137 events :
**101/137 n'ont AUCUN edge `derived_from`** — graphify ne l'a **jamais émis** pour eux ;
**36/137** sont edge-linked. Conséquence structurelle :

> La lignée non-droppable ne tient pas en deux moitiés (« geo sert X ⟺ immo projette X ») mais en
> **TROIS** : le producteur **ÉMET** l'edge ⟺ la projection le **MATÉRIALISE** ⟺ le nœud servi le
> **PORTE**. Un maillon absent n'importe où = fantôme.

**Model B (patch de projection immo) ne peut pas matérialiser un edge qui n'existe pas** : sa
portée est bornée aux events dont le graphe riche contient déjà l'edge. Les 101 unlinked ne sont
récupérables que **côté producteur**. → **Model A doit inclure une GATE DE COMPLÉTUDE PRODUCTEUR** :
geo (graphify) émet l'edge `derived_from` pour **TOUS** les events, et le gate track vérifie
0 event sans edge (ou un `no-edge:<raison>` de partition fermée) avant de déclarer A livré.

**Articulation avec les comptes des passes** : les passes portaient « 71/137 corrigés
graph-internal + 34 saint-jean » (mesure dry-run volet B) ; la résolution (b) porte
« 36 edge-linked / 101 unlinked / 137 » (mesure geo-archi de la présence d'edge). Ces deux mesures
portent sur des couches différentes (correction réalisable vs edge matérialisé) ; leur
**recouvrement exact est `unknown`** — à réconcilier au premier jalon du gate, **jamais** à
additionner.

## §2.5 Le discriminant severance-vs-absence — partition fermée, contractualisée, NON servie

**[FACT — vérifié passe 2, `zoning-events-emit.ts:51` ; `SPEC_QC_ZONING_EVENTS_V2.md:90-92`]**
`detection_state ∈ { detected | detection_incomplete | no-event }` — partition fermée qui distingue
un gap de DÉCOUVERTE d'un cas non-extractible. Défini mais **non servi** (collection vide).
Mapping mesuré côté immo (volet B §2.3) : per-event-found ⟺ `detected` · no-source après
épuisement ⟺ `no-event` · candidate/PIIA ⟺ `detection_incomplete`.

Cible (volet A §2.3) : jamais de null nu — `has-bylaw` / `no-bylaw:<raison>` avec raison ∈
{source-gap, non-adopte, unknown} ; plus un **flag « source amont non-projetée ici »** (sans lui,
la severance base-floor est indétectable servi-side). Depuis la résolution (b), la même discipline
s'étend au maillon producteur (`no-edge:<raison>`).

## §2.6 Gaps mesurés et contrat de format geo↔immo

**Gaps [FACT — volet A §2.2, convergent]** :
(a) **Base-floor ≠ per-event** : le servi estampille la BASE constante ; 542 occurrences
`ECARTE|MODIFIANT|AMENDEMENT` dans `reglement-provenance.json` écartent les amendements, aucune
jointure ne les rattache → le règlement servi est un **PLANCHER**, étiqueté tel, **jamais**
présenté comme source d'amendement (volet B §2.6).
(b) 2 dettes de curation URL : saint-dominique (URL → amendement 2023-399.1, pas le corps base
2017-324 ; millésime `"2017"` string) ; farnham (URL = page-titre seule).
(c) `qc-zoning-events` non peuplé (racine servi-side, §2.3).
(d) Typage millésime non uniforme (315 string vs int/null).

**Contrat de format geo↔immo (accord LOCKÉ entre volets)** — principe « geo sert X ⟺ immo
projette X », étendu par (b) en **« geo ÉMET X ⟺ immo projette X ⟺ le servi PORTE X »** :

- `Bylaw.id ⟺ ZoningEvent.bylaw_numero + muni + date_iso` (cible) ;
- `derived_from.refs[{docSha}] ⟺ provenance.docSha` — **docSha À AJOUTER au contrat**
  (**[FACT — vérifié passe 2, `zoning-events-emit.ts:59-64`]** `provenance` actuelle = 4 champs
  exactement `{producer, source_span, source_url, as_of_date}`, pas de docSha) ;
- `Source{docSha,date,pv} ⟺ provenance{source_url, as_of_date}` + docSha → octets CAS.

**Interface conjointement versionnée [FACT — vérifié passe 2, `SPEC_QC_ZONING_EVENTS_V2.md:5-6`]** :
geo = producteur unique, immo = consommateur seul écrivain de son graphe, v2 validée par immo sous
A1/A2/A3 (2026-07-18). Toute évolution Model A (docSha, bylaw_lifecycle, subject, split type/kind,
event_id unifié) est un **changement d'interface exigeant re-ratification immo**.

**3 axes distincts** (geo `type` les conflate — à splitter en Model A) :
1. **Bylaw lifecycle STATUS** (projet→en_cours→adopte→en_vigueur→abroge) — aucun home servi geo →
   champ `bylaw_lifecycle` à ajouter ;
2. **event ÉTAPE** (avis_motion→projet_reglement→second_projet→adoption + piia/ppcmoi/…) ;
3. **kind INSTRUMENT** ⟺ `ZoningEvent.type` (10 valeurs neutres,
   `zoning-events-emit.ts:38-48` — enum à élargir).

**3 ajouts de contrat servi (Model A)** : `provenance.docSha` · `bylaw_lifecycle` ·
**`subject`/`address` ref** (2ᵉ classe PIIA).

**Finding opus à réconcilier (chemin CAS)** : le chemin PV relayé par les volets,
`raw/proces-verbaux-<city>/cas/<docSha>.pdf`, embarque un slug municipal dans `<source>`, ce que
`SPEC_CAPTURE_ON_CLUSTER.md:141-142` **interdit** (`<source>` = id de lane-source, pas un slug).
La résolution (a) indique que `CAS_KEY_RE` accepte **`pv-index`** (id de lane-source conforme) ;
la référence de chemin dans le contrat geo↔immo doit être **unifiée sur la clé effective** au
moment du peuplement — reste-à-instruire, non bloquant pour la décision.

---

# §3 — PRÉSENTATION VUE (panneau droit)

## §3.1 État actuel et ses 3 confusions

**[FACT — volet C (a), accordéon « Règlement et Normes » #509]** Liste **plate** de « règlements »
= numéros cités par les signaux + bouton « Voir le PV source » au niveau ville. Le règlement de
BASE de la zone (`zone.reglementNumero/reglementMillesime`) **existe côté données mais n'est pas
surfacé**. Trois confusions : (1) **base vs amendement** — des amendements-événements présentés
comme « des règlements », la base n'apparaît pas ; (2) **amendement vs PV** — la relation « cet
amendement est porté par ce PV » n'est pas structurée ; (3) **« PV manquant » ambigu** — un signal
orphelin par severance de projection s'affiche comme si la source n'existait pas.

## §3.2 Cible : 3 niveaux non-ambigus (hiérarchie indentée, zone active)

**[FACT — volet C (b), convergent 2 passes]**
- **N1 — RÈGLEMENT DE ZONAGE (base)** : en tête, ancre stable, un par zone —
  « Règlement de zonage — {numéro} ({millésime}) » + grille PDF si servie.
- **N2 — AMENDEMENTS (par événement)**, nested sous N1 : « Amendement {numéro} — {étape} —
  {date} » ; **jamais** labellé « Règlement » (badge amendement + étape) ; tri chronologique.
- **N3 — PV SOURCE**, par amendement : « Voir le PV source » attaché à **son** amendement.

Lecture : « le règlement de base → les N amendements qui l'ont modifié → pour chacun son PV ».

## §3.3 États explicites : severance ≠ absence — §3 est gaté par §2

**[FACT — volet C (c)]**
- N1 vide → « Règlement de zonage non renseigné » (absence réelle).
- N2 vide → « Aucun amendement rattaché » (neutre).
- **N3 manquant (cas clé)** : severance de projection (source existe en amont) →
  **« Source non projetée »** — jamais « PV manquant » ; absence réelle →
  « Aucune source documentaire ».

**Invariants** : amendement ≠ « le règlement » ; PV ≠ « PDF du règlement » ; vide-par-severance ≠
absence réelle ; **zéro invention côté vue** — chaque niveau et chaque état mappe un champ/flag
servi de §2. **[JUGEMENT — convergent 2 passes]** La vue **consomme** le discriminant
severance/absence, elle ne peut pas l'inventer → **§3 est gaté par §2** : tant que
`detection_state` (ou l'ancre ré-incluse) n'est pas servi, la vue affichera au mieux un libellé
prudent unique. Mapping : N1 = `reglement_*` (qc-zonage) ; N2 = `qc-zoning-events` ; N3 =
provenance + `docSha` (PV) ; + discriminant severance/absence.

---

# §4 — OPTIONS, DÉCISION, GATE

## §4.0 Décision — DÉCIDÉE

La décision demandée par les deux passes ((i) structure documentaire cible, (ii) séquence de
réalisation, (iii) posture de provenance de A) est **tranchée** : **O2 ratifiée owner 2026-08-24**
(§0). La sous-décision (iii) — A-strict vs A-adossé — est **dissoute** par la résolution (a)
ci-dessous : il n'y a plus qu'une posture, **A-STRICT-CLEAN**. Le choix Model A/B était une
décision d'architecture **owner** ; geo-archi et extraction ont produit l'analyse, pas la décision
**[FACT — volet A §2.4]** — c'est l'owner qui a décidé.

## §4.1 Contexte (faits, hypothèses, unknowns)

### Faits antérieurs aux passes (convergents)

- **[FACT — volet B §2.6]** Cohorte Phase-1 : **137/9** fantômes ; 71 corrigés graph-internal
  (dry-run) + 34 saint-jean vérifiés corpus ; PIIA address-verify en cours ; no-source =
  retract-candidats après épuisement. Phase 2 = all-city (~1686, estimation) après clôture.
- **[FACT]** `qc-zoning-events` **vide** (contrat défini + outillé, non peuplé, non servi).
- **[FACT — volet B §2.2]** Le fantôme est une **severance de projection**, pas une source
  manquante (docShas vérifiés en CAS pour les échantillons §1.3).
- **[FACT]** Interface geo↔immo conjointement versionnée ; Model A = changement d'interface →
  re-ratification immo requise.
- **[FACT — finding opus]** `event_id` : 2 définitions contradictoires en spec (ligne 16 vs 60) ;
  le code suit la ligne 16 ; à unifier avant peuplement.

### §4.1-R ⟪RÉSOLUTIONS POST-PASSES⟫ — arrivées après les deux passes, preuve en main

#### (a) Question preuve-v2 / reçus : RÉSOLUE — A-STRICT-CLEAN

**[FACT — résolution pv, mesuré, cité code]** Les deux passes laissaient ouverte la question U1
(« les reçus de capture existent-ils pour les docShas PV ? ») et en dérivaient l'arbre
A-strict (recapture cluster) vs A-adossé (backfill traçabilité-grade, exclu du KPI preuve, règle
C-4). Cette question est **résolue** :

- les octets PV sont **preuve-v2 PAR CONSTRUCTION** : ils sont captés via le **chokepoint
  `capturedFetch`** (qui écrit manifeste + CAS au moment du fetch) ;
- **`CAS_KEY_RE` accepte `pv-index`** (la lane PV est une source CAS conforme) ;
- la règle **C-4 ne disqualifie QUE `backfilled:true`** — or une **capture live ne porte pas ce
  flag** → les PV captés par le chokepoint **ne sont PAS un backfill C-4**.

**Conséquence** : la posture A-strict/A-adossé de la passe fable **s'effondre en A-STRICT-CLEAN** —
il n'y a **aucune** provenance dégradée à assumer, aucun arbitrage owner résiduel sur (iii).
L'audit « sans regret » proposé par fable est **rendu** ; U1 passe de `unknown` à **vérifié
(favorable)**.

**Coût Model A actualisé** (remplace les chiffrages des deux passes) :
1. **capturer les 18 PV connus manquants** via le chokepoint existant (proof-by-construction) —
   chiffres : **126 liens ← 22 PV uniques ; 4/22 déjà sur geo ; 18/22 à capturer** ;
2. **construire les 3 émetteurs de reçus** : `zoning-event-pv-link-receipt/v1`,
   `pv-text-extraction-receipt/v1`, `source-no-match/v1` — ces reçus sont **définis + consommés,
   SANS producteur** aujourd'hui ;
3. **peupler + servir** `qc-zoning-events`.

**Ce que le coût A n'est PAS** : « recapturer 120 villes ». Le scénario recapture-massive des
passes (quota ~2 pods, DELAY_MS 2000 ms, jours par lane) est **hors sujet** pour A — il ne reste
que 18 PV ciblés.

#### (b) 3ᵉ couche : COMPLÉTUDE-PRODUCTEUR

**[FACT — résolution geo-archi, mesuré]** **101/137 events sans edge `derived_from`** (graphify ne
l'a jamais émis) ; 36 edge-linked. Détail en §2.4-bis. Conséquences pour la décision :

- la lignée non-droppable a **TROIS moitiés** (producteur ÉMET ⟺ projection MATÉRIALISE ⟺ nœud
  servi PORTE) ;
- **Model B ne peut pas matérialiser un edge absent** → sa portée réelle est bornée aux events
  edge-linked ; les 101 restants attendent A ;
- **Model A inclut une GATE DE COMPLÉTUDE PRODUCTEUR** : geo émet l'edge pour TOUS les events
  (critère du gate track, §4.4).

### Hypothèses (à valider)

- **[HYPOTHÈSE — volet B]** Model B tient en ≤2 PR immo, zéro dépendance geo — plausible (la
  donnée edge-linked est dans le graphe riche), chiffrage PR = estimation d'extraction.
- **[HYPOTHÈSE]** L'élargissement de l'enum `kind` et le split étape/kind sont non-cassants
  (aucun consommateur de `qc-zoning-events` n'existe encore — risque de casse faible par
  construction).

### Unknowns résiduels (déclarés, jamais devinés)

| Id | Unknown | Statut |
|---|---|---|
| ~~U1~~ | ~~Reçus de capture des docShas PV~~ | **RÉSOLU (favorable)** par §4.1-R(a) — vérifié |
| U2 | Volume province-wide de la classe PIIA (spot-checks : ~13 + ~10) | unknown |
| U3 | Écart saint-raymond 924-26 (PV) vs 922-26 (registre) — lequel est la base | unknown, à instruire |
| U4 | Volumétrie Phase 2 (~1686 = estimation, pas un décompte fermé) | unknown |
| U5 | Recouvrement exact entre « 71 corrigés graph-internal » et « 36 edge-linked » (couches de mesure différentes, §2.4-bis) | unknown, à réconcilier au 1ᵉʳ jalon |
| U6 | Délai de re-ratification immo du schéma élargi (interface conjointe, dépend d'un tiers) | unknown |

## §4.2 Options (récapitulatif steelmané — préservé pour l'audit de la décision)

*(Les options non retenues sont conservées telles que steelmanées par les deux passes ; les
résolutions §4.1-R sont annotées là où elles changent le cas.)*

- **O0 — Statu quo** (passe opus). POUR : zéro risque ; BASE servie déjà correcte (registre +
  VETO) ; fantôme cosmétique. CONTRE : récidive à chaque re-projection ; érosion de confiance
  (une source affichée absente alors qu'elle existe est pire qu'un vide franc) ; aucune
  trajectoire vers la pile non-ambiguë. **Écartée.**
- **O1 — Model B seul.** POUR : corrige les fantômes edge-linked cette semaine, ≤2 PR, zéro
  dépendance geo, réversible ; B est de toute façon **non-optionnel court-terme**
  (`qc-zoning-events` vide). CONTRE : ne traite pas la racine servi-side (immo self-extrait) ;
  récidive possible sur Phase 2 ; PIIA sans home ; **et depuis (b) : B ne peut structurellement
  pas couvrir les 101 events sans edge** — O1 plafonne. **Écartée.**
- **O2 — Séquence B → A. ✅ RATIFIÉE.** POUR : cumule le fix immédiat (B) et la cible durable (A :
  ancre non-droppable servie, immo consomme au lieu de re-extraire → non-récidive par
  construction) ; couvre les 2 classes d'ancre ; discriminant servi ; **et depuis (a) : le coût A
  est borné et propre (18 PV + 3 émetteurs + peupler/servir, A-STRICT-CLEAN)** ; **depuis (b) :
  seul chemin qui récupère les 101 unlinked (gate producteur)**. CONTRE (préservé, §4.5) :
  fenêtre de double source de vérité B→A ; risque de glissement en O1 si A n'a pas de jalon —
  **d'où le gate constitutif** (§4.4).
- **O3 — Model A d'emblée.** POUR : une seule vérité, pas de migration B→A, contrat éprouvé par
  un vrai consommateur dès le départ. CONTRE : les fantômes restent visibles pendant tout le
  délai A ; contredit le constat partagé « B non-optionnel court-terme ». *(Note : la résolution
  (a) réduisait l'écart de délai — U1 favorable était le renverseur n°3 de la passe fable — mais
  la résolution (b) le ré-élargit : la gate producteur ajoute du travail geo avant toute valeur.
  L'owner a tranché O2.)* **Écartée.**
- **O4 — Patch vue seul.** POUR : coût minimal ; surfacer N1 (base) possible dès aujourd'hui.
  CONTRE : viole l'invariant zéro-invention pour N3 (la vue ne peut pas distinguer
  severance/absence sans discriminant servi) ; ne résout rien structurellement. **Écartée**
  (le surfaçage N1 reste compatible avec O2 et peut être livré au fil de l'eau).

## §4.3 Coût et périmètre de Model A (consolidé post-résolutions)

Périmètre A, tel que borné par la ratification + les résolutions :

1. **Unification `event_id`** (spec ligne 16 vs 60 → aligner la spec sur le code, ligne 16) —
   préalable au join. *(finding opus)*
2. **3 ajouts de contrat servi** : `provenance.docSha` · `bylaw_lifecycle` · `subject`/`address`
   ref (2 classes d'ancre). Split étape/kind + élargissement enum `kind`.
3. **Re-ratification immo** (interface conjointe v2 → v3). *(dépendance tierce — U6)*
4. **Capture des 18 PV manquants** via chokepoint `capturedFetch` (proof-by-construction,
   A-STRICT-CLEAN — pas de recapture massive). *(résolution (a))*
5. **Construction des 3 émetteurs de reçus** (`zoning-event-pv-link-receipt/v1`,
   `pv-text-extraction-receipt/v1`, `source-no-match/v1`). *(résolution (a))*
6. **Gate de complétude producteur** : graphify émet `derived_from` pour TOUS les events
   (0 unlinked sans raison de partition fermée). *(résolution (b))*
7. **Peuplement + service** de `qc-zoning-events` ; discriminant severance/absence servi
   (partition fermée, flag « source amont non-projetée ici ») ; jointure base↔amendement.
8. **Réconciliation du chemin CAS** (`<source>` = id de lane type `pv-index`, jamais un slug).
   *(finding opus + résolution (a))*

**Réversibilité** : B réversible (re-projection) ; A = contrat servi → quasi-frozen dès le premier
consommateur — d'où l'ordre : event_id unifié et schéma ratifié AVANT peuplement.

## §4.4 GATE TRACK DATÉ — condition d'intégrité de la ratification

**[JUGEMENT — convergent 2 passes, constitutif de la ratification §0]** O2 sans gate contraignant
sur A dégénère en O1 sans que personne l'ait décidé (pré-mortem branche 1). Le gate est donc
**gravé dans track avec des jalons datés** — critères vérifiables, pas des intentions :

**Critères d'ENTRÉE de A** (avant peuplement) :
- (E1) `event_id` unifié en spec (ligne 60 corrigée) ;
- (E2) schéma élargi (docSha, bylaw_lifecycle, subject ref, split type/kind) re-ratifié par immo ;
- (E3) les 18 PV manquants capturés via chokepoint (18/18 en CAS avec manifeste).

**Critères de SORTIE de A** (pour déclarer A livré) :
- (S1) les 3 émetteurs de reçus construits et produisant
  (`zoning-event-pv-link-receipt/v1`, `pv-text-extraction-receipt/v1`, `source-no-match/v1`) ;
- (S2) **gate de complétude producteur** : 0 event sans edge `derived_from` non-justifié
  (partition fermée `no-edge:<raison>`) sur la cohorte 137, puis Phase 2 ;
- (S3) première ville avec `qc-zoning-events` **peuplée ET servie**, immo **consommant** l'ancre
  (plus de self-extraction sur cette ville) ;
- (S4) discriminant severance/absence servi et consommé par la vue (§3.3 débloqué) ;
- (S5) U5 réconcilié (articulation 71/36 mesurée et documentée).

Chaque critère reçoit une **date** au moment de l'ouverture du WP — le présent dossier (design-only)
enregistre les critères, pas les dates d'exécution.

## §4.5 Cas le plus fort CONTRE la décision (steelman préservé)

**[JUGEMENT — fusion des deux passes]** O2 installe **délibérément** une fenêtre de double source
de vérité : B écrit dans la projection servie immo des `props.refs`/`sourceRef` que geo ne sert
pas — exactement le motif « le consommateur fabrique ce que le producteur devrait servir » qui a
produit le fantôme initial. Une fois les fantômes edge-linked corrigés et la vue propre, la
pression pour A retombe ; l'histoire du dépôt montre que les contrats définis mais non peuplés
restent vides (`qc-zoning-events` en est la preuve vivante) ; le format `props.refs` projeté par B
peut devenir un contrat de fait, jamais ratifié. La passe opus ajoutait : le risque n'est pas que
A soit mauvais, c'est que **le framing temporel de A soit faux** — « B→A » se dégradant de facto
en « B seul » sans décision.

**Comment la ratification y répond** : (1) le gate §4.4 est **constitutif** de O2 (pas
d'ouverture de A sans E1-E3, pas de « A livré » sans S1-S5) ; (2) la résolution (a) a **dégonflé**
la principale cause plausible de glissement (le coût capture n'est plus « massif et à 0 % » mais
18 PV ciblés + 3 émetteurs) ; (3) la résolution (b) rend le plafonnement de B **mesurable**
(101 unlinked restent fantômes tant que A n'est pas livré — le symptôme ne peut pas devenir
cosmétiquement invisible).

## §4.6 Ce qui ROUVRIRAIT la décision (conditions de réexamen)

La décision est ratifiée ; elle serait à re-présenter à l'owner si :

1. **La re-ratification immo échoue ou diverge durablement** (U6) — l'interface conjointe est un
   prérequis dur de A ; un refus tiers change l'économie de O2.
2. **U2 explose** (classe PIIA beaucoup plus large que ~23) → re-prioriser le `subject` ref en
   tête de A, éventuellement avant l'axe bylaw — amendement de séquence à re-présenter.
3. **La capture des 18 PV révèle un mur** (sources non-captables depuis IP datacenter) — improbable
   au vu du profil PV, mais 18/18 est un critère E3 mesurable ; un échec partiel durable se
   re-présente avec les faits.
4. **La gate de complétude producteur révèle un coût graphify hors de proportion** (les 101
   unlinked exigent une refonte d'extraction, pas une émission d'edge) — le chiffrage
   actuel de ce poste est `unknown` ; un dépassement majeur se re-présente.

## §4.7 Pré-mortem (fusion des deux passes, actualisé post-résolutions)

Six mois plus tard, l'échec ressemblerait à ceci :

1. **B livré, A jamais livré** — « assez bon » a gelé A ; la racine servi-side est toujours là ;
   récidive à chaque refactor de projection. *Mitigation : gate §4.4 constitutif ; plafonnement de
   B mesurable (101 unlinked).* *(le plus probable — les 2 passes)*
2. **A calé sur la capture** — *branche largement dégonflée par la résolution (a)* : il ne reste
   que 18 PV via un chokepoint existant ; le résidu de risque est E3 (mur de captabilité, §4.6.3)
   et la discipline C-4 (ne jamais compter un éventuel backfill dans le KPI preuve).
3. **Interface conjointe divergée** — geo a ajouté docSha/bylaw_lifecycle/subject ; immo n'a pas
   re-ratifié à temps ; deux versions de schéma en vol → fantôme d'un autre type. *Mitigation :
   E2 avant peuplement.* *(opus)*
4. **`event_id` non unifié** — peuplement sur une identité, join immo sur l'autre → orphelins.
   *Mitigation : E1 avant peuplement.* *(opus)*
5. **Classe PIIA oubliée** — subject/address non ajouté → la moitié address-keyed reste fantôme
   après A. *Mitigation : exigence 2-ancres constitutive de la ratification (§0.4).* *(opus)*
6. **⟪nouvelle, post-(b)⟫ Gate producteur traitée comme un backlog** — les 101 unlinked reclassés
   « à faire plus tard », S2 jamais fermé → A « livré » ne couvre que 36/137 et le fantôme
   persiste en masse sous un libellé propre. *Mitigation : S2 = critère de sortie, partition
   fermée obligatoire.*

## §4.8 Divulgation d'intérêt du présentateur

**[JUGEMENT — passe fable, maintenu au dossier final]** La séquence B→A est aussi la trajectoire
la plus confortable pour les agents (B = patch local rapide et gratifiant ; A = chantier long
repoussable) — le risque présentateur est de **sous-pondérer le coût et la discipline d'exécution
de A**. L'intérêt owner (durabilité, non-récidive, preuve opposable) est mieux servi par
O2-avec-gate que par O2-sans-gate : c'est la raison pour laquelle le gate §4.4 est **constitutif**
de la ratification et non optionnel. Les résolutions post-passes (a)/(b) ont été foldées **dans
les deux sens** : (a) réduit le coût de A (favorable à la position confortable), (b)
l'**augmente** (gate producteur) — les deux sont enregistrées avec le même poids.

## §4.9 État de la décision et reste-à-faire

| Élément | État |
|---|---|
| Structure documentaire cible (pile 4-niveaux, 2 classes d'ancre, contrat geo↔immo, vue 3-niveaux) | **Ratifiée** (O2, owner, 2026-08-24) |
| Séquence B → A | **Ratifiée** |
| Gate track daté (critères E1-E3 / S1-S5) | **Ratifié dans son principe** ; dates à poser à l'ouverture du WP |
| Exigence 2-types-d'ancre | **Ratifiée** |
| Posture provenance A (ex-sous-décision (iii)) | **Dissoute** — A-STRICT-CLEAN par résolution (a), aucun arbitrage résiduel |
| Peuplement effectif, capture des 18 PV, écriture servie | **Non couverts par ce dossier** (design-only) — exécution selon jalons track |
| U2, U3, U4, U5, U6 | unknown — instruits au fil des jalons, jamais devinés |

---

## Annexe A — Chiffres clés consolidés

| Mesure | Valeur | Source | Statut |
|---|---|---|---|
| Municipalités registre curé | 944 | volet A | relayé |
| Occurrences ECARTE\|MODIFIANT\|AMENDEMENT (registre) | 542 | volet A | relayé |
| Cohorte fantômes Phase-1 | 137/9 | volet B | relayé (dry-run) |
| Corrigés graph-internal (dry-run) | 71 (+34 saint-jean corpus) | volet B | relayé |
| Events **sans** edge `derived_from` | **101/137** (36 edge-linked) | résolution (b), geo-archi | mesuré post-passes |
| Liens événement↔PV connus | **126**, portés par **22 PV uniques** | résolution (a), pv | mesuré post-passes |
| PV déjà sur geo / à capturer | **4/22** / **18/22** | résolution (a), pv | mesuré post-passes |
| Recouvrement 71 ↔ 36 | unknown (U5) | §2.4-bis | à réconcilier |
| Phase 2 (all-city) | ~1686 | volet B | estimation (U4) |
| Classe PIIA (spot-checks) | sainte-martine 13, saint-michel ~10 | volet B | partiel (U2) |

## Annexe B — Table de grounding (sélection, fusion des deux passes)

| Affirmation | Source | Statut |
|---|---|---|
| BASE = 4 champs verbatim `reglement_*` | `acquisition/src/fold-reglement-to-zonage.ts:36` | vérifié (passe 2) |
| Registre keyé slug + VETO 3-verdicts | `fold-reglement-to-zonage.ts:38-62` | vérifié (passe 2) |
| `provenance` = 4 champs, PAS de docSha | `acquisition/src/zoning-events-emit.ts:59-64` | vérifié (passe 2) |
| `ZoningEvent` : pas de `subject`/`address` | `zoning-events-emit.ts:94-116` | vérifié (passe 2) |
| `event_id` sans `bylaw_numero` (code) | `zoning-events-emit.ts:10-16` | vérifié (passe 2) |
| **`event_id` : 2 définitions contradictoires** | `SPEC_QC_ZONING_EVENTS_V2.md:16` vs `:60` | vérifié — finding opus |
| Interface conjointement versionnée geo/immo | `SPEC_QC_ZONING_EVENTS_V2.md:5-6` | vérifié (passe 2) |
| `detection_state` partition fermée | `zoning-events-emit.ts:51` ; spec:90-92 | vérifié (passe 2) |
| C-4 : seul `backfilled:true` disqualifié de la preuve | `SPEC_CAPTURE_ON_CLUSTER.md:541-544` | vérifié (passe 2) + résolution (a) |
| `<source>` interdit d'être un slug muni | `SPEC_CAPTURE_ON_CLUSTER.md:141-142` | vérifié — finding opus |
| Chokepoint `capturedFetch` existant ; `CAS_KEY_RE` accepte `pv-index` ; capture live sans flag backfill | résolution (a), pv, cité code (post-passes) | mesuré — supersède l'état 2026-07-25 de la spec |
| Severance de projection (SELECT Signal/DE seul) | volet B, repo immo (`project-graph-from-s3.ts`, `graph-signals.ts:145-205, :682-687`) | relayé (non vérifiable depuis geo) |
| 101/137 sans `derived_from` | résolution (b), geo-archi (post-passes) | mesuré |

---

*Fin du dossier réconcilié. **DÉCISION ENREGISTRÉE : O2 ratifiée owner 2026-08-24** (§0).
Design-only : aucune écriture code/servie, aucun commit. Les unknowns U2-U6 sont étiquetés et
instruits aux jalons du gate — aucun n'était requis pour la ratification.*
