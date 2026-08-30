# Revalidation de normalizeZoneCode AJUSTÉE (identité i-infra) — 2026-08-30

**Suite de** `_zones-normalizezonecode-validate-20260830.ts` (commit 29a14334) —
avait trouvé 16 fusions à tort HARMFUL causées par le retrait AVEUGLE d'un
suffixe parenthésé (contenu détruit). i-infra a AJUSTÉ la règle pour ne retirer
que les caractères `(`/`)` et CONSERVER le contenu.

```js
function normalizeZoneCode(raw) {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[–—]/g, "-")                       // unicode dash → ASCII
    .replace(/\(([A-Z0-9]{2,8})\)/g, "$1")       // balanced parens removed, CONTENT kept
    .replace(/\s+/g, "");                          // whitespace
}
```

> ⚠ Évalué UNIQUEMENT sur `normalizeZoneCode` (l'identité). `zoneSearchKey`
> reste VOLONTAIREMENT many-to-one — hors-scope, ni calculé ni signalé ici.

## Verdict

**INJECTIVE for false-merge purposes — 0 HARMFUL false merge, SAFE identity, merge-GO (10 pre-existing BENIGN same-code refold(s) unchanged, not false merges: disraeli--les-appalaches--2/74-ZR[whitespace], laverlochere-angliers/INST1[case], laverlochere-angliers/INST2[case], notre-dame-du-bon-conseil--drummond--2/AVP[case], riviere-au-tonnerre/RA-14[case], saint-ferdinand/137-P[case], saint-robert-bellarmin/REC-2[case], sainte-elisabeth/P-183[case], sainte-elisabeth/P-184[case], ville-marie/RC8[case])**

## Couverture (lecture seule S3 prod `sentropic-geo`, anti-invention)

- clés listées sous `normalized/ca-qc-zonage/` : **2806**
- slugs servis (total) : **873**
- **munis vérifiées : 873 / 873**
- flat-only : 801 · nested-only : 65 · both : 7
- erreurs de lecture : 0

## Régression B — les 16 groupes HARMFUL précédents sont-ils TUÉS ?

Attendu : **oui** (le contenu de secteur, avant détruit, différencie maintenant chaque brut).

**Tous tués : OUI ✓**

| slug | ancienne sortie (fusionnée) | nouvelles sorties | fonction | données |
|------|------------------------------|--------------------|----------|---------|
| la-redemption | `02` | `02 (AGF)`→`02AGF` · `02 (RCT)`→`02RCT` | KILLED ✓ | not-merged-in-data ✓ |
| la-redemption | `20` | `20 (AGF)`→`20AGF` · `20 (FRT)`→`20FRT` | KILLED ✓ | not-merged-in-data ✓ |
| la-redemption | `28` | `28 (AGF)`→`28AGF` · `28 (FRT)`→`28FRT` | KILLED ✓ | not-merged-in-data ✓ |
| la-redemption | `29` | `29 (AIC)`→`29AIC` · `29 (FRT)`→`29FRT` | KILLED ✓ | not-merged-in-data ✓ |
| la-redemption | `33` | `33 (FRT)`→`33FRT` · `33 (LSR)`→`33LSR` | KILLED ✓ | not-merged-in-data ✓ |
| la-redemption | `34` | `34 (CSV)`→`34CSV` · `34 (HBF)`→`34HBF` | KILLED ✓ | not-merged-in-data ✓ |
| padoue | `35` | `35 (AGF)`→`35AGF` · `35 (MTF)`→`35MTF` | KILLED ✓ | not-merged-in-data ✓ |
| saint-donat--la-mitis | `01` | `01 (AGF)`→`01AGF` · `01 (FRT)`→`01FRT` | KILLED ✓ | not-merged-in-data ✓ |
| saint-donat--la-mitis | `02` | `02 (AGC)`→`02AGC` · `02 (AGF)`→`02AGF` · `02 (VLG)`→`02VLG` | KILLED ✓ | not-merged-in-data ✓ |
| saint-donat--la-mitis | `43` | `43 (MTF)`→`43MTF` · `43 (RCT)`→`43RCT` | KILLED ✓ | not-merged-in-data ✓ |
| saint-joseph-de-lepage | `02` | `02 (AGC)`→`02AGC` · `02 (VLG)`→`02VLG` | KILLED ✓ | not-merged-in-data ✓ |
| saint-joseph-de-lepage | `03` | `03 (AGF)`→`03AGF` · `03 (VLG)`→`03VLG` | KILLED ✓ | not-merged-in-data ✓ |
| saint-joseph-de-lepage | `06` | `06 (AGC)`→`06AGC` · `06 (CSV)`→`06CSV` | KILLED ✓ | not-merged-in-data ✓ |
| saint-joseph-de-lepage | `07` | `07 (AGC)`→`07AGC` · `07 (VLG)`→`07VLG` | KILLED ✓ | not-merged-in-data ✓ |
| saint-joseph-de-lepage | `17` | `17 (AGF)`→`17AGF` · `17 (RCT)`→`17RCT` | KILLED ✓ | not-merged-in-data ✓ |
| saint-joseph-de-lepage | `19` | `19 (AGC)`→`19AGC` · `19 (AGF)`→`19AGF` | KILLED ✓ | not-merged-in-data ✓ |

## Régression A — les 15 couples HARMFUL historiques restent-ils distincts ?

Attendu : **oui** (inchangé par ce correctif — séparateurs toujours préservés).

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
| saint-donat--la-mitis | `01 (AGF)` → `01AGF` | `01 AGF)` → `01AGF)` | DISTINCT ✓ | not-merged-in-data ✓ |
| saint-joseph-de-lepage | `01 (AGF)` → `01AGF` | `01 AGF)` → `01AGF)` | DISTINCT ✓ | not-merged-in-data ✓ |

## Collisions PAR-MUNI sous la normalizeZoneCode AJUSTÉE

- groupes de collision (≥2 bruts distincts → même sortie) : **10**
- munis avec ≥1 collision : **8**
- par cause : paren=0 · whitespace=1 · dash=0 · case=9
- HARMFUL : 0 · BENIGN : 10

| slug | couche | nature | cause | sortie | bruts distincts fusionnés |
|------|--------|--------|-------|--------|---------------------------|
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

## Watch clé — nouveau mode de fusion (parenthésé vs natif)

Motif surveillé : un brut parenthésé `X (SECT)` → `XSECT` entre en collision
avec un brut NATIF sans parenthèses `XSECT` déjà présent dans la même muni —
mode IMPOSSIBLE sous l'ancienne règle (qui retombait sur `X`, pas `XSECT`).

**Occurrences : 0**

- aucune.

## Méthode

1. `listObjectEntries` sur `normalized/ca-qc-zonage/` → slugs plat/niché ; couche servie = niché si présent sinon plat (autorité geo-api ; 873 servis).
2. Par muni servie : bruts `zone_code` distincts (trim, non vide, ≠ UNKNOWN, sortie non vide) → `normalizeZoneCode` (AJUSTÉE) ; collision = une sortie provenant de ≥2 bruts distincts.
3. Cause par NÉCESSITÉ : règle R = cause ssi la retirer re-sépare le groupe. kind=HARMFUL ssi `paren` ∈ causes ; sinon BENIGN.
4. Régression A : 15 couples historiques (record 8d3d8b9b) — doivent rester distincts.
5. Régression B : 16 groupes HARMFUL de la sonde précédente (record 29a14334) — doivent être tués.
6. Watch : groupe HARMFUL dont ≥1 brut est SANS parenthèses et ≥1 brut AVEC — nouveau mode de fusion activé par la conservation du contenu.

Numéros MESURÉS ; muni illisible notée, jamais devinée.

## Erreurs de lecture

aucune.

