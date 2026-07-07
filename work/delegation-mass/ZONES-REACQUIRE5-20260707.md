# ZONES-REACQUIRE5 - 2026-07-07

Worker: native Codex

Objectif: obtenir un seul depot net parmi `charlemagne`, `deux-montagnes`,
`dollard-des-ormeaux`, `saint-bruno-de-montarville`,
`saint-gabriel-de-brandon`, ou fournir une preuve solide d'impossibilite sous
gate strict.

## Verdict

Aucun depot effectue.

Les cinq candidats echouent le gate officiel `verify-zone-overlap` sur les
depots actuellement servis, et aucune source officielle alternative exploitable
n'a ete trouvee pendant cette passe.

## Gate strict courant

Commande:

`npx tsx acquisition/src/verify-zone-overlap.ts --slugs charlemagne,deux-montagnes,dollard-des-ormeaux,saint-bruno-de-montarville,saint-gabriel-de-brandon`

Resultat:

- `FAIL charlemagne features=1 distinct=1 codeLike=0% norms=47 overlap=0`
  - depot courant = un seul code `URB`, couche d'affectation/perimetre, pas une
    grille municipale.
- `FAIL deux-montagnes features=124 distinct=123 codeLike=100% norms=40 overlap=0`
  - vrais codes SIG, mais millesime disjoint de la grille de normes.
- `FAIL dollard-des-ormeaux features=69 distinct=69 codeLike=100% norms=31 overlap=0`
  - vrais codes SIG, mais millesime disjoint de la grille de normes.
- `FAIL saint-bruno-de-montarville features=309 distinct=309 codeLike=100% norms=20 overlap=0`
  - vrais codes SIG, mais millesime disjoint de la grille de normes.
- `FAIL saint-gabriel-de-brandon features=84 distinct=84 codeLike=0% norms=21 overlap=0`
  - depot courant numeric-only, non acceptable sans prefixe officiel.

Synthese: `pass=0`, `fail=5`, `absent=0`.

## Recherche de source alternative

### Rapports recents relus

Rapports lus en premiere phase:

- `work/parallel-runs/20260707T131451Z-zones-reacquire6.out`
- `work/parallel-runs/20260707T131451Z-zones-focus30.out`
- `acquisition/src/verify-zone-overlap.ts`
- `work/coverage/zones-reacquire6-platform-probe.json`

Contraintes retenues:

- gate officiel: `distinct>=3`, `codeLike>=50%`, et `overlap>0` quand une grille
  de normes existe;
- pas de depot depuis affectation, numerique nu, lettre seule, ou conversion de
  code inventee;
- si depot il faut ensuite lancer lot-zone-join, lots-enriched et refresh
  manifeste.

### AGOL / ArcGIS

Commande:

`node scripts/arcgis-probe.mjs agol "Charlemagne zonage" "Deux-Montagnes zonage" "Dollard-des-Ormeaux zonage" "Saint-Bruno-de-Montarville zonage" "Saint-Gabriel-de-Brandon zonage"`

Resultat:

- `Charlemagne zonage`: aucun Feature Service / Map Service.
- `Deux-Montagnes zonage`: aucun Feature Service / Map Service.
- `Dollard-des-Ormeaux zonage`: aucun Feature Service / Map Service.
- `Saint-Bruno-de-Montarville zonage`: aucun Feature Service / Map Service.
- `Saint-Gabriel-de-Brandon zonage`: aucun Feature Service / Map Service.

### Probe plateformes

Rapport ecrit: `work/coverage/zones-reacquire5-platform-probe.json`.

Synthese:

- `byPlatform`: `none=5`
- `byStatus`: `none=3`, `fetch-fail=2`

Les pages officielles qui repondent ne montrent pas de portail GIS exploitable.
Les deux fetch-fail ne justifient pas un depot: aucun service officiel separable
n'a ete trouve via AGOL, et les preuves locales disponibles pour ces deux slugs
pointent vers des echecs de gate deja caracterises.

### Preuves locales par slug

- `charlemagne`
  - `ZONES-CANONICAL` et le gate courant confirment un depot `URB` unique.
  - Aucun service AGOL ou portail statique exploitable.
  - Depot interdit: affectation/perimetre, pas zonage municipal.

- `deux-montagnes`
  - Gate courant: `123` codes code-like, `overlap=0` contre `40` codes de normes.
  - Tests locaux verrouillent explicitement `H1 != H-100`: ce n'est pas un simple
    formatage.
  - Depot de remplacement impossible sans source d'un autre millesime.

- `dollard-des-ormeaux`
  - Gate courant: `69` codes code-like, `overlap=0` contre `31` codes de normes.
  - `work/gcp/dollard-des-ormeaux-r2025.gcp.json` utilise des points derives de
    l'emprise du plan, pas des points independants fiables.
  - Rapport qualite precedent: R-2025 rejete par gate GCP independants.

- `saint-bruno-de-montarville`
  - Gate courant: `309` codes code-like, `overlap=0` contre `20` codes de normes.
  - `work/gcp/saint-bruno-de-montarville.autogcp.json` donne un recalage spatial
    autonome solide, mais le rapport qualite precedent indique `0` label valide
    contre dictionnaire; aucun depot PDF honnete.

- `saint-gabriel-de-brandon`
  - Gate courant: codes numeric-only, `codeLike=0%`, `overlap=0`.
  - Rapport qualite precedent: WFS Geocentralis `pzon` officiel numeric-only
    (`etiquette_1`), sans prefixe officiel `ID/URB/REC/REF`.
  - Conversion numeric-only -> codes reglementaires interdite.

## Actions non lancees

Pas de `lot-zone-join`, pas de `lots-enriched`, pas de refresh manifeste: aucun
depot n'a franchi le gate pre-depot.

## Conclusion

Preuve suffisante pour cette passe: les cinq candidats restants ne permettent
pas un depot net sans invention ou sans source officielle additionnelle.
