import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

describe('CTA Banner Component', () => {
  let dom;
  let document;
  let ComponentLoader;

  beforeEach(async () => {
    // Create a new JSDOM instance with a basic HTML structure
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head><title>Test</title></head>
        <body>
          <main>
            <div id="cta-banner-placeholder"></div>
          </main>
        </body>
      </html>
    `, {
      url: 'http://localhost',
      resources: 'usable',
      runScripts: 'dangerously'
    });

    document = dom.window.document;
    global.document = document;
    global.window = dom.window;

    // Import ComponentLoader
    const ComponentLoaderModule = await import('../js/component-loader.js');
    ComponentLoader = ComponentLoaderModule.default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have cta-community in component definitions', () => {
    const loader = new ComponentLoader();
    const ctaCommunity = loader.components.find(c => c.name === 'cta-community');
    
    expect(ctaCommunity).toBeDefined();
    expect(ctaCommunity.name).toBe('cta-community');
    expect(ctaCommunity.file).toBe('cta-community.html');
    expect(ctaCommunity.placeholder).toBe('cta-community-placeholder');
    expect(ctaCommunity.required).toBe(false);
  });

  it('should load cta-banner component successfully', async () => {
    const loader = new ComponentLoader();
    
    // Read the actual cta-banner.html file
    const ctaBannerPath = path.join(process.cwd(), 'components', 'cta-banner.html');
    const ctaBannerHtml = fs.readFileSync(ctaBannerPath, 'utf-8');

    // Mock fetch to return the cta-banner HTML
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ctaBannerHtml
    });

    const result = await loader.loadComponent('cta-banner', 'cta-banner-placeholder');
    
    expect(result).toBe(true);
    
    const placeholder = document.getElementById('cta-banner-placeholder');
    expect(placeholder.innerHTML).toContain('¿Quieres formar parte de nuestra comunidad?');
    expect(placeholder.innerHTML).toContain('Únete a la AFA');
    expect(placeholder.innerHTML).toContain('Asóciate');
  });

  it('should handle missing cta-banner placeholder gracefully', async () => {
    const loader = new ComponentLoader();
    
    // Remove the placeholder
    const placeholder = document.getElementById('cta-banner-placeholder');
    placeholder.remove();

    const result = await loader.loadComponent('cta-banner', 'cta-banner-placeholder');
    
    expect(result).toBe(false);
  });

  it('should include cta-banner in loadAll results', async () => {
    const loader = new ComponentLoader();
    
    // Mock fetch for all components
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('cta-community.html')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => '<section>CTA Community</section>'
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => '<div>Component</div>'
      });
    });

    // Add placeholders for header and footer
    document.body.innerHTML += '<div id="header-placeholder"></div><div id="footer-placeholder"></div><div id="cta-community-placeholder"></div>';

    const status = await loader.loadAll();
    
    expect(status).toHaveProperty('cta-community');
    expect(status['cta-community']).toBe(true);
  });

  it('should cache cta-banner component', async () => {
    const loader = new ComponentLoader({ cache: true });
    
    const ctaBannerHtml = '<section>CTA Banner Content</section>';
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ctaBannerHtml
    });

    // First load
    await loader.loadComponent('cta-banner', 'cta-banner-placeholder');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second load should use cache
    await loader.loadComponent('cta-banner', 'cta-banner-placeholder');
    expect(global.fetch).toHaveBeenCalledTimes(1); // Still 1, not called again
    
    expect(loader.cache['cta-banner']).toBeDefined();
    expect(loader.cache['cta-banner'].html).toBe(ctaBannerHtml);
  });
});
