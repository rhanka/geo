# Catégorie a — PDF réellement PV ou faux positif

Enquête initiale : 30 communes vierges tirées parmi 222. Les cinq lignes `a` ont
été rouvertes par `capturedFetch` (UA navigateur, store mémoire, 117 tentatives,
aucune écriture S3/registre). Les octets sont identifiés dans le JSON par taille
et SHA-256; `Saint-Benjamin` a été rendu visuellement faute de couche texte.

| Commune | PDF indiqué par l’enquête | Verdict octets | Cause du raté / constat |
|---|---|---|---|
| Chelsea | [Avis_public_Dero_aout_2026_signe.pdf](https://www.chelsea.ca/application/files/4917/8404/4864/Avis_public_Dero_aout_2026_signe.pdf) | Faux positif : avis public de dérogation mineure | Le classifieur a pris le contexte « conseil/séance » du lien pour un PV; aucun PV prouvé dans les 11 documents bornés du chemin testé. |
| Saint-Émile-de-Suffolk | [PV PDF](https://fde7fc54-3e0b-4807-b715-8022699b3e4b.filesusr.com/ugd/18ea91_1971cc6790c6483381cb0e510fec9b32.pdf) | PV confirmé par le texte : « Procès-verbal de la séance… » | Le chemin actuel `/proces-verbaux` et le `.pdf` sont découvrables; le signal systématique est `pv.status=done`, qui exclut la commune de `pv-discover-unlisted` (`to-research` seulement). Un changement historique n’est pas prouvable avec les octets actuels. |
| Trécesson | [PDF](https://www.municipalitedetrecesson.com/_files/ugd/10bf4d_0ec9a5f142314a939082770e5a9c0052.pdf) | Faux positif : ordre du jour | Le PDF commence par « ORDRE DU JOUR »; les mentions de procès-verbal sont celles de points à l’ordre du jour, pas le document demandé. |
| Saint-René-de-Matane | [calendrier 2026](https://saintrene.ca/images/Upload/Files/calendriers_des_seances/calendrier_des_seances_2026.pdf) | Faux positif : avis public/calendrier | Le PDF décrit le calendrier des séances, pas un PV; le nom et le contexte « séances » ont suffi au classement initial. |
| Saint-Benjamin | [PDF](https://cdn.gestionweblex.ca/files/UNq96edSmu) | Faux positif confirmé visuellement : avis public/calendrier | PDF scanné sans texte; la première page dit « AVIS PUBLIC » et « CALENDRIER 2026 DES SÉANCES… ». La page configurée `/pages/proces-verbaux` répond 200 mais ne fournit pas de PV dans les liens ouverts. |

## Motif et contrôle

Le motif commun démontré est un faux positif de mesure : le rapport `a` ne
vérifiait pas le corps du PDF. Ce n’est donc pas un motif commun de chemin de
crawler prouvant un gisement de 37 communes. Le seul vrai PV est actuellement
sur un chemin canonique; le statut `done` stale/non capitalisé est le seul
blocage systématique observé. Dix communes supplémentaires, tirées des 192
restantes avec seed SHA-256 `pv-categorie-a-pdf-rates-controls-20260730T000000Z`,
ont donné **0/10 PV réel** dans le suivi borné (7 sites atteignables, 3 erreurs
de transport). Le motif ne tient donc pas sur ce contrôle.

## Chiffrage

Le `5/30 × 222 = 37,0` du rapport initial est invalidé par l’ouverture des
octets. Mesure corrigée : **1/30**, soit **1/30 × 222 = 7,4 communes** comme
extrapolation descriptive ponctuelle seulement; ce n’est pas un compte réel et le
contrôle 0/10 ne justifie pas de l’élargir. Les quatre faux positifs ne rouvrent
aucun gisement.

Voir le JSON pour les URL finales, statuts, hôtes, SHA-256, textes PDF, chemins
testés et sélection exacte des dix contrôles.
