# Provenance règlement — SHARD 0/2

Date: 2026-07-18T10:58:37.633Z

## Avant / après

- Périmètre strict: 148 slugs dont l’index dans la liste triée des villes reglement=false est pair.
- Avant: la matrice de couverture les indique tous reglement=false; le registre curé contenait déjà les 148 décisions (28 numéros prouvés, 120 null).
- Après: les 10 collections qc-zonage-* réellement présentes avec un numéro ont été foldées et vérifiées par API; chaque fold indique cellsChanged=0, donc les quatre champs étaient déjà servis et conformes.
- 18 numéros prouvés ne sont pas propagables: le fold répond polygone qc-zonage non servi. Les 120 null restent strictement non stampés.

## Collections servies et vérifiées

| Slug | Numéro API | Millésime registre | Page | Résultat fold |
| --- | --- | --- | --- | --- |
| charette | 2023-02 | 2023 | 3 | OK, cellsChanged=0 |
| duhamel | 2023-04 | null | 1 | OK, cellsChanged=0 |
| fassett | 2023-16 | 2023 | 3 | OK, cellsChanged=0 |
| notre-dame-du-sacre-coeur-dissoudun | 2007-06 | null | 9 | OK, cellsChanged=0 |
| roberval | 2018-09 | null | 2 | OK, cellsChanged=0 |
| saint-damien | 753 | 2017 | 2 | OK, cellsChanged=0 |
| saint-polycarpe | 218-2025 | null | 1 | OK, cellsChanged=0 |
| sainte-beatrix | 526-2012 | 2012 | 10 | OK, cellsChanged=0 |
| sainte-emelie-de-lenergie | 15RG-0712 | 2013 | 1 | OK, cellsChanged=0 |
| sainte-melanie | 673.1-2024 | null | 5 | OK, cellsChanged=0 |

## Numéros prouvés, collection de polygones absente

| Slug | Numéro | Millésime | Motif verbatim du fold |
| --- | --- | --- | --- |
| beaconsfield | 720 | null | polygone qc-zonage non servi |
| beloeil | 1667-00-2011 | 2012 | polygone qc-zonage non servi |
| bois-des-filion | 7200 | 2018 | polygone qc-zonage non servi |
| lile-cadieux | 196 | 2021 | polygone qc-zonage non servi |
| lorraine | URB-03 | 2010 | polygone qc-zonage non servi |
| marieville | 1066-05 | 2005 | polygone qc-zonage non servi |
| napierville | Z2019 | null | polygone qc-zonage non servi |
| pointe-des-cascades | 121 | null | polygone qc-zonage non servi |
| saint-blaise-sur-richelieu | 546-23 | null | polygone qc-zonage non servi |
| saint-cyprien-de-napierville | 452 | 2018 | polygone qc-zonage non servi |
| saint-isidore--roussillon | 160-2007 | 2007 | polygone qc-zonage non servi |
| saint-jean-sur-richelieu | 0651 | null | polygone qc-zonage non servi |
| saint-marc-sur-richelieu | 3-2011 | null | polygone qc-zonage non servi |
| saint-urbain-premier | 476-24 | null | polygone qc-zonage non servi |
| sainte-anne-de-bellevue | 874 | null | polygone qc-zonage non servi |
| sainte-marthe-sur-le-lac | URB-2025-1400 | null | polygone qc-zonage non servi |
| terrebonne | 1001 | null | polygone qc-zonage non servi |
| vaudreuil-sur-le-lac | 300 | null | polygone qc-zonage non servi |

## Villes laissées à null — raison verbatim

### amos

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le doc local (grille-original.pdf, 550 p) est un recueil de grilles nues: p1 = «#A) Zones agricoles « A-1 » / GRILLE DE SPECIFICATIONS / ZONE A-1 / Numéro de colonne...». Aucun numero de reglement, ni en entete, ni en pied, ni en note, sur toute l'etendue sondee. Defaut de DECOUVERTE (il manque le corps du reglement), pas d'extraction.

### armagh

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE (mesure $0, 2026-07-17): (a) aucun PDF local dans work/zonage-norms/armagh/, (b) aucune URL ouvrable — ni au manifest, ni sur la grille servie (_reglement-targets --shard 1/2 => «cibles avec URL source=0»). Le doc ayant servi a extraire 1 zone (mistral-vision) n'a pas ete conserve et sa provenance n'a pas ete enregistree. Rien n'a ete LU => aucun stamp. ETAPE = lane normes-discovery; RE-OUVRIR avec --overwrite des qu'un doc est telecharge.

### authier-nord

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ABORT gate => null. MISMATCH DE PROPRIETAIRE: le PDF depose dans work/zonage-norms/authier-nord/ est le reglement d'une AUTRE municipalite. Il se declare exclusivement d'AUTHIER, jamais d'Authier-Nord: p1 «MUNICIPALITÉ D’AUTHIER», p3 «DE L'ORIGINAL DU RÈGLEMENT DE ZONAGE DE LA MUNICIPALITÉ D’AUTHIER», p5 «Municipalité d’Authier — Règlement de zonage numéro 2025-05». Authier et Authier-Nord sont 2 municipalites DISTINCTES (MRC d'Abitibi-Ouest). Stamper 2025-05 (adopte le 3 juin 2025, en vigueur le 4 août 2025) sur authier-nord serait une fausse provenance. SIGNAL (hors lane P0_1): contamination croisee du corpus — verifier si le slug `authier` existe et si CE doc est le sien (il est complet, 137 p, et immediatement exploitable pour lui).

### baie-durfe

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le PDF servi est une grille: p1 «GRILLE DES SPÉCIFICATIONS / Annexe 2 du Règlement de zonage / Baie-D'Urfé», sans numero du reglement parent. Le «1110» du nom de fichier n'est pas une preuve et n'est pas retenu.

### baie-trinite

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: AUCUNE SOURCE: le source_url du manifest vaut litteralement «non-disponible» (grille deposee par vision sans URL). Aucun document a lire => null.

### bristol

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: HOLD null: le doc porte DEUX numeros CONTRADICTOIRES et rien ne permet de trancher a $0 => ne rien stamper plutot que risquer une fausse provenance. (a) Couverture et entete de CHAQUE page: «Zoning By-law - Number 312A.1» / «- Zoning By-Law number 312A.1 - The French version is the only official version -». (b) Le CORPS dit 264, deux fois et independamment: art.1.1 TITLE OF THE BY-LAW «The present By-law is known as "Zoning By-law number 264" of the Municipality of Bristol.» et art.1.4 REPLACED BY-LAW «The Zoning By-law of the Municipality of Bristol, designated as number 204, its amendments and the plans which are included, are abrogated and replaced by the present By-law: Zoning By-law number 264.» (204 = ancien, abroge). Lecture probable: 312A.1 = version codifiee/amendante estampillee en entete, 264 = le reglement lui-meme (l'art.1.1 fait foi par doctrine). NON TRANCHE: si 312A.1 avait remplace 264, l'art.1.4 le dirait. ETAPE = confirmation ville/MRC Pontiac. Millesime introuvable de toute facon: chap.7 BRINGING IN FORCE = «will come into force once all procedures under the law are fulfilled», sans date.

### candiac

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: AUCUNE SOURCE: le source_url du manifest vaut litteralement «non-disponible» (grille deposee par vision sans URL). Aucun document a lire => null.

### cheneville

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: DOC MUET: PDF = 2 pages de grille d'usages (texte natif OK, 4357 car.), seule mention datee «Date: Juin 2016». Recherche plein texte: 0 occurrence de «reglement» => aucun numero verbatim disponible dans le document servi => null.

### clerval

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: MAUVAIS REGLEMENT (bonne muni) => null. CORRIGE le _note precedent, qui tenait null sur «scan illisible / route vision requise» et renvoyait donc a une depense OCR: cette depense serait PERDUE, car le doc ne portera JAMAIS le numero de zonage. Le scan a ete LU A $0 (`pdftoppm -r 120 -png` p1-p2 + vision de l'agent, sans OCR payant). CE QU'IL EST, verbatim: p1 = page-titre «RÈGLEMENT DE CONSTRUCTION / NUMÉRO 84» (foliotage imprime «32»); p2 = «CHAPITRE NO 3 / RÈGLEMENT DE CONSTRUCTION / SECTION NUMÉRO 1 DISPOSITIONS DÉCLARATOIRES», art. 3.1.1 TITRE verbatim: «Le titre du présent règlement est "Règlement concernant la construction dans la municipalité de Clerval" et peut être cité sous le nom de "Règlement de construction" ou "Règlement numéro 84".» (foliotage imprime «33»). => 84 est le reglement de CONSTRUCTION, a ECARTER pour la provenance ZONAGE (meme famille que saint-hilaire-de-dorset/229-2018 = comite consultatif d'urbanisme, et saint-pierre-de-lamy/2022-005 = plan d'urbanisme: un numero parfaitement lisible mais du MAUVAIS reglement). GATE PROPRIETAIRE: PASSE (art. 3.1.1 + art. 3.1.4 «l'ensemble du territoire soumis à la juridiction de la municipalité de Clerval»); le blocage n'est ni la lisibilite ni le proprietaire. CE QUI MANQUE: le doc local (7 p) n'est qu'un FRAGMENT — le «CHAPITRE NO 3» d'une codification d'urbanisme dont le foliotage imprime commence a 32; le reglement de ZONAGE est un AUTRE chapitre de cette codification, absent du dossier. art. 3.1.3 confirme que 84 n'abroge que du construction: «Le présent règlement abroge et remplace en entier, tous les règlements ou dispositions antérieurs ayant trait à la construction, ainsi que le règlement numéro 50.» ETAPE = chapitre ZONAGE de la codification de Clerval (defaut de DECOUVERTE); NE PAS OCRiser ce PDF.

### coaticook

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION: le reglement de zonage consolide en vigueur est intitule (art.1.1) «Règlement de zonage de la ville de Coaticook» SANS numero. Le «6-1» du chemin d'URL (Zonage-no6-1-2002) est le règlement numero 6-1 ABROGE (art.1.4, ancien zonage pre-fusion Coaticook/Barford/Barnston). Aucun numero verbatim disponible => null.

### crabtree

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: DOC MUET: en-tete «Annexe 2 du Reglement de zonage» sur les 72 p, mais 0 occurrence d'un numero (recherche plein texte «zonage <num>» = 0 page). Le «va-2024-421» du nom de fichier est un candidat NON RETENU (gate) => null.

### denholm

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: null MAINTENU mais RAISON CORRIGEE — l'ancien _note («AUCUN DOC A LIRE: le source_url du manifest est la page d'accueil https://www.denholm.ca, pas un document») est PERIME: un PDF est desormais sur le disque, `work/zonage-norms/denholm/grille.pdf` (134 p, texte natif), et c'est le BON doc — le corps du reglement de zonage de la BONNE muni (p1 verbatim: «CHAPITRE 4 : RÈGLEMENT DE ZONAGE / MUNICIPALITÉ DE DENHOLM»). Le null tient pour une raison TOUT AUTRE: le document ne PORTE PAS son numero — CARTOUCHE VIDE, p1 verbatim «RÈGLEMENT NUMÉRO __________ / ENTRÉE EN VIGUEUR __________» (blancs typographiques litteraux), repris en en-tete de chaque page de la table des matieres «RÈGLEMENT DE ZONAGE NO. ___________». Meme signature que tres-saint-redempteur (projet a cartouche vide). PIEGE ECARTE: «02-93» est le seul numero du doc et il est tentant, mais c'est le reglement ABROGE — verbatim: «Le présent règlement de zonage remplace, à toutes fins que de droit, le règlement numéro 02-93, ainsi que [ses amendements]». Blocage = le doc est une refonte non encore numerotee/adoptee; il faut la version ADOPTEE (cartouche rempli) pour trancher, pas une re-lecture de celle-ci. Motif [[null-verdict-perime-par-depot-amont]]: la raison a ete re-ecrite pour que le prochain agent ne re-teste pas le mauvais motif (le disque a bouge, l'URL non).

### disraeli--les-appalaches--2

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: AUCUNE SOURCE: le source_url du manifest vaut litteralement «non-disponible» (grille deposee par vision sans URL). Aucun document a lire => null.

### east-broughton

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: FRAGMENT SANS COUVERTURE => null. CORRIGE le motif du _note precedent, qui concluait «Defaut d'EXTRACTION (route vision), pas de decouverte» — trompeur dans les DEUX sens: (a) la route vision se fait A $0 ici (`_pdf-page-png.ts` @150 dpi + vision de l'agent) et elle a ete FAITE, donc aucun OCR paye ne debloquera ce slug; (b) le blocage est bien un defaut de DECOUVERTE, pas d'extraction. MESURE: les QUATRE PDF locaux (grille.pdf, reglement.pdf, websrc.pdf, zonages-usages-generaux.pdf) font tous 16 p et sont le MEME FRAGMENT DUPLIQUE sous 4 noms — `reglement.pdf` p1 et `zonages-usages-generaux.pdf` p1 rendent une image IDENTIQUE. Ce fragment n'est PAS le debut du reglement: sa 1re page porte le folio «23» et demarre en plein milieu du corps — verbatim «CHAPITRE 3 / DIVISION DU TERRITOIRE / 3.1 DIVISION DU TERRITOIRE EN ZONES (modifié par 98-034)». Il n'y a donc ni couverture, ni article «Numéro et titre du règlement», ni cartouche d'adoption dans le corpus: le numero de la base n'y est PAS, et ne peut pas y etre. ECARTE 98-034: c'est le numero d'un AMENDEMENT ayant modifie l'art. 3.1 (forme «(modifié par NNN)» en titre de section), pas le reglement de zonage lui-meme. Le doc ne NOMME jamais sa muni non plus (dit «la Municipalité») => gate proprietaire NON evaluable sur ce fragment. ETAPE = decouvrir les pages 1-22 du corps (ou le doc complet) chez East Broughton; NE PAS re-OCRiser ces 4 PDF (ils seraient payes 4x pour le meme fragment sans numero). Coherent avec la memoire shard0/2: east-broughton terminal cote normes.

### escuminac

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null MAINTENU, mais la RAISON du null precedent est PERIMEE et corrigee ici. L'ancienne note disait «aucun PDF dans work/zonage-norms/escuminac/ (NO-LOCAL-PDF mesure). Rien a lire»: une lane amont a depuis depose annexe2-grilles.pdf (le disque a bouge PENDANT cette passe — mesure NO-LOCAL-PDF puis LOCAL=1 a ~20 min d'intervalle). Le doc a ete lu en PLEIN TEXTE ($0): c'est une GRILLE NUE anonyme qui ne numerote jamais son reglement. Verbatim p1: «GRILLES DE SPÉCIFICATIONS   MUNICIPALITÉ D'ESCUMINAC» et unique occurrence du motif sur tout le doc, l.874: «ANNEXE II - GRILLES DE SPÉCIFICATIONS   MUNICIPALITÉ D'ESCUMINAC» — zero occurrence de «règlement numéro N» / «entrée en vigueur». Le proprietaire est OK, c'est le NUMERO qui est absent du document. CANDIDAT ECARTE: «2021-003», lisible dans le NOM DE FICHIER du source_url manifest («...Mun Esc LL R 2021-003 Zonage Annexe 2 Grilles de spcifications adopt FUSIONN mj.pdf») — le numero d'une URL n'est jamais une lecture (piege prouve ~1/4 sur ce corpus) et il est ABSENT du contenu. ETAPE = decouverte du CORPS du reglement.

### fort-coulonge

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: HOLD null: CONFLIT DE NUMEROS INTERNE NON LEVE (famille bristol). Proprietaire OK (66 occurrences «Fort-Coulonge» = le slug, «MUNICIPALITÉ DU VILLAGE DE FORT-COULONGE» p1). Mais le doc porte DEUX numeros pour LE MEME reglement de zonage: (a) couverture p1 verbatim «Règlement no2004-202: (modifié remplaçant règlement no. 156, adopté le 5 juillet 1991) / Règlement de zonage / Adopté le 1er décembre 2004 / Mise à jour 17 septembre 2012 (incluant l'amendement numéro 2012-228» => le zonage en vigueur = 2004-202, et le 156 est l'ANCIEN (1991) qu'il remplace; (b) l'art. 1.1 TITRE DU RÈGLEMENT p2 verbatim «Le présent règlement numéro 156 a été adopté à la réunion du Conseil de la Corporation municipale du Village de Fort-Coulonge du 1er décembre 2004. Ce règlement peut être cité sous le nom de ''Règlement de zonage''.» — l'art. 1.1 fait foi par doctrine (cf. bristol), et il dit 156. NON TRANCHE, et l'art. 1.1 est de surcroit AUTO-CONTRADICTOIRE avec la couverture sur la date meme du 156 (5 juillet 1991 en p1 vs 1er décembre 2004 en p2): la lecture probable est un reste de gabarit non renumerote lors de la refonte 2004, mais «probable» n'est pas verbatim. Les deux sources s'accordent en revanche sur la date d'adoption du reglement EN VIGUEUR: 1er décembre 2004 (=> millesime 2004 des que le numero sera tranche). ETAPE = piece officielle (avis d'entree en vigueur / certificat MRC Pontiac).

### franquelin

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: HOTE INJOIGNABLE: «https://municipalites-du-quebec.ca/franquelin/pdf_reglements/2025-03_Reglements de zonage.pdf» ne repond pas (curl http=000, timeout). Meme famille d'hote que berry/elgin (municipalites-du-quebec) => panne d'hote, pas absence de doc. Voie = re-essai quand l'hote repond.

### gallichan

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le doc local n'est PAS un reglement: grille.pdf est le BULLETIN MUNICIPAL de Gallichan de «M AI 2 0 1 9» (p1 = en-tete «MUNICIPALITÉ DE GALLICHAN / 168, chemin de Gallichan C.P. 38 / Tél. : (819) 787-6092 ... Site Internet : www.gallichan.ao.ca»; p3 = rubrique «Le conseil en bref...» melant zonage, «cueillette des encombrants», «démantèlement des barrages de castors»). PISTE NON STAMPEE, a re-qualifier au prochain passage: p3 verbatim «Adopté le second projet de règlement #239 modifiant le règlement de zonage #93;» — Gallichan y nomme donc son zonage «#93» (et #239 n'est qu'un SECOND PROJET, pas en vigueur en mai 2019). NON RETENU parce que la source est SECONDAIRE (un bulletin qui RAPPORTE une seance du 7 mai 2019, pas le reglement lui-meme) et qu'aucun corps ne permet de confirmer que #93 est toujours la base 7 ans plus tard. Servir «Regl. 93» a immo depuis un compte rendu de seance serait une provenance invérifiable presentee comme officielle. Defaut de DECOUVERTE: il manque le corps du reglement.

### grand-saint-esprit

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null MAINTENU (CONTAMINATION). Note precedente («aucun PDF local») PERIMEE: la lane normes a depose work/zonage-norms/grand-saint-esprit/reglement-1200-texte.pdf (384 p, texte natif). MESURE: ce doc n'est PAS de Grand-Saint-Esprit -- couverture p1 verbatim «RÈGLEMENT NUMÉRO 1200 / ZONAGE ET LOTISSEMENT / VILLE DE SHERBROOKE / Version administrative à jour au 02-12-2025», et la «GRILLE DES MODIFICATIONS» donne le base «1200 / Avis de motion 06-02-2017 / Adoption 20-02-2017 / Entrée en vigueur 09-05-2017». Grand-Saint-Esprit (MRC Nicolet-Yamaska) n'est nomme NULLE PART (grep grand-saint/esprit/nicolet/yamaska = 0). Owner-gate ECHOUE => interdit de stamper 1200 sur grand-saint-esprit (motif corpus-slug-owner-mismatch / crawler-attache-le-site-de-lhomonyme). Le fichier est le CORPS officiel de SHERBROOKE mis sous le mauvais slug => lead cross-shard (sherbrooke = 1200, millesime 2017), a traiter par l'agent shard 0/2. ETAPE grand-saint-esprit = trouver son propre reglement (muni sans grille servie, manifest 404).

### ham-nord

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: HOLD null: PDF servi = «ANNEXE B / La Grille des usages et normes» (48 p). p3 dit verbatim «Cette grille fait partie intégrante du règlement de zonage» sans numéro. Deux cartouches tardifs sont incompatibles sans relation de remplacement : p41-42 «Règlement n° 480», p43-44 «Règlement n° 496», chacun suivi de la même formule. Le document ne dit ni lequel est le règlement de zonage courant ni si l'un modifie/remplace l'autre ; ne pas choisir un candidat isolé.

### honfleur

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE PUR: cible NO-GRILLE (aucune entree au manifest) ET aucun PDF dans work/zonage-norms/honfleur/ (NO-LOCAL-PDF mesure). Rien a lire => on ne stampe rien. ETAPE = decouverte du doc, hors gate $0 de cette lane.

### huberdeau

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE: aucun PDF local + aucune URL ouvrable (manifest et grille servie muets). Doc des 28 zones (mistral-vision) non conserve. Rien n'a ete lu => aucun stamp. ETAPE = lane normes-discovery.

### kirkland

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: LIEN MORT: «https://www.ville.kirkland.qc.ca/wp-content/uploads/reglements/90-58-codification.pdf» repond HTTP 404. Le «90-58» du nom de fichier est un candidat NON RETENU (gate) => null. Voie = re-decouverte de l'URL.

### la-pocatiere

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: LIEN MORT: «https://www.lapocatiere.ca/gstDocument/document/doc2075-1.pdf» repond HTTP 404 (URL opaque, aucun numero devinable de toute facon) => null. Voie = re-decouverte de l'URL.

### la-redemption

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-la-redemption: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/la-redemption/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### la-visitation-de-yamaska

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: MAUVAIS DOC — CE N'EST MEME PAS UN REGLEMENT => null. Slug non cure (etat NO-GRILLE: absent du manifest normes) mais PDF local present. `work/zonage-norms/la-visitation-de-yamaska/grille.pdf` (20 p, 1.30MB) est un SCAN sans couche texte (pdftotext = NO-TEXT-LAYER), d'ou l'absence de verdict jusqu'ici. LU A $0 SANS OCR PAYANT: `pdftoppm -r 130 -png` p1 + lecture vision de l'agent. VERDICT VERBATIM p1: c'est le BULLETIN MUNICIPAL, pas un document reglementaire — couverture «Le Visitandin / Bulletin rural», bandeau de pied «Volume 46 | Février 2026 | Numéro 2», blason «LA VISITATION», photo de coeurs givres (numero de la Saint-Valentin). Le fichier a ete nomme `grille.pdf` par la lane amont, mais son contenu n'a AUCUN rapport avec le zonage: le «Numéro 2» de la couverture est un numero de PARUTION, pieges a ne pas confondre avec un numero de reglement. Aucun stamp possible, et rien a re-extraire. NB: aucune norme n'a ete servie depuis ce doc (le slug est absent du manifest = NO-GRILLE), donc pas d'alarme amont ici — contrairement a saint-edouard-de-lotbiniere; mais le dossier de corpus est POLLUE et devrait etre purge/re-acquis par la lane normes. ETAPE = corps du reglement de zonage de La Visitation-de-Yamaska (defaut de DECOUVERTE total); NE PAS re-OCRiser ce PDF (~$0.02 seraient depenses pour lire un bulletin de la Saint-Valentin).

### lac-des-plages

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le doc local est une page UNIQUE, sans aucun motif de reglement ni de date (NO-CANDIDATE-LINE mesure sur la seule page). Ni numero, ni clause d'adoption, ni entree en vigueur. Defaut de DECOUVERTE (il manque le corps du reglement). Cible NO-GRILLE.

### lac-sergent

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null MAINTENU (2026-07-17: la RAISON precedente «NO-GRILLE / aucun source_url a ouvrir» est PERIMEE — le manifest qc-zonage-norms sert desormais une URL). Le source_url «https://www.villelacsergent.com/assets/pdf/reglements/Reglement_314-14_grilles_usages_et_normes-VF.pdf» repond HTTP 200 (455 ko, application/pdf natif genere Excel, 27 p). LU: cahier de grilles pur — p1 verbatim «VILLE DE LAC-SERGENT / Grille des usages et normes / Annexe B» (OWNER-OK: nomme la ville). FIND-0 sur «314» et sur toute date d'adoption / «entrée en vigueur du règlement no N» dans les 27 pages. Le «314-14» du nom de fichier est un candidat NON RETENU (gate: jamais deduire de l'URL). => grille annexe SANS numero verbatim; le corps n'est pas servi. Voie restante = decouverte du CORPS (hors lane P0_1 URL-connue).

### lange-gardien--la-cote-de-beaupre

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: CONTAMINATION INTER-MUNI => null, malgre un numero et une date parfaitement lisibles. Le site source du slug (municipalitedelangegardien.com) et son API REST WordPress (1942 medias) servent le corps «MUNICIPALITÉ DE L'ANGE-GARDIEN / RÈGLEMENT DE ZONAGE / RÈGLEMENT NUMÉRO 2025-008 / ENTRÉ EN VIGUEUR LE 23 mai 2025» (105 p) — mais rien ne rattache ce doc au L'Ange-Gardien de LA CÔTE-DE-BEAUPRÉ. Il existe DEUX municipalites de L'Ange-Gardien au Quebec: MRC de La Côte-de-Beaupré (Capitale-Nationale) = ce slug, et MRC des Collines-de-l'Outaouais. Le doc ne nomme AUCUNE MRC: «Côte-de-Beaupré» = FIND-0 / 105 p, «Beaupré» = FIND-0, «Outaouais» = FIND-0, «Château-Richer» = FIND-0, «Saint-Laurent» = FIND-0, «Gatineau» = FIND-0 («collines» n'apparait que comme nom commun p72 «Sur le sommet des collines») => la contre-epreuve MRC est INCONCLUSIVE sur le doc seul. GATE DECISIF = le SITE PUBLIEUR: la page d'accueil de municipalitedelangegardien.com dit «Collines» 17x, «Outaouais» 14x, «Gatineau» 4x et JAMAIS Côte-de-Beaupré / Château-Richer / Capitale-Nationale => ce site est celui de L'Ange-Gardien DES COLLINES-DE-L'OUTAOUAIS. Le 2025-008 est donc le zonage de l'HOMONYME. Famille normes-homonym-muni-contamination / mistral-window-ne-prouve-pas-le-proprietaire. ⚠️ ESCALADE LANE ZONES: la grille SERVIE de ce slug (rows=111, «20240517-Annexe-3-Grilles-zonage.pdf») vient du MEME site => les 111 zones servies sous ce slug sont probablement celles de l'Outaouais. Famille les-hauteurs-sert-verdun-contamination. ⚠️ _reglement-owner-gate rend OWNER-WEAK nom-complet=0 jeton«gardien»=113: le nom complet echoue sur l'apostrophe TYPOGRAPHIQUE de «L'ANGE-GARDIEN» (U+2019) — ce n'est PAS ce qui disqualifie le doc ici.

### launay

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE PUR: cible NO-GRILLE (aucune entree au manifest) ET aucun PDF dans work/zonage-norms/launay/ (NO-LOCAL-PDF mesure). Rien a lire => on ne stampe rien. ETAPE = decouverte du doc, hors gate $0 de cette lane.

### lavenir

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE PUR: aucune source_url au manifest ET aucun PDF dans work/zonage-norms/lavenir/ (NO-LOCAL-DOC mesure). Rien a lire, ni en ligne ni sur disque => on ne stampe rien. Le zonage est servi (methode=mistral-vision, rows=1) mais son doc source n'est pas dans le corpus. ETAPE = decouverte du doc (crawler muni), hors gate $0 de cette lane.

### lemieux

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE: aucun PDF local + aucune URL ouvrable (manifest et grille servie muets). Doc des 12 zones (mistral-vision) non conserve. Rien n'a ete lu => aucun stamp. ETAPE = lane normes-discovery.

### les-bergeronnes

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE: aucun PDF local + aucune URL ouvrable (manifest et grille servie muets). Doc des 62 zones (mistral-vision) non conserve. Rien n'a ete lu => aucun stamp. ETAPE = lane normes-discovery.

### lile-du-grand-calumet

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-lile-du-grand-calumet: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/lile-du-grand-calumet/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### lingwick

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. NO-GRILLE (absent du manifest) + le seul PDF local work/zonage-norms/lingwick/grille.pdf ne fait QU'1 page, sans aucun motif «règlement/numéro/vigueur» (NO-CANDIDATE). Aucun corps à lire => pas de numéro verbatim.

### maskinonge

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANNEXE NUE => null. CORRIGE le motif du _note precedent («scan image — route vision requise»): la route vision a ete FAITE, a $0 (`pdftoppm -r 120 -png` p1 + vision de l'agent), et elle ne rend AUCUN numero — inutile de facturer un OCR sur 94 pages. VERBATIM p1: page-titre de division portant EXACTEMENT trois lignes — «RÈGLEMENT DE ZONAGE», «ANNEXE A», «TERMINOLOGIE». Aucun numero, aucune muni, aucune date. Le doc local (`grille.pdf`, 8.07MB, 94 p) est donc l'ANNEXE A (terminologie) du reglement de zonage, pas le corps: c'est le motif «Règlement de zonage» SANS numero (faux positif de motif, meme famille que sorel-tracy/notre-dame-du-mont-carmel/barkmere). Un cahier de terminologie ne porte structurellement pas le numero de la base. ETAPE = corps du reglement de zonage de Maskinonge (defaut de DECOUVERTE), pas une re-extraction de cette annexe.

### mcmasterville

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. La grille normes servie porte litteralement _source_url=«non-disponible» et reglement_url=null; work/zonage-norms/mcmasterville/ ne contient aucun PDF. Aucun reglement a ouvrir, donc aucun numero ni millesime ne peut etre stampé.

### mont-joli

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. PDF servi = «Règlement de zonage / ANNEXE 2 / LA GRILLE DES NORMES D’IMPLANTATION» (6 p, texte natif). L'en-tête désigne le règlement sans le numéroter. Le pied p6 énumère sans qualification «RÈGLEMENT 2009-1210, 2010-1241, 2010-1244, …, 2021-1450» ; le document ne dit pas lequel est le règlement de base ni quels sont des amendements. Le «2009-1210» du nom de fichier est donc aussi écarté : jamais déduit de l'URL.

### mont-saint-michel

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. L'URL servie «Grilles_specifications_R257.pdf» répond maintenant HTTP 404; le cache déjà lu est une grille/scan sans couche texte. «R257» n'est porté que par le nom de fichier et n'est pas retenu. Corps requis: aucun numéro officiel n'a été lu verbatim.

### montreal

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-montreal: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/montreal/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### murdochville

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE: aucun PDF local + aucune URL ouvrable (manifest et grille servie muets). Doc des 30 zones (mistral-vision) non conserve. Rien n'a ete lu => aucun stamp. ETAPE = lane normes-discovery.

### normetal

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null: MAUVAIS DOCUMENT. work/zonage-norms/normetal/grille.pdf porte verbatim «Règlement de zonage des Territoires non organisés de la MRC d’Abitibi-Ouest» (entete de chaque page) et «Le présent règlement s'applique à l'ensemble des TNO de la MRCAO, soit le TNO de Rivière-Ojima...». Son numero («Règlement no. 08-2020», adopte le 16 decembre 2020, en vigueur le 18 decembre 2020) est celui des TNO de la MRC, PAS de la municipalite de Normetal: le stamper serait une provenance fausse. ESCALADE: la grille normes de normetal (21 zones) a ete extraite de ce meme doc => son zonage est lui aussi a re-qualifier.

### notre-dame-de-la-paix

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le doc local (grille.pdf, 102 p) est un SCAN IMAGE sans couche texte: pdftotext rend <40 caracteres sur tout le doc. Aucune lecture verbatim possible a $0 => on ne stampe rien. Route vision requise (hors gate $0 de cette lane); relancer le probe apres OCR. Aucune source_url au manifest.

### notre-dame-des-monts

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE PUR: aucune source_url au manifest ET aucun PDF dans work/zonage-norms/notre-dame-des-monts/ (NO-LOCAL-DOC mesure). Rien a lire => on ne stampe rien. ETAPE = decouverte du doc, hors gate $0 de cette lane.

### notre-dame-des-pins

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: HOLD null: le doc est un RECUEIL de 5 reglements d'urbanisme et n'enonce JAMAIS lequel est le zonage. Couverture p1 verbatim: «PLAN ET RÈGLEMENTS D'URBANISME / Notre-Dame-des-Pins / RÈGLEMENTS 163-2007, 164-2007*, 165-2007*, 166-2007 ET 167-2007 / Adoption: 5 mars 2007 / Entrée en vigueur: 20 mars 2007 – 15 mai 2007*». PISTE FORTE mais NON VERBATIM (=> non retenue, gate anti-invention): le tableau d'amendements de la meme page a une colonne «Modifie» et TOUTES ses lignes de zonage portent le segment median «164A», verbatim «169-164A-2007  Règlement de zonage  x x x  19 septembre 2007», «214-164A-2012  Règlement de zonage», «218-164A-2013  Règlement de zonage»... La convention <nouveau>-<modifieA>-<annee> designe donc 164-2007 comme le reglement de zonage, mais cette convention n'est ENONCEE NULLE PART: c'est une inference de nomenclature, pas une lecture. Contre-preuve cherchee et negative: grep «164-2007» sur le doc entier ne rend QUE la ligne de couverture — aucune clause de titre. ETAPE = confirmer 164-2007 aupres de la muni/MRC Beauce-Sartigan, ou trouver le corps du 164-2007 (millesime probable 2007, adoption 5 mars 2007).

### notre-dame-du-mont-carmel

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le doc local (142 p) est l'«Annexe C – Grilles de spécifications». Ses «NOTES PRÉLIMINAIRES» RENVOIENT au reglement sans jamais le numeroter («La section 5 du Règlement de zonage précise...», «...incluses dans le Règlement de zonage.») = faux positifs de motif. Defaut de DECOUVERTE (il manque le corps).

### orford

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null MAINTENU (2026-07-17: la RAISON precedente «BLOCAGE ACCES HTTP 403/WAF» est PERIMEE). Le source_url «https://canton.orford.qc.ca/.../951_Zonage-et-lotissement-Annexe-3-Grilles-Complet_20251211.pdf» repond MAINTENANT HTTP 200 (UA Mozilla/5.0, 2,0 Mo, application/pdf, 126 p texte natif). LU: c'est un cahier de grilles pur — p1 verbatim «GRILLE DES USAGES ET DES SPÉCIFICATIONS PAR ZONE / ZONE: P1», aucune couverture, aucun cartouche, aucun nom de municipalite, et FIND-0 sur «951» ou toute mention «règlement (de zonage) numéro N» dans les 126 pages (seul motif capte = la phrase generique de note de grille «l'entrée en vigueur du présent règlement», sans numero). Le «951» du nom de fichier est un candidat NON RETENU (gate: jamais deduire de l'URL). => grille annexe SANS numero verbatim; le corps (qui porterait le numero) n'est pas la piece servie. Voie restante = decouverte du CORPS (hors lane P0_1 URL-connue).

### packington

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE: aucun PDF local + aucune URL ouvrable (manifest et grille servie muets). Doc des 6 zones (mistral-vision) non conserve. Rien n'a ete lu => aucun stamp. ETAPE = lane normes-discovery.

### peribonka

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE PUR: aucune source_url au manifest ET aucun PDF dans work/zonage-norms/peribonka/ (NO-LOCAL-DOC mesure). Rien a lire => on ne stampe rien. ETAPE = decouverte du doc, hors gate $0 de cette lane.

### piopolis

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE: aucun PDF local + aucune URL ouvrable (manifest et grille servie muets). Doc des 64 zones (mistral-vision) non conserve. Rien n'a ete lu => aucun stamp. ETAPE = lane normes-discovery.

### pointe-a-la-croix

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Depot-disque frais examine (null «aucun PDF local» perime): work/zonage-norms/pointe-a-la-croix/annexe2-grilles.pdf (36 p). C'est l'ANNEXE 2 (grilles de specifications) + une table d'amendements dont seul l'en-tete est lisible verbatim «# Règlement | Description | Entrée en vigueur»; aucune ligne ne porte le NUMERO de la BASE de zonage lisible a $0 (natif p1-36). Le corps (qui porte le numero) n'est pas sur disque => pas de stamp. ETAPE = corps de Pointe-a-la-Croix.

### pointe-lebel

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le doc local (grille.pdf, 17 p) est un cahier de grilles nues: entete verbatim de chaque page «Cahier des spécifications Municipalité de Pointe-Lebel». Aucun numero de reglement nulle part; les 2 seuls motifs captes sont des renvois de prose sans numero («...au moment de l'entrée en vigueur de ce règlement.», «...applicables à l'égard de l'utilisation projetée au moment de l'entrée en vigueur du...»). Defaut de DECOUVERTE (il manque le corps du reglement). Aucune source_url au manifest. Cf. le _note de price: ce meme cahier est aussi le seul PDF local de price.

### poularies

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le doc local (grille.pdf, 10 p) est un SCAN IMAGE sans couche texte: pdftotext rend <40 caracteres sur tout le doc. Aucune lecture verbatim possible a $0 => on ne stampe rien. Route vision requise (hors gate $0 de cette lane); relancer le probe apres OCR. Cible NO-GRILLE.

### price

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ⚠️ MAUVAIS DOCUMENT => null. L'UNIQUE PDF local de price (src.pdf, 17 p) n'est PAS un doc de Price: son entete verbatim, repete sur chaque page, est «Cahier des spécifications Municipalité de Pointe-Lebel», et son contenu traite de zones etrangeres a Price («la Zone prioritaire d'aménagement (ZAP) "des Pins" formée notamment par la zone H17», «la ZAP "Lapierre" formée notamment par les zones H18, H19 et H20»). Price (MRC de La Mitis) et Pointe-Lebel (MRC de Manicouagan) sont deux municipalites distinctes. SIGNAL AMONT (plus grave que la provenance): le manifest sert price avec rows=22 codes=22 methode=native-text/grille-native-first+ocr/mistral-ocr et pointe-lebel avec rows=22 codes=22 par la MEME methode — comptes IDENTIQUES: la grille de normes SERVIE pour price est vraisemblablement celle de Pointe-Lebel (contamination croisee du corpus). Le ZONAGE de price est a re-qualifier, hors lane P0_1. Defaut de DECOUVERTE + doc errone, pas d'extraction.

### rapide-danseur

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le doc (grilles-de-zones.pdf, 10 p, telecharge OK depuis l'URL manifest rapide-danseur.ao.ca) est un SCAN IMAGE sans couche texte: pdftotext rend <40 caracteres sur tout le doc; pdfinfo confirme la provenance scanner: «Creator: Xerox WorkCentre 7835 / Producer: Xerox WorkCentre 7835 / CreationDate: Thu Jan 5 12:53:34 2017». Aucune lecture verbatim possible a $0 => on ne stampe rien. Route vision requise (hors gate $0 de cette lane); relancer le probe apres OCR.

### ristigouche-sud-est

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: DOC MUET (type barkmere): PDF = «ANNEXE II - GRILLES DE SPÉCIFICATIONS   MUNICIPALITÉ DE RISTIGOUCHE-PARTIE-SUD-EST» (15 p, texte natif OK, muni CONFORME). Recherche plein texte: ZERO occurrence du mot «règlement» ET zero occurrence de «2022-002» dans tout le doc. CANDIDAT ECARTE: le «R 2022-002» du nom de fichier («2022-08-31 MRSE R 2022-002 Zonage Annexe 2 Grilles de spcifications MJ Adopt.pdf») est plausible mais NON RETENU -- il n'apparait nulle part DANS le document (gate: jamais deduire de l'URL; type saint-felicien) => null.

### rougemont

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE: aucun PDF local + source_url = sentinelle «https://non-disponible». Le doc ayant servi aux 75 zones (mistral-vision) n'a pas ete conserve. Rien n'a ete lu => aucun stamp. ETAPE = lane normes-discovery.

### saint-adolphe-dhoward

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION (meme cas que rawdon / les-coteaux). Doc = «Grilles de zonage» (14 p, texte natif OK), en-tete «Grilles de zonage» + «Derniere mise a jour : Avril 2023», sans page de titre ni numero de reglement parent. Les seuls verbatims numerotes sont la ligne «Modifications reglementaires : R.634-11; R.634-17; R.634-8; R.634-1» = des reglements MODIFIANTS de la serie 634. Le «634» de base n'est JAMAIS ecrit seul dans le doc; le deduire d'un numero d'amendement est exclu par le gate. Le «2019» du nom de fichier (GRILLES_ZONAGE_2019...) est un millesime de grille, pas un numero => null.

### saint-aime

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. _source_url = «393-2023-annexeB-grilles-usages-normes.pdf» (Annexe B grilles). «393» = 0 occurrence verbatim (piege nom de fichier). Grille pure sans cartouche de base.

### saint-alexis

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. _source_url = «2025-127_annexe_B.pdf» (55 Ko, couche texte quasi nulle a l'extraction = annexe B scannee/grille). «2025-127» du nom de fichier non confirme verbatim (doc illisible en texte natif). Corps requis / route vision hors budget $0.

### saint-ambroise-de-kildare

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: DOC MUET TOTAL: PDF = «ANNEXE - GRILLE DES USAGES» zones H1.. (148 p, texte natif OK, 254213 car.). Recherche plein texte = 0 occurrence de «reglement» ET 0 de «841» sur tout le document: l'annexe ne se rattache a AUCUN numero. Le «841-2023» n'existe que dans le nom de fichier (gate: jamais deduire de l'URL) => null.

### saint-andre-dargenteuil

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: HOTE INJOIGNABLE: le source_url du manifest «https://www.saint-andre-argenteuil.ca/storage/app/media/uploads/files/RUP/Annexe-B-Tableau-spec.pdf» echoue au fetch (FETCH FAIL, aucun octet). Le nom de fichier ne porte aucun numero de toute facon => null. Voie = re-essai quand l'hote repond.

### saint-andre-de-restigouche

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: MAUVAIS DOC -- MUNICIPALITE DIFFERENTE (2e occurrence du piege, cf. saint-francois-du-lac). Le source_url du manifest «https://matapedialesplateaux.com/wp-content/uploads/2021/03/ANNEXE_2_Grilles_spécifications_St-AlexisV6.pdf» rend les grilles de SAINT-ALEXIS-DE-MATAPEDIA, PAS de Saint-Andre-de-Restigouche. Le doc le dit verbatim p1: «GRILLES DE SPÉCIFICATIONS   MUNICIPALITÉ DE SAINT-ALEXIS-DE-MATAPÉDIA» (et le nom de fichier porte «St-Alexis»). Rien de ce doc ne peut etre stampe sur saint-andre-de-restigouche => null. Voie = re-decouverte de l'URL + AUDIT de la grille servie qc-zonage-norms-saint-andre-de-restigouche (35 codes): contamination amont probable, la grille vient peut-etre de ce meme mauvais PDF.

### saint-anselme

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION: doc = «grilles de specification et plan de zonage» (123 p, texte natif OK). 0 motif «reglement de zonage numero X»: les seules mentions sont des RENVOIS non numerotes («la section III du chapitre IV du reglement de zonage», p96-p100) et une note de grille citant un reglement TIERS pour un cas d'espece («habitation communautaire zone 231 I en vertu du reglement 356 [...] adopte le 1er decembre 2015», p83) -- le 356 n'est pas declare comme le reglement de zonage, le stamper serait un faux. L'URL est opaque (telechargement/392/zonage/8453) => null.

### saint-apollinaire

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: AUCUN DOC A LIRE: le source_url du manifest est une page HTML de portail «https://www.st-apollinaire.com/ma-municipalite/conseil-municipal/proces-verbaux/» (liste de proces-verbaux), pas un PDF de reglement -- le fetch rend du HTML (magic=«<!DO»). Rien a relever verbatim => null. Voie = decouverte du PDF de zonage (hors lane P0_1).

### saint-benoit-labre

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE: aucun PDF local + aucune URL ouvrable (manifest et grille servie muets). Doc de la zone unique (mistral-vision) non conserve. Rien n'a ete lu => aucun stamp. ETAPE = lane normes-discovery.

### saint-casimir

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. NO-GRILLE (absent du manifest) ET aucun PDF local (NO-LOCAL-DOC dans work/zonage-norms/saint-casimir/). Rien à lire à $0. Défaut de DÉCOUVERTE.

### saint-claude

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE: aucun PDF local + aucune URL ouvrable (manifest et grille servie muets). Doc des 26 zones (mistral-vision) non conserve. Rien n'a ete lu => aucun stamp. ETAPE = lane normes-discovery.

### saint-colomban

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: AUCUNE SOURCE (type baie-trinite): le source_url du manifest vaut litteralement «https://non-disponible» (grille deposee sans URL). Aucun document a lire => null.

### saint-david-de-falardeau

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: DOC MUET (type ragueneau, meme gabarit «Cahier des spécifications»): PDF = «Cahier des spécifications Municipalité de Saint-David-de-Falardeau» (27 p, texte natif OK, muni CONFORME). Le cahier ne numerote jamais son reglement de zonage parent. CANDIDAT ECARTE: «règlement 578 sur les projets particuliers de construction» = PPCMOI, PAS le zonage; les autres renvois sont sans numero («règlement sur les PAE», «règlement sur les PIIA», «règlement sur les usages»). Le source_url est opaque (a2af3d_1b94cd68a27f4d75ab98275d255e41d8.pdf) => null.

### saint-edmond-de-grantham

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=https://www.st-edmond-de-grantham.qc.ca/file-9720.
- Raison: DOC MUET: page titre p1 verbatim en entier = «ANNEXE "B" / La Grille des usages et normes / 2021» (51 p, texte natif OK). Le seul renvoi au parent est generique et sans numero: «Cette grille fait partie intégrante du règlement de zonage» (repete p2, p4, p6...). ZERO occurrence du motif «reglement + numero» dans tout le doc. L'URL («file-9720») est un identifiant de CMS, aucun candidat. Aucun numero verbatim => null (le «2021» de la page titre date l'annexe, pas un numero).

### saint-edouard-de-lotbiniere

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: PROPRIETAIRE MISMATCH => null (le dossier de slug ment). Le _note precedent tenait null pour la BONNE conclusion mais la MAUVAISE raison («PROJET + CONFLIT DE NUMEROS NON LEVE», voie proposee = «piece officielle (avis d'entree en vigueur / certificat MRC)»): cette voie est FUTILE, car le doc n'est pas celui de cette muni et aucune levee du conflit 2015-258/2015-259 ne le rendra stampable ici. PREUVE VERBATIM, art. 8 du doc: «la MRC les Jardins de Napierville.» — 0 occurrence de «Lotbiniere» sur TOUT le doc (175 p). Le doc est donc le reglement de zonage de SAINT-ÉDOUARD (MRC Les Jardins-de-Napierville, Monteregie), et non de SAINT-ÉDOUARD-DE-LOTBINIÈRE (MRC de Lotbiniere, Chaudiere-Appalaches) = ce slug. Le toponyme y est TOUJOURS nu («Règlement de zonage de la municipalité de Saint-Édouard», art. 1), ce qui rend le piege invisible a l'oeil: le nom-court du doc est un PREFIXE du nom-long du slug, comme courcelles-saint-evariste (sens «le doc nomme MOINS que le slug»), sauf qu'ici ce n'est PAS un predecesseur/regroupement mais une muni ETRANGERE homonyme (famille authier-nord / saint-camille-de-lellis / saint-cleophas-de-brandon / TNO-normetal-palmarolle; cf. memoire normes-homonym-muni-contamination: extraction PARFAITE + muni FAUSSE, seul le gate proprietaire l'attrape). Le conflit de numeros reste REEL mais devient sans objet ici: page-titre + art. 1 disent «(Règlement numéro 2015-259)» (art. 1 verbatim: «Le présent règlement porte le nom de « Règlement de zonage de la municipalité de Saint-Édouard » (Règlement numéro 2015-259).», art. 3 «abroge et remplace le règlement 115»), le pied de CHAQUE page dit «Règlement de zonage numéro 2015-258» — a trancher par/pour SAINT-ÉDOUARD (Napierville), PAS pour ce slug. ⚠️ ALARME AMONT (au-dela de la provenance, elle etait deja notee «audit amont souhaitable» et se confirme PIRE): la grille SERVIE de saint-edouard-de-lotbiniere (41 codes) est extraite de ce doc => ce ne sont pas seulement les 4 champs de provenance qui manquent, ce sont les NORMES SERVIES qui proviennent d'une AUTRE municipalite. A escalader lane NORMES (re-acquisition depuis le corpus de Saint-Édouard-de-Lotbiniere, MRC de Lotbiniere), pas lane provenance. ETAPE = corps du reglement de zonage de SAINT-ÉDOUARD-DE-LOTBINIÈRE; NE PAS re-sonder ce PDF (5 lectures verbatim concordantes).

### saint-elphege

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-saint-elphege: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-elphege/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### saint-ephrem-de-beauce

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-saint-ephrem-de-beauce: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-ephrem-de-beauce/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### saint-etienne-des-gres

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Defaut de DECOUVERTE: rien a lire, a $0 comme au reseau. (1) aucun PDF local (NO-LOCAL-PDF mesure sur work/zonage-norms/saint-etienne-des-gres/); (2) le manifest normes porte une entree (rows=36 codes=36 methode=mistral-vision) mais son source_url est la SENTINELLE «non-disponible», pas une URL ouvrable; (3) contre-verification sur la grille SERVIE qc-zonage-norms-saint-etienne-des-gres: _source_url=«non-disponible», reglement_url=null, reglement_numero=null. Aucun document a ouvrir => on ne stampe rien. ETAPE = decouverte du doc (hors gate $0 de cette lane).

### saint-eusebe

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le PDF local (2 pages) est un extrait de grilles qui ne NOMME NI son reglement NI sa municipalite: gate proprietaire OWNER-ABSENT (nom-complet=0, jeton «eusebe»=0) et FIND-0 sur «règlement (de zonage) numéro N» dans le plein texte. N'etant pas rattachable a Saint-Eusebe par son propre contenu, il ne s'attribue pas. Defaut de DECOUVERTE.

### saint-flavien

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: DOC MUET (type bedford): PDF = «Municipalité de Saint-Flavien / ANNEXE B: GRILLE DE SPÉCIFICATIONS / RÈGLEMENT DE ZONAGE» (23 p, texte natif OK). L'en-tete se declare annexe DU reglement de zonage sans jamais le numeroter; les seuls numeros verbatim sont des MODIFIANTS, p1: «Amendements : R. 05-2010, R. 06-2010, R. 03-2012» + «Abrogé (R. 03-2015)» + «Entreposage exterieur de type E (R. 09-2016)» (gate: pas d'amendement isole) => null.

### saint-francois-de-la-riviere-du-sud

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-saint-francois-de-la-riviere-du-sud: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-francois-de-la-riviere-du-sud/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### saint-gabriel

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Depot-disque frais examine (null «404/aucun PDF local» perime): work/zonage-norms/saint-gabriel/grille-1200.pdf (1990 p, 27 Mo). Sonde natif p1-40 = NO-CANDIDATE-LINE (aucune ligne «règlement de zonage numéro» ni date d'adoption/EEV). Le nom `grille-1200` + la taille (1990 p) evoquent une CONTAMINATION par un code consolide d'une AUTRE muni (cf. grand-saint-esprit=reglement-1200=Sherbrooke); non prouvee ici mais le doc ne NOMME pas Saint-Gabriel ni ne porte de numero verbatim => pas de stamp. ETAPE = corps de Saint-Gabriel (Ville, Lanaudiere).

### saint-hilaire-de-dorset

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: MAUVAIS DOCUMENT => null. Le doc local (3 p) n'est pas un reglement de zonage: p1 «CORPORATION MUNICIPALE SAINT HILAIRE DE DORSET / RÈGLEMENT NO 229-2018 / RÈGLEMENT RELATIF À LA CRÉATION D'UN COMITÉ CONSULTATIF EN URBANISME.», pied de page «règlement 229-2018 CCU». PIEGE ECARTE: le numero 229-2018 est parfaitement lisible et le doc dit «que le règlement portant le numéro 229-2018 soit et est adopté» (adoption «conseil tenue le 5 février 2018») — un lecteur presse le stamperait comme zonage. C'est le reglement du CCU. Le doc ne cite le zonage que comme tiers non numerote: «En cas de disparité, le règlement de zonage en vigueur...». Defaut de DECOUVERTE.

### saint-honore-de-temiscouata

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-saint-honore-de-temiscouata: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-honore-de-temiscouata/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### saint-hugues

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: LIEN MORT: le source_url du manifest «https://saint-hugues.com/fichiersUpload/fichiers/annexeA.pdf» repond HTTP 404. Aucun document a lire => null. Voie = re-decouverte de l'URL (hors lane P0_1).

### saint-ignace-de-loyola

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-saint-ignace-de-loyola: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-ignace-de-loyola/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### saint-jacques-de-leeds

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. LE DOSSIER DE SLUG MENT: work/zonage-norms/saint-jacques-de-leeds/grille.pdf porte le reglement d'une AUTRE municipalite — SAINT-JACQUES (MRC de Montcalm, Lanaudiere) — alors que Saint-Jacques-de-Leeds est dans la MRC des Appalaches (Chaudiere-Appalaches). Preuves verbatim: p1 «MUNICIPALITÉ DE SAINT-JACQUES» (jamais «de-Leeds»); p2 «Attendu que la Municipalité régionale de comté de Montcalm a adopté un schéma d'aménagement révisé / entré en vigueur le 8 mai 2009 ;» et «Et résolu à l'unanimité que le conseil de la Municipalité de Saint-Jacques adopte ce qui suit :»; entete de chaque page «Municipalité de Saint-Jacques». Gate proprietaire: OWNER-WEAK, nom-complet=0 (le nom COMPLET du slug n'apparait pas une seule fois dans 246 pages) alors que le jeton «jacques» sort 263x — exactement le profil du piege de prefixe. Le numero «Règlement de zonage numéro 011-2022» (p3) est donc REEL mais appartient a Saint-Jacques; le stamper aurait servi a immo le zonage d'une autre muni, avec numero et dates parfaitement propres. 4e cas mesure de cette famille (apres authier, saint-camille, TNO).

### saint-jean-de-lile-dorleans

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-saint-jean-de-lile-dorleans: HTTP 404, donc aucune grille ni _source_url/reglement_url servie. La prémisse «aucun PDF local» est périmée: `work/zonage-norms/saint-jean-de-lile-dorleans/zonage.pdf` est maintenant présent (208 p), MAIS c'est un scan sans couche texte: p1 extrait vide, sonde `NO-TEXT-LAYER`. Aucun numéro ne peut donc être LU verbatim; ne rien déduire du nom de fichier. Pas de stamp; route vision ou source officielle textuelle requise.

### saint-joseph-du-lac

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: Grille servie «grilles_de_specification_des_usages (mise a jour 28 aout 2025)» (Saint-Joseph-du-Lac). Aucun numero de reglement de base enonce dans le texte. => null.

### saint-juste-du-lac

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: MAUVAIS DOC -- MUNICIPALITE DIFFERENTE (3e occurrence, apres saint-andre-de-restigouche et saint-francois-du-lac). Le source_url du manifest (sjdl.qc.ca) rend le «REGLEMENT DE ZONAGE N° 15-2024 / MUNICIPALITE DE SAINT-JOSEPH-DU-LAC» (583 p): recherche plein texte = 0 OCCURRENCE de «Saint-Juste-du-Lac», tous les en-tetes portent SAINT-JOSEPH-DU-LAC (p4, p5, p6, p440, p448). Saint-Juste-du-Lac (Temiscouata) != Saint-Joseph-du-Lac (Deux-Montagnes): stamper 15-2024 servirait le droit d'une AUTRE ville => null. ESCALADE: la grille servie de saint-juste-du-lac (50 codes, ocr/mistral-schema) provient de cette meme URL et est donc suspecte.

### saint-leonard-daston

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: HOLD null — CONTAMINATION HOMONYME (note precedente «HTTP 404 / aucun PDF local» PERIMEE par depot-disque amont). Un PDF est desormais present: work/zonage-norms/saint-leonard-daston/websearch-grille.pdf (336 p) — MAIS c'est le zonage d'une AUTRE muni: p1 verbatim «MUNICIPALITÉ DE SAINT-LÉONARD-DE-PORTNEUF», p2 «RÈGLEMENT DE ZONAGE / Municipalité de Saint-Léonard-de-Portneuf / Adopté le 4 juin 2012 / MRC de Portneuf», p3 «RÈGLEMENT DE ZONAGE NUMÉRO 400-12», p20 «remplace le règlement de zonage numéro 221-91». Or ce slug = Saint-Léonard-d'Aston (MRC Nicolet-Yamaska), pas Saint-Léonard-de-Portneuf (MRC de Portneuf): le websearch a rapporte l'HOMONYME. PIEGE ECARTE: stamper «400-12» servirait le zonage d'une autre ville => null. Famille crawler-attache-le-site-de-lhomonyme. ETAPE = corps de Saint-Léonard-d'Aston (Nicolet-Yamaska) nommant sa muni.

### saint-louis-de-gonzague--les-etchemins

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: HOLD null -- CONTAMINATION HOMONYME (note precedente 'HTTP 404 / aucun PDF local' PERIMEE par depot-disque amont). work/zonage-norms/saint-louis-de-gonzague--les-etchemins/grille.pdf (216 p) est desormais present MAIS c'est le «Règlement de zonage numéro 16-125» de la MUNICIPALITE DE SAINT-LOUIS-DE-GONZAGUE de la MRC de BEAUHARNOIS-SALABERRY (Monteregie), PAS de Saint-Louis-de-Gonzague DES ETCHEMINS (Chaudiere-Appalaches) = ce slug. Verbatim: p1 «Municipalité de Saint-Louis-de-Gonzague / Règlement de zonage / Règlement numéro 16-125 / ADOPTÉ LE 19 DÉCEMBRE 2016»; page ÉQUIPE DE TRAVAIL «Yves Daoust, maire et préfet de la MRC» et «Service de l'aménagement et du développement du territoire de la MRC de Beauharnois-Salaberry». «Etchemins» = FIND-0. Owner-gate ECHOUE (famille crawler-attache-le-site-de-lhomonyme / saint-camille-de-lellis / saint-edouard-de-lotbiniere) => NE PAS stamper 16-125 ici. 16-125/2016 est un GAIN pour le slug Saint-Louis-de-Gonzague (Beauharnois-Salaberry), autre agent. ⚠️ escalade lane ZONES: la grille SERVIE de CE slug provient probablement du meme doc contamine.

### saint-lucien

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le PDF local (4 pages) est un extrait de grilles: gate proprietaire OWNER-OK (nom-complet=3) mais FIND-0 sur «règlement (de zonage) numéro N» dans le plein texte. Defaut de DECOUVERTE: il manque le corps.

### saint-majorique-de-grantham

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: DOC MUET (type barkmere): PDF = grille des usages et normes d'implantation (4 p, texte natif OK). En-tete de CHAQUE page verbatim: «Annexe V, Reglement de zonage, Saint-Majorique-de-Grantham» -- l'annexe se declare annexe DU reglement de zonage mais ne le NUMEROTE nulle part (3 occurrences de «reglement», toutes cet en-tete). Le nom de fichier «Usages et normes dimplantation.pdf» ne porte aucun numero => null.

### saint-mathias-sur-richelieu

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Cahier de grilles SANS numero, meme gabarit que saint-damien / sainte-lucie-des-laurentides: p1 «GRILLE DES SPÉCIFICATIONS / Annexe 2 du Règlement de zonage / Zone A-1 / Municipalité de Saint-Mathias-sur-Richelieu» — «Annexe 2 du Règlement de zonage» = faux positif de motif (nomme sans numeroter). FIND-0 sur «règlement (de zonage) numéro N» dans les 88 pages. Gate proprietaire OWNER-OK (nom-complet=86). Defaut de DECOUVERTE: il manque le corps.

### saint-narcisse-de-beaurivage

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANNEXE NUE => null. CORRIGE le motif du _note precedent, dont la premisse d'OUTIL etait fausse: il disait «Aucune lecture verbatim possible a $0 => Route vision requise (HORS GATE $0 de cette lane); relancer le probe apres OCR». Or la route vision se fait A $0 dans cette lane (`_pdf-page-png.ts` @150 dpi + vision de l'agent, sans OCR paye) — elle a ete FAITE ici, et elle ne rend AUCUN numero: inutile de facturer un OCR, et surtout ne pas laisser croire qu'un budget debloquerait ce slug. VERBATIM p1: c'est une ANNEXE de grille, pas un reglement — titre «Annexe 2 / Extrait du « CAHIER DES SPÉCIFICATIONS » / NB les modifications sont surlignées en jaune», puis l'entete de table «ANNEXE B : CAHIER DE SPÉCIFICATIONS (DOSSIER 011-06-UR-CS-B)» et les colonnes «Numéro de zone 26 / 27 / 29». Le doc ne se rattache a AUCUN numero de reglement: la colonne «Réf. Régl.» ne porte que des numeros d'ARTICLES (2.2.1.1, 4.2.3, 6.1.1...) et la ligne «AMENDEMENTS» des numeros de resolutions illisibles. Le «011-06-UR-CS-B» est un numero de DOSSIER de firme d'urbanisme, pas un numero de reglement (piege a ne pas confondre). Meme famille que maskinonge (annexe nue). ETAPE = corps du reglement de zonage de Saint-Narcisse-de-Beaurivage: defaut de DECOUVERTE, pas d'extraction. Aucune source_url au manifest.

### saint-patrice-de-beaurivage

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-saint-patrice-de-beaurivage: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-patrice-de-beaurivage/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### saint-paul

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: AUCUNE SOURCE (type baie-trinite): le source_url du manifest vaut litteralement «https://non-disponible» (grille deposee sans URL). Aucun document a lire => null.

### saint-pie-de-guire

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-saint-pie-de-guire: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-pie-de-guire/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### saint-pierre-de-lamy

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: MAUVAIS DOC (mauvais REGLEMENT, bonne muni) => null. Slug non cure (etat NO-GRILLE: absent du manifest normes) mais PDF local present — «absent du manifest != absent du disque». `grille.pdf` (4 p) est un SCAN sans couche texte: pdftotext rend NO-TEXT-LAYER, d'ou l'absence de verdict jusqu'ici. LU A $0 SANS OCR PAYANT: `pdftoppm -r 130 -png` p1 + lecture vision de l'agent (le renvoi «route vision requise (~$0.01)» des sondes est un FAUX COUT: la vision de l'agent lit un scan de couverture a $0; ne facturer Mistral que si l'agent lui-meme ne lit pas). Page pivotee 90deg, parfaitement lisible. GATE PROPRIETAIRE: PASSE — «PROVINCE DE QUÉBEC / MUNICIPALITÉ DE SAINT-PIERRE-DE-LAMY» (en-tete p1). Mais le doc N'EST PAS un reglement de zonage: titre verbatim p1 «PROJET DE Règlement numéro 2022-005 modifiant le Plan d'urbanisme numéro 01-2014 et ses amendements de la Municipalité de Saint-Pierre-de-Lamy», confirme par l'ARTICLE 2 TITRE DU RÈGLEMENT verbatim: «Le présent règlement s'intitule « Règlement numéro 2022-005 modifiant le Plan d'urbanisme numéro 01-2014 et ses amendements de la Municipalité de Saint-Pierre-de-Lamy ».» => (a) c'est le PLAN D'URBANISME (01-2014) qui est modifie, PAS le reglement de ZONAGE — 2022-005 et 01-2014 sont donc tous deux a ECARTER pour la provenance zonage; (b) c'est de surcroit un PROJET («PROJET DE Règlement», «un avis de motion pour l'adoption du présent projet de règlement a été donné le 7 novembre 2022»), donc pas du droit en vigueur. Les autres numeros cites sont ceux de la MRC et n'ont rien a voir: «le Règlement 02-10-53 modifiant le Règlement 02-10 édictant le schéma d'aménagement et de développement révisé de la MRC de Témiscouata est entré en vigueur le 11 août 2022». Aucun numero de ZONAGE n'est porte par ce doc. ETAPE = corps du reglement de zonage de Saint-Pierre-de-Lamy (defaut de DECOUVERTE); NE PAS re-OCRiser ce PDF (lu integralement a $0).

### saint-remi-de-tingwick

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Cahier de grilles SANS numero: p1 «ANNEXE "B" / La grille des usages et normes. / Zones H, P et C / 2008». Le «2008» est une date NUE, sans numero de reglement auquel la rattacher — un millesime sans numero ne sert a rien (immo affiche «Regl. {numero} ({millesime})»). FIND-0 sur «règlement (de zonage) numéro N» dans les 20 pages. Defaut de DECOUVERTE: il manque le corps.

### saint-roch-ouest

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. _source_url = «annexe-4-2-r-151-2023-zonage.pdf» — ce n'est ni le corps ni la grille des usages mais «ANNEXE 4.2 CADRE NORMATIF POUR LE CONTRÔLE DE L'UTILISATION DU SOL DANS LES ZONES DE CONTRAINTES» (PIIA/contraintes). «151-2023» = pas de cartouche de base verbatim. Corps zonage requis.

### saint-sylvestre

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le doc local est «ANNEXE B : CAHIER DE SPÉCIFICATIONS (DOSSIER 005-06-UR-CS-B)» (37 p). PIEGE ECARTE: «005-06-UR-CS-B» est un numero de DOSSIER d'urbanisme (mandat du consultant), PAS un numero de reglement — le confondre stamperait une reference inexistante. L'annexe renvoie aux articles du reglement («Réf. au règlement 2.2.1.1») sans jamais le numeroter. Defaut de DECOUVERTE (il faut le corps).

### saint-wenceslas

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-saint-wenceslas: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/saint-wenceslas/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### sainte-anne-des-lacs

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: GABARIT JAMAIS REMPLI (variante inedite du doc muet): PDF = grilles des usages/normes/dimensions (38 p, texte natif OK). Le pied de CHAQUE page porte litteralement le blanc a remplir: «Annexe "A" du reglement de zonage numero ___» -- le numero n'a jamais ete saisi dans le gabarit. Seul numero present, «1002-02-2021» (date 2022-03-17), figure dans le bloc «NOTES AMENDEMENTS / No. Regl. Date» = reglement MODIFIANT, ECARTE. Aucun numero de zonage verbatim => null.

### sainte-apolline-de-patton

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-sainte-apolline-de-patton: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/sainte-apolline-de-patton/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### sainte-famille-de-lile-dorleans

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le doc local (grille.pdf, 16 p) est un SCAN IMAGE sans couche texte: pdftotext rend <40 caracteres sur tout le doc. Aucune lecture verbatim possible a $0 => on ne stampe rien. Route vision requise (hors gate $0 de cette lane); relancer le probe apres OCR. Aucune source_url au manifest.

### sainte-francoise--les-basques

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-sainte-francoise--les-basques: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/sainte-francoise--les-basques/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### sainte-gertrude-manneville

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-sainte-gertrude-manneville: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/sainte-gertrude-manneville/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### sainte-julienne

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: AUCUNE SOURCE (type baie-trinite): le source_url du manifest vaut litteralement «https://non-disponible» (grille deposee sans URL). Aucun document a lire => null.

### sainte-luce

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Cahier de grilles SANS numero (4 pages): p1 «Règlement de zonage / La grille des normes d'implantation / ANNEXE 2 / LA GRILLE DES NORMES» — «Règlement de zonage» y figure SANS numero (faux positif de motif). FIND-0 sur «règlement (de zonage) numéro N». Defaut de DECOUVERTE: il manque le corps.

### sainte-lucie-des-laurentides

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Cahier de grilles SANS numero, meme gabarit que saint-damien / saint-mathias-sur-richelieu: p1 «GRILLE DES SPÉCIFICATIONS / Annexe 2 du Règlement de zonage / Zone URB-01 / Municipalité de Sainte-Lucie-des-Laurentides» — faux positif de motif. FIND-0 sur «règlement (de zonage) numéro N» dans le plein texte. Defaut de DECOUVERTE: il manque le corps.

### sainte-marie-de-blandford

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-sainte-marie-de-blandford: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/sainte-marie-de-blandford/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### sainte-rose-de-watford

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: MAUVAIS DOCUMENT => null. Le doc local est un AVIS PUBLIC d'une seule page, a couche texte OCR fortement degradee. Titre verbatim (tel quel): «ENTRÉE EN vIGUEUR DU n RÈcr,nuENT REMrLAÇANT ln nÈcr-nMENT oÉcnÉuNr» ; corps: «municipale, le ministère des Affaires municipales et de I'Habitation (MAMH) a décrété l'entrée en vigueur du», «Le règlement entre en vigueur à compter de la date de publication de cet avis public», «décembre 2023, le présent avis public d'entrée en vigueur du règlement.» Ce n'est ni le reglement de zonage ni sa grille, et l'avis ne numerote aucun reglement de zonage. Defaut de DECOUVERTE.

### sainte-sophie

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: AUCUNE SOURCE (type baie-trinite): le source_url du manifest vaut litteralement «https://non-disponible» (grille deposee sans URL). Aucun document a lire => null.

### senneville

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Le PDF servi est le plan: p1 «Annexe 1 : Plan de zonage / Ce plan fait partie intégrante du Règlement de zonage du Village de Senneville», sans numero du reglement parent. «448-7 / 17 février 2021» est en tableau «Modifications au plan»: candidat ecarte comme modification, pas la base.

### sherbrooke

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-sherbrooke: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/sherbrooke/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

### stanbridge-east

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. _source_url = «399-2011- Annexe B - Grilles des usages et des normes 27-01-16.pdf» (annexe B seule, cartouche «Annexe B»). Le base «399-2011» n'apparait PAS verbatim; seules des cellules citent l'AMENDEMENT «399-2011-3» (=3e modif du base) et «399-11-2». Regle: pas un numero d'amendement isole, et le base 399-2011 = deduit du nom de fichier + de l'amendement => refuse. Corps requis pour confirmer 399-2011 verbatim.

### temiscouata-sur-le-lac

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: HOLD null — le seul doc connu (_source_url vplus: Rg 329-24 (Projet) - ZONAGE (REFONTE).pdf, 247 p) est un PROJET, pas un reglement OFFICIEL adopte. Verbatim couverture p1: «VILLE DE TÉMISCOUATA-SUR-LE-LAC / RÈGLEMENT NUMÉRO 329-24 / (Projet) / ZONAGE», preambule «ATTENDU QUE le Conseil peut adopter un projet de règlement de zonage...» et «...que le projet de règlement 329-24 soit adopté et qu'il soit statué et décrété...» (dispositif au conditionnel). En-tete de chaque page «Règlement de zonage numéro 329-24». Gate viole: numero OFFICIEL requis + millesime coherent — un projet n'a pas de date d'adoption. NE PAS stamper 329-24 tant que la version ADOPTEE (numero/date fermes) n'est pas lue.

### tingwick

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. _source_url = «2010-311-grilles-usages-normes.pdf», en-tete «MUNICIPALITÉ DE TINGWICK / Règlement de zonage» SANS numero. «2010-311» / «311» = 0 occurrence verbatim (piege nom de fichier); le doc ne date que des usages adoptes par amendement (ex «Garde de poules (adopté le 3 octobre 2016)»). Base non porte par l'annexe.

### val-des-monts

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: DOC MUET (faux positif «Numero» type sainte-melanie): PDF = «Reglement de zonage - ANNEXE B / Grilles des specifications» (120 p, texte natif OK). L'en-tete de chaque page porte «Numero de zone : 45» -- le seul «Numero» est celui de la ZONE; l'annexe ne numerote jamais son reglement de zonage. ECARTE «940-24»: c'est le LOTISSEMENT, lu p1 verbatim «Les dimensions des lots sont identifiees au reglement de lotissement 940-24» (le zonage, lui, n'est nomme nulle part) => null.

### val-saint-gilles

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-val-saint-gilles: HTTP 404, donc aucune grille ni _source_url/reglement_url servie. La prémisse «aucun PDF local» est périmée: `cdx-no-171--projet-de-reglement-de-zonage---maj-mai202.pdf` est maintenant présent (135 p) mais c'est explicitement un PROJET, p1 verbatim «PROJET / RÈGLEMENT DE ZONAGE / Règlement no. / Adopté le : / Entrée en vigueur le :» (champs vides), et p5 «Règlement de zonage numéro XX». «XX» est un placeholder, jamais un numéro officiel; aucun millésime ni adoption n'est lisible. Pas de stamp.

### yamaska

- Champs: reglement_numero=null, reglement_millesime=null, reglement_page_source=null, reglement_url=null.
- Raison: ANTI-INVENTION => null. Croisement de qc-zonage-norms-yamaska: HTTP 404, donc aucune grille ni _source_url/reglement_url servie; aucun PDF local dans work/zonage-norms/yamaska/. Aucun document de règlement ne peut être lu verbatim => pas de stamp.

## Commandes exécutées

- npx tsx acquisition/src/fold-reglement-to-zonage.ts --slugs … en 13 lots (12/12/12/12/12/12/12/12/12/12/12/12/4).
- Vérification API avec curl et jq pour les 10 collections présentes.
