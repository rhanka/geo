# Provenance règlement — shard 0/2 — 2026-07-17T22:55:32.413Z

Périmètre: slugs uniques `served=true && reglement=false`, triés, dont l’indice est pair.

## Servi

Fold exécuté sur 11 villes du shard: `acton-vale`, `bolton-est`, `coteau-du-lac`, `franklin`, `lac-sainte-marie`, `mont-laurier`, `potton`, `saint-cuthbert`, `saint-eustache`, `saint-gilles`, `saint-prosper-de-champlain`.

Contrôle API (`qc-zonage-<slug>`, première feature):

| Slug | `reglement_numero` servi |
|---|---|
| acton-vale | `069-2003` |
| bolton-est | `2025-447` |
| coteau-du-lac | `URB 400` |
| franklin | `272` |
| lac-sainte-marie | `2024-08-002` |
| mont-laurier | `134` |
| potton | `2001-291` |
| saint-cuthbert | `352` |
| saint-eustache | `1288` |
| saint-gilles | `363-08` |
| saint-prosper-de-champlain | `04-04-2009` |

Avant/après du fold: les dix premières villes ci-dessus étaient déjà identiques au registre (`cellsChanged=0`). Saint-Eustache avait déjà `1288`, mais pas de lien: le registre porte maintenant l’URL source servie et le fold a écrit ce seul champ sur les 321 polygones (`cellsChanged=321`). Le PDF source porte verbatim en p.1: «REGLEMENT 1288», «Ville de Saint-Eustache» et «entrée en vigueur 88-02-17».

État de surface après écriture: le contrôle API confirme encore `1288` mais rend `reglement_url=null`; la lecture S3 de la même clé confirme l’URL sur les 321 features. L’API conserve donc cet objet en mémoire. `deploy/gcp-tool/serve_geojson.py` documente explicitement qu’un `rollout restart deploy/geo-api` est requis après une écriture S3 pour exposer la collection. Aucun redémarrage n’a été fait dans ce lot (hors autorisation); le lien sera visible après ce refresh de service.

## Nuls maintenus — document source muet

| Slug | Raison vérifiée, verbatim |
|---|---|
| authier | Le PDF commence par «MUNICIPALITÉ D’AUTHIER / GRILLE DES SPÉCIFICATIONS»; aucune occurrence de «règlement», «zonage» ni d’année n’y identifie un numéro de règlement. |
| cheneville | La grille ne donne que les colonnes «AFFECTATIONS», «USAGES», «NUMÉRO DE LIGNE» et «ZONAGE»; aucun numéro de règlement. |
| crabtree | L’en-tête répété est «Annexe 2 du Règlement de zonage — Zone ID-1»; le tableau «No. de règlement / Entrée en vigueur» est vide. Le `2024-421` du nom de fichier est écarté. |
| saint-ambroise-de-kildare | Le cahier ne porte que «Annexe E - Grilles des spécifications» et des colonnes «No. Règl. / Date» vides; aucun numéro de règlement dans le texte. |
| saint-anselme | Les seules références numériques sont «AMENDEMENT PAR RÈGLEMENT 356» (et autres amendements): aucun n’est déclaré règlement de zonage de base. |
| saint-flavien | Le document porte «RÈGLEMENT» et «Numéro de zone», mais aucun numéro de règlement de zonage; les numéros vus sont des zones. |
| saint-mathias-sur-richelieu | Chaque page dit «Annexe 2 du Règlement de zonage» mais ne numérote jamais ce règlement; «No. de règlement / Entrée en vigueur» reste sans valeur. |
| sainte-paule | Le gabarit dit littéralement «Cette grille fait partie intégrante du règlement no.» suivi d’un blanc; les colonnes «Révisé le / Règlement #» sont vides. |
| val-des-monts | Le document se limite à «Règlement de zonage - ANNEXE B» et «Numéro de zone». `940-24` est explicitement le «règlement de lotissement», donc écarté. |

Ces villes restent à `null`: aucun numéro n’a été déduit d’une URL, d’un nom de fichier ou d’un amendement isolé.
