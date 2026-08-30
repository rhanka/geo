# Collision de normalisation des codes de zone servis — 2026-08-30

**Question (immo).** Normaliser la recherche via
`norm(c) = c.toUpperCase().replace(/[^A-Z0-9]/g, "")` (donc `H-101` ≡ `H101`).
RISQUE : fusionner à tort deux zones RÉELLES DISTINCTES dont les codes bruts ne
diffèrent que par des non-alphanumériques supprimés (surtout la POSITION du tiret :
`H-10-1` vs `H-101` ; `P-1A` vs `P1-A`). On cherche ces collisions sur les
codes **réellement servis** en prod (`sentropic-geo`, OVH BHS).

## Verdict

**UNSAFE for 15 muni(s) — these raw codes would wrongly merge distinct zones**

## Couverture (lecture seule S3, anti-invention)

- clés listées sous `normalized/ca-qc-zonage/` : **2806**
- slugs servis (total) : **873**
- **munis vérifiées : 873 / 873**
- flat-only : 801 · nested-only : 65 · both : 7
- erreurs de lecture : 0

## Collisions PAR-MUNI sur la couche SERVIE (autoritatif)

- munis avec ≥1 collision (toute nature) : **23**
- munis avec ≥1 collision **HARMFUL** (fusion de zones distinctes) : **15**
- munis avec collisions **BENIGN uniquement** (casse/espaces — no-op sémantique) : **8**

### HARMFUL — codes bruts distincts qui fusionneraient à tort

| slug | couche | normalisé | codes bruts en collision |
|------|--------|-----------|--------------------------|
| amqui | flat | `51R` | `5.1 R` · `51 R` |
| ascot-corner | flat | `P1` | `P-1` · `P1` |
| cote-saint-luc | nested | `RU65` | `RU*-65` · `RU-65` |
| drummondville | flat | `H1031` | `H-103-1` · `H-1031` |
| franklin | flat | `HA12` | `HA-1-2` · `HA-12` |
| hinchinbrooke | flat | `AF11` | `Af-1-1` · `Af-11` |
| lanoraie | flat | `C18` | `C1-8` · `C18` |
| lanoraie | flat | `R16` | `R1-6` · `R16` |
| mont-saint-hilaire | nested | `C11` | `C-1-1` · `C-11` |
| saint-aime-du-lac-des-iles | flat | `A01` | `A-01` · `A-Î01` |
| saint-aime-du-lac-des-iles | flat | `A02` | `A-02` · `A-Î02` |
| saint-ambroise-de-kildare | flat | `A11` | `A1-1` · `A11` |
| saint-ambroise-de-kildare | flat | `A21` | `A2-1` · `A21` |
| saint-donat--la-mitis | flat | `01AGF` | `01 (AGF)` · `01 AGF)` |
| saint-joseph-de-beauce | flat | `H13` | `H-1.3` · `H-13` |
| saint-joseph-de-beauce | flat | `H14` | `H-1.4` · `H-14` |
| saint-joseph-de-lepage | flat | `01AGF` | `01 (AGF)` · `01 AGF)` |
| saint-narcisse-de-beaurivage | flat | `31H` | `3.1-H` · `31-H` |
| sainte-clotilde | flat | `RA11` | `Ra1-1` · `Ra11` |
| sainte-clotilde | flat | `RA13` | `Ra1-3` · `Ra13` |
| sainte-clotilde | flat | `RA14` | `Ra-1-4` · `Ra14` |
| sainte-clotilde | flat | `RA16` | `Ra1-6` · `Ra16` |

### BENIGN — casse/espaces uniquement (fusion sans perte de distinction réelle)

| slug | couche | normalisé | codes bruts en collision |
|------|--------|-----------|--------------------------|
| disraeli--les-appalaches--2 | flat | `74ZR` | `74 - ZR` · `74-ZR` |
| laverlochere-angliers | flat | `INST1` | `INST1` · `Inst1` |
| laverlochere-angliers | flat | `INST2` | `INST2` · `Inst2` |
| notre-dame-du-bon-conseil--drummond--2 | flat | `AVP` | `AVP` · `AVp` |
| riviere-au-tonnerre | flat | `RA14` | `RA-14` · `Ra-14` |
| saint-ferdinand | flat | `137P` | `137-P` · `137-p` |
| saint-robert-bellarmin | flat | `REC2` | `REC-2` · `Rec-2` |
| sainte-elisabeth | flat | `P183` | `P-183` · `p-183` |
| sainte-elisabeth | flat | `P184` | `P-184` · `p-184` |
| ville-marie | flat | `RC8` | `RC8` · `Rc8` |

## Contexte — collisions GLOBALES cross-muni

Contexte seulement : `zone_code` est scoping-muni, donc le per-muni ci-dessus fait
foi. Une collision entre deux munis différentes n'est **pas** une fusion à tort dans
une recherche immo scopée par muni.

- normalisés provenant de ≥2 bruts distincts (toutes munis servies) : **5312**

## Contexte — couche PLATE NON servie (slugs BOTH)

Le geo-api sert le NICHÉ quand les deux coexistent ; la couche plate de ces slugs
n'est **pas servie**. Rapportée pour complétude seulement — hors verdict.

- munis (plate) avec ≥1 collision : **2**

| slug | nature | normalisé | codes bruts en collision |
|------|--------|-----------|--------------------------|
| gore | BENIGN | `RU1` | `RU-1` · `Ru-1` |
| gore | BENIGN | `RU10` | `RU-10` · `Ru-10` |
| gore | BENIGN | `RU11` | `RU-11` · `Ru-11` |
| gore | BENIGN | `RU12` | `RU-12` · `Ru-12` |
| gore | BENIGN | `RU13` | `RU-13` · `Ru-13` |
| gore | BENIGN | `RU14` | `RU-14` · `Ru-14` |
| gore | BENIGN | `RU15` | `RU-15` · `Ru-15` |
| gore | BENIGN | `RU16` | `RU-16` · `Ru-16` |
| gore | BENIGN | `RU17` | `RU-17` · `Ru-17` |
| gore | BENIGN | `RU18` | `RU-18` · `Ru-18` |
| gore | BENIGN | `RU19` | `RU-19` · `Ru-19` |
| gore | BENIGN | `RU2` | `RU-2` · `Ru-2` |
| gore | BENIGN | `RU20` | `RU-20` · `Ru-20` |
| gore | BENIGN | `RU21` | `RU-21` · `Ru-21` |
| gore | BENIGN | `RU22` | `RU-22` · `Ru-22` |
| gore | BENIGN | `RU23` | `RU-23` · `Ru-23` |
| gore | BENIGN | `RU3` | `RU-3` · `Ru-3` |
| gore | BENIGN | `RU4` | `RU-4` · `Ru-4` |
| gore | BENIGN | `RU5` | `RU-5` · `Ru-5` |
| gore | BENIGN | `RU6` | `RU-6` · `Ru-6` |
| gore | BENIGN | `RU7` | `RU-7` · `Ru-7` |
| gore | BENIGN | `RU8` | `RU-8` · `Ru-8` |
| gore | BENIGN | `RU9` | `RU-9` · `Ru-9` |
| gore | BENIGN | `VI1` | `VI-1` · `Vi-1` |
| gore | BENIGN | `VI10` | `VI-10` · `Vi-10` |
| gore | BENIGN | `VI11` | `VI-11` · `Vi-11` |
| gore | BENIGN | `VI2` | `VI-2` · `Vi-2` |
| gore | BENIGN | `VI3` | `VI-3` · `Vi-3` |
| gore | BENIGN | `VI4` | `VI-4` · `Vi-4` |
| gore | BENIGN | `VI5` | `VI-5` · `Vi-5` |
| gore | BENIGN | `VI6` | `VI-6` · `Vi-6` |
| gore | BENIGN | `VI7` | `VI-7` · `Vi-7` |
| gore | BENIGN | `VI8` | `VI-8` · `Vi-8` |
| gore | BENIGN | `VI9` | `VI-9` · `Vi-9` |
| mont-saint-hilaire | HARMFUL | `C11` | `C-1-1` · `C-11` |

## Méthode

1. `listObjectEntries` sur `normalized/ca-qc-zonage/` → slugs plat / niché.
2. Couche servie par slug = niché si présent sinon plat (autorité geo-api).
3. Par muni servie : bruts `zone_code` distincts (trim, non vide, ≠ UNKNOWN) → `norm()` ;
   collision par-muni = un normalisé provenant de ≥2 bruts distincts.
4. HARMFUL ⟺ bruts encore distincts après upper-case + suppression des espaces
   (⇒ séparateurs/position différents ⇒ vraies zones distinctes). BENIGN sinon.
5. Global cross-muni pour contexte ; par-muni = risque autoritatif (codes scoping muni).
   Numéros MESURÉS ; une muni illisible est notée, jamais devinée.

## Erreurs de lecture

aucune.

