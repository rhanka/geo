# Conducteur zones — reprise 2026-08-03

Reprise après idle ~3 h. État lu depuis le **committé** (inbox cassé, on remonte par SHA).

## État servi v2 vecteur-natif — 6/167

| slug | source | commit dépôt |
|---|---|---|
| saint-charles-sur-richelieu | gonet | `1f4ff519` |
| saint-dominique | gonet | `1f4ff519` |
| saint-michel | gonet | `1f4ff519` |
| saint-patrice-de-sherrington | gonet | `1f4ff519` |
| saint-pie | gonet (numérique) | `1f4ff519` |
| contrecoeur | arcgis | `ca58a4f9` |

Tous qa-attestés PASS-banc. Pipeline validé : sonde plateforme → capture `zones-obscura-run.ts`
→ gate 4-portes → manifeste §3 = preuve v2 par construction (`source_url_reelle` = `/query?…f=geojson`,
`retrieved_at`, `sha256`, champ ∈ taxonomie, registre <1.1 km).

## Débloqué depuis le pilote

- **D2 corrigé** (`f4bf07f0`) : le gate cessait de faux-rejeter le zonage NUMÉRIQUE. saint-pie
  (déposé) + saint-jude re-passent `PASS_CAPTURE_NUMERIC` (`5c98b6f3`, reverify `20260803T130635Z`).
  ⇒ **arcgis-12 débloqué** (le HOLD D2 tombe).

## Plan de reprise (focus OWNER = qualité recalage, visible sur 167 mercredi)

1. **Scaler le vecteur-natif restant (~30)** — capture→gate→dépôt par lots sobres (≈3-4 workers
   luna xhigh, banc). AUCUN dépôt sans PASS-banc + gate anti-régression couverture servie.
2. **Delta PDF-recalage** (66 v2-prouvables − 36 vecteur-natif) → t1/t2/t3 → banc b → dépôt,
   anti-dégénérescence (chamfer≈0 + 100 % inliers = échelle imprimée = REJET).
3. **Reste (148 − 66)** → N-A DOCUMENTÉ (URL morte CDX `matchType=domain` + 0 géoréf tracés,
   `SPEC_PALIER_RESOLUTION` `e78c725c`).
4. **2 HELD** (saint-bernard-de-michaudville, saint-jude) : trancher capture GOnet incomplète vs servi
   superset (`b371eb73`).
5. Chaque dépôt géom → ping lane lot (re-fold) + RENDU overlay showcase owner.

Reporte X/167 v2 par commit.
