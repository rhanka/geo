# col-9 — scan de fraîcheur orphan/candidate (re-mesure état servi courant, 2026-08-10)

## Objet

La matrice provenance-qualité `…20260726T130555Z-8c02991472…` (col-8/col-9) date
du **2026-07-26**. La ré-acquisition zones re-stampe des preuves v2 dans l'objet
servi **sans re-scan de la matrice** → une ville « orphan » au 26-07 peut porter
aujourd'hui une vraie preuve v2. CLAUDE.md : « le rapport mesure présence ET
provenance/qualité — sinon la ré-acquisition et le stampage sont invisibles ».
Ce scan **re-mesure** l'état COURANT des 119 orphan+candidate (read-only, aucun write).

## Résultat (`_col9-orphan-freshness-scan.ts`, 120 entrées : orphan+candidate + l'unique unknown-servi)

| classe | n | sens |
| --- | ---: | --- |
| `proof_present_stamped` | **8** | matrice PÉRIMÉE — preuve v2 réelle + stamp déjà présents → reclassables ≥documented, **aucun write** |
| `proof_present_unstamped` | 0 | preuve présente mais stamp incomplet (restampable additif) — aucun cas |
| `no_proof` | **112** | gap RÉEL (111 orphan/candidate + `les-cedres` unknown-servi) — campagne capture↔servi (lane **zones**, gated g-cond) |
| `unavailable` | 0 | objet servi illisible/absent — aucun |

**LEVIER-3 (col-89 triage) est AUSSI infondé.** L'unique ville `unknown` avec
jointure exacte est **`les-cedres`** : `zone_source_url=null` dans l'objet servi
courant → aucune preuve à normaliser, **non restampable par jointures**. C'est un
item capture-zones, pas un rattrapage jointures. Les trois « leviers jointure
lane » du triage `col89-provenance-triage-20260807` (LEVIER-1 orphan, -2
candidate, -3 unknown) sont donc **tous infondés** : il n'existe AUCUN rattrapage
provenance exécutable depuis la lane jointures. Tout le gap col-8/9 est soit
déjà-réparé-par-zones (8, re-mesure), soit campagne-capture-zones (112).

## Les 8 orphan périmés (déjà améliorés par la ré-acquisition zones)

`boisbriand`, `contrecoeur`, `hampstead`, `saint-charles-sur-richelieu`,
`saint-lin-laurentides`, `salaberry-de-valleyfield`, `sherbrooke`, `vercheres`.

Chacune porte une vraie `zone_source_url` ArcGIS/goAzimut re-téléchargeable dans
l'objet servi courant (détail + URL par ville dans le `.json`). Preuve vérifiée
octet-servi, **rien de deviné**. (Recoupement : `saint-charles-sur-richelieu` et
`vercheres` sont aussi dans les 15 `na_proven` col-20 recette-attestés.)

## Verdict

1. **col-9 orphan (82) surestime le gap d'au moins 8** : ces 8 sont déjà
   ≥documented côté servi ; seule la matrice est périmée. Une **re-mesure**
   (pas un write) les sort de orphan → rend visible la ré-acquisition zones.
2. **0 orphan restampable par jointures** : le rattrapage
   `_restamp-served-from-proof.ts` SKIP tout objet sans preuve v2 présente
   (9/10 de l'échantillon skippé) — les 8 améliorés le sont déjà par zones, pas
   par jointures. LEVIER-1 du triage `col89-provenance-triage-20260807` (restamp
   orphan depuis jointures) est **infondé** : il n'existe pas de rattrapage
   jointures ici.
3. **Le vrai gap = 112** (no_proof : 111 orphan/candidate + `les-cedres`
   unknown-servi) → campagne **capture↔servi de la lane zones** (cf mémoire
   `zones-v2-upgrade-opportunity`, campagne EN COURS, gated g-cond). Hors lane
   jointures — AUCUN des 3 leviers jointure du triage col-89 n'est exécutable.

## Suites

- **zones/g-cond** : (i) re-scan de la matrice provenance-qualité pour intégrer
  les 8 déjà-améliorés (col-9 orphan −8 net) ; (ii) les 111 orphan réels sont la
  cible de la campagne v2-upgrade zones (scoping `570ee0d7`).
- **jointures** : rien à écrire ici (aucun rattrapage jointures) ; ce scan
  documente la re-mesure et corrige le triage col-89.
