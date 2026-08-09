# Capture ODJ — agrégat des six lots

Rapport JSON : `work/coverage/pv-capture-campaign-report-20260730t001459z.json`

1. 25 tentatives — DOCUMENT_LISIBLE_NON_PV=1, PDF_SANS_COUCHE_TEXTE=3, PV_LISIBLE_PROPRIETAIRE_CONFIRME=19, PV_LISIBLE_PROPRIETAIRE_NON_CONFIRME=2
2. 25 tentatives — DOCUMENT_LISIBLE_NON_PV=1, HTTP_404=1, HTTP_AUTRE=2, PAGE_HTML=2, PDF_SANS_COUCHE_TEXTE=2, PV_LISIBLE_PROPRIETAIRE_CONFIRME=17
3. 25 tentatives — AUTRE=1, HTTP_403=2, HTTP_AUTRE=1, PAGE_HTML=1, PV_LISIBLE_PROPRIETAIRE_CONFIRME=20
4. 25 tentatives — HTTP_AUTRE=1, PAGE_HTML=1, PDF_SANS_COUCHE_TEXTE=1, PV_LISIBLE_PROPRIETAIRE_CONFIRME=22
5. 5 tentatives — PV_LISIBLE_PROPRIETAIRE_CONFIRME=5

- Agrégat : 105 tentatives ; confirmés=83 ; 404=1 ; 403=2
- Taux d'arrêt agrégé : 83/102 = 81.37% (cible 76,7 % ; calcul sur au moins quatre lots)
- CAS : 98 distinctes durables ; 98 nouvelles (dedup=false)
- Hôtes morts journalisés : www.municipalitesayabec.com (1×404)
