# Recheck des 9 gaps in-cohorte (indeterminate + saint-constant) — 2026-08-16

Vérification web 1-à-1 (WebFetch/WebSearch) + HEAD-probe (UA de capture) des 9
municipalités laissées indeterminate/404 par la découverte statique.

## Résultat : 0 PROVEN_NA, 0 recoverable avec l'UA de capture actuel

Les 9 publient toutes des PV. AUCUNE n'est recoverable avec la chaîne polie
actuelle (UA `PV_USER_AGENT`, fetch statique). Toutes capability-bound ou data-fix.

| Muni | Blocage | Détail |
|---|---|---|
| saint-constant | UA/403 | Section statique PDF directs (browser OK via WebFetch) MAIS HEAD-probe UA capture = 0/82 live, 82 dead → le serveur bloque l'UA de recherche. |
| saint-remi | data-fix + à revérifier | Annuaire MORT (ville.saint-remi.qc.ca) → réel saint-remi.ca (PDF wp-content). Après fix annuaire, revérifier UA. |
| saint-pierre | data-fix + à revérifier | Annuaire MORT (villagestpierre.org) → réel municipalites-du-quebec.com/village-st-pierre (chemin MDQ). Après fix, revérifier UA. |
| saint-hyacinthe | TLS | Chaîne TLS incomplète (intermédiaire manquant). ~56k hab, PV PDF statiques (index Google, 2019→2026). |
| sainte-madeleine | HTTP headers | Header malformé (Missing CR after header value). PDF statiques /fichiers/pv*.pdf (récence >2011 non confirmée). |
| sainte-marie-madeleine | HTTP headers | Idem header malformé. PDF wp-content statiques (2020→2025). |
| howick | TLS/SNI | Cert partagé box4.domaineinternet.ca (mismatch). Section Documents/Conseil. |
| lile-cadieux | TLS/SNI | Idem box4. Archive PV 2009+ + audio 2020-2022 (indexé). |
| tres-saint-sacrement | TLS/SNI | Idem box4. Section Documents + calendrier séances (PV non nommé explicitement, plus faible). |

## Refinement capability (majeur)

**Succès WebFetch (navigateur) ≠ succès capture (UA `PV_USER_AGENT`).** Le HEAD-probe
avec l'UA réel de capture est le test qui fait foi. saint-constant l'illustre :
contenu statique, accessible navigateur, mais 403 à l'UA poli.

Le mur « capability » est donc plus large que JS-render : il inclut **(A) robots,
(B) JS/tiers, (C) TLS/headers non-conformes, (D) blocage par UA/403**. Une seule
capability navigateur (Chromium : vrai UA + tolérance TLS/headers + rendu JS) couvre
les quatre. C'est le levier PV restant le plus élevé.

## Actions gratuites (sans capability)

- **Fix annuaire MAMH** (3) : saint-remi→saint-remi.ca, saint-pierre→municipalites-du-quebec.com/village-st-pierre, saint-sulpice→st-sulpice.com. Débloque la découverte ; l'UA reste à revérifier ensuite par HEAD-probe.

## Bilan cohorte /167

147 couvert + 2 N-A (lile-dorval, saint-clet) = 149 résolus. 18 restants =
capability-bound (browser) + 3 data-fix annuaire. Easy yield (UA poli statique) épuisé.
