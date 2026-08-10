# Col-20 qc-zoning-events par ville (WP5 v3.4 — recall directionnel immo→geo)

Cohorte : 6 villes (source : work/coverage/zoning-events-cohort-sample6.txt). Source geo : local_file. Source immo : aucune (toutes immo-gt-pending).

Résumé : measured 0 · measured-geo-empty 0 · immo-gt-pending 6. Événements geo émis : 451 sur 5 villes. Match immo→geo : 0/0.

`recall_pct_si_mesurable` = recall directionnel immo→geo (metric Steve) ; `null`/immo-gt-pending quand la vérité-terrain immo manque — jamais un unknown fabriqué.

| Ville | geo_events | immo_gt | matched/immo | recall | statut |
| --- | ---: | :---: | ---: | ---: | --- |
| saint-raymond | 22 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-stanislas | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| sutton | 10 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| coaticook | 5 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-mathieu-de-beloeil | 37 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-eustache | 377 | non | 0/0 | immo-gt-pending | immo-gt-pending |
