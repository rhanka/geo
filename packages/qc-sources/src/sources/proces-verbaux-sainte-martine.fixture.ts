/**
 * Real procès-verbaux fixture data for Sainte-Martine (MRC Beauharnois-Salaberry) unit tests.
 *
 * HONESTY (rules/MASTER.md §Fair Benchmarking + ANTI-INVENTION):
 * ALL data is derived verbatim from PUBLIC documents captured 2026-06-10 from:
 *   - Index HTML: https://sainte-martine.ca/municipalite/administration-et-finances/publications/?document_type=proces-verbaux
 *     HTTP 200, 229 581 bytes, public / no login.
 *     robots.txt: User-agent: * / Disallow: (empty — no restrictions).
 *   - PV PDF (April 14, 2026):
 *     https://sainte-martine.ca/wp-content/uploads/2026/05/conseil-avril-2026.pdf
 *     HTTP 200, 359 080 bytes (PDF), extracted via pdftotext → 43 198 bytes.
 *
 * Nothing is fabricated. Only excerpts are included to keep fixture size
 * reasonable. Each section is labelled with source URL and fetch date.
 *
 * TWO fixtures are provided:
 *   1. PV_SAINTE_MARTINE_INDEX_HTML — verbatim HTML excerpt from the publications page
 *      (document-item structure with PDF links).
 *   2. PV_SAINTE_MARTINE_2026_04_TEXT — pdftotext excerpt from the real April 14, 2026 PV.
 *      Contains "avis de motion" for règlements 2026-507, 2026-508, 2026-509, 2026-510,
 *      2026-511.  Règlement 2026-510 and 2026-511 modify "Règlement de zonage numéro
 *      2019-342" (zone MxtV-2).
 *
 *      DETECTED (precision-filtered — anti-sur-agrégation):
 *        avisDeMotion=true, changementZonage=true
 *        reglementNumbers=[2026-510]   ← only the real zonage règlement
 *        (2026-507/508/509 excluded: no "zonage" in their immediate context;
 *         2019-342 excluded: it is the OLD règlement being modified, not new;
 *         2011-185/2019-341 excluded: not zonage règlements)
 *
 * HTTP + robots.txt status (confirmed 2026-06-10):
 *   - https://sainte-martine.ca/ → HTTP 200
 *   - https://sainte-martine.ca/robots.txt → Disallow: (empty — no restrictions)
 *   - Target page is a public publications page → scraping allowed
 */

/**
 * Real HTML snippet from the PV publications page of Municipalité de Sainte-Martine,
 * captured 2026-06-10 from:
 * https://sainte-martine.ca/municipalite/administration-et-finances/publications/?document_type=proces-verbaux
 *
 * Key PDF links present:
 *   - conseil-avril-2026.pdf (Procès-verbal – 14 avril 2026)
 *   - conseil-mars-2026-vf.pdf (Procès-verbal – 17 mars 2026)
 *   - conseil-mars-2026-extra.pdf (Procès-verbal – 2 mars 2026 – Séance extraordinaire)
 *   - conseil-fevrier-2026.pdf (Procès-verbal – 10 février 2026)
 *   - conseil-janvier-2026.pdf (Procès-verbal – 20 janvier 2026)
 *   - conseil-decembre-2025-budget.pdf (Procès-verbal – 16 décembre 2025 – Budget)
 *   - conseil-decembre-2025.pdf (Procès-verbal – 16 décembre 2025)
 *   - conseil-novembre-2025-vf.pdf (Procès-verbal – 18 novembre 2025)
 *   - conseil-octobre-2025-vf.pdf (Procès-verbal – 1er octobre 2025)
 *   - conseil-septembre-2025.pdf (Procès-verbal – 9 septembre 2025)
 */
export const PV_SAINTE_MARTINE_INDEX_HTML = `
<div class="documents-list">
  <div class="document-item">
    <div class="content">
      <a href="https://sainte-martine.ca/wp-content/uploads/2026/05/conseil-avril-2026.pdf" target="_blank" class="title">
        <h3>Procès-verbal &#8211; 14 avril 2026</h3>
      </a>
    </div>
  </div>
  <div class="document-item">
    <div class="content">
      <a href="https://sainte-martine.ca/wp-content/uploads/2026/04/conseil-mars-2026-vf.pdf" target="_blank" class="title">
        <h3>Procès-verbal &#8211; 17 mars 2026</h3>
      </a>
    </div>
  </div>
  <div class="document-item">
    <div class="content">
      <a href="https://sainte-martine.ca/wp-content/uploads/2026/02/conseil-mars-2026-extra.pdf" target="_blank" class="title">
        <h3>Procès-verbal &#8211; 2 mars 2026 &#8211; Séance extraordinaire</h3>
      </a>
    </div>
  </div>
  <div class="document-item">
    <div class="content">
      <a href="https://sainte-martine.ca/wp-content/uploads/2026/02/conseil-fevrier-2026.pdf" target="_blank" class="title">
        <h3>Procès-verbal &#8211; 10 février 2026</h3>
      </a>
    </div>
  </div>
  <div class="document-item">
    <div class="content">
      <a href="https://sainte-martine.ca/wp-content/uploads/2026/02/conseil-janvier-2026.pdf" target="_blank" class="title">
        <h3>Procès-verbal &#8211; 20 janvier 2026</h3>
      </a>
    </div>
  </div>
  <div class="document-item">
    <div class="content">
      <a href="https://sainte-martine.ca/wp-content/uploads/2026/01/conseil-decembre-2025-budget.pdf" target="_blank" class="title">
        <h3>Procès-verbal &#8211; 16 décembre 2025 &#8211; Budget</h3>
      </a>
    </div>
  </div>
  <div class="document-item">
    <div class="content">
      <a href="https://sainte-martine.ca/wp-content/uploads/2026/01/conseil-decembre-2025.pdf" target="_blank" class="title">
        <h3>Procès-verbal &#8211; 16 décembre 2025</h3>
      </a>
    </div>
  </div>
  <div class="document-item">
    <div class="content">
      <a href="https://sainte-martine.ca/wp-content/uploads/2025/12/conseil-novembre-2025-vf.pdf" target="_blank" class="title">
        <h3>Procès-verbal &#8211; 18 novembre 2025</h3>
      </a>
    </div>
  </div>
  <div class="document-item">
    <div class="content">
      <a href="https://sainte-martine.ca/wp-content/uploads/2025/11/conseil-octobre-2025-vf.pdf" target="_blank" class="title">
        <h3>Procès-verbal &#8211; 1er octobre 2025</h3>
      </a>
    </div>
  </div>
  <div class="document-item">
    <div class="content">
      <a href="https://sainte-martine.ca/wp-content/uploads/2025/10/conseil-septembre-2025.pdf" target="_blank" class="title">
        <h3>Procès-verbal &#8211; 9 septembre 2025</h3>
      </a>
    </div>
  </div>
</div>
`;

/**
 * Real pdftotext excerpt from the April 14, 2026 ordinary council session PV of
 * Municipalité de Sainte-Martine, captured 2026-06-10 from:
 * https://sainte-martine.ca/wp-content/uploads/2026/05/conseil-avril-2026.pdf
 *
 * This excerpt covers the "avis de motion" section (règlements 2026-507 through 2026-511).
 *
 * Détection attendue après correction anti-sur-agrégation (honest, anti-invention):
 *   - avisDeMotion: true (multiple "Donne avis de motion" for règlements 2026-507..2026-511)
 *   - changementZonage: true (Règlement 2026-510 modifying "Règlement de zonage numéro
 *     2019-342 afin d'agrandir la zone MxtV-2"; idem 2026-511 if in excerpt)
 *   - reglementNumbers: ["2026-510"]  ← SEUL le vrai règlement de zonage
 *     (les autres exclus car leur contexte immédiat ne contient pas "zonage")
 *   - zoneRefs: ["MxtV-2"] (capturée par ZONE_CODE_CONTEXT_RE: "zone MxtV-2")
 *
 * Preuve tirée du texte réel :
 *   Règlement 2026-507 = contrôle et garde des animaux (PAS de "zonage" → exclus).
 *   Règlement 2026-508 = nuisances, modifiant règlement 2011-185 (PAS de "zonage" → exclus).
 *   Règlement 2026-509 = plan d'urbanisme, modifiant règlement 2019-341
 *     ("plan d'urbanisme" ≠ "règlement de zonage" / "règlement d'urbanisme" → exclus).
 *   Règlement 2026-510 = modifiant le "Règlement de zonage numéro 2019-342", zone MxtV-2
 *     → ZONAGE CONFIRMÉ, seul numéro retenu dans reglementNumbers.
 *     "zone MxtV-2" capturée par ZONE_CODE_CONTEXT_RE (casse mixte + 1 chiffre).
 *   Règlement 2019-342 = ancien règlement modifié (cible de "modifiant le Règlement de
 *     zonage numéro 2019-342") → exclu par filterNewReglements().
 *   Règlement 2026-511 = hors-fixture (non inclus dans cet extrait).
 */
export const PV_SAINTE_MARTINE_2026_04_TEXT = `Avis de motion et dépôt du projet de Règlement numéro 2026-507 relatif au
contrôle et à la garde des animaux
Madame Mélanie Lefort, mairesse, par la présente:
▪

Donne avis de motion qu'il sera présenté pour adoption, lors d'une séance
subséquente, le Règlement numéro 2026-507 relatif au contrôle et à la
garde des animaux ;

▪

Dépose le projet du Règlement numéro 2026-507.

Avis de motion et dépôt du projet de Règlement numéro 2026-508 modifiant le
Règlement numéro 2011-185 portant sur les nuisances (RMH-450)
Madame Mélanie Lefort, mairesse, par la présente:
▪

Donne avis de motion qu'il sera présenté pour adoption, lors d'une séance
subséquente, le Règlement numéro 2026-508 modifiant le Règlement
numéro 2011-185 portant sur les nuisances (RMH-450) ;

▪

Dépose le projet du Règlement numéro 2026-508.

Avis de motion du Règlement numéro 2026-509 modifiant le Règlement
numéro 2019-341 concernant le plan d'urbanisme afin d'agrandir l'aire
d'affectation Mixte villageoise
Madame Mélanie Lefort, mairesse, par la présente:
▪

Donne avis de motion qu'il sera présenté pour adoption, lors d'une séance
subséquente, le Règlement numéro 2026-509 modifiant le Règlement
numéro 2019-341 concernant le plan d'urbanisme afin d'agrandir l'aire
d'affectation Mixte villageoise.

2026-04-079 : Adoption du Projet de Règlement numéro 2026-509 modifiant le
Règlement numéro 2019-341 concernant le plan d'urbanisme afin d'agrandir
l'aire d'affectation Mixte villageoise
Attendu que la Loi sur l'aménagement et l'urbanisme permet à la Municipalité de
modifier son plan d'urbanisme ;
Attendu la résolution numéro 2026-03-059 par laquelle le conseil a approuvé la
demande de modification réglementaire numéro 2025-016 relative au 122, rue
Saint-Joseph ;
Attendu qu'un avis de motion a été donné lors de la séance ordinaire du conseil
municipal tenue le 14 avril 2026 ;
En conséquence,
Il est proposé par madame Karine Ferlatte-Schofield
Appuyé par madame Stéphanie Julien
Et résolu à l'unanimité des membres présents
Que le Projet de Règlement numéro 2026-509 modifiant le Règlement
numéro 2019-341 concernant le plan d'urbanisme afin d'agrandir l'aire
d'affectation Mixte villageoise soit adopté.
Adoptée

Avis de motion du Règlement numéro 2026-510 modifiant le Règlement de
zonage numéro 2019-342 afin d'agrandir la zone MxtV-2
Madame Mélanie Lefort, mairesse, par la présente:
▪

Donne avis de motion qu'il sera présenté pour adoption, lors d'une séance
subséquente, le Règlement numéro 2026-510 modifiant le Règlement de
zonage numéro 2019-342 afin d'agrandir la zone MxtV-2.

2026-04-080 : Adoption du Premier projet de Règlement numéro 2026-510
modifiant le Règlement de zonage numéro 2019-342 afin d'agrandir la
zone MxtV-2
Attendu que la Loi sur l'aménagement et l'urbanisme permet à la Municipalité de
modifier son règlement de zonage ;
Attendu la résolution numéro 2026-03-059 par laquelle le conseil a approuvé la
demande de modification réglementaire numéro 2025-016 relative au 122, rue
Saint-Joseph ;
Attendu que le présent projet de règlement permet d'assurer la concordance au
plan d'urbanisme, modifié par le projet de Règlement numéro 2026-509 ;
Attendu qu'un avis de motion a été donné lors de la séance ordinaire du conseil
municipal tenue le 14 avril 2026 ;
En conséquence,
Il est proposé par monsieur Alexandre Bissonnette
Appuyé par monsieur Normand Sauvé
Et résolu à l'unanimité des membres présents
Que le Premier projet de Règlement numéro 2026-510 modifiant le Règlement
de zonage numéro 2019-342 afin d'agrandir la zone MxtV-2 soit adopté.
Adoptée
`;
