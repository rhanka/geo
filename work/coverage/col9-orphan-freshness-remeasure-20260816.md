# col-9 — re-mesure fraîcheur orphan/candidate vs servi courant (2026-08-16)

## Mesure

Re-scan **read-only** (`_col9-orphan-freshness-scan`, HEAD/GET, aucune écriture) de
la liste orphan/candidate de la matrice provenance-qualité (`as_of 2026-07-26`)
contre l'état **servi courant**. « Mesure là où geo émet » — pas de churn.

| bucket | cb018f38 (baseline) | courant (2026-08-16) | Δ |
| --- | ---: | ---: | ---: |
| proof_present_stamped | 8 | **12** | **+4** |
| proof_present_unstamped | 0 | **0** | 0 |
| no_proof | 111 | **108** | −3 |
| unavailable | 0 | 0 | 0 |
| entries scannées | 119 | 120 | +1 |

## Interprétation

- **+4 orphan/candidate désormais stampés v2** (matrice périmée pour eux) :
  **murdochville**, **saint-denis-sur-richelieu**, **saint-francois-de-lile-dorleans**,
  **saint-pierre-de-lile-dorleans**. Objet servi porte une vraie preuve v2 réelle
  + `zone_source_url` stampé → reclassables `documented`/v2, **aucun write requis**.
- Ces gains viennent de la **campagne zones** (ré-acquisition qui re-stampe dans la
  même passe), **pas d'une action jointures**.
- **`proof_present_unstamped = 0`** : aucune ville ne porte une preuve v2 sans stamp
  → **0 rattrapage additif jointures** (`_restamp-served-from-proof` sans cible).
  Confirme `COL8-LEVIER3 INFONDÉ` (`f7e6107a`) : le levier jointure sur col-8/9
  reste **nul par construction** — tout gain passe par zones.
- **108 `no_proof`** = orphelins réels → campagne capture↔servi (lane zones, gated
  g-cond). Hors portée jointures.

## Statut lane

Re-mesure au point courant de la campagne zones (la campagne progresse : +4 en
~3 semaines). L'artefact daté est versionné pour rendre la progression **visible**
(CLAUDE.md : le rapport mesure présence ET provenance/qualité — sinon la
ré-acquisition et le stampage sont invisibles). Prochaine re-mesure à un point plus
stable de la campagne. Le levier jointures sur col-8/9 demeure à 0 ; le suivi porte
sur la fonte de `no_proof` (108) pilotée par zones, pas sur une action de cette lane.
