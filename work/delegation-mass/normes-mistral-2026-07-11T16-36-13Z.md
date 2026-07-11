# NORMES via Mistral — shard 2/4

Date UTC : 2026-07-11T16:36:13Z

## Périmètre

- Sélection stricte : liste complète des slugs triée, conservation de `index % 4 == 2`.
- Éligibilité : `zones.status == done` et `normes.status != done`.
- État initial : 69 cibles éligibles dans le shard.
- Moteurs utilisés : Mistral OCR 4.0 et Mistral `document_annotation` (`ocr/mistral-schema`) uniquement.
- Aucun GPT, Codex ou moteur Claude d’extraction n’a été utilisé.
- Dépôts : parquet-only, puis fusion explicite du manifeste.

## Résultat net

| Slug | Résultat | Preuve/gate |
|---|---|---|
| saint-ulric | DÉPOSÉ | Mistral schema, 323 pages, 24 codes, `publishedFieldPct=1`, overlap SIG 7/57, coût schema 0,969 $; parquet `registry/qc-zonage-norms/qc-zonage-norms-saint-ulric.parquet` |
| adstock | rejet | OCR 80 pages : 0 zone extraite |
| bonsecours | source indisponible | URL PDF connue mais téléchargement expiré après 60 s, aucun octet reçu |
| guerin | rejet | OCR : 0 zone; schema : 0 code sur 55 pages |
| lac-saint-joseph | rejet | OCR : 12 codes, overlap 6, mais `publishedFieldPct=0`; schema : 0 code sur 206 pages |
| latulipe-et-gaboury | rejet | OCR : erreur Mistral 500; schema : fenêtre auto 31..38, 0 code |
| ripon | rejet | OCR : 1003 codes et overlap 41, mais `publishedFieldPct=0`; schema : 0 code |
| saint-alphonse-de-granby | rejet | fenêtre grille 152..158 détectée; OCR et schema : 0 code |
| saint-andre-de-kamouraska | rejet | OCR 80 pages : 0 zone extraite |
| saint-augustin-de-desmaures | rejet | schema : 56 codes, `publishedFieldPct=11,6`, mais overlap SIG 0/10 |
| saint-martin | rejet | 2 codes extraits, overlap SIG 0/5 |
| saint-paul-de-montminy | rejet | 3 codes extraits, overlap SIG 0/79 |
| sainte-anne-des-plaines | rejet | OCR : 4 codes et `publishedFieldPct=0`; schema : 1 code seulement; SIG introuvable |
| sainte-praxede | rejet | 4 codes extraits, overlap SIG 0/42 |
| thetford-mines | rejet | OCR : dépassement `maxBuffer`; schema fenêtre 28..83 : 0 code |

Coût Mistral observé sur les appels facturés : environ 2,760 $. Le cumul Saint-Ulric est de 1,049 $ (0,080 $ OCR initial + 0,969 $ schema), soit un dépassement involontaire de 0,049 $ du plafond par ville lors du fallback; aucun autre slug ne dépasse 1 $ en cumul.

## Découverte

- Réemploi prioritaire des PDF locaux : inventaire de 69 cibles, 32 PDF locaux trouvés.
- Crawler 2-hop : aucun PDF grille confirmé dans les lots bornés; Brébeuf a produit un règlement juridique sans grille et a été rejeté par le classifieur.
- Portail MRC Témiscamingue : URL officielles retrouvées et vérifiées pour Guérin et Latulipe-et-Gaboury; les deux PDF locaux correspondent aux règlements publiés par la MRC.
- Les valeurs `sourceUrl=non-disponible` présentes dans d’anciens manifestes n’ont pas été utilisées comme provenance de dépôt.

## Post-dépôt Saint-Ulric

- Fusion manifeste : Saint-Ulric ajouté; manifeste passé de 622 à 623 entrées.
- Jointure lots/zones : 1618 lots, 99,94 % assignés, 11,38 % avec code de norme correspondant; vérification parquet/stats OK.
- Lots enrichis : 1618 lots, 100 % surface, 100 % RTA, 92,03 % adresse, dépôt OK.
- Le faible taux de correspondance normes (11,38 %) est conservé comme avertissement; aucune valeur n’a été inventée pour augmenter le rappel.

## État final vérifié

- Scoreboard NORMES : 624/1106.
- Shard 2 restant : 68 cibles éligibles.
- Vérité S3 : `saint-ulric normesDone=true`; les 14 autres slugs du lot ne portent aucun dépôt NORMES.
