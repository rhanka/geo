# NORMES via Mistral — shard 0/4

Date UTC : 2026-07-11T21:37:13Z  
Branche : `feat/cadre-acquisition`  
Sélection : liste triée `zones.status == done && normes.status != done`, indices `% 4 == 0`, recalculée entre les lots parce que les dépôts concurrents faisaient évoluer la matrice.

## Résultat net

Deux nouveaux produits parquet-only ont passé tous les gates anti-invention, puis ont été fusionnés au manifeste.

| Slug | Source officielle | Route Mistral | Zones | Overlap SIG | Champs publiés | Coût confirmé | Résultat |
|---|---|---:|---:|---:|---:|---:|---|
| `saint-janvier-de-joly` | VPlus, `JOLY_Grille spécification complète 2026-04-14` | OCR 4.0 | 37 | 37/43 | 49 % | 0,002 USD | déposé |
| `saint-philemon` | GestionWebLex, règlement de zonage 15-2025, annexe L p.142–211 | `mistral-schema` | 69 | 65/78 | 29,9 % | 0,210 USD | déposé |

Clés :

- `registry/qc-zonage-norms/qc-zonage-norms-saint-janvier-de-joly.parquet`
- `registry/qc-zonage-norms/qc-zonage-norms-saint-philemon.parquet`

La fusion de manifeste a ajouté ces deux slugs. Elle a également intégré des parquets concurrents déjà présents ; le faux préfixe `registry` a échoué sans empêcher la fusion des vrais slugs.

## Aval immo

- `saint-janvier-de-joly` : 962 lots, zone assignée 99,9 %, normes jointes 85,22 %, lots enrichis déposés.
- `saint-philemon` : 1 554 lots, zone assignée 100 %, normes jointes 88,22 %, lots enrichis déposés.

## Échecs de gate et preuves

| Slug | Route | Coût confirmé | Preuve de rejet |
|---|---|---:|---|
| `lac-des-plages` | `mistral-schema` | 0,003 USD | 30 codes, overlap 11/11, mais `publishedFieldPct=0` |
| `saint-emile-de-suffolk` | `mistral-schema` | 0,003 USD | codes d'usages `FOR*`, overlap SIG 0 et champs nuls |
| `saint-bruno-de-guigues` | OCR 4.0 | 0,004 USD | PDF officiel MRC confirmé, quatre pages, 0 zone extraite |
| `saint-philemon` | OCR 4.0 | 0,070 USD | 2 faux codes `MIN`/`MAX`, overlap SIG 0 ; fallback schema ensuite réussi |

Coût Mistral confirmé de cette passe : **0,292 USD**. L'appel Saint-Philémon initial parti sur la mauvaise fenêtre 1–80 a été interrompu ; sa facturation éventuelle n'est pas affirmée.

## Découverte

- Le crawler PV 2-hop du premier lot ne connaissait que 8/15 slugs. Il a confirmé zéro grille pour `abercorn`, `dundee`, `brebeuf` et `esterel` avant sa borne globale ; Brébeuf a été rejeté comme règlement/amendement d'une page.
- Le portail MRC de Témiscamingue a fourni le PDF officiel de `saint-bruno-de-guigues`, mais ce document ne porte aucune grille exploitable.
- L'API publique VPlus de Saint-Janvier-de-Joly a fourni la grille complète séparée : c'est le premier dépôt net.
- GestionWebLex Saint-Philémon a fourni le nouveau règlement 15-2025 avec l'annexe L complète : c'est le deuxième dépôt net.
- L'API VPlus de Sainte-Famille-de-l'Île-d'Orléans a fourni une annexe séparée `annexe-5-grilles-usages.pdf`, HTTP 200, 16 pages scannées. Le PDF est prêt dans `work/zonage-norms/sainte-famille-de-lile-dorleans/grille.pdf`, mais l'extraction Mistral a été bloquée par la limite d'usage de l'agent avant exécution.
- VPlus a aussi confirmé les règlements de base de `padoue` et `saint-antoine-de-tilly`. Les preuves antérieures ne justifiaient pas de repayer ces mêmes documents avant les cibles à annexe séparée.

## Blocage de continuation

La relance Mistral pour Sainte-Famille-de-l'Île-d'Orléans a été refusée par la limite d'usage Codex jusqu'à 22:10. Aucun contournement n'a été tenté. Le résiduel du shard a sinon été recoupé avec les rapports Mistral existants : chaque slug restant possède déjà une preuve de gate échoué, de document non-grille/annexe absente, ou d'absence de source officielle confirmée dans les recherches bornées.
