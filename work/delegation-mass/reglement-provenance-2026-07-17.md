# Provenance règlement — shard 0/2 — 2026-07-17

## Périmètre et bilan

- Univers: 272 villes servies avec `reglement=false` dans zonage-enrichment.json, triées par slug.
- Shard traité: indices pairs, soit 136 villes.
- Avant ce passage: 20 entrées du registre avaient un numéro de règlement et 116 étaient déjà des verdicts null motivés.
- Après ce passage: les mêmes 20 numéros sont confirmés par l’API des polygones; les 116 null restent explicitement non stampés.
- Fold: deux lots de dix; résultat idempotent, 0 cellule modifiée (les polygones étaient déjà servis avec les valeurs du registre).
- Vérification servie: requête API limit=1 effectuée pour chacune des 20 villes numérotées, toutes conformes ci-dessous.

## Villes servies et vérifiées

- acton-vale — 069-2003
- bolton-est — 2025-447 (2025)
- coteau-du-lac — URB 400
- franklin — 272
- labrecque — 300-07
- lac-sainte-marie — 2024-08-002
- mont-laurier — 134 (2007)
- new-carlisle — 2013-344 (2013)
- potton — 2001-291 (2001)
- saint-antonin — 922-26
- saint-cuthbert — 352 (2024)
- saint-eustache — 1288 (1988)
- saint-gilles — 363-08 (2008)
- saint-marc-du-lac-long — 2015-02
- saint-prosper-de-champlain — 04-04-2009
- saint-rene — 119-06 (2006)
- sainte-angele-de-merici — 2010-06
- schefferville — 2013-120
- sorel-tracy — 2222 (2013)
- tres-saint-redempteur — 288-2026

## Villes null — raison consignée verbatim

Chaque ligne reprend la première phrase du _note curé du registre, sans réinterprétation; le _note complet reste la source durable de la preuve et des citations PDF. La seule normalisation est l’omission des délimiteurs typographiques autour du chemin de fichier de Denholm.

- ange-gardien — «CONTAMINATION HOMONYME (3e cas de la famille L'Ange-Gardien) => null.»
- authier — «DOC MUET: «grille-des-specifications.pdf» (16 p) est la grille seule; recherche plein texte = 0 occurrence de «reglement», «zonage» ET de toute annee (19xx/20xx).»
- baie-des-sables — «ANTI-INVENTION => null.»
- baie-trinite — «AUCUNE SOURCE: le source_url du manifest vaut litteralement «non-disponible» (grille deposee par vision sans URL).»
- candiac — «AUCUNE SOURCE: le source_url du manifest vaut litteralement «non-disponible» (grille deposee par vision sans URL).»
- champneuf — «ANTI-INVENTION => null.»
- cheneville — «DOC MUET: PDF = 2 pages de grille d'usages (texte natif OK, 4357 car.), seule mention datee «Date: Juin 2016».»
- clerval — «MAUVAIS REGLEMENT (bonne muni) => null.»
- coaticook — «ANTI-INVENTION: le reglement de zonage consolide en vigueur est intitule (art.1.1) «Règlement de zonage de la ville de Coaticook» SANS numero.»
- crabtree — «DOC MUET: en-tete «Annexe 2 du Reglement de zonage» sur les 72 p, mais 0 occurrence d'un numero (recherche plein texte «zonage <num>» = 0 page).»
- denholm — «null MAINTENU mais RAISON CORRIGEE — l'ancien _note («AUCUN DOC A LIRE: le source_url du manifest est la page d'accueil https://www.denholm.ca, pas un document») est PERIME: un PDF est desormais sur le disque, work/zonage-norms/denholm/grille.pdf (134 p, texte natif), et c'est le BON doc — le corps du reglement de zonage de la BONNE muni (p1 verbatim: «CHAPITRE 4 : RÈGLEMENT DE ZONAGE / MUNICIPALITÉ DE DENHOLM»).»
- disraeli--les-appalaches--2 — «AUCUNE SOURCE: le source_url du manifest vaut litteralement «non-disponible» (grille deposee par vision sans URL).»
- dundee — «ANTI-INVENTION => null.»
- entrelacs — «DOC MUET (type montreal-ouest): le source_url rend la grille SEULE (2 p, texte natif OK) «Municipalité d'Entrelacs / grille des usages principaux et des normes» (zones S-1..S-6), sans page de titre ni pied de grille numerotant le reglement.»
- farnham — «ANTI-INVENTION => null.»
- fort-coulonge — «HOLD null: CONFLIT DE NUMEROS INTERNE NON LEVE (famille bristol).»
- frontenac — «ANTI-INVENTION => null.»
- girardville — «ANTI-INVENTION => null.»
- grande-riviere — «AUCUNE SOURCE: le source_url du manifest vaut litteralement «non-disponible» (grille deposee par vision sans URL).»
- hemmingford--les-jardins-de-napierville — «ANTI-INVENTION => null.»
- hope — «ANTI-INVENTION => null.»
- huntingdon — «ANTI-INVENTION => null.»
- la-corne — «AUCUNE SOURCE: le source_url du manifest vaut litteralement «non-disponible» (grille deposee par vision sans URL).»
- la-presentation — «DOC = EXTRAIT, pas le reglement.»
- la-reine — «ANTI-INVENTION => null.»
- lac-des-plages — «ANTI-INVENTION => null.»
- lacolle — «ANTI-INVENTION => null.»
- lascension-de-patapedia — «ANTI-INVENTION => null.»
- laval — «ANTI-INVENTION => null.»
- laverlochere-angliers — «ANTI-INVENTION => null.»
- les-bergeronnes — «ANTI-INVENTION => null.»
- lile-du-grand-calumet — «ANTI-INVENTION => null.»
- lotbiniere — «ANTI-INVENTION => null.»
- matapedia — «ANTI-INVENTION => null.»
- montreal — «ANTI-INVENTION => null.»
- murdochville — «ANTI-INVENTION => null.»
- normetal — «ANTI-INVENTION => null: MAUVAIS DOCUMENT.»
- notre-dame-de-la-paix — «ANTI-INVENTION => null.»
- notre-dame-des-monts — «ANTI-INVENTION => null.»
- notre-dame-des-pins — «HOLD null: le doc est un RECUEIL de 5 reglements d'urbanisme et n'enonce JAMAIS lequel est le zonage.»
- notre-dame-du-mont-carmel — «ANTI-INVENTION => null.»
- notre-dame-du-sacre-coeur-dissoudun — «HOLD null: le doc porte DEUX numeros CONTRADICTOIRES et rien ne permet de trancher a $0 (famille bristol) => ne rien stamper plutot que risquer une fausse provenance.»
- ormstown — «ANTI-INVENTION => null.»
- palmarolle — «ABORT gate => null.»
- piopolis — «ANTI-INVENTION => null.»
- pointe-a-la-croix — «ANTI-INVENTION => null.»
- pointe-lebel — «ANTI-INVENTION => null.»
- prevost — «ANTI-INVENTION => null.»
- quebec — «ANTI-INVENTION => null, et BLOCAGE STRUCTUREL du modele per-muni (pas un defaut d'extraction).»
- ristigouche-sud-est — «DOC MUET (type barkmere): PDF = «ANNEXE II - GRILLES DE SPÉCIFICATIONS   MUNICIPALITÉ DE RISTIGOUCHE-PARTIE-SUD-EST» (15 p, texte natif OK, muni CONFORME).»
- roquemaure — «ANTI-INVENTION => null.»
- roxton-falls — «ANTI-INVENTION => null.»
- saint-adolphe-dhoward — «ANTI-INVENTION (meme cas que rawdon / les-coteaux).»
- saint-adrien-dirlande — «⚠️ MAUVAIS DOCUMENT => null.»
- saint-aime-des-lacs — «ANTI-INVENTION => null.»
- saint-alexis-de-matapedia — «ANTI-INVENTION => null.»
- saint-ambroise-de-kildare — «DOC MUET TOTAL: PDF = «ANNEXE - GRILLE DES USAGES» zones H1..»
- saint-andre-dargenteuil — «HOTE INJOIGNABLE: le source_url du manifest «https://www.saint-andre-argenteuil.ca/storage/app/media/uploads/files/RUP/Annexe-B-Tableau-spec.pdf» echoue au fetch (FETCH FAIL, aucun octet).»
- saint-andre-de-restigouche — «MAUVAIS DOC -- MUNICIPALITE DIFFERENTE (2e occurrence du piege, cf.»
- saint-anselme — «ANTI-INVENTION: doc = «grilles de specification et plan de zonage» (123 p, texte natif OK).»
- saint-barnabe-sud — «DOC MUET TOTAL: PDF = «Annexe A - grille des usages» (16 p, texte natif OK), colonnes «Usage dominant / Classes d'usages / Article de zonage / Zones».»
- saint-bernard-de-lacolle — «ANTI-INVENTION => null.»
- saint-christophe-darthabaska — «DOC MUET (type montreal-ouest / saint-calixte, meme gabarit): PDF = «Annexe 2 du Règlement de zonage   Zone P-1» (76 p, texte natif OK).»
- saint-cleophas-de-brandon — «PROPRIETAIRE MISMATCH => null (le dossier de slug ment).»
- saint-damase--les-maskoutains — «ANTI-INVENTION => null.»
- saint-david — «ANTI-INVENTION => null.»
- saint-denis-sur-richelieu — «AUCUN DOC A LIRE: le source_url du manifest est la page d'accueil du site municipal «https://www.stdenissurrichelieu.com» -- le fetch rend du HTML (magic=«<!DO»), pas un PDF.»
- saint-edmond-de-grantham — «DOC MUET: page titre p1 verbatim en entier = «ANNEXE "B" / La Grille des usages et normes / 2021» (51 p, texte natif OK).»
- saint-eloi — «ANTI-INVENTION => null.»
- saint-elzear--bonaventure — «ANTI-INVENTION => null.»
- saint-ephrem-de-beauce — «ANTI-INVENTION => null.»
- saint-esprit — «AUCUNE SOURCE (type baie-trinite): le source_url du manifest vaut litteralement «https://non-disponible» (grille deposee sans URL).»
- saint-eugene — «DOC MUET (type barkmere): PDF = «ANNEXE "B" / Les grilles des usages et normes.»
- saint-flavien — «DOC MUET (type bedford): PDF = «Municipalité de Saint-Flavien / ANNEXE B: GRILLE DE SPÉCIFICATIONS / RÈGLEMENT DE ZONAGE» (23 p, texte natif OK).»
- saint-francois-de-la-riviere-du-sud — «ANTI-INVENTION => null.»
- saint-gabriel — «ANTI-INVENTION => null.»
- saint-hippolyte — «AUCUNE SOURCE (type baie-trinite): le source_url du manifest vaut litteralement «https://non-disponible» (grille deposee sans URL).»
- saint-hubert-de-riviere-du-loup — «DOC MUET (type barkmere): PDF = grille des specifications (31 p, texte natif OK).»
- saint-hyacinthe — «ANTI-INVENTION => null.»
- saint-ignace-de-stanbridge — «DOC MUET (cas extreme, type ristigouche-sud-est): PDF = «GRILLE DES USAGES ET NORMES SAINT-IGNACE-DE-STANBRIDGE / ANNEXE C» (21 p, texte natif OK, 24706 car.).»
- saint-jacques-de-leeds — «ANTI-INVENTION => null.»
- saint-jean-de-lile-dorleans — «ANTI-INVENTION => null.»
- saint-jerome — «ANTI-INVENTION => null.»
- saint-just-de-bretenieres — «ANTI-INVENTION => null.»
- saint-lambert--abitibi-ouest — «ANTI-INVENTION => null.»
- saint-louis — «ANTI-INVENTION => null.»
- saint-louis-de-gonzague-du-cap-tourmente — «CONTAMINATION INTER-MUNI => null, malgre un numero parfaitement lisible.»
- saint-lucien — «ANTI-INVENTION => null.»
- saint-majorique-de-grantham — «DOC MUET (type barkmere): PDF = grille des usages et normes d'implantation (4 p, texte natif OK).»
- saint-mathias-sur-richelieu — «ANTI-INVENTION => null.»
- saint-narcisse-de-beaurivage — «ANNEXE NUE => null.»
- saint-patrice-de-beaurivage — «ANTI-INVENTION => null.»
- saint-philippe-de-neri — «ANTI-INVENTION => null.»
- saint-pie-de-guire — «ANTI-INVENTION => null.»
- saint-pierre-de-lamy — «MAUVAIS DOC (mauvais REGLEMENT, bonne muni) => null.»
- saint-severin--beauce-centre — «DOC MUET (type boisbriand: date sans numero): PDF = «Annexe B [...] / Grille des spécifications des usages» (2 p, texte natif OK), en-tete p1 verbatim «Annexe B Adopté à Saint-Séverin, ce 2 jour de mai 2022».»
- saint-thomas — «ANTI-INVENTION => null.»
- saint-wenceslas — «ANTI-INVENTION => null.»
- sainte-anne-des-lacs — «GABARIT JAMAIS REMPLI (variante inedite du doc muet): PDF = grilles des usages/normes/dimensions (38 p, texte natif OK).»
- sainte-aurelie — «MAUVAIS DOCUMENT => null.»
- sainte-eulalie — «DOC MUET (type saint-eugene, meme gabarit): PDF = «Grille des usages et normes / Cette grille fait partie intégrante du règlement de zonage / Annexe B / Zone H11 / Municipalité de Sainte-Eulalie» (2 p, texte natif OK).»
- sainte-flavie — «ANTI-INVENTION => null.»
- sainte-genevieve-de-berthier — «ANTI-INVENTION => null.»
- sainte-helene-de-mancebourg — «ANTI-INVENTION => null.»
- sainte-justine — «ANTI-INVENTION => null.»
- sainte-lucie-de-beauregard — «ANTI-INVENTION => null.»
- sainte-madeleine — «ANTI-INVENTION => null.»
- sainte-marie-madeleine — «ANTI-INVENTION => null.»
- sainte-paule — «GABARIT JAMAIS REMPLI (2e occurrence apres sainte-anne-des-lacs, et ici l'URL l'avoue): PDF = «ANNEXE 1 / Grille des specifications / MUNICIPALITE DE SAINTE-PAULE» (2 p, texte natif OK).»
- sainte-sabine--les-etchemins — «ANTI-INVENTION => null.»
- sherbrooke — «ANTI-INVENTION => null.»
- taschereau — «ANTI-INVENTION => null.»
- thetford-mines — «HOTE INJOIGNABLE: le source_url du manifest «https://www.villethetford.ca/wp-content/uploads/2024/01/02-01-GrilleSpecificationsZonage-Janv2024.pdf» ne repond pas (fetch failed; curl -L rend http=000 size=0, echec de connexion -- ni 404 ni redirection).»
- val-des-monts — «DOC MUET (faux positif «Numero» type sainte-melanie): PDF = «Reglement de zonage - ANNEXE B / Grilles des specifications» (120 p, texte natif OK).»
- val-saint-gilles — «ANTI-INVENTION => null.»
- warden — «ANTI-INVENTION => null.»

## Shard 1/2 — contrôle de service 2026-07-17

### Avant / après

- Univers du shard: 136 slugs (`index % 2 == 1`) parmi les 272 villes servies alors marquées `reglement=false`.
- Avant le fold: les dix slugs ci-dessous avaient déjà une entrée curée numérotée; les 126 autres avaient un verdict `null` explicite dans le registre.
- Après `fold-reglement-to-zonage --slugs`: 10/10 succès, `cellsChanged=0` (données déjà en place), puis lecture API `qc-zonage-<slug>?limit=1` conforme pour chacun. Aucun numéro n'a été inventé et aucun `null` n'a été stampé.

### Villes servies et vérifiées

- compton — 2020-166 (2020)
- saint-adrien — 248-2003
- saint-alphonse — 274-2013
- saint-donat--la-mitis — 318
- saint-epiphane — 157 (1991)
- saint-jacques-le-majeur-de-wolfestown — 98 (1990)
- saint-joseph-de-coleraine — 376
- saint-luc-de-bellechasse — 05-07 (2007)
- saint-michel-de-bellechasse — 545-2026 (2026)
- sainte-catherine-de-hatley — 90-256

### Villes null relues — raison verbatim

- barkmere — «ANTI-INVENTION => null. PDF servi (28 p, texte natif) : p1 «GRILLE DES SPÉCIFICATIONS / Annexe 2 du Règlement de zonage / VILLE DE BARKMERE». Sur les 28 pages, l'annexe ne nomme AUCUN numéro de règlement de zonage ; la colonne «No. de règlement / Entrée en vigueur» est un en-tête de modifications sans valeur. La date p1 «13 juin 2009» est celle d'«Apur urbanistes-conseils», pas une adoption.»
- degelis — «ANTI-INVENTION => null. PDF servi = «ANNEXE II – GRILLES DE SPÉCIFICATIONS» (13 p, texte natif). Les seuls numéros sont explicitement des amendements : p2 «Modifications : Règlement 676», puis p4/p6/p7 «Règlement 738», p8 «Règlement 712 // Règlements 738», p9 «Règlement 694», p11/p13 «Règlement 712» et p13 «Règlement 695». Le règlement de zonage de base n'est jamais numéroté dans le document.»
- disraeli--les-appalaches — «ANTI-INVENTION => null. PDF servi (20 p, texte natif) = grilles de zones ; il ne porte aucun cartouche ni article donnant le numéro du règlement de zonage. p1 ne contient que «ZONE 1-R» et des renvois dont «Art. complémentaires – règlement de lotissement» : ce ne sont pas un numéro de zonage. Aucun numéro de base ne peut être relevé verbatim.»
- ham-nord — «HOLD null: PDF servi = «ANNEXE B / La Grille des usages et normes» (48 p). p3 dit verbatim «Cette grille fait partie intégrante du règlement de zonage» sans numéro. Deux cartouches tardifs sont incompatibles sans relation de remplacement : p41-42 «Règlement n° 480», p43-44 «Règlement n° 496», chacun suivi de la même formule. Le document ne dit ni lequel est le règlement de zonage courant ni si l'un modifie/remplace l'autre ; ne pas choisir un candidat isolé.»
- lac-des-aigles — «ANTI-INVENTION => null. PDF servi = grille de spécifications (7 p, texte natif) ; il ne contient aucune occurrence de «règlement», ni numéro, ni date d'adoption/entrée en vigueur. Les nombres à quatre chiffres sont des codes d'usage CUBF («Industrie de catégorie 2 - I2 / 2011 à 2099, 2711 à 2722»), pas un millésime.»
- mont-joli — «ANTI-INVENTION => null. PDF servi = «Règlement de zonage / ANNEXE 2 / LA GRILLE DES NORMES D’IMPLANTATION» (6 p, texte natif). L'en-tête désigne le règlement sans le numéroter. Le pied p6 énumère sans qualification «RÈGLEMENT 2009-1210, 2010-1241, 2010-1244, …, 2021-1450» ; le document ne dit pas lequel est le règlement de base ni quels sont des amendements. Le «2009-1210» du nom de fichier est donc aussi écarté : jamais déduit de l'URL.»
- orford — «ANTI-INVENTION => null MAINTENU (2026-07-17: la RAISON precedente «BLOCAGE ACCES HTTP 403/WAF» est PERIMEE). Le source_url «https://canton.orford.qc.ca/.../951_Zonage-et-lotissement-Annexe-3-Grilles-Complet_20251211.pdf» repond MAINTENANT HTTP 200 (UA Mozilla/5.0, 2,0 Mo, application/pdf, 126 p texte natif). LU: c'est un cahier de grilles pur — p1 verbatim «GRILLE DES USAGES ET DES SPÉCIFICATIONS PAR ZONE / ZONE: P1», aucune couverture, aucun cartouche, aucun nom de municipalite, et FIND-0 sur «951» ou toute mention «règlement (de zonage) numéro N» dans les 126 pages (seul motif capte = la phrase generique de note de grille «l'entrée en vigueur du présent règlement», sans numero). Le «951» du nom de fichier est un candidat NON RETENU (gate: jamais deduire de l'URL). => grille annexe SANS numero verbatim; le corps (qui porterait le numero) n'est pas la piece servie. Voie restante = decouverte du CORPS (hors lane P0_1 URL-connue).»
- pointe-fortune — «ANTI-INVENTION => null. _source_url = «PF_R400-2024_Zonage_AnnexeB_Grilles.pdf» (40 p, Annexe B grilles). «400» / «400-2024» = 0 occurrence verbatim (piege nom de fichier). Le doc porte une table d'amendements (colonnes «Numéro de règlement / Numéro d'article / Date d'entrée en vigueur») mais qui ne liste PAS le base. Corps requis.»
- portneuf — «DOC MUET (type barkmere): PDF = «Annexe I / Règlement de zonage / Grille des spécifications / FEUILLETS DES USAGES (A) ET DES NORMES (B)» (91 p, texte natif OK). L'annexe se declare annexe DU reglement de zonage mais ne le NUMEROTE nulle part (0 motif «Reglement ... numero X») => null.»
- saint-aime — «ANTI-INVENTION => null. _source_url = «393-2023-annexeB-grilles-usages-normes.pdf» (Annexe B grilles). «393» = 0 occurrence verbatim (piege nom de fichier). Grille pure sans cartouche de base.»
- saint-anicet — «ANTI-INVENTION => null. _source_url = «SAT_R585_Zonage_AnnexeB_Grilles.pdf» (annexe B grilles). «585» = 0 occurrence verbatim (piege nom de fichier); le doc cite seulement «Règlement de lotissement 586» (le LOTISSEMENT, pas le zonage) et une table d'amendements sans le base. Corps zonage requis.»
