/**
 * Unit Tests for ComponentLoader
 * Feature: header-footer-components
 * Task 2.2: Implement loadComponent method with fetch and injection
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('ComponentLoader - loadComponent method', () => {
  let dom;
  let document;
  let window;
  let ComponentLoader;
  let loader;
  let fetchMock;
  let consoleErrorSpy;

  beforeEach(async () => {
    // Create a fresh JSDOM instance for each test
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://localhost'
    });
    
    window = dom.window;
    document = window.document;
    global.document = document;
    global.window = window;
    
    // Mock console.error to capture error messages
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    
    // Import ComponentLoader dynamically
    const module = await import('../component-loader.js');
    ComponentLoader = module.default || module.ComponentLoader || module;
    
    // Create a new loader instance
    loader = new ComponentLoader();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  /**
   * Test: Successful component loading and injection
   * Validates: Requirements 3.1, 3.2, 3.3
   */
  test('loadComponent successfully loads and injects component HTML', async () => {
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Mock successful fetch response
    const mockHtml = '<header><h1>Test Header</h1></header>';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => mockHtml
    });
    
    // Execute: Load the component
    const result = await loader.loadComponent('header', 'test-placeholder');
    
    // Verify: Component was loaded successfully
    expect(result).toBe(true);
    expect(placeholder.innerHTML).toBe(mockHtml);
    expect(fetchMock).toHaveBeenCalledWith('./components/header.html', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  /**
   * Test: Placeholder validation before injection
   * Validates: Requirement 10.4
   */
  test('loadComponent validates placeholder exists before injection', async () => {
    // Execute: Try to load component with non-existent placeholder
    const result = await loader.loadComponent('header', 'non-existent-placeholder');
    
    // Verify: Returns false and logs error
    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith('Placeholder not found: non-existent-placeholder');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * Test: Handle 404 errors gracefully
   * Validates: Requirements 3.5, 10.2
   */
  test('loadComponent handles 404 errors gracefully', async () => {
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Mock 404 response
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });
    
    // Execute: Try to load non-existent component
    const result = await loader.loadComponent('missing', 'test-placeholder');
    
    // Verify: Returns false and logs error with component name
    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith('Component file not found: missing at ./components/missing.html');
    expect(placeholder.innerHTML).toBe(''); // Placeholder remains empty
  });

  /**
   * Test: Handle network errors gracefully
   * Validates: Requirements 3.5, 10.2
   */
  test('loadComponent handles network errors gracefully', async () => {
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Mock network error
    const networkError = new Error('Network error');
    fetchMock.mockRejectedValue(networkError);
    
    // Execute: Try to load component with network error
    const result = await loader.loadComponent('header', 'test-placeholder');
    
    // Verify: Returns false and logs error
    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith('Network error loading component header from ./components/header.html:', 'Network error');
    expect(placeholder.innerHTML).toBe(''); // Placeholder remains empty
  });

  /**
   * Test: Handle timeout errors gracefully
   * Validates: Requirements 3.5, 10.2
   */
  test('loadComponent handles timeout errors gracefully', async () => {
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Create loader with short timeout
    const timeoutLoader = new ComponentLoader({ timeout: 100 });
    
    // Setup: Mock fetch that takes longer than timeout
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);
    
    // Execute: Try to load component with timeout
    const result = await timeoutLoader.loadComponent('header', 'test-placeholder');
    
    // Verify: Returns false and logs timeout error with component name
    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith('Timeout loading component header: Request exceeded 100ms from ./components/header.html');
    expect(placeholder.innerHTML).toBe(''); // Placeholder remains empty
  });

  /**
   * Test: Correct URL construction
   * Validates: Requirement 3.1
   */
  test('loadComponent constructs correct component URL', async () => {
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Mock successful fetch response
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<div>Test</div>'
    });
    
    // Execute: Load component
    await loader.loadComponent('footer', 'test-placeholder');
    
    // Verify: Fetch was called with correct URL
    expect(fetchMock).toHaveBeenCalledWith('./components/footer.html', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  /**
   * Test: Custom components path
   * Validates: Requirement 3.1
   */
  test('loadComponent uses custom components path', async () => {
    // Setup: Create loader with custom path
    const customLoader = new ComponentLoader({ componentsPath: '/custom/path/' });
    
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Mock successful fetch response
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<div>Test</div>'
    });
    
    // Execute: Load component
    await customLoader.loadComponent('header', 'test-placeholder');
    
    // Verify: Fetch was called with custom path
    expect(fetchMock).toHaveBeenCalledWith('/custom/path/header.html', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  /**
   * Test: Injection uses innerHTML
   * Validates: Requirement 3.3
   */
  test('loadComponent injects HTML using innerHTML', async () => {
    // Setup: Create a placeholder element with existing content
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    placeholder.innerHTML = '<p>Old content</p>';
    document.body.appendChild(placeholder);
    
    // Setup: Mock successful fetch response
    const mockHtml = '<header><h1>New Header</h1></header>';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => mockHtml
    });
    
    // Execute: Load the component
    await loader.loadComponent('header', 'test-placeholder');
    
    // Verify: Old content is replaced with new content
    expect(placeholder.innerHTML).toBe(mockHtml);
    expect(placeholder.innerHTML).not.toContain('Old content');
  });

  /**
   * Test: Return value indicates success/failure
   * Validates: Task requirement for boolean return value
   */
  test('loadComponent returns boolean indicating success or failure', async () => {
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Test success case
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<div>Test</div>'
    });
    
    const successResult = await loader.loadComponent('header', 'test-placeholder');
    expect(successResult).toBe(true);
    
    // Test failure case (404)
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });
    
    const failureResult = await loader.loadComponent('missing', 'test-placeholder');
    expect(failureResult).toBe(false);
  });

  /**
   * Test: Multiple components can be loaded into different placeholders
   * Validates: Requirements 3.2, 3.3
   */
  test('loadComponent can load multiple components into different placeholders', async () => {
    // Setup: Create multiple placeholder elements
    const headerPlaceholder = document.createElement('div');
    headerPlaceholder.id = 'header-placeholder';
    document.body.appendChild(headerPlaceholder);
    
    const footerPlaceholder = document.createElement('div');
    footerPlaceholder.id = 'footer-placeholder';
    document.body.appendChild(footerPlaceholder);
    
    // Setup: Mock fetch responses
    const headerHtml = '<header>Header Content</header>';
    const footerHtml = '<footer>Footer Content</footer>';
    
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => headerHtml
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => footerHtml
      });
    
    // Execute: Load both components
    const headerResult = await loader.loadComponent('header', 'header-placeholder');
    const footerResult = await loader.loadComponent('footer', 'footer-placeholder');
    
    // Verify: Both components loaded successfully
    expect(headerResult).toBe(true);
    expect(footerResult).toBe(true);
    expect(headerPlaceholder.innerHTML).toBe(headerHtml);
    expect(footerPlaceholder.innerHTML).toBe(footerHtml);
  });
});

/**
 * Unit Tests for ComponentLoader Caching Mechanism
 * Feature: header-footer-components
 * Task 2.4: Implement caching mechanism
 */

describe('ComponentLoader - Caching Mechanism', () => {
  let dom;
  let document;
  let window;
  let ComponentLoader;
  let loader;
  let fetchMock;
  let consoleLogSpy;

  beforeEach(async () => {
    // Create a fresh JSDOM instance for each test
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://localhost'
    });
    
    window = dom.window;
    document = window.document;
    global.document = document;
    global.window = window;
    
    // Mock console.log to capture cache logging
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    
    // Import ComponentLoader dynamically
    const module = await import('../component-loader.js');
    ComponentLoader = module.default || module.ComponentLoader || module;
    
    // Create a new loader instance
    loader = new ComponentLoader();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  /**
   * Test: Cache miss on first load
   * Validates: Requirement 8.2 - Check cache before fetching
   */
  test('first load results in cache miss and fetches from network', async () => {
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Mock successful fetch response
    const mockHtml = '<header><h1>Test Header</h1></header>';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => mockHtml
    });
    
    // Execute: Load the component for the first time
    await loader.loadComponent('header', 'test-placeholder');
    
    // Verify: Cache miss logged and fetch was called
    expect(console.log).toHaveBeenCalledWith('Cache miss: header');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('./components/header.html', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  /**
   * Test: Component is cached after first load
   * Validates: Requirement 8.2 - Store fetched HTML in cache with timestamp and URL
   */
  test('component is cached after first successful load', async () => {
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Mock successful fetch response
    const mockHtml = '<header><h1>Test Header</h1></header>';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => mockHtml
    });
    
    // Execute: Load the component
    await loader.loadComponent('header', 'test-placeholder');
    
    // Verify: Component is stored in cache with correct structure
    expect(loader.cache['header']).toBeDefined();
    expect(loader.cache['header'].html).toBe(mockHtml);
    expect(loader.cache['header'].timestamp).toBeGreaterThan(0);
    expect(loader.cache['header'].url).toBe('./components/header.html');
    expect(console.log).toHaveBeenCalledWith('Cached: header');
  });

  /**
   * Test: Cache hit on subsequent loads
   * Validates: Requirement 8.2 - Check cache before fetching component
   */
  test('subsequent loads use cached content without fetching', async () => {
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Mock successful fetch response
    const mockHtml = '<header><h1>Test Header</h1></header>';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => mockHtml
    });
    
    // Execute: Load the component twice
    await loader.loadComponent('header', 'test-placeholder');
    fetchMock.mockClear(); // Clear fetch mock to verify it's not called again
    await loader.loadComponent('header', 'test-placeholder');
    
    // Verify: Second load uses cache and doesn't fetch
    expect(console.log).toHaveBeenCalledWith('Cache hit: header');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(placeholder.innerHTML).toBe(mockHtml);
  });

  /**
   * Test: clearCache method empties the cache
   * Validates: Requirement 8.2 - Implement clearCache() method
   */
  test('clearCache method empties the cache', async () => {
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Mock successful fetch response
    const mockHtml = '<header><h1>Test Header</h1></header>';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => mockHtml
    });
    
    // Execute: Load component, clear cache, load again
    await loader.loadComponent('header', 'test-placeholder');
    expect(loader.cache['header']).toBeDefined();
    
    loader.clearCache();
    
    // Verify: Cache is empty and logs message
    expect(loader.cache).toEqual({});
    expect(console.log).toHaveBeenCalledWith('Component cache cleared');
  });

  /**
   * Test: After cache clear, component is fetched again
   * Validates: Requirement 8.2 - clearCache() functionality
   */
  test('after clearCache, component is fetched from network again', async () => {
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Mock successful fetch response
    const mockHtml = '<header><h1>Test Header</h1></header>';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => mockHtml
    });
    
    // Execute: Load, clear cache, load again
    await loader.loadComponent('header', 'test-placeholder');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    loader.clearCache();
    fetchMock.mockClear();
    
    await loader.loadComponent('header', 'test-placeholder');
    
    // Verify: Component is fetched again after cache clear
    expect(console.log).toHaveBeenCalledWith('Cache miss: header');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Test: Cache can be disabled via options
   * Validates: Requirement 8.2 - Cache configuration
   */
  test('caching can be disabled via constructor options', async () => {
    // Setup: Create loader with caching disabled
    const noCacheLoader = new ComponentLoader({ cache: false });
    
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Mock successful fetch response
    const mockHtml = '<header><h1>Test Header</h1></header>';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => mockHtml
    });
    
    // Execute: Load component twice
    await noCacheLoader.loadComponent('header', 'test-placeholder');
    fetchMock.mockClear();
    await noCacheLoader.loadComponent('header', 'test-placeholder');
    
    // Verify: Fetch is called both times (no caching)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(noCacheLoader.cache).toEqual({});
  });

  /**
   * Test: Different components are cached separately
   * Validates: Requirement 8.2 - Cache management
   */
  test('different components are cached separately', async () => {
    // Setup: Create placeholder elements
    const headerPlaceholder = document.createElement('div');
    headerPlaceholder.id = 'header-placeholder';
    document.body.appendChild(headerPlaceholder);
    
    const footerPlaceholder = document.createElement('div');
    footerPlaceholder.id = 'footer-placeholder';
    document.body.appendChild(footerPlaceholder);
    
    // Setup: Mock fetch responses
    const headerHtml = '<header>Header Content</header>';
    const footerHtml = '<footer>Footer Content</footer>';
    
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => headerHtml
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => footerHtml
      });
    
    // Execute: Load both components
    await loader.loadComponent('header', 'header-placeholder');
    await loader.loadComponent('footer', 'footer-placeholder');
    
    // Verify: Both components are cached separately
    expect(loader.cache['header']).toBeDefined();
    expect(loader.cache['footer']).toBeDefined();
    expect(loader.cache['header'].html).toBe(headerHtml);
    expect(loader.cache['footer'].html).toBe(footerHtml);
    expect(loader.cache['header'].url).toBe('./components/header.html');
    expect(loader.cache['footer'].url).toBe('./components/footer.html');
  });

  /**
   * Test: Failed loads are not cached
   * Validates: Requirement 8.2 - Only cache successful loads
   */
  test('failed component loads are not cached', async () => {
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Mock 404 response
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });
    
    // Execute: Try to load non-existent component
    await loader.loadComponent('missing', 'test-placeholder');
    
    // Verify: Failed component is not cached
    expect(loader.cache['missing']).toBeUndefined();
    expect(Object.keys(loader.cache).length).toBe(0);
  });

  /**
   * Test: Cache hit/miss logging for debugging
   * Validates: Requirement 8.2 - Add cache hit/miss logging for debugging
   */
  test('cache hit and miss are logged for debugging', async () => {
    // Setup: Create a placeholder element
    const placeholder = document.createElement('div');
    placeholder.id = 'test-placeholder';
    document.body.appendChild(placeholder);
    
    // Setup: Mock successful fetch response
    const mockHtml = '<header><h1>Test Header</h1></header>';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => mockHtml
    });
    
    // Execute: Load component twice
    await loader.loadComponent('header', 'test-placeholder');
    await loader.loadComponent('header', 'test-placeholder');
    
    // Verify: Both cache miss and cache hit are logged
    expect(console.log).toHaveBeenCalledWith('Cache miss: header');
    expect(console.log).toHaveBeenCalledWith('Cache hit: header');
    expect(console.log).toHaveBeenCalledWith('Cached: header');
  });
});

/**
 * Unit Tests for ComponentLoader loadAll method
 * Feature: header-footer-components
 * Task 4.1: Implement loadAll method with parallel loading
 */

describe('ComponentLoader - loadAll method', () => {
  let dom;
  let document;
  let window;
  let ComponentLoader;
  let loader;
  let fetchMock;
  let consoleErrorSpy;

  beforeEach(async () => {
    // Create a fresh JSDOM instance for each test
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://localhost'
    });
    
    window = dom.window;
    document = window.document;
    global.document = document;
    global.window = window;
    
    // Mock console.error to capture error messages
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    
    // Import ComponentLoader dynamically
    const module = await import('../component-loader.js');
    ComponentLoader = module.default || module.ComponentLoader || module;
    
    // Create a new loader instance
    loader = new ComponentLoader();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  /**
   * Test: loadAll loads both header and footer successfully
   * Validates: Requirement 8.3 - Load components in parallel
   */
  test('loadAll successfully loads both header and footer components', async () => {
    // Setup: Create placeholder elements
    const headerPlaceholder = document.createElement('div');
    headerPlaceholder.id = 'header-placeholder';
    document.body.appendChild(headerPlaceholder);
    
    const footerPlaceholder = document.createElement('div');
    footerPlaceholder.id = 'footer-placeholder';
    document.body.appendChild(footerPlaceholder);
    
    // Setup: Mock fetch responses
    const headerHtml = '<header>Header Content</header>';
    const footerHtml = '<footer>Footer Content</footer>';
    
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => headerHtml
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => footerHtml
      });
    
    // Execute: Load all components
    const result = await loader.loadAll();
    
    // Verify: Both components loaded successfully
    expect(result).toMatchObject({
      header: true,
      footer: true
    });
    expect(headerPlaceholder.innerHTML).toBe(headerHtml);
    expect(footerPlaceholder.innerHTML).toBe(footerHtml);
  });

  /**
   * Test: loadAll uses Promise.all for parallel loading
   * Validates: Requirement 8.3 - Use Promise.all() to load header and footer in parallel
   */
  test('loadAll loads components in parallel using Promise.all', async () => {
    // Setup: Create placeholder elements
    const headerPlaceholder = document.createElement('div');
    headerPlaceholder.id = 'header-placeholder';
    document.body.appendChild(headerPlaceholder);
    
    const footerPlaceholder = document.createElement('div');
    footerPlaceholder.id = 'footer-placeholder';
    document.body.appendChild(footerPlaceholder);
    
    // Setup: Track fetch call order
    const fetchOrder = [];
    
    fetchMock.mockImplementation((url) => {
      fetchOrder.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => `<div>${url}</div>`
      });
    });
    
    // Execute: Load all components
    await loader.loadAll();
    
    // Verify: Both fetch calls were initiated (parallel loading)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchOrder).toContain('./components/header.html');
    expect(fetchOrder).toContain('./components/footer.html');
  });

  /**
   * Test: loadAll handles partial failures gracefully
   * Validates: Requirement 8.3 - Handle partial failures gracefully (one component fails, other succeeds)
   */
  test('loadAll handles partial failures gracefully - header fails, footer succeeds', async () => {
    // Setup: Create placeholder elements
    const headerPlaceholder = document.createElement('div');
    headerPlaceholder.id = 'header-placeholder';
    document.body.appendChild(headerPlaceholder);
    
    const footerPlaceholder = document.createElement('div');
    footerPlaceholder.id = 'footer-placeholder';
    document.body.appendChild(footerPlaceholder);
    
    // Setup: Mock header failure, footer success
    const footerHtml = '<footer>Footer Content</footer>';
    
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => footerHtml
      });
    
    // Execute: Load all components
    const result = await loader.loadAll();
    
    // Verify: Header failed, footer succeeded
    expect(result).toMatchObject({
      header: false,
      footer: true
    });
    expect(headerPlaceholder.innerHTML).toBe(''); // Header not injected
    expect(footerPlaceholder.innerHTML).toBe(footerHtml); // Footer injected
  });

  /**
   * Test: loadAll handles partial failures gracefully - footer fails, header succeeds
   * Validates: Requirement 8.3 - Handle partial failures gracefully
   */
  test('loadAll handles partial failures gracefully - footer fails, header succeeds', async () => {
    // Setup: Create placeholder elements
    const headerPlaceholder = document.createElement('div');
    headerPlaceholder.id = 'header-placeholder';
    document.body.appendChild(headerPlaceholder);
    
    const footerPlaceholder = document.createElement('div');
    footerPlaceholder.id = 'footer-placeholder';
    document.body.appendChild(footerPlaceholder);
    
    // Setup: Mock header success, footer failure
    const headerHtml = '<header>Header Content</header>';
    
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => headerHtml
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });
    
    // Execute: Load all components
    const result = await loader.loadAll();
    
    // Verify: Header succeeded, footer failed
    expect(result).toMatchObject({
      header: true,
      footer: false
    });
    expect(headerPlaceholder.innerHTML).toBe(headerHtml); // Header injected
    expect(footerPlaceholder.innerHTML).toBe(''); // Footer not injected
  });

  /**
   * Test: loadAll handles both components failing
   * Validates: Requirement 8.3 - Handle partial failures gracefully
   */
  test('loadAll handles both components failing', async () => {
    // Setup: Create placeholder elements
    const headerPlaceholder = document.createElement('div');
    headerPlaceholder.id = 'header-placeholder';
    document.body.appendChild(headerPlaceholder);
    
    const footerPlaceholder = document.createElement('div');
    footerPlaceholder.id = 'footer-placeholder';
    document.body.appendChild(footerPlaceholder);
    
    // Setup: Mock both failures
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });
    
    // Execute: Load all components
    const result = await loader.loadAll();
    
    // Verify: Both components failed
    expect(result).toMatchObject({
      header: false,
      footer: false
    });
    expect(headerPlaceholder.innerHTML).toBe('');
    expect(footerPlaceholder.innerHTML).toBe('');
  });

  /**
   * Test: loadAll returns object with status for each component
   * Validates: Requirement 8.3 - Return object with status for each component {header: boolean, footer: boolean}
   */
  test('loadAll returns object with status for each component', async () => {
    // Setup: Create placeholder elements
    const headerPlaceholder = document.createElement('div');
    headerPlaceholder.id = 'header-placeholder';
    document.body.appendChild(headerPlaceholder);
    
    const footerPlaceholder = document.createElement('div');
    footerPlaceholder.id = 'footer-placeholder';
    document.body.appendChild(footerPlaceholder);
    
    // Setup: Mock successful responses
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<div>Content</div>'
    });
    
    // Execute: Load all components
    const result = await loader.loadAll();
    
    // Verify: Result has correct structure
    expect(result).toHaveProperty('header');
    expect(result).toHaveProperty('footer');
    expect(typeof result.header).toBe('boolean');
    expect(typeof result.footer).toBe('boolean');
  });

  /**
   * Test: loadAll handles missing placeholders gracefully
   * Validates: Requirement 8.3 - Handle partial failures gracefully
   */
  test('loadAll handles missing placeholders gracefully', async () => {
    // Setup: Only create header placeholder, footer placeholder is missing
    const headerPlaceholder = document.createElement('div');
    headerPlaceholder.id = 'header-placeholder';
    document.body.appendChild(headerPlaceholder);
    
    // Setup: Mock successful responses
    const headerHtml = '<header>Header Content</header>';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => headerHtml
    });
    
    // Execute: Load all components
    const result = await loader.loadAll();
    
    // Verify: Header succeeds, footer fails due to missing placeholder
    expect(result).toMatchObject({
      header: true,
      footer: false
    });
    expect(headerPlaceholder.innerHTML).toBe(headerHtml);
    expect(console.error).toHaveBeenCalledWith('Placeholder not found: footer-placeholder');
  });

  /**
   * Test: loadAll handles network errors gracefully
   * Validates: Requirement 8.3 - Handle partial failures gracefully
   */
  test('loadAll handles network errors gracefully', async () => {
    // Setup: Create placeholder elements
    const headerPlaceholder = document.createElement('div');
    headerPlaceholder.id = 'header-placeholder';
    document.body.appendChild(headerPlaceholder);
    
    const footerPlaceholder = document.createElement('div');
    footerPlaceholder.id = 'footer-placeholder';
    document.body.appendChild(footerPlaceholder);
    
    // Setup: Mock network error
    const networkError = new Error('Network error');
    fetchMock.mockRejectedValue(networkError);
    
    // Execute: Load all components
    const result = await loader.loadAll();
    
    // Verify: Both components fail due to network error
    expect(result).toMatchObject({
      header: false,
      footer: false
    });
    expect(console.error).toHaveBeenCalledWith(
      'Network error loading component header from ./components/header.html:',
      'Network error'
    );
    expect(console.error).toHaveBeenCalledWith(
      'Network error loading component footer from ./components/footer.html:',
      'Network error'
    );
  });
});
