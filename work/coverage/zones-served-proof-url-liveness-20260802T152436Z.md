# Liveness des URL de preuve zonage servies

Sonde HTTP(S) en lecture seule, avec UA navigateur; les corps ne sont examinés qu’en mémoire et ne sont pas persistés.

Couples `(slug, url)` : **167**; slugs distincts : **167**.
Partition : LIVE=164, DEAD=0, AMBIGU=3, UNKNOWN=0.

Source : `work/coverage/served-zonage-immo-proof-url-audit-final-20260728T120900Z.json` (served-zonage-immo-proof-url-audit/v1). Recalcul : `npx tsx acquisition/src/zones-served-proof-url-liveness-sweep.ts`.
