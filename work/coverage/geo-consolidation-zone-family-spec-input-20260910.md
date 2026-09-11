# GEO-consolidation — §3 `zone_family` : INPUT SPEC (mesuré, read-only)

**Contexte** : chantier GEO-consolidation (owner-validé via i-cond, relayé geo-cond).
GEO publie le contrat lot enrichi canonique ; le repli `affectation→kind→code` + provenance
doit se faire **côté GEO** (pas UI). Sol v3 a mesuré : zones servies (Varennes 249/249,
Salaberry 645/645) portent le **vrai `zone_code`** mais **0 kind, 0 affectation**.
**Auteur** : geo-zones (lane acquisition). **Date** : 2026-09-10. **Portée** : INPUT SPEC read-only,
PAS le build, zéro prod. **Anti-invention** : chaque champ ci-dessous est mesuré (réf. fichier:ligne)
ou nommé comme source-gap ; aucune table famille hallucinée.

## §3.0 — État actuel MESURÉ (ce que geo sert déjà)

| Élément | Fait mesuré | Réf. |
|---|---|---|
| Objet zone servi | `zone_code` (VERBATIM brut SIG) + `zone_source_url` + `zone_source_level` (provenance géométrie). **PAS** de `kind`/`affectation`/`zone_family`. | CLAUDE.md provenance ; `lotZoneJoin.ts` (raw `zoneCode`) ; sol v3 |
| Jointure zone⋈norme | clé canonique **`canonicalizeZoneCodeForJoin`** = SEULE source de vérité ; `zonage-norms.ts canonZone` y délègue (0 drift). `zone_code` reste verbatim, la clé de join est dérivée séparément. | `packages/geo/src/zonage/lotZoneJoin.ts:88-133` |
| Norme jointe | `LotZoneNormAssignment.norms: NormsRecord` porte `densite_value`+`densite_unit`, hauteur_*, frontage_*, superficie_*. | `lotZoneJoin.ts:33-37,165-208` ; test `:153` |
| Whitelist normes | **EXCLUT délibérément** affectation/usage/vocation/catégorie (« trop ambigu : codes permis/affectation partagent le nom »). | `zonage-norms.ts:306-311,376,445` |
| Primitive famille existante | **`alphaFamily(canon)`** = run alpha de tête du code canonique (H-12 → "H"). | `zonage-norms.ts:784` |
| Expansion catégorie existante | propage les normes d'une catégorie ALPHA-ONLY (`EAF`,`M`) sur les codes individuels **VERBATIM**, tag provenance **`CATEGORY_EXPANDED_TAG="category-expanded"`** ; STRICT (catégorie C couvre X ssi C = famille alpha EXACTE de canon(X)) ; ne fabrique jamais. | `zonage-norms.ts:673-802,691` |
| Carte famille par muni | `norms-category-map/<slug>.json` mappe les codes aux **familles issues de la LÉGENDE du règlement de la muni** (HABITATION HA/HB, COMMERCE CO…), pas d'une règle universelle. | `acquisition/config/norms-category-map/trois-pistoles.json` |
| Affectation déjà rencontrée | (a) découverte ArcGIS reconnaît `/affectation/i` ; (b) densité **scoped à une affectation** (Varennes PPU, Mont-Tremblant plan) → actuellement REFUSÉE `densite-affectation-sans-code-zone`. | `discover-arcgis.ts:86` ; `densityDocument.ts:904-952` |
| CPTAQ | servi comme OVERLAY `qc-cptaq-zone-agricole` (tag `constraint:"cptaq-zone-agricole"`), membership SPATIALE ; PAS un nœud Zone. Attrs source : Mrc, Date_maj, Zonage. | `packages/geo-sources-americas/src/ca-qc-constraints/cptaq/{manifest,normalizer}.ts` |

## §3.1 — Méthode d'assignation `zone_family` (précédence)

Résolution par précédence FIXE, chaque niveau portant sa propre provenance (voir §3.2) :

1. **affectation-explicite** — si la source SIG/règlement porte un attribut affectation/
   grande-affectation explicite (découverte ArcGIS reconnaît déjà ces couches ; densité
   Varennes/Mont-Tremblant est affectation-scoped). `zone_family` = classe de l'affectation.
   ⚠ **Namespace séparé** : l'affectation vit dans un champ DISTINCT de `zone_code`, JAMAIS
   foldée dans la clé de join (collision mesurée `zonage-norms.ts:306-311`).
2. **kind-explicite** — si la source porte un type/vocation explicite distinct du code.
   Rare en SIG QC → à MESURER par source, jamais supposé.
3. **code-dérivé** — sinon dériver du `zone_code` VERBATIM via **`alphaFamily(canon)`**
   (run alpha de tête : H-12 → clé famille "H"). Le libellé "H"→"Habitation" est un LABEL
   posé sur la famille alpha. ⚠ **Anti-invention** : la table famille-alpha→label n'est PAS
   universelle ; elle vient de la **légende de la muni** (comme `norms-category-map/*.json`
   le fait déjà par-muni) ; à défaut, défaut-convention-QC explicitement tagué provenance
   « dérivé ». JAMAIS de "H"/"R" nu comme label sans légende OU tag « dérivé ».
4. **Agricole (CPTAQ)** — ⚠ **PAS l'étape 4 d'un fallback** : c'est une couche OVERLAY
   parallèle, assignée par membership SPATIALE dans le servi `qc-cptaq-zone-agricole`,
   PAS depuis le code. Un lot peut être à la fois famille "H" (dérivée) ET dans la zone
   agricole CPTAQ. ⇒ CPTAQ est un AXE ADDITIF (dimension overlay), pas une valeur mutuellement
   exclusive de la famille zonage. (Correction proposée au libellé du chantier : traiter
   Agricole-CPTAQ comme axe séparé, pas comme dernier repli.)

## §3.2 — Provenance PAR NIVEAU (champ `zone_family_source`)

Miroir de la discipline provenance existante (`zone_source_level` sur la géométrie,
`CATEGORY_EXPANDED_TAG` sur les normes propagées). Chaque assignation famille porte :

| Niveau | `zone_family_source` (valeur) | Charge utile |
|---|---|---|
| affectation | `"affectation (source explicite)"` | nom+valeur de l'attribut source |
| kind | `"kind (source explicite)"` | nom+valeur de l'attribut source |
| code-dérivé | `"dérivé (préfixe de code)"` | famille alpha + (légende muni \| convention) |
| CPTAQ | `"Agricole (CPTAQ)"` | id contrainte + attr `Zonage` |

Règle : une famille dérivée n'est JAMAIS présentée comme explicite. La provenance est verbatim
ou taguée, jamais silencieuse (« vert par omission = rouge »).

## §3.3 — CRITIQUE : clé densité canonique pour `multifamilial4plus`

**MESURÉ** :
- Clé du contrat normes servi = **`densite_value`** (number) + **`densite_unit`** (string).
  Réf : `fold-norms-to-zonage.ts:34` `DENSITY_FIELDS=["densite_value","densite_unit"]` ;
  `densite-deja-acquise-non-pliee.ts:40` `DENSITY_FIELD="densite_value"` ; whitelists
  `publish-norms-grilles.ts`, `zonage-proof.ts:408`, `norms-manifest-refresh.ts`, `density-document-deposit.ts`.
- **`densiteLogHa` / `densite_log_ha` / `DENSITE_LOG_HA` = 0 occurrence** dans TOUT le repo geo.
  Ce sont des noms upstream/raw ou radar-immobilier, PAS le contrat servi geo.
- `densite` nu existe UNIQUEMENT dans la couche extraction OCR/grille (`grille-*`, `zonage-norms.ts`),
  normalisé en `densite_value`+`densite_unit` par `fold-norms-to-zonage`. Donc raw≠servi.
- radar-api utilise aussi `densite_value` (per geo-cond) → **aligné**.

**STANDARD proposé** : geo sert `densite_value` (number) + `densite_unit` (string) VERBATIM
dans `LotZoneNormAssignment.norms`. C'est déjà le cas — pas de nouveau champ, juste figer le nom.

**⚠ L'UNITÉ N'EST PAS mono-valuée** (mesuré) : `densite_unit` observé ∈ { `"log/ha"`
(logements/hectare), `"logements/terrain"`, `"log/terrain"`, `"ratio"` }.
Réf : `fold-norms-to-zonage.test.ts:18,31` ; `density-document-served-gap.test.ts:83`.
Décisif pour 4+ :
- `logements/terrain` : `densite_value ≥ 4` ⇒ 4+ logements par terrain/bâtiment = DIRECT.
- `log/ha` : c'est une densité par HECTARE, PAS un compte par bâtiment → `densite_value ≥ 4`
  N'IMPLIQUE PAS 4+ logements/bâtiment (une zone 3,5 log/ha peut autoriser 4+ unités/bâtiment).
  Le signal 4+ « par bâtiment » n'est PAS dans la whitelist normes → **source-gap nommé**
  (typologie/usage « nombre de logements par bâtiment »), à mesurer, JAMAIS fabriqué.

**RECOMMANDATION geo-jointures** (prédicat 4+) :
```
is4plus = (densite_unit ∈ {"logements/terrain","log/terrain"}) && densite_value >= 4
```
Pour `densite_unit === "log/ha"` → NE PAS conclure 4+ depuis `densite_value` seul ; requiert un
signal typologie/usage absent aujourd'hui = source-gap (ne pas deviner). **Ne PAS** collapser
en une unité unique (détruirait la sémantique mesurée : le contrat doit servir
`densite_value`+`densite_unit` et geo-jointures branche sur l'unité).

## Ouvertures / à trancher (contrat)
- Noms de champs net-new à figer côté contrat : `zone_family`, `zone_family_source`
  (+ éventuellement `affectation`, `affectation_source` en namespace séparé).
- La table famille-alpha→label : par-muni (légende) prioritaire ; défaut-convention-QC
  tagué « dérivé » — à ratifier (geo-cond/owner) car impacte 1106 munis.
- CPTAQ comme axe overlay additif (pas repli) — à confirmer dans le libellé du chantier.
- Signal « logements par bâtiment » pour 4+ en zones log/ha = source-gap (acquisition future).
