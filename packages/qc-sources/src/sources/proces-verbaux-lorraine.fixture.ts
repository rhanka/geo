/**
 * Real procès-verbaux fixture data for Lorraine (MRC Thérèse-De Blainville) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://lorraine.ca/conseil-municipal
 *     HTTP 200 (October CMS), direct PV links under /storage/app/media/.
 *     robots.txt: Disallow /administration, /administration/, /administration/backend,
 *     /administration/backend/ — content pages (conseil-municipal) are allowed.
 *   - PV PDF (April 14, 2026):
 *     https://lorraine.ca/storage/app/media/decouvrir/bienvenue-a-lorraine/conseil-municipal/proces-verbaux/2026/PV_2026-04-14_Signe.pdf
 *     HTTP 200, text layer present (pdftotext → 1409 lines).
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_LORRAINE_INDEX_HTML — verbatim HTML excerpt from the PV index page
 *      (c-document-card links, October CMS, same CMS family as Sainte-Thérèse/Deux-Montagnes).
 *   2. PV_LORRAINE_2026_04_TEXT — pdftotext excerpt from the April 14, 2026 PV.
 *      Contains:
 *        - Avis de motion for Règlement URB-03-17 modifying Règlement URB-03 sur le zonage
 *          (changes to authorized usages in zones I-133 and I-226, corrections to grille R-301)
 *        - Adoption of first project of Règlement URB-03-17 with public consultation
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://lorraine.ca/ → HTTP 200
 *   - https://lorraine.ca/robots.txt → Disallow: /administration, /administration/,
 *     /administration/backend, /administration/backend/ only
 *   - Target page (conseil-municipal) is NOT under /administration → scraping allowed
 *
 * Détection attendue (honest, anti-invention):
 *   - avisDeMotion: true
 *     ("Avis de motion est donné par monsieur le conseiller Jocelyn Proulx, qu'à une séance
 *      du conseil subséquente, sera adopté le Règlement URB-03-17 modifiant le
 *      « Règlement URB-03 sur le zonage »")
 *     → AVIS_MOTION_RE matches "Avis de motion est donné"
 *   - changementZonage: true (2026-06-10: fixed by REGLEMENT_MULTIPREFIX_RE)
 *     REGLEMENT_MULTIPREFIX_RE matches "Règlement URB-03-17" in the same paragraph
 *     where ZONAGE_KEYWORDS_RE fires on "le zonage". The ANTI-FP guard (only applied
 *     in confirmed zonage context) prevents false positives from non-zonage bylaws.
 *   - reglementNumbers: ["URB-03-17"]
 *     URB-03 (the existing règlement being modified) is identified by
 *     MODIFIANT_REGLEMENT_MULTIPREFIX_RE from "modifiant le « Règlement URB-03 »"
 *     and excluded via filterNewReglements.
 *   - NOTE: Lorraine uses multi-letter-prefix règlement numbering (URB-). Handled by the
 *     new REGLEMENT_MULTIPREFIX_RE pattern alongside V-prefix (Saint-Rémi) and
 *     single-letter-prefix (Châteauguay/Mirabel) patterns.
 */

/**
 * Real HTML snippet from the PV index page of Ville de Lorraine,
 * captured 2026-06-10 from:
 * https://lorraine.ca/conseil-municipal
 *
 * Key PV PDF links present (c-document-card format, October CMS):
 *   - PV_2026-04-14_Signe.pdf (April 14, 2026)
 *   - PV_SE_2026-03-24_Sign.pdf (March 24, 2026 extraordinary)
 *   - PV_2026-03-10_Sign.pdf (March 10, 2026)
 *   - PV_2026-02-10_Sign.pdf (February 10, 2026)
 *   - PV_2026-01-13_Sign.pdf (January 13, 2026)
 *   - Several 2025 PVs
 *
 * Same c-document-card CMS markup as Sainte-Thérèse / Deux-Montagnes / Blainville.
 */
export const PV_LORRAINE_INDEX_HTML = `
<div class="c-rubric-card__documents">
    <a class="c-document-card || js-log-link-click-count" href="https://lorraine.ca/storage/app/media/decouvrir/bienvenue-a-lorraine/conseil-municipal/proces-verbaux/2026/PV_2026-04-14_Signe.pdf" target="_blank" rel="noopener noreferrer">
        <div class="c-document-card__content">
            <span class="c-document-card__surtitle">Séance ordinaire</span>
            <h3 class="c-document-card__title">Procès-verbal - 14 avril 2026</h3>
        </div>
    </a>
    <a class="c-document-card || js-log-link-click-count" href="https://lorraine.ca/storage/app/media/decouvrir/bienvenue-a-lorraine/conseil-municipal/proces-verbaux/2026/PV_SE_2026-03-24_Sign.pdf" target="_blank" rel="noopener noreferrer">
        <div class="c-document-card__content">
            <span class="c-document-card__surtitle">Séance extraordinaire</span>
            <h3 class="c-document-card__title">Procès-verbal - 24 mars 2026</h3>
        </div>
    </a>
    <a class="c-document-card || js-log-link-click-count" href="https://lorraine.ca/storage/app/media/decouvrir/bienvenue-a-lorraine/conseil-municipal/proces-verbaux/2026/PV_2026-03-10_Sign.pdf" target="_blank" rel="noopener noreferrer">
        <div class="c-document-card__content">
            <span class="c-document-card__surtitle">Séance ordinaire</span>
            <h3 class="c-document-card__title">Procès-verbal - 10 mars 2026</h3>
        </div>
    </a>
    <a class="c-document-card || js-log-link-click-count" href="https://lorraine.ca/storage/app/media/decouvrir/bienvenue-a-lorraine/conseil-municipal/proces-verbaux/2026/PV_2026-02-10_Sign.pdf" target="_blank" rel="noopener noreferrer">
        <div class="c-document-card__content">
            <span class="c-document-card__surtitle">Séance ordinaire</span>
            <h3 class="c-document-card__title">Procès-verbal – 10 février 2026</h3>
        </div>
    </a>
    <a class="c-document-card || js-log-link-click-count" href="https://lorraine.ca/storage/app/media/decouvrir/bienvenue-a-lorraine/conseil-municipal/proces-verbaux/2026/PV_2026-01-13_Sign.pdf" target="_blank" rel="noopener noreferrer">
        <div class="c-document-card__content">
            <span class="c-document-card__surtitle">Séance ordinaire</span>
            <h3 class="c-document-card__title">Procès-verbal – 13 janvier 2026</h3>
        </div>
    </a>
    <a class="c-document-card || js-log-link-click-count" href="https://lorraine.ca/storage/app/media/decouvrir/bienvenue-a-lorraine/conseil-municipal/proces-verbaux/2025/PV_2025-12-09_Sign.pdf" target="_blank" rel="noopener noreferrer">
        <div class="c-document-card__content">
            <span class="c-document-card__surtitle">Séance ordinaire</span>
            <h3 class="c-document-card__title">Procès-verbal – 9 décembre 2025</h3>
        </div>
    </a>
    <a class="c-document-card || js-log-link-click-count" href="https://lorraine.ca/storage/app/media/decouvrir/bienvenue-a-lorraine/conseil-municipal/proces-verbaux/2025/PV_2025-11-11_Sign.pdf" target="_blank" rel="noopener noreferrer">
        <div class="c-document-card__content">
            <span class="c-document-card__surtitle">Séance ordinaire</span>
            <h3 class="c-document-card__title">Procès-verbal – 11 novembre 2025</h3>
        </div>
    </a>
</div>
`;

/**
 * Real pdftotext excerpt from the April 14, 2026 PV of Ville de Lorraine,
 * captured 2026-06-10 from:
 * https://lorraine.ca/storage/app/media/decouvrir/bienvenue-a-lorraine/conseil-municipal/proces-verbaux/2026/PV_2026-04-14_Signe.pdf
 *
 * Key sections:
 *   6.3 (résolution 2026-04-77): AVIS DE MOTION ET DÉPÔT du Règlement URB-03-17
 *       modifiant le « Règlement URB-03 sur le zonage » concernant des changements
 *       aux usages autorisés dans les zones I-133 et I-226 et des corrections dans
 *       les notes de la grille R-301
 *   7.1 (résolution 2026-04-78): ADOPTION DU PREMIER PROJET DE RÈGLEMENT URB-03-17
 *       (soumettre à une assemblée publique de consultation)
 *
 * Détection honnête (mise à jour 2026-06-10 — REGLEMENT_MULTIPREFIX_RE):
 *   - avisDeMotion: true
 *     (AVIS_MOTION_RE: "Avis de motion est donné" matches)
 *   - changementZonage: true
 *     (REGLEMENT_MULTIPREFIX_RE captures URB-03-17; ZONAGE_KEYWORDS_RE fires on "le zonage")
 *   - reglementNumbers: ["URB-03-17"]
 *     (URB-03 excluded by MODIFIANT_REGLEMENT_MULTIPREFIX_RE → filterNewReglements)
 *   - NOTE: "zones I-133 et I-226" are zone codes (not règlement numbers) → not captured
 *     by REGLEMENT_MULTIPREFIX_RE (single letter before dash → doesn't match [A-Z]{2,4})
 */
export const PV_LORRAINE_2026_04_TEXT = `
2026-04-14

PROCÈS-VERBAL d'une séance ordinaire du conseil municipal de la
Ville de Lorraine, tenue à la salle du Conseil, le 14 avril 2026.

6.3
2026-04-77

AVIS DE MOTION ET DÉPÔT DU PROJET DE RÈGLEMENT - Règlement URB-0317 modifiant le «Règlement URB-03 sur le zonage» concernant des
changements aux usages autorisés dans les zones 1-133 et I-226 et des
corrections dans les notes de la grille R-301

Avis de motion est donné par monsieur le conseiller Jocelyn Proulx, qu'à une séance
du conseil subséquente, sera adopté le Règlement URB-03-17 modifiant le
« Règlement URB-03 sur le zonage » concernant des changements aux usages
autorisés dans les zones I-133 et 1-226 et des corrections dans les notes de la grille R301.

Monsieur le conseiller Jocelyn Proulx dépose également ledit projet de règlement,
lequel a pour objet de changer les usages autorisés dans les zones l-133 et l-226 et
de corriger les notes de la grille R-301.
Suivant la séance, une copie du projet de règlement ainsi déposé sera mise à la
disposition du public via le site Internet de la Ville.

ADOPTION DES RÈGLEMENTS
7.1

2026-04-78

ADOPTION DU PREMIER PROJET DE RÈGLEMENT - Règlement URB-03-17
modifiant le « Règlement URB-03 sur le zonage » concernant des changements
aux usages autorisés dans les zones l-133 et l-226 et des corrections dans les
notes de la grille R-301

CONSIDÉRANT QU'à cette même séance, le projet de Règlement URB-03-17 a été
déposé et qu'un avis de motion a été donné conformément aux dispositions de la Loi
sur les cités et villes;

CONSIDÉRANT QUE ce Règlement a pour objet de changer les usages autorisés
dans les zones l-133 et l-226 et de corriger les notes de la grille R-301;

CONSIDÉRANT QUE depuis le dépôt de l'avis de motion, aucun changement de
nature à changer l'objet du règlement n'a été apporté au projet de règlement aujourd'hui
soumis pour adoption;

CONSIDÉRANT QUE ce projet de Règlement contient des dispositions susceptibles
d'approbation référendaire;

EN CONSÉQUENCE,

Il est PROPOSÉ par monsieur le conseiller Jocelyn Proulx
APPUYÉ par monsieur le conseiller Patrick Archambault
et RÉSOLU à l'unanimité,

D'ADOPTER le premier projet de Règlement URB-03-17 modifiant le « Règlement
URB-03 sur le zonage » concernant des changements aux usages autorisés dans les
zones I-133 et l-226 et des corrections dans les notes de la grille R-301;

DE SOUMETTRE ce projet à une assemblée publique de consultation;
D'AUTORISER le greffier par intérim ou l'assistante-greffière à fixer les modalités de
l'assemblée publique de consultation, incluant la publication d'un avis public à cet effet.
`;
