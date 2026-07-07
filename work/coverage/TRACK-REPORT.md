FAIT
scope                        avancement        dernières actions                          
──────────────────────────   ───────────────   ───────────────────────────────────────────
global                       2821/4303 (66%)   2821 items faits; poursuivre les WP ouverts

WP1 · couche: cadastre       2/2 (100%)        WP clos; preuve/acceptance enregistrée     

WP2 · couche: role-foncier   2/2 (100%)        WP clos; preuve/acceptance enregistrée     

À-FAIRE
WP                                    avancement        à faire                                                                 
───────────────────────────────────   ───────────────   ────────────────────────────────────────────────────────────────────────
WP3 · couche: zones                   761/1106 (69%)    zones/agol-account · abercorn [to-research] — Zonage via compte AGOL /  
                                                        ArcGIS Hub (FeatureServer ville) / zones/agol-account · acton-vale      
                                                        [to-research] — Zonage via compte AGOL / ArcGIS Hub (FeatureServer ↳ détail --flat

WP4 · couche: normes                  554/1106 (50%)    normes/pdf-native · abercorn [to-research] — Normes — grille extraite du
                                                        PDF natif (texte/tableau) / normes/pdf-native · adstock [to-research] — 
                                                        Normes — grille extraite du PDF natif (texte/tableau) (+550 autres)     

WP5 · couche: pv                      1040/1106 (94%)   pv/scraper-configured · baie-sainte-catherine [to-research] — PV —      
                                                        scraper configuré pour le CMS de la ville (ALL_PV_CITIES) /             
                                                        pv/scraper-configured · belleterre [to-research] — PV — scraper ↳ détail --flat

WP6 · couche: pmtiles                 0/1 (0%)          pmtiles/derive-province · AGRÉGAT 1106 ville(s) [planned] — PMTiles —   
                                                        dérivé des couches province (build tuiles per-muni)                     

WP7 · LOT 0 — Fondations & contrats   0/5 (0%)          WP0.1 — GeometryKernel (interface + adapters turf/proj4/GEOS-WASM) +    
(geo-lib)                                               corpus golden géométrie / WP0.2 — StreetGraph: modèle multigraphe dirigé
                                                        (CRS, géométries, poids) + contrats sérialisation (+3 autres)           

WP8 · zones-reacquire — SIG           0/13 (0%)         zones-reacquire · boischatel — SIG sans codes de zone (sig=0 ext=29     
affectation/millésime disjoint                          overlap=0) → ré-acquérir vrai zonage municipal / zones-reacquire ·      
(ré-acquérir vrai zonage municipal)                     charlemagne — SIG affectation (sig=1 ext=47 overlap=0) → ré-acquérir ↳ détail --flat

WP9 · immo-lots-enrichment            462/962 (48%)     immo-lots adresse · acton-vale — adresse present on 100% of served lots 
                                                        / immo-lots adresse · adstock — adresse present on 100% of served lots  
                                                        (+498 autres)                                                           

DÉCISIONS/ACTIONS
scope/gate       sujet                                                                      préconisation                                   
──────────────   ────────────────────────────────────────────────────────────────────────   ────────────────────────────────────────────────
WP5.1            pv/scraper-configured · charette [planned] — PV — scraper configuré pour   action (subagent): terminer l'incrément en cours
                 le CMS de la ville (ALL_PV_CITIES)                                                                                         

WP6.1            pmtiles/derive-province · AGRÉGAT 1106 ville(s) [planned] — PMTiles —      action (subagent): terminer l'incrément en cours
                 dérivé des couches province (build tuiles per-muni)                                                                        

spec-not-ready   zones/agol-account · abercorn [to-research] — Zonage via compte AGOL /     action (subagent): spécifier avant de démarrer  
                 ArcGIS Hub (FeatureServer ville)                                                                                           

spec-not-ready   normes/pdf-native · abercorn [to-research] — Normes — grille extraite du   action (subagent): spécifier avant de démarrer  
                 PDF natif (texte/tableau)                                                                                                  

spec-not-ready   WP0.1 — GeometryKernel (interface + adapters turf/proj4/GEOS-WASM) +       action (subagent): spécifier avant de démarrer  
                 corpus golden géométrie                                                                                                    

spec-not-ready   zones-reacquire · boischatel — SIG sans codes de zone (sig=0 ext=29        action (subagent): spécifier avant de démarrer  
                 overlap=0) → ré-acquérir vrai zonage municipal                                                                             

spec-not-ready   immo-lots adresse · acton-vale — adresse present on 100% of served lots    action (subagent): spécifier avant de démarrer  

spec-not-ready   immo-lots code_postal · baie-comeau — code_postal present on 100% of       action (subagent): spécifier avant de démarrer  
                 served lots                                                                                                                

spec-not-ready   immo-lots folded-normes · acton-vale — folded normes present on 100% of    action (subagent): spécifier avant de démarrer  
                 served lots                                                                                                                

RECOMMANDATION
Avancer par premier item ouvert, enregistrer preuve/acceptance, et escalader uniquement les décisions réellement bloquantes.
