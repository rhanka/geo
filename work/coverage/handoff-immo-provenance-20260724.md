# Handoff Immo — provenance de géométrie de zone (`zone_source_url` / `zone_source_level`)

**De :** geo. **À :** immo. **Date :** 2026-07-24.
**Contrat :** `docs/spec/immo-zone-lot-provenance-api-20260724.md` (nouveau,
complète `docs/spec/immo-zone-lot-provenance-api-20260722.md`).

## État

- 870 / 871 collections `qc-zonage` servies portent désormais
  `zone_source_url` (string ou `null`) et `zone_source_level` (enum) sur
  leurs features.
- 529 avec une URL source réelle. 341 avec `null` honnête (source non
  conservée — pas une erreur). 1 collection (`les-cedres`) sans stamp car
  vide (0 feature). 0 erreur de lecture.
- Vérifié par relecture directe des objets S3 servis (pas seulement les logs
  de dépôt) : `work/coverage/zone-source-readback-audit-20260724.json`.
- Écriture strictement additive : géométrie et bloc `proof` inchangés sur
  toutes les features touchées (liste blanche de clés côté producteur).

## Comment lire les champs

- `zone_source_url: string | null` — URL de la source géométrique réelle
  (SIG/ArcGIS/AGOL/WFS/GeoNet/JMap, GeoPDF ou plan officiel). `null` = aucune
  source conservée, transparence assumée, **pas une erreur**.
- `zone_source_level` — un des 5 : `historical-verified`,
  `legacy-traceable`, `candidate`, `orphan`, `unknown`.
  - Seul `historical-verified` peut être présenté comme « source vérifiée ».
  - `legacy-traceable` = lignée historique connue (souvent avec une vraie
    URL) mais **pas une preuve courante**.
  - `candidate` = source officielle établie pour la municipalité, mais
    filiation octet non prouvée ; **dans les faits, `zone_source_url` est
    quasi toujours `null` pour ce niveau** dans les données servies
    aujourd'hui.
  - `orphan` = aucune source retenue.
  - `unknown` = non évalué (0 occurrence servie actuellement, mais à gérer
    par tout parseur strict).
- Règle d'affichage impérative : toujours montrer le niveau à côté de l'URL
  (jamais l'URL seule) ; ne jamais présenter `legacy-traceable`/`candidate`
  comme vérifié ; ne jamais masquer une zone à cause de `orphan`/`unknown`
  (même politique de non-blackout que le contrat 20260722 §6).

## Les 3 axes restent séparés — ne pas les fusionner

| Axe | Champ(s) | Répond à |
|---|---|---|
| Géométrie de zone | `zone_source_url` / `zone_source_level` | D'où vient le polygone ? |
| Réglementaire | `reglement_url`, `reglement_numero`, `reglement_millesime` | Quel règlement documente la zone ? |
| Jointure lot↔zone | `assignment_method` (contrat 20260722) | Pourquoi ce lot est-il rattaché à cette zone ? |

Exemple réel qui illustre pourquoi la séparation est nécessaire : Chelsea a
une provenance réglementaire forte (règlement 1215-22, Annexe 2, URL et
SHA-256 connus) mais sa géométrie de zone reste `orphan` /
`zone_source_url: null` — les deux axes ne se déduisent pas l'un de
l'autre. Ne jamais copier une URL de règlement dans `zone_source_url`.

## Demande à Immo

Merci de fournir la **liste Steve 10/10 → 6/10 (+ B')** pour qu'on puisse
prioriser les collections `candidate`/`orphan`/`legacy-traceable` restantes
selon l'usage réel côté Immo plutôt qu'à l'aveugle. Sans cette liste, la
suite de la remontée en niveau de preuve se fait par ordre alphabétique de
slug, ce qui n'est probablement pas ce qui compte le plus pour vous.

## Références

- Contrat détaillé : `docs/spec/immo-zone-lot-provenance-api-20260724.md`
- Contrat enveloppe (non implémenté) : `docs/spec/immo-zone-lot-provenance-api-20260722.md`
- Audit readback : `work/coverage/zone-source-readback-audit-20260724.json`
- Producteur du fold : `acquisition/src/fold-zone-source-provenance-to-zonage.ts`
- Gate d'écriture additive : `acquisition/src/lib/zonage-proof.ts` (`putServedZoneAdditive`)
