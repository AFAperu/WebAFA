/**
 * ComponentLoader - Dynamic HTML Component Loading System
 * 
 * Loads reusable HTML components (header, footer) into static pages.
 * Designed to work with Alpine.js and execute before Alpine initialization.
 * 
 * Requirements: 3.1, 8.2
 */

class ComponentLoader {
  /**
   * Create a new ComponentLoader instance
   * 
   * @param {Object} options - Configuration options
   * @param {string} options.componentsPath - Base path for component files (default: './components/')
   * @param {boolean} options.cache - Enable in-memory caching (default: true)
   * @param {number} options.timeout - Fetch timeout in milliseconds (default: 5000)
   * @param {string|null} options.fallbackContent - Content to show if loading fails (default: null)
   */
  constructor(options = {}) {
    // Configuration options with defaults
    this.componentsPath = options.componentsPath || './components/';
    // basePath: prefix for rewriting asset paths in loaded components (e.g., '../' for subpages)
    this.basePath = options.basePath || '';
    this.cacheEnabled = options.cache !== undefined ? options.cache : true;
    this.timeout = options.timeout || 5000;
    this.fallbackContent = options.fallbackContent || null;

    // In-memory cache for storing loaded components
    // Structure: { componentName: { html: string, timestamp: number, url: string } }
    this.cache = {};

    // Component definitions - maps component names to their configuration
    this.components = [
      {
        name: 'header',
        file: 'header.html',
        placeholder: 'header-placeholder',
        required: true
      },
      {
        name: 'footer',
        file: 'footer.html',
        placeholder: 'footer-placeholder',
        required: true
      },
      {
        name: 'cta-community',
        file: 'cta-community.html',
        placeholder: 'cta-community-placeholder',
        required: false
      }
    ];
  }

  /**
   * Load a single component and inject it into the specified placeholder
   * 
   * @param {string} componentName - Name of the component to load (e.g., 'header', 'footer')
   * @param {string} placeholderId - ID of the placeholder element where component will be injected
   * @returns {Promise<boolean>} - Returns true if successful, false otherwise
   * 
   * Requirements: 3.1, 3.2, 3.3, 3.5, 8.2, 10.2, 10.4, 10.5
   */
  async loadComponent(componentName, placeholderId) {
    try {
      // Validate that placeholder element exists before attempting injection (Requirement 10.4)
      const placeholder = document.getElementById(placeholderId);
      if (!placeholder) {
        console.error(`Placeholder not found: ${placeholderId}`);
        return false;
      }

      // Construct the full URL for the component file
      const componentUrl = `${this.componentsPath}${componentName}.html`;

      let html;

      // Check cache before fetching component (Requirement 8.2)
      if (this.cacheEnabled && this.cache[componentName]) {
        console.log(`Cache hit: ${componentName}`);
        html = this.cache[componentName].html;
      } else {
        console.log(`Cache miss: ${componentName}`);
        
        // Create AbortController for timeout handling (Requirement 3.5, 10.2)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          // Fetch the component HTML from file with timeout support (Requirement 3.1, 3.5)
          const response = await fetch(componentUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          
          // Handle 404 errors with component name in message (Requirement 3.5, 10.2)
          if (response.status === 404) {
            console.error(`Component file not found: ${componentName} at ${componentUrl}`);
            return false;
          }
          
          // Handle other HTTP errors with descriptive logging (Requirement 3.5, 10.2)
          if (!response.ok) {
            console.error(`Failed to load component ${componentName}: ${response.status} ${response.statusText} from ${componentUrl}`);
            return false;
          }

          // Get the HTML content from the response
          html = await response.text();

          // Store fetched HTML in cache with timestamp and URL (Requirement 8.2)
          if (this.cacheEnabled) {
            this.cache[componentName] = {
              html: html,
              timestamp: Date.now(),
              url: componentUrl
            };
            console.log(`Cached: ${componentName}`);
          }
        } catch (fetchError) {
          clearTimeout(timeoutId);
          
          // Handle timeout errors specifically (Requirement 3.5, 10.2)
          if (fetchError.name === 'AbortError') {
            console.error(`Timeout loading component ${componentName}: Request exceeded ${this.timeout}ms from ${componentUrl}`);
            return false;
          }
          
          // Handle network errors with descriptive logging (Requirement 3.5, 10.2)
          console.error(`Network error loading component ${componentName} from ${componentUrl}:`, fetchError.message);
          return false;
        }
      }

      // Rewrite relative asset paths if basePath is set (for subpage support)
      if (this.basePath) {
        html = html.replace(/(src|href)="(?!https?:\/\/|\/\/|#|mailto:|tel:|\/)([^"]+)"/g, (match, attr, path) => {
          return `${attr}="${this.basePath}${path}"`;
        });
      }

      // Inject component HTML into placeholder element using innerHTML (Requirement 3.2, 3.3)
      // Wrap injection in try-catch to preserve page state on any error (Requirement 10.5)
      try {
        placeholder.innerHTML = html;
      } catch (injectionError) {
        console.error(`Failed to inject component ${componentName} into placeholder ${placeholderId}:`, injectionError.message);
        return false;
      }

      return true;
    } catch (error) {
      // Catch-all error handler to preserve page state on any uncaught exceptions (Requirement 10.5)
      console.error(`Unexpected error loading component ${componentName}:`, error.message);
      return false;
    }
  }

  /**
   * Clear the in-memory component cache
   * Useful for development and testing
   * 
   * Requirements: 8.2
   */
  clearCache() {
    this.cache = {};
    console.log('Component cache cleared');
  }
  /**
   * Load all configured components in parallel
   * Uses Promise.all() to load header and footer simultaneously for better performance
   *
   * @returns {Promise<{header: boolean, footer: boolean}>} - Object with status for each component
   *
   * Requirements: 8.3
   */
  async loadAll() {
    // Create an array of promises for parallel loading
    const loadPromises = this.components.map(component =>
      this.loadComponent(component.name, component.placeholder)
        .then(success => ({ name: component.name, success }))
        .catch(error => {
          // Handle any unexpected errors gracefully
          console.error(`Error loading ${component.name}:`, error.message);
          return { name: component.name, success: false };
        })
    );

    // Wait for all components to load in parallel using Promise.all()
    // This handles partial failures gracefully - if one fails, others can still succeed
    const results = await Promise.all(loadPromises);

    // Convert results array to object with status for each component
    const status = {};
    results.forEach(result => {
      status[result.name] = result.success;
    });

    return status;
  }

  /**
   * Initialize components synchronously before Alpine.js processes the DOM
   * 
   * This method provides a synchronous blocking initialization that ensures
   * components are fully loaded and injected before Alpine.js initializes.
   * 
   * LOADING SEQUENCE:
   * 1. Page HTML loads
   * 2. This initialization function executes (before Alpine.js script)
   * 3. Components are fetched in parallel (header.html and footer.html)
   * 4. Components are injected into their placeholders
   * 5. Alpine.js script loads and initializes
   * 6. Alpine.js processes x-data attributes in the injected components
   * 7. Page becomes fully interactive
   * 
   * USAGE:
   * Place this script tag BEFORE the Alpine.js script tag in your HTML:
   * 
   * <script src="component-loader.js"></script>
   * <script>
   *   // Initialize components synchronously before Alpine.js
   *   await ComponentLoader.initSync();
   * </script>
   * <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
   * 
   * Or use the blocking initialization pattern:
   * 
   * <script>
   *   (async () => {
   *     const loader = new ComponentLoader();
   *     await loader.initSync();
   *   })();
   * </script>
   * 
   * ALPINE.JS COMPATIBILITY:
   * - Components must be injected BEFORE Alpine.js processes the DOM
   * - All Alpine directives (x-data, @click, :class, etc.) in components will be
   *   processed by Alpine.js after injection
   * - Page-specific Alpine state (page identifier, darkMode, etc.) is preserved
   * - This method blocks execution until components are loaded, ensuring proper timing
   * 
   * @returns {Promise<{header: boolean, footer: boolean}>} - Status of each component load
   * 
   * Requirements: 3.4, 4.1
   */
  async initSync() {
    console.log('ComponentLoader: Starting synchronous initialization...');
    
    // Load all components and wait for completion
    // This blocks execution until all components are loaded and injected
    const status = await this.loadAll();
    
    // Log the results for debugging
    const successCount = Object.values(status).filter(s => s).length;
    const totalCount = Object.keys(status).length;
    
    if (successCount === totalCount) {
      console.log(`ComponentLoader: All ${totalCount} components loaded successfully`);
    } else {
      console.warn(`ComponentLoader: ${successCount}/${totalCount} components loaded successfully`);
      Object.entries(status).forEach(([name, success]) => {
        if (!success) {
          console.error(`ComponentLoader: Failed to load ${name} component`);
        }
      });
    }

    // Load cookie consent script after components are injected
    this._loadCookieConsent();

    // Set dynamic copyright year in footer
    const yearEl = document.getElementById('footer-year');
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }
    
    return status;
  }

  /**
   * Dynamically load the cookie consent script after components are injected.
   * Uses basePath to resolve the correct path for subpages.
   */
  _loadCookieConsent() {
    const scriptPath = `${this.basePath}js/cookie-consent.js`;
    const script = document.createElement('script');
    script.src = scriptPath;
    script.async = false;
    document.body.appendChild(script);
  }

  /**
   * Static helper method to create and initialize a ComponentLoader instance
   * 
   * This is a convenience method for the most common use case: creating a loader
   * with default options and immediately initializing all components.
   * 
   * USAGE:
   * <script>
   *   (async () => {
   *     await ComponentLoader.init();
   *   })();
   * </script>
   * 
   * @param {Object} options - Configuration options (same as constructor)
   * @returns {Promise<{header: boolean, footer: boolean}>} - Status of each component load
   * 
   * Requirements: 3.4, 4.1
   */
  static async init(options = {}) {
    const loader = new ComponentLoader(options);
    return await loader.initSync();
  }

}

// Export for Node.js/testing environments, make available globally for browsers
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ComponentLoader;
}

export default ComponentLoader;

if (typeof window !== 'undefined') {
  window.ComponentLoader = ComponentLoader;
}

