# Cumul ODJ — mesure au 2026-07-29T03:39:49Z

Commetteur : `rhanka <fabien.antoine@m4x.org>`.

Méthode : `acquisition/src/pv-capture-campaign-audit.ts`, union des manifests vérifiés et des 12 rapports complets admis, déduplication stricte sur `storage_key` CAS. Le périmètre campagne seul ratait les 4 runs bruts du 28/07 et les 5 runs `pv-20260729T0234*`; ils sont rejoints au même auditeur. Les 5 manifests sans `run.json` restent non terminaux et sont exclus par la règle de référence.

Résultat : **948 clés CAS ODJ captées durablement**, dont **656 clés CAS confirmées à l’ouverture** (`PV_LISIBLE_PROPRIETAIRE_CONFIRME`) et 292 captées non confirmées : `948 = 656 + 292`. Donc **656 est reproductible** uniquement avec cette définition d’union terminalement admissible; le run de contrôle `pv-20260728T165200Z` est `unknown` car son rapport porte un préfixe S3 avec une casse divergente que l’auditeur rejette.

Le dénominateur `3058` vient du plan ODJ 2025–2026 (`1163 + 1895`) issu du snapshot d’index hashé `b32…`, pas d’une sonde. Le KPI demandé se compare comme `656/3058`; `948/3058` mesure séparément la capture durable.
