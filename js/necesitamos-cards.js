/**
 * Renders the "Necesitamos" cards from data/necesitamos.json.
 * Each record is a short paragraph plus a contact button that opens
 * the visitor's email client with a prefilled message.
 */

const DATA_PATH = '../data/necesitamos.json';
const DEFAULT_EMAIL = 'afaceipperu@gmail.com';

const ICONS = {
  user: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  mail: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>'
};

/** Escapes text before interpolating it into innerHTML. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Builds the mailto: URL that opens the visitor's email application. */
function buildMailto(necesidad) {
  const email = necesidad.email || DEFAULT_EMAIL;
  const subject = 'Quiero ayudar a la AFA';
  const saludo = necesidad.contacto ? `Hola, ${necesidad.contacto}:` : 'Hola:';
  const body =
    `${saludo}\n\nHe visto en la web de la AFA que necesitáis ayuda con esto:\n\n` +
    `"${necesidad.descripcion}"\n\nMe gustaría echar una mano.\n\n` +
    `Mi nombre es:\nMi teléfono es:\n\nGracias.`;

  return `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}` +
    `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function renderCard(necesidad) {
  const contacto = necesidad.contacto
    ? `<div class="necesita-meta">${ICONS.user}<span>Contacta con <strong>${esc(necesidad.contacto)}</strong></span></div>`
    : '';

  return `
    <article class="extra-card necesita-card">
      <div class="extra-card-body">
        <p class="necesita-desc">${esc(necesidad.descripcion)}</p>
        <div class="necesita-footer">
          ${contacto}
          <a href="${esc(buildMailto(necesidad))}" class="lk gh dk rg tc wf xf _l gi hi extra-card-btn">${ICONS.mail}<span>Quiero ayudar</span></a>
        </div>
      </div>
    </article>`;
}

async function init() {
  const container = document.getElementById('necesitamos-container');
  if (!container) return;

  try {
    const res = await fetch(DATA_PATH);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { necesidades } = await res.json();

    const visibles = (necesidades || []).filter(n => n.descripcion);

    if (visibles.length === 0) {
      container.innerHTML =
        '<div class="no-results-msg">Ahora mismo no necesitamos nada en concreto. ' +
        '¡Gracias por pasarte! Vuelve pronto o escríbenos si quieres colaborar.</div>';
      return;
    }

    container.innerHTML = visibles.map(renderCard).join('');
  } catch (err) {
    console.error('[Necesitamos]', err);
    container.innerHTML = '<p class="loading-msg">⚠️ No se pudieron cargar las necesidades.</p>';
  }
}

init();

export { buildMailto, renderCard, esc };
