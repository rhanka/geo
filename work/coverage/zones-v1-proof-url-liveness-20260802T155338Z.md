# Liveness des URL de preuve zonage v1

Sonde HTTP(S) en lecture seule avec UA navigateur; les corps ne sont examinés qu’en mémoire et ne sont pas persistés.

Sources Git : 3 fichier(s) correspondant à `work/coverage/zonage-proof-url-candidates-*.json`; manquants : aucun.
Couples `(slug, url)` : **242**; slugs distincts : **242**.
Par couple : LIVE=37, DEAD=186, AMBIGU=19, UNKNOWN=0.
Par slug : LIVE=37, DEAD=186, AMBIGU=19, UNKNOWN=0.
Preuve : vivante=37, morte=205.

Recalcul : `npx tsx acquisition/src/zones-v1-proof-url-liveness-sweep.ts`.
