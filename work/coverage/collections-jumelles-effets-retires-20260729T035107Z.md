# Collections jumelles et effets retirés

Mesure UTC: 2026-07-29T03:51:07.640Z. Déploiement redémarré: geo/geo-api, génération observée 20.

- Collections servies: 4248; jumelles par forme: additive-prebackup=226; other=100; other+timestamp=42; subdir+timestamp=23.
- Jumelles portant au moins un `effet_densifiant` non `inconnu`: 15 collections, 179 features.
- OGC post-redémarrage: Sutton CONFIRME (95 features, dont 48 stable + 27 densifie + 10 reduit (85 effets non-inconnu)); Coaticook CONFIRME (RD-104 est servi une fois avec effet_densifiant=densifie).

## Recommandation (non appliquée)

Retirer les collections jumelles plutôt que seulement leurs effets, puis publier un registre immuable collection-id → canonique/version et faire casser les consommateurs sur tout id absent de ce registre; cela casse les résolutions par préfixe/horodatage et tout client qui consommait explicitement un jumeau, mais empêche toute ré-ingestion silencieuse.
