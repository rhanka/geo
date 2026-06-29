/**
 * Recorded REAL HTML excerpt from the live Valleyfield avis-publics page,
 * captured 2026-06-01 from https://www.ville.valleyfield.qc.ca/avis-publics.
 * Four genuine notices (verbatim markup) used to unit-test the parser without
 * hitting the network. NOTHING here is fabricated: it is a faithful slice of
 * the source document. Single canonical fixture, shared by the RECUEIL adapter
 * tests and the automation-benchmark connector tests.
 */
export const AVIS_PUBLICS_FIXTURE_HTML = `
<div class="accordions__inside">
  <div class="mb-1/3">
    <a class="icon-block icon-block--is-link" target="_blank" href="https://dua3m7xvptjbw.cloudfront.net/documents/avis/2026-05-20-Avis-de-derogation-mineure.pdf" download>
      <div class="icon-block__icon-bg">
        <svg class="icon-block__icon"><use xlink:href="#sdv-icon__file"></use></svg>
      </div>
      <div class="icon-block__text-wrapper">
        <span class="sr-only">Télécharger:</span>
        <div class="icon-block__title">Dérogations mineures du 20 mai 2026</div>
        <div class="icon-block__text icon-block__date">20 mai 2026</div>
      </div>
    </a>
  </div>
  <div class="mb-1/3">
    <a class="icon-block icon-block--is-link" target="_blank" href="https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_Avis-Registre-150-49-1.pdf" download>
      <div class="icon-block__icon-bg">
        <svg class="icon-block__icon"><use xlink:href="#sdv-icon__file"></use></svg>
      </div>
      <div class="icon-block__text-wrapper">
        <span class="sr-only">Télécharger:</span>
        <div class="icon-block__title">Avis public - Procédure de demande de scrutin référendaire pour le Règlement 150-49-1</div>
        <div class="icon-block__text icon-block__date">22 avril 2026</div>
      </div>
    </a>
  </div>
  <div class="mb-1/3">
    <a class="icon-block icon-block--is-link" target="_blank" href="https://dua3m7xvptjbw.cloudfront.net/documents/avis/Avis-entree-en-vigueur-des-Reglements-209-47-et-216-34.pdf" download>
      <div class="icon-block__icon-bg">
        <svg class="icon-block__icon"><use xlink:href="#sdv-icon__file"></use></svg>
      </div>
      <div class="icon-block__text-wrapper">
        <span class="sr-only">Télécharger:</span>
        <div class="icon-block__title">Avis public d&#039;entrée en vigueur des règlements 209-47 et 216-34</div>
        <div class="icon-block__text icon-block__date">20 mai 2026</div>
      </div>
    </a>
  </div>
  <div class="mb-1/3">
    <a class="icon-block icon-block--is-link" target="_blank" href="https://dua3m7xvptjbw.cloudfront.net/documents/avis/PPCMOI2026-0066-Avis-public-assemblee-de-consultation.pdf" download>
      <div class="icon-block__icon-bg">
        <svg class="icon-block__icon"><use xlink:href="#sdv-icon__file"></use></svg>
      </div>
      <div class="icon-block__text-wrapper">
        <span class="sr-only">Télécharger:</span>
        <div class="icon-block__title">Assemblée publique de consultation à propos de la demande PPCMOI2026-0066</div>
        <div class="icon-block__text icon-block__date">20 mai 2026</div>
      </div>
    </a>
  </div>
</div>
`;
