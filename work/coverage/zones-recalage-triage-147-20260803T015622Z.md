# Triage zones recale_missing — 20260803T015622Z

Population fermée : **148** villes (147 `recale_missing` + 1 `unresolved`).

- RECALABLE : **0**
- PAS_DE_CARTE : **0**
- NEEDS_WEB_CHECK : **148**
- Validation : **148 = 148**, partition fermée.

## RECALABLE

Aucune. Aucun ArcGIS `LIVE` dans la population et aucun plan local dans les gisements vérifiés.

## Décision N-A

Aucun `PAS_DE_CARTE` n’est attribué : la passe n’a effectué ni check municipal exhaustif ni requête CDX `matchType=domain`. Selon `e78c725c` / `SPEC_PALIER_RESOLUTION.md`, l’absence de signal positif ne constitue pas une preuve d’absence. Les 148 restent donc `NEEDS_WEB_CHECK`.

Sources engagées : statut `a634175c`, audit URL `ea9297b6`, liveness v1 `05eaa5b6`, gisement `acquisition/src/_ondisk-plan-gisement.ts`.
