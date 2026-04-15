/**
 * Banner Component
 * A reusable notification banner that loads content from banner-config.json
 * Matches the existing website's look and feel with dark/light theme support
 */

class BannerComponent {
  constructor() {
    this.banner = null;
    this.config = null;
    this.isDismissed = false;
    this.init();
  }

  async init() {
    try {
      await this.loadConfig();
      if (this.config && this.config.enabled && !this.isDismissed) {
        this.createBanner();
        this.attachEventListeners();
      }
    } catch (error) {
      console.warn('Banner component failed to initialize:', error);
    }
  }

  async loadConfig() {
    try {
      const response = await fetch('js/banner-config.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      this.config = await response.json();
    } catch (error) {
      console.warn('Failed to load banner configuration:', error);
      // For file:// protocol, try to read the config from a global variable or embedded config
      // This allows testing without a server while still respecting the JSON settings
      if (window.bannerConfig) {
        this.config = window.bannerConfig;
      } else {
        this.config = null;
      }
    }
  }

  createBanner() {
    if (!this.config || !this.config.enabled || !this.config.message || this.config.message.trim() === '') return;

    // Check if banner was previously dismissed
    const dismissedKey = `banner-dismissed-${this.hashConfig()}`;
    if (localStorage.getItem(dismissedKey) === 'true') {
      this.isDismissed = true;
      return;
    }

    // Create banner HTML
    this.banner = document.createElement('div');
    this.banner.id = 'notification-banner';
    this.banner.className = this.getBannerClasses();
    
    this.banner.innerHTML = `
      <div class="animate_left bb ze ki xn 2xl:ud-px-0">
        <div class="tc wf xf rj">
          <div class="banner-content tc wf xf ig vk sg rg ${this.getContentClasses()} ai">
            <div class="banner-text tc wf xf ig oc">
              
              <span class="ek lk wm">${this.config.message}</span>
            </div>
            ${this.config.link && this.config.link.text && this.config.link.text.trim() !== '' ? `
              <a href="${this.config.link.url}" class="banner-link vc ek lk xl ml il _l rg gi hi oc">
                ${this.config.link.text}
              </a>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    // Insert banner as a section between Hero and Features sections
    const main = document.querySelector('main');
    const featuresSection = document.querySelector('#features');
    
    if (main && featuresSection) {
      // Insert banner right before the Features section
      main.insertBefore(this.banner, featuresSection);
    } else {
      // Fallback: insert after hero section
      const heroSection = main ? main.querySelector('section') : null;
      if (heroSection && heroSection.nextElementSibling) {
        main.insertBefore(this.banner, heroSection.nextElementSibling);
      } else if (main) {
        // Insert at the beginning of main if no hero found
        main.insertBefore(this.banner, main.firstChild);
      } else {
        // Last fallback: insert at the top of body
        document.body.insertBefore(this.banner, document.body.firstChild);
      }
    }

    // Re-trigger ScrollReveal for the dynamically injected banner
    if (typeof sr !== 'undefined') {
      sr.reveal('#notification-banner .animate_top', {
        origin: 'top',
        interval: 100
      });
    }
  }

  getBannerClasses() {
    // Section-style classes with theme-aware background
    const baseClasses = 'ji gp uq i'; // Relative positioning
    // Add white background for light theme, dark background for dark theme
    const themeClasses = 'hh sm'; // hh = white bg in light mode, sm = dark bg in dark mode (from CSS)
    return `${baseClasses} ${themeClasses}`;
  }

  getContentClasses() {
    // Blue content area classes based on banner type
    const typeClasses = {
      'info': 'gh', // Blue background
      'success': 'nh', // Green background  
      'warning': 'oh', // Orange background
      'error': 'kh' // Red background
    };
    
    return typeClasses[this.config.type] || typeClasses.info;
  }

  

  attachEventListeners() {
    if (!this.banner) return;

    // Handle link clicks
    const link = this.banner.querySelector('a');
    if (link && link.getAttribute('href').startsWith('#')) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }
  }

  dismissBanner() {
    if (!this.banner) return;

    // Store dismissal in localStorage
    const dismissedKey = `banner-dismissed-${this.hashConfig()}`;
    localStorage.setItem(dismissedKey, 'true');

    // Animate banner out
    this.banner.style.transform = 'translateY(-100%)';
    this.banner.style.opacity = '0';
    
    setTimeout(() => {
      if (this.banner && this.banner.parentNode) {
        this.banner.parentNode.removeChild(this.banner);
      }
      this.banner = null;
      this.isDismissed = true;
    }, 300);
  }

  hashConfig() {
    // Simple hash function to create a unique key for this banner configuration
    const str = JSON.stringify(this.config);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString();
  }

  // Public method to manually show banner (useful for testing)
  show() {
    this.isDismissed = false;
    localStorage.removeItem(`banner-dismissed-${this.hashConfig()}`);
    this.init();
  }

  // Public method to manually hide banner
  hide() {
    this.dismissBanner();
  }

  // Public method to update banner content
  async updateConfig(newConfig) {
    this.config = newConfig;
    if (this.banner) {
      this.dismissBanner();
    }
    if (newConfig && newConfig.enabled) {
      setTimeout(() => this.init(), 350);
    }
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.bannerComponent = new BannerComponent();
  });
} else {
  window.bannerComponent = new BannerComponent();
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BannerComponent;
}
