# WP9 — champs lots immo, shard 0/1

Date : 2026-07-17.  Mesures S3 par `immo-lots-audit.ts` : référence
`2026-07-17T21:34:47Z`, mesure finale `2026-07-17T21:54:31Z`.

## Avant / après, par champ

| Champ | Avant S3 | Après S3 | Écart confirmé |
|---|---:|---:|---:|
| `surface_m2` | 3 365 896 / 3 365 896 (100 %) | 3 365 896 / 3 365 896 (100 %) | 0 |
| `adresse` | 2 540 332 / 3 365 896 (75,47 %) | 2 540 332 / 3 365 896 (75,47 %) | 0 |
| `code_postal` | 3 365 895 / 3 365 896 (100 %) | 3 365 895 / 3 365 896 (100 %) | 0 |
| `folded-normes` | 855 648 / 3 365 896 (25,42 %) | 856 226 / 3 365 896 (25,44 %) | **+578** |
| `in_tod` (scope TOD) | 28 431 / 28 431 (100 %) | 28 431 / 28 431 (100 %) | 0 |

Le gain net revendiqué est exclusivement celui de l'audit final. Les fiches
finales confirment notamment `audet` à 759/759, `saint-maurice` à 30/2 387
(1,26 %) et `sainte-melanie` à 624/2 326 (26,83 %). Une variation de 117
valeurs ailleurs dans les audits intermédiaires empêche d'attribuer par simple
soustraction l'intégralité de ces écarts locaux : elle n'est donc pas
revendiquée.

## Villes traitées

Adresse, avec le rôle foncier activé à chaque fois : `franquelin`, `remigny`,
`saint-eugene-de-ladriere`, `saint-felix-de-dalquier`,
`saint-gabriel-de-valcartier`, `saint-louis-de-gonzague-du-cap-tourmente`,
`saint-pierre`.

Chaîne lot → zone → normes puis enrichissement : `acton-vale`, `adstock`,
`alma`, `amos`, `amqui`, `armagh`, `arundel`, `ascot-corner`, `audet`,
`roxton-pond`, `vercheres`, `sainte-beatrix`, `mont-laurier`,
`lange-gardien--la-cote-de-beaupre`, `saint-maurice`, `sainte-melanie`,
`blue-sea`, `saint-christophe-darthabaska`, `scott`,
`sainte-victoire-de-sorel`, `huntingdon`, `saint-martin`, `la-presentation`,
`saint-chrysostome`, `saint-benoit-labre`, `saint-lin-laurentides`,
`varennes`, `pont-rouge`, `rigaud`, `rosemere`, `saint-zotique`, `prevost`,
`hemmingford--les-jardins-de-napierville--2`, `saint-amable`.

## Villes skippées ou sans valeur source

- Adresse : les sept villes à 0 % ont toutes été ré-enrichies avec rôle.
  `franquelin` (22 correspondances < 30), `remigny` (1 < 30),
  `saint-eugene-de-ladriere` (4 < 30),
  `saint-gabriel-de-valcartier` (21 < 30),
  `saint-louis-de-gonzague-du-cap-tourmente` (1 < 98) et `saint-pierre`
  (238 < 639) échouent le seuil de recouvrement; `saint-felix-de-dalquier`
  n'a aucun candidat `code_geo`. Les adresses restent nulles par contrat.
- Zones absentes, donc pas de jointure honnête : `amherst`, `cap-chat`,
  `sainte-anne-de-bellevue`, `baie-durfe`.
- Normes déposées mais aucune valeur foldable avec les zones servies :
  `roxton-pond`, `vercheres`, `sainte-beatrix`, `mont-laurier`,
  `lange-gardien--la-cote-de-beaupre`, `blue-sea`,
  `saint-christophe-darthabaska`, `scott`, `sainte-victoire-de-sorel`,
  `huntingdon`, `la-presentation`, `saint-chrysostome`,
  `saint-benoit-labre`. `saint-martin` n'a aucune zone assignée.
- Les dix villes de contrôle `saint-pierre`, `saint-lin-laurentides`,
  `varennes`, `pont-rouge`, `rigaud`, `rosemere`, `saint-zotique`, `prevost`,
  `hemmingford--les-jardins-de-napierville--2`, `saint-amable` ont été
  ré-enrichies sans gain : le taux `zone_code_match_rate` ne mesure pas le
  champ audité `folded-normes`; l'audit et le runner donnent les mêmes valeurs.

## Conclusion opérationnelle

`surface_m2`, `code_postal` et `in_tod` sont déjà à 100 % dans l'audit S3.
Le résidu `adresse` est désormais constitué de jointures rôle non sûres, non
de l'option `--no-role`. Le résidu `folded-normes` exige une amélioration des
sources normes ou de la couverture/compatibilité zone, pas une nouvelle
matérialisation identique des lots.
# Champs LOT immo (WP9) — shard 0/1 — 2026-07-17

Mesure d'autorité : `immo-lots-audit.ts` sur S3 (832 munis servis / 1106, 3 321 961 lots),
`generatedAt=2026-07-17T03:43:14.924Z`. Aucune valeur ci-dessous n'est estimée.

## Verdict : les 5 prémisses du brief sont des artefacts de compteur

Les chiffres du brief (`815/821`, `794/821`, `21/821`, `15/821`) sont le **compteur track
TOUT-OU-RIEN** (une ville ne compte qu'à 100% strict), pas la couverture. Piège déjà
documenté ([[immo-lots-track-counter-trap]]).

### AVANT / APRÈS **par champ** (couverture lots, mesurée S3)

| champ | brief (compteur) | mesuré S3 (couverture lots) | munis ≥90% | verdict |
|---|---|---|---|---|
| `surface_m2` | 815/821 (99%) « résidu 6 villes » | **100%** — 3321961/3321961 | 826/832 | ⛔ **gisement PHANTOM** |
| `code_postal` | 794/821 (97%) « résidu 27 villes » | **100%** — 3321961/3321961 | 826/832 | ⛔ **gisement PHANTOM** |
| `adresse` | 15/821 (2%) | **66.82%** — 2219784/3321961 | 595 full / 818 any | 8 munis à 0%, tous diagnostiqués |
| `folded-normes` | 21/821 (3%) | **20.98%** | 165 | vrai gisement, **partiellement dans la lane** |
| `in_tod` | 4/4 (100%) | 100% scoped (7083/28431 lots, 4 munis) | 4/4 | fait |

**Priorité 3 du brief est vide** : `surface_m2` et `code_postal` sont à **100% de couverture
lots**. Les « résidus 6 / 27 villes » sont des villes sous le seuil strict du compteur, pas des
lots sans valeur. Aucun `qc-lots-backfill` à lancer.

### AVANT / APRÈS agrégé — re-mesuré sur S3 (`generatedAt=2026-07-17T04:34:19.934Z`)

| champ | AVANT (03:43) | APRÈS (04:34) | munis ≥90% |
|---|---|---|---|
| `folded-normes` | 20.98% | **21.39%** | 165 → **168** |
| `adresse` | 66.82% | **66.85%** | 595 → 596 |
| `surface_m2` | 100% | 100% | 826 → 827 |
| `code_postal` | 100% | 100% | 826 → 827 |
| `in_tod` | 100% scoped | 100% scoped | 4/4 |

⚠️ **Le delta agrégé n'est pas entièrement le mien** : le dénominateur a bougé pendant la passe
(832 → 833 munis servis, 3 321 961 → 3 325 228 lots) — une autre lane a déposé en concurrence.
Ma contribution **attribuable**, mesurée par ville au dépôt, est le tableau ci-dessous :

### APRÈS par ville servie (`folded-normes`, mesuré au dépôt, `deposit=Y`)

| muni | lots | `folded-normes` AVANT | APRÈS | lots repliés | `adresse` APRÈS |
|---|---|---|---|---|---|
| `saint-pascal` | 2 622 | 0% | **99.85%** | ~2 618 | 91.5% |
| `les-coteaux` | 2 486 | 0% | **96.02%** | ~2 387 | 90.67% |
| `saint-basile` | 2 380 | 0% | **71.72%** | ~1 707 | 91.81% |
| `rigaud` | 4 757 | 0% | **64.73%** | ~3 079 | 99.05% |
| `chandler` | 2 286 | 0% | **29.35%** | ~671 | 90.64% |
| `nicolet` | 4 522 | 0% | **10.42%** | ~471 | 89.96% |

**6 villes servies, ~10 933 lots nouvellement repliés** (0% → valeur réelle), cohérent avec le
+0.41 pt agrégé mesuré.

## Le piège `--no-role` du brief est FAUX — réfuté deux fois

Le brief dit : « `--no-role` REMET adresse=null […] cause #1 de adresse=2% ». C'est inexact.

1. **Par le code** : `acquisition/src/lib/address-regression-guard.ts:66-86` **refuse l'upload**
   quand le candidat a 0 adresse et que le dépôt existant en a >0 (fail-closed, y compris si les
   stats existantes sont illisibles). `--no-role` écrit bien `adresse=null` en mémoire
   (`lots-enriched-run.ts:594`) mais **n'a jamais pu écraser une adresse servie**.
2. **Par la mesure** : les 8 munis à `adresse=0%` portent tous un **WARN rôle avec sa cause**
   (`rôle overlap too low`, `no code_geo candidate`) — preuve que le rôle **était activé**. Un run
   `--no-role` ne laisse aucun WARN rôle. Ces villes n'ont jamais perdu d'adresse : elles n'en
   ont jamais eu.

Conséquence : re-lancer `lots-enriched-run.ts --slugs <…>` sans `--no-role` sur ces 8 villes —
l'action n°1 demandée par le brief — est un **no-op**. Je ne l'ai donc pas lancé en masse.

## Lane `adresse` — 8 munis à 0%, 0 réparable par ré-enrichissement

Diagnostic LIVE (`lots-enriched-run.ts --verify-only`, lit les sidecars, $0) :

| muni | lots | cause mesurée | réparable ? |
|---|---|---|---|
| `montreal` | 680 087 (20,5% du parc) | `role-foncier.ts:318` fait `xml.parse(xmlBytes.toString())` ; le rôle 66023 dépasse la limite de string Node (~512 Mo) | **non par re-run** — exige un parseur XML *streaming*. **Vaut ~+20 pts d'adresse à lui seul** |
| `saint-pierre` | 21 322 | `overlap too low (best code=61020 matched=238 < 639)` — homonyme | non — résolution d'homonyme |
| `saint-louis-de-gonzague-du-cap-tourmente` | 3 284 | `matched=1 < 98` — homonyme | non — résolution d'homonyme |
| `saint-felix-de-dalquier` | 936 | `no code_geo candidate for slug` — nom absent de l'index rôle/SDA | non — mapping nom→code_geo |
| `franquelin` | 43 | `matched=22 < 30` (taux 51%) | plancher |
| `saint-gabriel-de-valcartier` | 23 | `matched=21 < 30` (taux **91%**) | plancher |
| `saint-eugene-de-ladriere` | 5 | `matched=4 < 30` (taux 80%) | plancher |
| `remigny` | 1 | `matched=1 < 30` (taux **100%**) | plancher |

Les 4 derniers ont un **taux d'overlap de 51 à 100%** (= c'est la bonne muni) mais échouent le
plancher **absolu** `minMatch = Math.max(30, 3%)` (`lots-enriched-run.ts:449`) : sous 30 lots il
est **mathématiquement inatteignable**. **72 lots en jeu.** Affaiblir un garde anti-invention est
un arbitrage du principal — **je n'y ai pas touché**.

## Lane `folded-normes` — 4 modes, dont UN est réparable ici

146 munis à `folded-normes=0%` avec `normes=done`. **16 villes sondées** (2 échantillons) :

| mode | villes mesurées | signature | lane |
|---|---|---|---|
| ✅ **`qc-lots` PÉRIMÉ** | `saint-pascal` (100%), `rigaud` (99.04%), `nicolet` (10.42%) | join frais → `match>0` alors que le dépôt servi est à 0% | **CETTE mission** → servi |
| **zones absentes** | `amherst`, `baie-durfe`, `beaconsfield`, `beauharnois`, `blainville` (20 962 lots), `bonaventure`, `cap-chat`, `chertsey`, `lavaltrie` | `SKIP zones not found` / `no zonage parquet` | **ZONAGE** |
| **zones ⊥ normes** | `baie-saint-paul`, `beauceville`, `berthier-sur-mer`, `vercheres`, `roxton-pond`, `mont-laurier` | `assigned≈100%` mais `match=0% without_norms=100%` | **NORMES** |
| zones partielles | `amos` (2.52%), `plessisville` (59.22%) | couverture zones < cadastre | **ZONAGE** |

**Le mode ✅ est le cœur de la mission et il est réel** : le dépôt `qc-lots` est périmé
vis-à-vis des normes déposées **après** son dernier enrichissement — le gap se re-crée à chaque
dépôt normes amont ([[qc-lots-gap-terminal]]). La chaîne du brief (étape 3) est la bonne, il faut
juste la **re-passer**.

⚠️ **Ma première conclusion était fausse et je l'ai corrigée.** Le 1er échantillon (8 villes) était
biaisé : tête alphabétique `a/b` uniquement, 0 cas ✅ → j'en avais conclu « zéro gisement, chaîne
hors-lane ». Le 2e échantillon, **réparti sur tout l'alphabet**, a sorti 3 cas ✅ sur 8. Leçon :
**ne jamais conclure un verdict de bucket sur une tranche alphabétique.**

Le mode « zones ⊥ normes » n'est **pas** un écart de forme réparable par canon : `lot-zone-join`
réconcilie déjà via `canonicalizeZoneCodeForJoin` (**insensible à l'ordre**) et matche quand même
**0%**. Le SIG de `beauceville` porte 193 codes déjà canoniques (`A-101`, `H-141`, `ID-103`…) ;
les codes du registry ne les recoupent pas → millésime/jeu de codes disjoint.

**Détection du mode ✅ : un `lots-enriched` seul NE SUFFIT PAS.** Testé sur 8 villes
(`bonaventure, bromont, cap-chat, chandler, charlemagne, chertsey, huntingdon, lavaltrie`) :
toutes `norms=0%`, car le parquet `lot-zonage` servi n'a pas les normes. Il faut
`lot-zone-join` **d'abord** (c'est lui qui replie le registry), puis `lots-enriched`. La jointure
est le coût dominant (~2-3 min/ville) → 130 villes restantes ≈ 5-6 h de flotte.

## Villes traitées / déposées

- ✅ **3 `qc-lots` servis** (gain réel) : `saint-pascal`, `rigaud`, `nicolet` — voir tableau APRÈS.
- **8 `qc-lots` re-déposés sans gain** (`bonaventure, bromont, cap-chat, chandler, charlemagne,
  chertsey, huntingdon, lavaltrie`) : `norms=0%` (parquet sans normes) ; `adresse` déjà à 88-99%
  → re-dépôt idempotent.
- **12 parquets `lot-zonage` re-joints** : `amos, baie-saint-paul, beauceville, berthier-sur-mer,
  chateauguay, mont-laurier, vercheres, plessisville, rigaud, nicolet, roxton-pond, saint-pascal`.
  Join déterministe sur (cadastre, zones, registry) → re-run **idempotent**, aucune régression.

## Villes skippées + raison

- **9** : zones absentes → lane zonage (dont `blainville`, 20 962 lots).
- **6** : `match=0%` registry ⊥ SIG → lane normes.
- **8** (`adresse=0%`) : ré-enrichissement = no-op ; causes non-re-run (voir tableau).
- **~130** restantes du bucket `folded-normes=0%` : **non sondées (budget temps)** — le bucket
  n'est PAS épuisé, et il contient des cas ✅ (3/8 dans l'échantillon réparti).

## Suite (par ROI décroissant)

1. **Continuer la boucle `folded-normes`** — c'est le gisement vivant de cette mission.
   Recette **prouvée** : `lot-zone-join-run.ts --slugs <8>` → garder ceux qui sortent `match>0`
   → `lots-enriched-run.ts --slugs <gagnants>` (**jamais** `--no-role`). ~130 villes non sondées,
   3/8 de rendement sur l'échantillon réparti. **Piocher en désordre, pas dans l'ordre alphabétique.**
2. **Parseur XML streaming** dans `role-foncier.ts` → `montreal` → **adresse 66.82% → ~87%**.
   Le seul item adresse qui vaut deux chiffres ; aucun re-run ne le donnera.
3. **Arbitrage principal** : plancher `minMatch=max(30, 3%)` → 4 munis / 72 lots.
4. **Lane zonage** : servir les zones manquantes (`blainville` seul = 20 962 lots).
5. **Lane normes** : millésime disjoint registry ⊥ SIG (pas un problème de canon).

## Passe finale WP9 — 2026-07-17 21:01–21:08Z (shard 0/1)

Mesures d'autorité : deux exécutions de `immo-lots-audit.ts` sur S3,
`generatedAt=2026-07-17T21:01:33.135Z` et `2026-07-17T21:08:50.982Z`.
Tous les enrichissements ci-dessous ont été exécutés **sans** `--no-role`.

### Avant / après, par champ (lots mesurés S3)

| champ | avant | après | constat |
|---|---:|---:|---|
| `surface_m2` | 3 359 823 / 3 359 823 (100%) | 3 359 823 / 3 359 823 (100%) | aucun résidu lot à backfiller |
| `adresse` | 2 534 516 / 3 359 823 (75,44%) | 2 534 516 / 3 359 823 (75,44%) | aucune adresse ajoutée : les nulls testés sont protégés par les gardes anti-homonyme |
| `code_postal` | 3 359 822 / 3 359 823 (arrondi 100%) | 3 359 822 / 3 359 823 (arrondi 100%) | aucun résidu lot à backfiller |
| `folded-normes` | 854 877 / 3 359 823 (25,44%) | 854 877 / 3 359 823 (25,44%) | aucun nouveau pliage sur les villes testées ; causes documentées ci-dessous |
| `in_tod` (périmètre TOD) | 28 431 / 28 431 (100%) | 28 431 / 28 431 (100%) | fait |

Les résidus « villes <100% » du compteur ne sont donc pas des valeurs à inventer : les
colonnes `surface_m2` et `code_postal` sont déjà complètes au niveau lot. Aucun
`qc-lots-backfill.ts` n'a été lancé.

### Villes traitées et dépôts vérifiés

- Adresse avec jointure rôle active : `abercorn`, `acton-vale`, `adstock`,
  `remigny`, `saint-eugene-de-ladriere`, `saint-gabriel-de-valcartier`,
  `franquelin`, `saint-felix-de-dalquier`. Les trois premières conservent
  respectivement 99,78%, 98,83% et 97,55% d'adresses ; aucune régression n'a été
  déposée.
- Chaîne `lot-zone-join` puis `lots-enriched` : `remigny`,
  `saint-eugene-de-ladriere`, `saint-gabriel-de-valcartier`, `franquelin`,
  `saint-felix-de-dalquier`, `authier`, `amos`. Tous les dépôts `qc-lots` issus
  de cette passe ont été vérifiés par le runner et re-mesurés par l'audit S3.

### Villes skippées ou sans gain, avec raison mesurée

- `calixa-lavallee` — aucune zone servie sous `normalized/ca-qc-zonage/` : lane
  zonage.
- `saint-louis-de-gonzague-du-cap-tourmente` — zones sans `zone_code` exploitable :
  lane zonage.
- `remigny`, `saint-eugene-de-ladriere`, `saint-gabriel-de-valcartier`,
  `franquelin` — rôle identifié mais overlap inférieur au plancher anti-homonyme
  de 30 lots ; `adresse` reste honnêtement `null`.
- `saint-felix-de-dalquier` — aucun candidat `code_geo` du rôle ; en plus,
  seulement 8,51% des codes de zone ont une norme correspondante.
- `authier` — normes déposées mais seulement 5,51% de correspondance
  `zone_code`→norme ; pas de valeur ajoutée au-delà de ce qui était déjà servi.
- `amos` — 2,52% des lots reçoivent une zone et 0% des codes appariés aux normes :
  lane zonage/normes.

Aucune des villes testées n'était sans parquet de normes ; les échecs viennent des
zones absentes/inexploitables, de la couverture SIG ou de jeux de codes disjoints,
pas d'une acquisition de normes manquante.

## Passe shard 0/1 — 23:22Z

Mesures d'autorité : deux exécutions S3 de `immo-lots-audit.ts`, avant et
après les dépôts de cette passe (853 produits `qc-lots` servis). Aucun chiffre
ci-dessous n'est estimé.

### Avant / après, par champ

| Champ | Avant (lots / dénominateur) | Avant % | Après (lots / dénominateur) | Après % | Écart lots |
| --- | ---: | ---: | ---: | ---: | ---: |
| `surface_m2` | 3 368 162 / 3 368 162 | 100,00 % | 3 368 162 / 3 368 162 | 100,00 % | 0 |
| `adresse` | 2 542 382 / 3 368 162 | 75,48 % | 2 542 382 / 3 368 162 | 75,48 % | 0 |
| `code_postal` | 3 368 161 / 3 368 162 | 100,00 % | 3 368 161 / 3 368 162 | 100,00 % | 0 |
| `folded-normes` | 860 646 / 3 368 162 | 25,55 % | 860 604 / 3 368 162 | 25,55 % | -42 |
| `in_tod` (périmètre TOD) | 28 431 / 28 431 | 100,00 % | 28 431 / 28 431 | 100,00 % | 0 |

Le delta `folded-normes=-42` est l'observation entre les deux audits ; cette
passe ne le lui attribue pas sans preuve causale. `surface_m2` et
`code_postal` sont déjà complets au niveau lot (le second est 3 368 161 / 3
368 162, arrondi 100 %) : aucun backfill artificiel n'a été lancé.

### Villes traitées

- Adresse, rôle actif (jamais `--no-role`) : `saint-pierre`,
  `saint-louis-de-gonzague-du-cap-tourmente`, `saint-felix-de-dalquier`,
  `franquelin`, `saint-gabriel-de-valcartier`,
  `saint-eugene-de-ladriere`, `remigny`. Les sept dépôts ont été vérifiés et
  les adresses restent nulles : candidat `code_geo` absent pour
  `saint-felix-de-dalquier`; les autres échouent le seuil anti-homonymie
  (respectivement 238/639, 1/98, 22/30, 21/30, 4/30 et 1/30 lots
  correspondants).
- Chaîne lot→zone→normes puis enrichissement :
  `saint-mathias-sur-richelieu`, `lambton`, `lisle-aux-coudres`,
  `beaulac-garthby`, `saint-ferdinand`, `ascot-corner`, `saint-cuthbert`,
  `sainte-melanie`, `brigham`, `daveluyville`. Les jointures couvrent
  97,20–100 % des lots, mais seulement 7,29–27,07 % des codes de zones ont une
  norme déposée ; les valeurs restantes sont donc restées nulles.

### Skips vérifiés

- Zones absentes : `cap-chat`, `sainte-anne-de-bellevue`, `amherst`,
  `baie-durfe`.
- Jointure sans norme correspondante (0 %) : `huntingdon`, `la-presentation`,
  `saint-chrysostome`, `saint-benoit-labre`, `notre-dame-des-neiges`.
- `saint-martin` : 0 % des lots reçoivent une zone.
- Correspondance zone→norme seulement 0,05–0,62 % :
  `fossambault-sur-le-lac`, `lavenir`, `saint-romain`, `ham-nord`,
  `duhamel-ouest`, `chesterville`, `guerin`, `armagh`, `manseau`,
  `saint-ours`.

Ces derniers résidus nécessitent des zones servies ou des normes dont les codes
rejoignent le SIG : ils relèvent respectivement des lanes zonage et normes.
