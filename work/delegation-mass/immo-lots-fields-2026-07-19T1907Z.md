# Champs LOT immo — shard 0/1 — passe 2026-07-19T19:07Z

Mesure d'autorité : `immo-lots-audit.ts` (lecture S3, sidecars stats des 876 dépôts
`normalized/qc-lots/`). AVANT = 19:03:37Z, APRÈS = 19:07:21Z.

## ⚠️ Les chiffres de la mission étaient PÉRIMÉS

La mission annonçait `surface 815/821 · CP 794/821 · adresse 15/821 (2 %) · folded 21/821 (3 %)`.
Mesuré LIVE : dénominateur **876 munis / 3 404 289 lots**, et surtout **adresse = 75.68 %**,
**folded-normes = 30.56 %** au niveau LOT.

L'écart vient du **compteur track TOUT-OU-RIEN** (`immo-lots-audit` ligne `[track] WPs cibles`) :
il compte les munis à **exactement 100 %** (`adresse=22/876`, `folded-normes=52/876`), pas la
couverture réelle. Pour `adresse` ce compteur est **structurellement inatteignable** : un lot
vacant n'a pas d'adresse au rôle. Piloter la lane sur ce compteur mène à re-broyer du terminal.

## ⚠️ Le « PIÈGE CONNU » de la mission est faux dans sa causalité

La mission affirmait que `--enrich-no-role` **remet `adresse=null`** et donc qu'« adresse ne
remontera JAMAIS ». Vérifié dans le code AVANT tout run :

- `lots-enriched-run.ts:594` — `props["adresse"] = roleRow?.adresse ?? null` : oui, sans rôle
  le candidat porte `adresse=null` (`:551` note `rôle join disabled (--no-role)`).
- **MAIS** `lib/address-regression-guard.ts:66-86` (`guardedQcLotsUpload`) **refuse l'upload**
  quand le candidat a 0 adresse et que le dépôt existant en a > 0 → `AddressRegressionGuardError`.

⇒ `--no-role` n'a **jamais effacé** d'adresses servies. La consigne opératoire reste bonne
(enrichir **avec** le rôle — c'est ce qui a été fait), mais il n'y a **pas** de perte de données
à réparer, et donc **pas** de gisement adresse caché derrière ce prétendu piège.

## AVANT / APRÈS **par champ** (jamais d'agrégat)

| champ | AVANT (19:03Z) | APRÈS (19:07Z) | Δ |
|---|---|---|---|
| `surface_m2` | 100 % — 3 404 289/3 404 289 lots — 870 munis ≥90 % | 100 % — 3 404 289 — 870 | **0** |
| `adresse` | 75.68 % — 2 576 315 lots — 628 munis ≥90 % | 75.68 % — 2 576 315 — 628 | **0** |
| `code_postal` | 100 % — 3 404 288/3 404 289 — 870 munis | 100 % — 3 404 288 — 870 | **0** |
| `folded-normes` | 30.56 % — 1 040 224 lots — 219 munis ≥90 % | **30.61 % — 1 041 991 lots — 221 munis ≥90 %** | **+1 767 lots, +2 munis** |
| `in_tod` (scopé) | 100 % — 28 431/28 431 (4 munis TOD) | 100 % — 28 431 | **0** |

## Villes TRAITÉES (2, dépôt S3 réel `deposit=Y`)

Trouvées par le gate $0 `zonage-norms-stale-lots-audit.ts` → bucket **`servingGap`** : le parquet
`qc-lot-zonage/<slug>.parquet` porte **déjà** les normes, seul le geojson servi était périmé.
Confirmé par `_immo-lots-folded-gain.ts --slugs` (`normsInParquet == matched/total`) ⇒ règle du
7ᵉ passage appliquée : **`lots-enriched-run.ts` SEUL, sans re-jouer `lot-zone-join`**.

| slug | lots | folded AVANT | folded APRÈS | adresse (préservée) |
|---|---|---|---|---|
| `saint-francois-de-lile-dorleans` | 672 | 0 % | **99.7 %** | 99.26 % (code 20005) |
| `sainte-agathe-de-lotbiniere` | 1 110 | 0 % | **98.83 %** | 89.01 % (code 33017) |

Commande : `lots-enriched-run.ts --slugs saint-francois-de-lile-dorleans,sainte-agathe-de-lotbiniere`
(**sans** `--no-role`). Re-vérifié par `_immo-lots-peek.ts` (lecture S3 indépendante).

⇒ **Le flux `servingGap` n'est PAS sec** : il s'était re-rempli depuis la dernière passe. C'est le
seul bucket actionnable côté immo, et il faut le re-balayer à chaque passe.

## Villes SKIPPÉES, avec la raison

### `surface_m2` — 6 munis < 100 %, **0 lot manquant**
`aguanish`, `caniapiscau`, `cote-nord-du-golfe-du-saint-laurent`, `havre-saint-pierre`,
`lile-danticosti`, `metis-sur-mer` : tous `numLots=0` (dépôt `qc-lots` à FeatureCollection vide).
Rien à enrichir — **cadastre amont**, hors lane immo. Total lots manquants = **0**.

### `code_postal` — 7 munis < 100 %, **1 seul lot manquant dans tout le Québec**
Les 6 ci-dessus (`numLots=0`) + `pierreville` 99.95 % : **1 lot** dont le centroïde tombe hors de
tout polygone RTA (plan d'eau / limite). Anti-invention : reste `null`. **Plafond structurel.**

### `adresse` — 13 munis à 0 %, tous TERMINAUX
6 sont les `numLots=0` ci-dessus. Les 7 autres butent sur le plancher d'overlap rôle
`minMatch = max(30, 0.03·nLots)` (`lots-enriched-run.ts:449`, lu cette passe) :

| slug | lots | cause (déterministe) |
|---|---|---|
| `saint-pierre` | 21 322 | overlap 238 < 639 — homonyme |
| `saint-louis-de-gonzague-du-cap-tourmente` | 3 284 | overlap 1 < 98 — homonyme |
| `saint-felix-de-dalquier` | 936 | `no code_geo candidate` — nom absent de l'index rôle/SDA |
| `franquelin` | 43 | 22 < 30 (plancher absolu) |
| `saint-gabriel-de-valcartier` | 23 | < 30 — **mécaniquement** inatteignable |
| `saint-eugene-de-ladriere` | 5 | < 30 — idem |
| `remigny` | 1 | < 30 — idem |

Non re-jouées : le plancher est du code déterministe, 4 des 7 ont **moins de lots que le plancher**.
Affaiblir le garde = arbitrage du principal, pas une décision d'agent. 72 lots en jeu au total.

Le vrai gisement `adresse` restant est **`montreal`** (680 087 lots, 41.05 % au rôle, code 66023) :
bloqué par `role-foncier.ts:318` `xml.parse(xmlBytes.toString())` — le rôle 66023 dépasse la limite
de string Node (~512 Mo). **Aucun re-run ne le débloquera** : exige un parseur XML *streaming*
(tâche d'ingénierie, pas d'acquisition). Le résoudre porterait `adresse` à ~87 %.
`laval` 34.18 % est un **plafond rôle** (déjà joint, code 65005), pas un stale.

### `folded-normes` — gate $0 re-balayé, reste **amont**
`_immo-lots-folded-gain.ts --auto --any-status` :
- palier **petites munis** (1–199 lots, 18 munis) : **0 REJOUABLE-GAIN** — 7 NO-NORMS, 10 STERILE, 1 REGRESSIF.
- palier **grosses munis** (≥200 lots, tri par lots décroissant) : sur les ~120 plus gros munis
  balayés, **0 REJOUABLE-GAIN**. Répartition : `STERILE` (dépôt déjà à jour : `matched/total` ==
  `folded%` servi), `REGRESSIF`, `NO-NORMS` (lane normes), `NO-JOIN` (lane zonage).

⛔ **`REGRESSIF` = NE PAS re-jouer** : le dépôt servi porte PLUS de normes que la grille amont
n'en matche aujourd'hui ; re-jouer **détruirait** des normes servies. Cas les plus marqués relevés :
`pont-rouge` −65.34 pt, `thetford-mines` −47.19, `sainte-brigitte-de-laval` −41.90,
`saint-zotique` −31.14, `saint-hyacinthe` −28.56, `notre-dame-du-mont-carmel` −26.71,
`val-david` −17.86, `saint-honore` −15.63, `val-dor` −13.95, `matane` −4.18.

Bucket `REFRESH` du gate manifest (18 munis, `zonage_match_rate=0`) : **non re-joué**. Le manifest
`crossval.overlap > 0` (grille ↔ SIG) **ne garantit pas** un match au niveau LOT ; 3 passes
antérieures indépendantes ont mesuré `match=0 %` sur ce même bucket. `ivry-sur-le-lac` reste
STERILE (0.65 % dans le parquet, 0 matché).

## Conclusion de la passe

- **1 gisement réel trouvé et servi** : `servingGap` (2 munis, +1 767 lots foldés, $0, sans jointure).
- `surface_m2`, `code_postal`, `in_tod` : **saturés** (1 lot résiduel structurel dans tout le parc).
- `adresse` : saturé sauf `montreal` — **débloquer exige un parseur XML streaming** (`role-foncier.ts:318`).
- `folded-normes` : le reste est **amont** (lanes normes / zonage), pas immo.

**Recette à re-jouer à chaque passe** (c'est la seule qui rend) :
`zonage-norms-stale-lots-audit.ts` → bucket `servingGap` → `_immo-lots-folded-gain.ts --slugs <…>`
pour confirmer `normsInParquet == matched` → `lots-enriched-run.ts --slugs <…>` **sans `--no-role`**.
