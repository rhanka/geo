# Validation de normalizeZoneCode (identité i-infra) — 2026-08-30

**Question (i-infra, avant merge `@radar/domain`).** La fonction d'IDENTITÉ
`normalizeZoneCode` est-elle **INJECTIVE** sur les codes de zone servis PAR-MUNI —
c.-à-d. deux codes bruts DISTINCTS ne produisent-ils jamais la même sortie (une
telle collision = **fusion à tort** de deux zones distinctes) ?

```js
normalizeZoneCode(raw) = String(raw ?? "")
  .toUpperCase()
  .replace(/[–—]/g, "-")                     // unicode dash → ASCII hyphen
  .replace(/\s*\([A-Z0-9]{2,8}\)\s*/g, "")   // parenthesized sector suffix
  .replace(/\s+/g, "");                        // whitespace
```

> ⚠ Évalué UNIQUEMENT sur `normalizeZoneCode` (l'identité). La couche de
> recherche `zoneSearchKey(raw) = normalizeZoneCode(raw).replace(/[^A-Z0-9]/g,"")`
> est VOLONTAIREMENT many-to-one — son sur-match n'est PAS une fusion à tort et
> n'est ni calculé ni signalé ici.

## Verdict

**26 residual collisions (16 HARMFUL paren-suffix distinct-sector merge, 10 BENIGN same-code case/whitespace/dash refold) across 12 muni(s)**

- injective (0 collision, toute cause) : **NON**
- fusion à tort de secteurs DISTINCTS (retrait parenthésé) : **16**
- repli du MÊME code (casse/espace/tiret — canonicalisation par construction) : **10**

## Couverture (lecture seule S3 prod `sentropic-geo`, anti-invention)

- clés listées sous `normalized/ca-qc-zonage/` : **2806**
- slugs servis (total) : **873**
- **munis vérifiées : 873 / 873**
- flat-only : 801 · nested-only : 65 · both : 7
- erreurs de lecture : 0

## Collisions PAR-MUNI sous `normalizeZoneCode`

- groupes de collision (≥2 bruts distincts → même sortie) : **26**
- munis avec ≥1 collision : **12**
- par cause : paren=16 · whitespace=1 · dash=0 · case=9

| slug | couche | nature | cause | sortie | bruts distincts fusionnés |
|------|--------|--------|-------|--------|---------------------------|
| la-redemption | flat | HARMFUL | paren | `02` | `02 (AGF)` · `02 (RCT)` |
| la-redemption | flat | HARMFUL | paren | `20` | `20 (AGF)` · `20 (FRT)` |
| la-redemption | flat | HARMFUL | paren | `28` | `28 (AGF)` · `28 (FRT)` |
| la-redemption | flat | HARMFUL | paren | `29` | `29 (AIC)` · `29 (FRT)` |
| la-redemption | flat | HARMFUL | paren | `33` | `33 (FRT)` · `33 (LSR)` |
| la-redemption | flat | HARMFUL | paren | `34` | `34 (CSV)` · `34 (HBF)` |
| padoue | flat | HARMFUL | paren | `35` | `35 (AGF)` · `35 (MTF)` |
| saint-donat--la-mitis | flat | HARMFUL | paren | `01` | `01 (AGF)` · `01 (FRT)` |
| saint-donat--la-mitis | flat | HARMFUL | paren | `02` | `02 (AGC)` · `02 (AGF)` · `02 (VLG)` |
| saint-donat--la-mitis | flat | HARMFUL | paren | `43` | `43 (MTF)` · `43 (RCT)` |
| saint-joseph-de-lepage | flat | HARMFUL | paren | `02` | `02 (AGC)` · `02 (VLG)` |
| saint-joseph-de-lepage | flat | HARMFUL | paren | `03` | `03 (AGF)` · `03 (VLG)` |
| saint-joseph-de-lepage | flat | HARMFUL | paren | `06` | `06 (AGC)` · `06 (CSV)` |
| saint-joseph-de-lepage | flat | HARMFUL | paren | `07` | `07 (AGC)` · `07 (VLG)` |
| saint-joseph-de-lepage | flat | HARMFUL | paren | `17` | `17 (AGF)` · `17 (RCT)` |
| saint-joseph-de-lepage | flat | HARMFUL | paren | `19` | `19 (AGC)` · `19 (AGF)` |
| disraeli--les-appalaches--2 | flat | BENIGN | whitespace | `74-ZR` | `74 - ZR` · `74-ZR` |
| laverlochere-angliers | flat | BENIGN | case | `INST1` | `INST1` · `Inst1` |
| laverlochere-angliers | flat | BENIGN | case | `INST2` | `INST2` · `Inst2` |
| notre-dame-du-bon-conseil--drummond--2 | flat | BENIGN | case | `AVP` | `AVP` · `AVp` |
| riviere-au-tonnerre | flat | BENIGN | case | `RA-14` | `RA-14` · `Ra-14` |
| saint-ferdinand | flat | BENIGN | case | `137-P` | `137-P` · `137-p` |
| saint-robert-bellarmin | flat | BENIGN | case | `REC-2` | `REC-2` · `Rec-2` |
| sainte-elisabeth | flat | BENIGN | case | `P-183` | `P-183` · `p-183` |
| sainte-elisabeth | flat | BENIGN | case | `P-184` | `P-184` · `p-184` |
| ville-marie | flat | BENIGN | case | `RC8` | `RC8` · `Rc8` |

## Nouvelles collisions introduites par les règles supplémentaires (watch clé)

Règles absentes de l'ancienne `strip-[^A-Z0-9]` :

- **(a) retrait suffixe parenthésé** `X (SECT)` → `X` (HARMFUL — supprime un
  distinguateur de secteur réel) : **16**
  - `la-redemption` → `02` ⟵ `02 (AGF)` · `02 (RCT)`
  - `la-redemption` → `20` ⟵ `20 (AGF)` · `20 (FRT)`
  - `la-redemption` → `28` ⟵ `28 (AGF)` · `28 (FRT)`
  - `la-redemption` → `29` ⟵ `29 (AIC)` · `29 (FRT)`
  - `la-redemption` → `33` ⟵ `33 (FRT)` · `33 (LSR)`
  - `la-redemption` → `34` ⟵ `34 (CSV)` · `34 (HBF)`
  - `padoue` → `35` ⟵ `35 (AGF)` · `35 (MTF)`
  - `saint-donat--la-mitis` → `01` ⟵ `01 (AGF)` · `01 (FRT)`
  - `saint-donat--la-mitis` → `02` ⟵ `02 (AGC)` · `02 (AGF)` · `02 (VLG)`
  - `saint-donat--la-mitis` → `43` ⟵ `43 (MTF)` · `43 (RCT)`
  - `saint-joseph-de-lepage` → `02` ⟵ `02 (AGC)` · `02 (VLG)`
  - `saint-joseph-de-lepage` → `03` ⟵ `03 (AGF)` · `03 (VLG)`
  - `saint-joseph-de-lepage` → `06` ⟵ `06 (AGC)` · `06 (CSV)`
  - `saint-joseph-de-lepage` → `07` ⟵ `07 (AGC)` · `07 (VLG)`
  - `saint-joseph-de-lepage` → `17` ⟵ `17 (AGF)` · `17 (RCT)`
  - `saint-joseph-de-lepage` → `19` ⟵ `19 (AGC)` · `19 (AGF)`
- **(b) suppression des espaces** `A 1` vs `A1` (BENIGN — même code) : **1**
  - `disraeli--les-appalaches--2` → `74-ZR` ⟵ `74 - ZR` · `74-ZR`
- **(c) tiret unicode → ASCII** `A–1` vs `A-1` (BENIGN — même code) : **0**
  - aucune

## Régression — les 15 couples HARMFUL historiques restent-ils distincts ?

Attendu : **oui** (normalizeZoneCode préserve les séparateurs et leur position).

**Tous distincts : OUI ✓**

| slug | brut A → sortie | brut B → sortie | fonction | données |
|------|-----------------|-----------------|----------|---------|
| drummondville | `H-103-1` → `H-103-1` | `H-1031` → `H-1031` | DISTINCT ✓ | not-merged-in-data ✓ |
| lanoraie | `C1-8` → `C1-8` | `C18` → `C18` | DISTINCT ✓ | not-merged-in-data ✓ |
| franklin | `HA-1-2` → `HA-1-2` | `HA-12` → `HA-12` | DISTINCT ✓ | not-merged-in-data ✓ |
| hinchinbrooke | `Af-1-1` → `AF-1-1` | `Af-11` → `AF-11` | DISTINCT ✓ | not-merged-in-data ✓ |
| mont-saint-hilaire | `C-1-1` → `C-1-1` | `C-11` → `C-11` | DISTINCT ✓ | not-merged-in-data ✓ |
| saint-ambroise-de-kildare | `A1-1` → `A1-1` | `A11` → `A11` | DISTINCT ✓ | not-merged-in-data ✓ |
| sainte-clotilde | `Ra1-1` → `RA1-1` | `Ra11` → `RA11` | DISTINCT ✓ | not-merged-in-data ✓ |
| saint-joseph-de-beauce | `H-1.3` → `H-1.3` | `H-13` → `H-13` | DISTINCT ✓ | not-merged-in-data ✓ |
| saint-narcisse-de-beaurivage | `3.1-H` → `3.1-H` | `31-H` → `31-H` | DISTINCT ✓ | not-merged-in-data ✓ |
| amqui | `5.1 R` → `5.1R` | `51 R` → `51R` | DISTINCT ✓ | not-merged-in-data ✓ |
| ascot-corner | `P-1` → `P-1` | `P1` → `P1` | DISTINCT ✓ | not-merged-in-data ✓ |
| cote-saint-luc | `RU*-65` → `RU*-65` | `RU-65` → `RU-65` | DISTINCT ✓ | not-merged-in-data ✓ |
| saint-aime-du-lac-des-iles | `A-01` → `A-01` | `A-Î01` → `A-Î01` | DISTINCT ✓ | not-merged-in-data ✓ |
| saint-donat--la-mitis | `01 (AGF)` → `01` | `01 AGF)` → `01AGF)` | DISTINCT ✓ | not-merged-in-data ✓ |
| saint-joseph-de-lepage | `01 (AGF)` → `01` | `01 AGF)` → `01AGF)` | DISTINCT ✓ | not-merged-in-data ✓ |

## Méthode

1. `listObjectEntries` sur `normalized/ca-qc-zonage/` → slugs plat/niché ; couche servie = niché si présent sinon plat (autorité geo-api ; 873 servis).
2. Par muni servie : bruts `zone_code` distincts (trim, non vide, ≠ UNKNOWN, sortie non vide) → `normalizeZoneCode` ; collision = une sortie provenant de ≥2 bruts distincts.
3. Cause par NÉCESSITÉ : règle R = cause ssi la retirer re-sépare le groupe. kind=HARMFUL ssi `paren` ∈ causes (retrait de secteur distinct) ; sinon BENIGN (repli du même code).
4. Régression : 15 couples historiques (record 8d3d8b9b) — pure-fonction `normalizeZoneCode(A) ≠ normalizeZoneCode(B)` + croisement données servies (non fusionnés dans la muni). Numéros MESURÉS ; muni illisible notée, jamais devinée.

## Erreurs de lecture

aucune.

