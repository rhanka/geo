# SPEC — Exposition MCP de la provenance règlement / normes (immo-mcp)

- **Statut** : v1.0 — contrat **geo-side FIGÉ** ; forme du tool **RÉSOLUE** (i-arch, 2026-09-03, porteur `packages/immo-mcp`).
- **Producteur** : geo (WP3 règlement). **Consommateur** : `@radar/immo-mcp` (i-arch).
- **Date** : 2026-09-03. **as_of données** : palier-167 (audit 2026-08-16, coverage 2026-08-30).

## 0. Objet & périmètre

Ce spec fige le **contrat geo-side** que le tool `immo-mcp` expose sur la provenance
règlement :

- (a) grille de normes servie `normalized/qc-zonage-norms/qc-zonage-norms-<slug>.geojson` ;
- (b) events de cycle de vie `qc-zoning-events-<slug>`.

Il **ne prescrit pas** l'implémentation du tool (framework, signatures, transport) —
c'est le domaine d'i-arch (§4, décisions ouvertes). geo est le **seul producteur** de
ces collections ; immo **lit** (jamais n'écrit ; geo ne touche jamais le graphe immo).

## 1. Contrat NORMES — `qc-zonage-norms-<slug>` (feature-level)

Source de vérité : `acquisition/src/publish-reglement-provenance.ts` (`FIELDS`, 8 champs
figés) + registre `acquisition/config/reglement-provenance.json`. Chaque feature porte
**exactement** ces 8 champs (passthrough verbatim ; champ inconnu = `null`, jamais deviné) :

| champ | type | sémantique |
|---|---|---|
| `reglement_numero` | `string\|null` | n° du règlement courant |
| `reglement_millesime` | `string\|null` | millésime — **uniquement** registre curé, jamais dérivé d'un numéro |
| `reglement_page_source` | `string\|null` | page source — **uniquement** registre curé |
| `reglement_url` | `string\|null` | URL publique (curé `??` miné de `_source_url`) |
| `reglement_ancien_numero` | `string\|null` | n° du règlement de base modifié (relation « modifie X ») |
| `reglement_ancien_millesime` | `null` | **jamais inféré en v1** (toujours `null`) |
| `reglement_ancien_source` | `string\|null` | source de l'ancien |
| `has_ancien` | `boolean` | présence d'un règlement de base |

**Non exposé** : `_source_url` / `_reglement` (breadcrumbs internes de capture ; source du
fold `reglement_url ← _source_url`, `reglement_numero ← _reglement`). Le tool **ne doit pas**
les surfacer — seul `reglement_url` est le champ URL public.

**Distinction de provenance** (à ne pas confondre) :
- provenance **normes** = `reglement_url` (+ 7 champs ci-dessus), sur `qc-zonage-norms` ;
- provenance **géométrie** = `zone_source_url` / `zone_source_level`, sur `qc-zonage-<slug>` (domaine geo-zones) ;
- provenance **events** = `provenance.source_url`, sur `qc-zoning-events-<slug>` (§2).

Il n'existe **aucun** champ public `source_url` sur la grille de normes.

## 2. Contrat EVENTS — `qc-zoning-events-<slug>`

Source : `acquisition/src/zoning-events-emit.ts` (origin/main). Schéma canonique complet :
`docs/spec/SPEC_QC_ZONING_EVENTS_V2.md` (v2.1 + axes lifecycle #286/#294) — **ce spec-ci
ne re-fige pas** le schéma event, il énumère ce que le tool MCP surface :

- **Cœur** : `event_id`, `version`, `supersedes`, `state` (`active|corrected|retracted`),
  `muni`, `bylaw_numero` (verbatim corps art. 1.1 ; `string\|null`), `type` (taxonomie
  neutre), `date_iso` (`YYYY-MM-DD`), `detection_state`, `zone_codes_resolus[]`,
  `zone_codes_non_resolus[]`, `nb_unites_max` (`int\|null`, verbatim),
  `effet_densifiant_ref` (**pointeur** `{collection, zone_code}`), `url_pdf`,
  `extrait_brut` (span preuve), `confidence`,
  `provenance` `{producer, source_span, source_url, as_of_date}`.
- **Axes lifecycle** (#286/#294) : `document_type`
  (`avis_motion|projet_reglement|adoption|entree_en_vigueur|abrogation|null`),
  `type_instrument` (`zonage|lotissement|construction|plan-urbanisme|piia|derogation|'unknown'|null`),
  `reglement_number` (`(string\|null)[]`), `cible_reglement_numero` (`string\|null`, **réservé à
  `avis_motion`**), `libelles_relation` (`string[]`), `declencheur_type` (`…|null`),
  `decision_state` (`planned|decided|null`).

**3 axes orthogonaux** : `document_type` (étape bylaw) ⊥ `type_instrument` (instrument
déclaré) ⊥ `decision_state` (planifié/décidé). Le tool ne doit pas les collapser.

## 3. INVARIANTS anti-invention (le tool DOIT les préserver en surface)

1. **verbatim-ou-null** : un champ absent = `null`, jamais deviné/dérivé.
2. `reglement_millesime` + `reglement_page_source` viennent **uniquement** du registre
   curé — jamais dérivés d'un numéro de règlement.
3. **`_source_url` jamais exposé** (breadcrumb interne) ; seul `reglement_url` est public.
4. **`decision_state` : `planned` ≠ `decided`** ; un `planned` n'est jamais présenté comme
   adopté / décidé.
5. `effet_densifiant_ref` = **pointeur** `{collection, zone_code}` — la valeur normative de
   densité vit sur `qc-zonage-<slug>`, jamais dupliquée dans l'event.
6. `score_confiance = 1.0` = match **exact** only (`provenance = exact_geom`) ; une mention
   non résolue va dans `zone_codes_non_resolus` avec une **raison nommée**, jamais un score bas.

## 4. Forme du tool — DÉCISIONS RÉSOLUES (i-arch, 2026-09-03, porteur `packages/immo-mcp`)

Tranchées par i-arch (porteur du tool immo-mcp) ; alignées sur les recos geo. Le tool
préserve en surface les 6 invariants du §3 (acceptés tels quels).

- **4.1 Chemin d'accès data** — **normes** : réutilise les services immo existants
  (`api/src/services/geo/`, provenance déjà foldée `qc-lots-<slug>.zone.reglement{Numero,
  Millesime,PageSource,Url}` — même seam que PR#1, 0 duplication). **Events** : non foldés →
  **nouveau client immo `qc-zoning-events`** (accès dédié, feature-level).
- **4.2 Surface du tool** —
  - Tool #1 : **`get_reglement_provenance(muni_slug, zone_code?)`** → provenance normes +
    events liés d'une zone (cas first-visible).
  - Tool #2 (follow-on) : **`query_zoning_events({muni, zone_code?, document_type?,
    decision_state?})`** → timeline lifecycle.
- **4.3 Clé de liaison event ↔ zone** — `zone_codes_resolus[].zone_code` (match **exact** ;
  `target_type` `Zone|Lot`).
- **4.4 Granularité de retour** — **feature-level** (par zone, comme le fold `qc-lots`),
  sans rollup muni.

**Ordre de build** (i-arch) : merge PR#1 (#568) → tool #1 `get_reglement_provenance`
(normes, réutilise l'existant) → tool #2 events (nouveau client). L'impl du tool est
postérieure au merge PR#1.

**Livrable geo en attente** : le **contrat validateur exact** (rejets / gates de
`validateZoningEvent` — quels champs d'event sont hard-rejetés et pourquoi) sera fourni par
geo (WP3) quand i-arch attaque `query_zoning_events`, sur ping. Réf.
`acquisition/src/zoning-events-emit.ts` (`validateZoningEvent`).

## 5. Provenance de mesure (traçabilité — aucun champ inventé)

- Normes : `acquisition/src/publish-reglement-provenance.ts` (`FIELDS`, `resolveProv`).
- `_source_url` interne + fold : `acquisition/src/reglement-url-served-audit.ts`
  (`observeServedUrl`, lecture `reglement_url` vs `_source_url`).
- Events : `acquisition/src/zoning-events-emit.ts` (origin/main, `buildReglementEvent`) ;
  schéma canonique `docs/spec/SPEC_QC_ZONING_EVENTS_V2.md`.
- Coverage / servi (as_of) : `work/coverage/reglement-url-served-audit-palier167-*.json`
  (136 grilles servies / 117 munis URL http reglement, palier-167),
  `work/coverage/reglement-url-coverage-palier167-20260830.json` (119/167 complete).
