# Col-20 qc-zoning-events par ville (WP5 v3.4 — recall directionnel immo→geo)

Cohorte : 6 villes (source : work/coverage/zoning-events-cohort-sample6.txt). Source geo : local_file. Source immo : /home/antoinefa/src/radar-immobilier/tmp/handoff/jointures-designation-events-6.ndjson.

Résumé : measured 5 · measured-geo-empty 0 · immo-gt-pending 1. Événements geo émis : 451 sur 5 villes. Match immo→geo : 70/85.

`recall_pct_si_mesurable` = recall directionnel immo→geo (metric Steve) ; `null`/immo-gt-pending quand la vérité-terrain immo manque — jamais un unknown fabriqué.

| Ville | geo_events | immo_gt | matched/immo | recall | statut |
| --- | ---: | :---: | ---: | ---: | --- |
| saint-raymond | 22 | oui | 5/8 | 62.5 % | measured |
| saint-stanislas | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| sutton | 10 | oui | 1/3 | 33.3 % | measured |
| coaticook | 5 | oui | 2/6 | 33.3 % | measured |
| saint-mathieu-de-beloeil | 37 | oui | 12/18 | 66.7 % | measured |
| saint-eustache | 377 | oui | 50/50 | 100.0 % | measured |
