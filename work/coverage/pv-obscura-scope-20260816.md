# Scope capability « Obscura » (capture headless+session) — PV

État : 2026-08-16. Auteur : lane geo-pv. Destinataire : geo-cond → paquet capability owner.
Couverture PV 732/1106 ; in-cohorte X/167 = 147/167 ; 20 gaps restants majoritairement capability-bound.

## Problème

La chaîne de capture actuelle (`k8s-capture-run.ts` → `capturedFetch`) est **polie
et statique** : UA de recherche `PV_USER_AGENT`, respect de `robots.txt`, fetch HTTP
sans rendu JS. Deux murs la bloquent sur une part importante des municipalités :

- **(A) Mur robots** — le site `robots.txt` interdit l'UA de capture (mais sert un
  navigateur). Exemplaire : **saint-basile-le-grand** (`villesblg.ca`, 102 PDF PV
  tous `capture_bound_robots` au HEAD-probe). Probable aussi **terrebonne** (mur 403
  à la capture, cf. commit `f6dfe7fc`).
- **(B) Mur rendu JS / hébergement tiers** — la liste des PV est chargée par
  JS/AJAX ou hébergée hors-domaine (Calameo, Google Drive), donc le fetch statique
  ne voit aucune ancre `.pdf`. Découvert via vérification N-A 1-à-1 (WebFetch) :
  **6 munis in-cohorte** publient bien leurs PV mais la découverte statique les rate —
  oka (Calameo), saint-calixte, saint-paul-dabbotsford, sainte-marie-salome,
  terrasse-vaudreuil, notre-dame-de-lile-perrot.

**Finding structurant** : sur un échantillon de 10 munis « no_candidate », **8
publiaient réellement des PV** (taux de miss ~80 %). La découverte HTML-statique
sous-estime donc massivement le gisement ; le levier de rattrapage n'est pas « plus
de découverte statique » mais une **capability de rendu headless**.

## Approche proposée (à chiffrer)

Un chemin de capture **headless + session** (navigateur Chromium piloté, ex. Playwright) :

1. **Énumération** : rendre la page de séances (JS exécuté), extraire les URLs PDF
   réelles (y compris Calameo/Drive résolus), gérer la pagination « Charger plus ».
2. **Fetch** : télécharger les PDF via la session navigateur (UA navigateur), avec
   politesse (délai, rate-limit) ; dépôt CAS + manifeste identiques à la chaîne
   actuelle (mêmes invariants de preuve v2).
3. **Périmètre robots** : décision owner/juridique requise — les PV municipaux sont
   des documents publics, mais un `robots.txt` bloquant tout bot signale une
   préférence. C'est précisément ce qui rend la capability **gated** (comme le
   recalage PDF) : le franchissement du mur robots/ToS n'est pas une décision de lane.

## Dimensions de coût à chiffrer

- **Image de capture headless** (Chromium embarqué) : build + maintenance + taille
  (≫ image statique actuelle) + mémoire pod (Chromium ≫ 256Mi ; prévoir 512–1024Mi).
- **Temps par muni** : rendu + énumération + fetch ≈ 1–3 min/muni (vs ~secondes en statique).
- **Revue ToS/robots** : coût juridique/owner par classe de site (blanket-disallow vs
  simple oubli de robots).
- **Échelle du gain** : le finding ~80 % de miss suggère qu'une capability headless
  débloque une **large fraction** des 20 gaps in-cohorte restants ET du tail /1106 —
  levier probablement le plus élevé restant côté PV.

## Munis-témoins pour valider/chiffrer (1–2 par mur)

- Mur robots (A) : **saint-basile-le-grand** (`villesblg.ca`).
- Mur JS/tiers (B) : **oka** (Calameo) et **terrasse-vaudreuil** (JS, archive 2010→2026).

## Ce qui reste faisable SANS la capability (déjà fait / en cours)

- Fix données : **saint-sulpice** — l'URL de l'annuaire MAMH est un frameset
  (`municipalitesaintsulpice.com`) embarquant `st-sulpice.com` ; corriger l'annuaire
  pour pointer `st-sulpice.com` rendrait ses PV capturables en statique.
- Récupération statique : **saint-lambert** récupéré (recheck seedé → INDEXED).
- N-A prouvés : **lile-dorval** (micro-île, 0 section PV), **saint-clet** (confiance modérée).
