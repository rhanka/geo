# Couverture municipale PV

Définition : une municipalité est couverte si au moins un document CAS lui est projeté après déduplication et porte le verdict `INDEXED`, avec propriétaire imprimé confirmé. Une capture non indexée et tout refus restent exclus.

Mesure : **640/1106** municipalités. Clés CAS dédupliquées : 6934; clés finales `INDEXED` : 5958.
Écart au 640 annoncé : **0** (La réunion CAS-dédoublonnée projette exactement les cinq composantes annoncées; leurs ensembles de slugs sont disjoints.).
Unknown : **83** clés (UNKNOWN_NO_TERMINAL_PV_MANIFEST=83, UNKNOWN_AMBIGUOUS_MANIFEST_SCOPE=0, UNCLASSIFIED_NO_TERMINAL_VERDICT=0); sources manquantes/injoignables : 0.

La liste complète des slugs est dans l’artefact JSON voisin. Recalcul : `npx tsx acquisition/src/pv-couverture-municipale.ts --out=work/coverage/<UTC>.json --markdown=work/coverage/<UTC>.md`.
