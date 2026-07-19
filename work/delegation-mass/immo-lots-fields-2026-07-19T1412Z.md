# IMMO LOTS — Champs : 2026-07-19T14:12Z (shard 0/1 = tous les slugs)

## Scope & méthode

- Shard `0/1` → `index % 1 == 0` : **tout l'ensemble servi** (874 munis qc-lots / 1106).
- Mesure AVANT : `immo-lots-audit.ts` (S3) — `generatedAt=2026-07-19T14:04:01.536Z`.
- Mesure APRÈS : `immo-lots-audit.ts` (S3) — `generatedAt=2026-07-19T14:12:17.281Z`.
- Rien n'est revendiqué qui ne soit lu par l'audit S3.

⚠️ **Les chiffres de l'énoncé de mission étaient périmés** (`1651/3290`, `denom=821`,
`adresse 15/821 = 2 %`, `folded 21/821 = 3 %`, `surface 815/821`, `cp 794/821`).
État réel MESURÉ avant toute action : `denom = 3 401 026 lots / 874 munis`,
`adresse 75.66 %`, `folded-normes 25.85 %`, `surface 100 %`, `code_postal 100 %`.

## Avant / Après PAR CHAMP (S3, lot-pondéré)

- `surface_m2` : 100 % → **100 %** (inchangé)
  - Avant : `numWith=3 401 026 / denom=3 401 026`, `munisFull=868 / munisAny=868`
  - Après : `numWith=3 401 026 / denom=3 401 026`, `munisFull=868 / munisAny=868`

- `adresse` : 75.66 % → **75.66 %** (inchangé — plafond rôle, cf. « skippées »)
  - Avant : `numWith=2 573 212 / denom=3 401 026`, `munisFull=626 / munisAny=861`
  - Après : `numWith=2 573 212 / denom=3 401 026`, `munisFull=626 / munisAny=861`

- `code_postal` : 100 % → **100 %** (inchangé)
  - Avant : `numWith=3 401 025 / denom=3 401 026`, `munisFull=868 / munisAny=868`
  - Après : `numWith=3 401 025 / denom=3 401 026`, `munisFull=868 / munisAny=868`

- `folded-normes` : 25.85 % → **29.96 %** (**+4.11 pt**, **+139 794 lots**)
  - Avant : `numWith=879 166 / denom=3 401 026`, `munisFull=218 / munisAny=596`
  - Après : `numWith=1 018 960 / denom=3 401 026`, `munisFull=218 / munisAny=597`

- `in_tod` (scopé CMM/CMQ) : 100 % → **100 %** (inchangé)
  - Avant/Après : `numWith=28 431 / denom=28 431`, `munisFull=4 / munisAny=4`

## Villes TRAITÉES (1 mutation déposée)

### `laval` — le verrou historique de la lane, levé

- Gate `zonage-norms-stale-lots-audit.ts` : bucket **`servingGap`** (`zonage_match_rate=100`,
  `zonage_distinct_with_norms=2613`, `served_pct_with_norms=0`, `served_num_lots=401 594`).
- Gate `_immo-lots-folded-gain.ts --slugs laval` : **`REJOUABLE-GAIN +34.81 pt`**
  (`matched/total=34.81 %` vs `folded_S3=0 %`, `normsInParquet=34.81 %`).
- **La jointure `lot-zone-join` était DÉJÀ faite** (parquet `qc-lot-zonage/laval.parquet`
  présent, `match_rate=100`). L'OOM documenté en mémoire portait sur la JOINTURE, pas sur
  le fold ⇒ `lots-enriched-run.ts --slugs laval` **SEUL** suffisait (recette `servingGap`).
- Exécuté : `NODE_OPTIONS=--max-old-space-size=12288 npx tsx acquisition/src/lots-enriched-run.ts --slugs laval`
  (**sans** `--no-role`, conformément au piège de la mission).
- Sortie 1ʳᵉ main :
  `OK laval lots=401594 zone_code=34.81% norms=34.81% surface=100% code_postal=100%(RTA) adresse=34.18%(code=65005) tod=n/a deposit=Y bytes=768578105`
  puis `DONE ok=1 skipped=0 failed_deposit=0`.
- **`adresse` NON régressée** : 34.18 % conservé (rôle `code_geo=65005` re-joint) — le
  `WARN laval adresse present 34.18% < 50%` est le plafond rôle connu, pas une perte.

## Villes SKIPPÉES, avec la raison mesurée

### Priorité 1 — `adresse` : 7 munis à 0 %, TOUTES terminales (aucune re-jouée)

`_immo-lots-targets.ts --field adresse --zero-only` → exactement les 7 munis déjà
documentés comme terminaux (plancher `minMatch = max(30, 3 % · nLots)` de
`lots-enriched-run.ts:444`, ou nom absent de l'index rôle) :
`franquelin`(43 lots), `remigny`(1), `saint-eugene-de-ladriere`(5),
`saint-felix-de-dalquier`(936, « no code_geo candidate »), `saint-gabriel-de-valcartier`(23),
`saint-louis-de-gonzague-du-cap-tourmente`(3284, overlap 1<98),
`saint-pierre`(21 322, overlap 238<639 — homonyme).
→ **Non re-jouées** : 3 passes indépendantes antérieures les ont re-enrichies AVEC rôle
pour un gain de 0. Re-broyer aurait été du bruit, pas du travail.
Le reste du déficit `adresse` est le plafond rôle par muni (lot vacant = pas d'adresse) +
`montreal` (41.05 %, bloqué par la limite de string Node sur le rôle 66023 — exige un
parseur XML *streaming*, hors périmètre de ce lot).

### Priorité 2 — `folded-normes` : 210 munis passés au gate $0, 1 seul actionnable

`_immo-lots-folded-gain.ts --auto` en 3 paliers (le gate qui compare `matched/TOTAL` au
`folded %` déjà servi — le seul qui échappe au piège du dénominateur) :

| palier | périmètre | REJOUABLE-GAIN | STERILE | REGRESSIF | NO-JOIN | NO-NORMS |
|---|---|---|---|---|---|---|
| 1 | 90 plus grosses (≥200 lots) | **1 (`laval` +34.81)** | 70 | 15 | 3 | 1 |
| 2 | 120 munis 1 858–4 208 lots | **0** | 84 | 31 | 5 | 0 |
| 3 | munis 150–1 857 lots (en cours à la clôture) | 0 à date | — | — | — | — |

- `STERILE` = le dépôt servi porte DÉJÀ tout ce que la grille matche (re-fold = 0 gain).
- `REGRESSIF` = le dépôt porte PLUS de normes que la grille courante ne matche
  (ex. `pont-rouge -65.34`, `saint-elie-de-caxton -84.59`, `thetford-mines -47.19`) —
  **re-jouer DÉTRUIRAIT des normes servies**. Lane NORMES (grille amont a changé de forme).
- `NO-JOIN` (`blainville` 20 962 lots, `beaconsfield`, `beauharnois`, `bois-des-filion`,
  `sainte-anne-de-bellevue`, `cap-chat`, `saint-ferreol-les-neiges`,
  `saint-louis-de-gonzague-du-cap-tourmente`, `amherst`, `baie-durfe`) = pas de parquet
  `qc-lot-zonage` → **lane ZONAGE**, pas immo.
- `NO-NORMS` (`sherbrooke` 36 785 lots, `huntingdon`) = pas de normes déposées → **lane NORMES**.
- Gate `zonage-norms-stale-lots-audit.ts` : `servingGap=2` → `laval` (traité) et
  `ivry-sur-le-lac` (**`STERILE`**, `matched/total=0 %` vs `normsInParquet=0.65 %`) ;
  `REFRESH=18`, tous `zonage_match_rate=0` (codes zonage servi ⊥ codes normes) → amont.

### Priorité 3 — résidus `surface_m2` / `code_postal` : aucun lot enrichissable

- `surface_m2` : `_immo-lots-targets.ts --field surface_m2 --max-pct 99.99` → **`below100=0`**.
  Les 6 munis manquants du compteur track (868/874) sont des dépôts à `numLots=0`
  (FeatureCollection vide, cadastre amont) — il n'y a **aucun lot** à enrichir.
- `code_postal` : **1 seul** muni sous 100 % → `pierreville` 99.95 % (1 831 lots).
  1 lot hors de tout polygone RTA StatCan 2021 ⇒ `null` structurel (anti-invention).

## Conclusion

Le lot est **1 mutation, +139 794 lots foldés, +4.11 pt** sur `folded-normes` — la plus
grosse avancée disponible dans la lane, obtenue en réfutant une prémisse de la mémoire
(« laval = OOM ») : l'OOM portait sur la jointure, déjà faite, pas sur le fold.
Les trois autres champs sont à leur plafond mesuré ; leurs résidus sont amont
(rôle / cadastre / normes / zonage), pas immo.
