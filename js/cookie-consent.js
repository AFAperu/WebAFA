/**
 * Cookie Consent Banner - GDPR Compliant
 * 
 * Self-injecting cookie consent banner that:
 * - Shows a banner on first visit
 * - Allows accepting all, rejecting non-essential, or configuring preferences
 * - Blocks Google Analytics until consent is given
 * - Stores preferences in localStorage
 * - Re-shows banner if preferences are cleared
 */

(function () {
  'use strict';

  const CONSENT_KEY = 'cookie_consent';
  const CONSENT_VERSION = '1'; // bump to re-ask consent

  // Detect base path from current page depth
  function getBasePath() {
    const depth = window.location.pathname.replace(/\/+$/, '').split('/').filter(Boolean).length;
    if (depth === 0) return '';
    return '../'.repeat(depth);
  }

  function getConsent() {
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.version !== CONSENT_VERSION) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function saveConsent(analytics) {
    const data = {
      version: CONSENT_VERSION,
      necessary: true, // always true
      analytics: analytics,
      timestamp: new Date().toISOString()
    };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(data));
  }

  function loadAnalytics() {
    // Only load GA if not already loaded
    if (document.querySelector('script[src*="googletagmanager"]')) return;
    // GA_MEASUREMENT_ID should be set globally or replaced here
    const gaId = window.GA_MEASUREMENT_ID || '';
    if (!gaId) return;

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + gaId;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', gaId, { anonymize_ip: true });
  }

  function removeBanner() {
    const el = document.getElementById('cookie-consent-banner');
    if (el) el.remove();
    const overlay = document.getElementById('cookie-consent-overlay');
    if (overlay) overlay.remove();
  }

  function acceptAll() {
    saveConsent(true);
    loadAnalytics();
    removeBanner();
  }

  function rejectNonEssential() {
    saveConsent(false);
    removeBanner();
  }

  function showSettings() {
    const details = document.getElementById('cookie-settings-details');
    const btn = document.getElementById('cookie-settings-btn');
    if (details) {
      const isHidden = details.style.display === 'none';
      details.style.display = isHidden ? 'block' : 'none';
      if (btn) btn.textContent = isHidden ? 'Ocultar configuración' : 'Configurar cookies';
    }
  }

  function saveSettings() {
    const analyticsCheckbox = document.getElementById('cookie-analytics-toggle');
    const analytics = analyticsCheckbox ? analyticsCheckbox.checked : false;
    saveConsent(analytics);
    if (analytics) loadAnalytics();
    removeBanner();
  }

  function injectBanner() {
    const basePath = getBasePath();

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'cookie-consent-overlay';
    document.body.appendChild(overlay);

    // Banner
    const banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Consentimiento de cookies');
    banner.innerHTML = `
      <div class="cookie-banner-content">
        <div class="cookie-banner-text">
          <p><strong>🍪 Esta web utiliza cookies</strong></p>
          <p>Usamos cookies propias y de terceros (Google Analytics) para analizar el uso del sitio y mejorar tu experiencia. Las cookies necesarias son imprescindibles para el funcionamiento básico. Puedes aceptar todas, rechazar las no esenciales o configurar tus preferencias.</p>
          <p class="cookie-banner-links">
            Más información en nuestra <a href="${basePath}politica-cookies/">Política de Cookies</a> y en el <a href="${basePath}aviso-legal/">Aviso Legal</a>.
          </p>
        </div>

        <div id="cookie-settings-details" style="display:none;">
          <div class="cookie-category">
            <label>
              <input type="checkbox" checked disabled />
              <strong>Cookies necesarias</strong> — Imprescindibles para el funcionamiento del sitio. Siempre activas.
            </label>
          </div>
          <div class="cookie-category">
            <label>
              <input type="checkbox" id="cookie-analytics-toggle" />
              <strong>Cookies analíticas (Google Analytics)</strong> — Nos ayudan a entender cómo se usa el sitio.
            </label>
          </div>
          <div class="cookie-banner-actions">
            <button id="cookie-save-settings" class="cookie-btn cookie-btn-primary">Guardar preferencias</button>
          </div>
        </div>

        <div class="cookie-banner-actions">
          <button id="cookie-accept-all" class="cookie-btn cookie-btn-primary">Aceptar todas</button>
          <button id="cookie-reject" class="cookie-btn cookie-btn-secondary">Rechazar no esenciales</button>
          <button id="cookie-settings-btn" class="cookie-btn cookie-btn-link">Configurar cookies</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    // Event listeners
    document.getElementById('cookie-accept-all').addEventListener('click', acceptAll);
    document.getElementById('cookie-reject').addEventListener('click', rejectNonEssential);
    document.getElementById('cookie-settings-btn').addEventListener('click', showSettings);
    document.getElementById('cookie-save-settings').addEventListener('click', saveSettings);
  }

  // Init
  function init() {
    const consent = getConsent();
    if (consent) {
      // Already consented — load analytics if allowed
      if (consent.analytics) loadAnalytics();
      return;
    }
    // No consent yet — show banner
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectBanner);
    } else {
      injectBanner();
    }
  }

  init();
})();
