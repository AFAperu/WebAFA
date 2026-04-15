# Design Document: Header and Footer Components

## Overview

This design document specifies the technical approach for extracting the header and footer from landing.html into reusable components that can be dynamically loaded across all HTML pages in the static website. The solution will create a JavaScript-based component loading system that preserves Alpine.js functionality, maintains visual consistency, and supports page-specific customization.

### Goals

- Eliminate code duplication by creating single-source-of-truth component files for header and footer
- Maintain all existing functionality including Alpine.js interactivity, dark mode, sticky navigation, and mobile menu
- Ensure seamless integration across all target pages (landing.html, index.html, blog-grid.html, blog-single.html, equipo.html, extraescolares.html, signin.html, signup.html, 404.html)
- Support page-specific customization such as navigation highlighting and call-to-action variations
- Optimize loading performance with caching and parallel loading
- Preserve accessibility features and semantic HTML structure

### Non-Goals

- Migrating to a full JavaScript framework (React, Vue, etc.)
- Server-side rendering or build-time component compilation
- Modifying the existing CSS framework or styling approach
- Changing the Alpine.js implementation patterns

## Architecture

### Component Structure

The system will consist of three main parts:

1. **Component HTML Files**: Standalone HTML files containing the header and footer markup
   - `components/header.html` - Contains the complete header structure
   - `components/footer.html` - Contains the complete footer structure

2. **Component Loader**: A JavaScript module that handles component loading and injection
   - `component-loader.js` - Core loading mechanism with fetch API and caching

3. **Page Integration**: Placeholder elements in each HTML page where components will be injected
   - `<div id="header-placeholder"></div>` - Header injection point
   - `<div id="footer-placeholder"></div>` - Footer injection point

### Loading Sequence

The component loading follows this sequence to ensure Alpine.js compatibility:

```
1. Page HTML loads
2. Component loader script executes (before Alpine.js)
3. Fetch header.html and footer.html in parallel
4. Inject components into placeholders
5. Alpine.js initializes and processes x-data attributes
6. Page becomes interactive
```

### Alpine.js Integration Strategy

Alpine.js requires special handling because it initializes after the DOM loads. The component loader must:

1. **Execute before Alpine.js**: Load components before Alpine.js processes the DOM
2. **Preserve x-data attributes**: Ensure Alpine directives in components are intact when Alpine initializes
3. **Support page-specific state**: Allow each page to define its own Alpine state (e.g., `page: 'home'`)
4. **Maintain event handlers**: Preserve all Alpine event bindings (@click, @scroll.window, etc.)

The solution uses a synchronous blocking approach during initial page load to ensure components are in place before Alpine.js runs.

## Components and Interfaces

### Component Loader API

```javascript
class ComponentLoader {
  constructor(options)
  async loadComponent(componentName, placeholderId)
  async loadAll()
  clearCache()
}
```

#### Constructor Options

```javascript
{
  componentsPath: './components/',  // Base path for component files
  cache: true,                      // Enable in-memory caching
  timeout: 5000,                    // Fetch timeout in milliseconds
  fallbackContent: null             // Content to show if loading fails
}
```

#### Methods

**loadComponent(componentName, placeholderId)**
- Loads a single component and injects it into the specified placeholder
- Returns: Promise<boolean> - true if successful, false otherwise
- Throws: Error if placeholder doesn't exist

**loadAll()**
- Loads all configured components in parallel
- Returns: Promise<{header: boolean, footer: boolean}>
- Handles partial failures gracefully

**clearCache()**
- Clears the in-memory component cache
- Useful for development and testing

### Component HTML Structure

#### Header Component (components/header.html)

The header component will contain:
- Complete `<header>` element with all classes
- Logo with light/dark theme variants
- Navigation menu with dropdown support
- Mobile hamburger menu
- Dark mode toggle
- Call-to-action button
- All Alpine.js directives (x-data, @click, :class, @scroll.window)

Key Alpine.js dependencies:
- Requires `navigationOpen` boolean in parent scope
- Requires `darkMode` boolean in parent scope
- Requires `stickyMenu` boolean in parent scope
- Requires `page` string in parent scope for navigation highlighting

#### Footer Component (components/footer.html)

The footer component will contain:
- Complete `<footer>` element with all classes
- Logo with light/dark theme variants
- Company description
- Social media links (Facebook, Twitter, LinkedIn, Instagram)
- Quick links section
- Services section
- Contact information section
- Newsletter subscription form
- Footer bottom with copyright and legal links
- All inline SVG icons

Key Alpine.js dependencies:
- Requires `scrollTop` boolean in parent scope for back-to-top button
- No other Alpine state dependencies

### Page Integration Interface

Each HTML page must include:

1. **Placeholder elements** (before Alpine.js script):
```html
<div id="header-placeholder"></div>
<main>
  <!-- Page content -->
</main>
<div id="footer-placeholder"></div>
```

2. **Component loader script** (before Alpine.js):
```html
<script src="component-loader.js"></script>
```

3. **Alpine.js initialization** with required state:
```html
<body x-data="{ 
  page: 'home',
  darkMode: true,
  stickyMenu: false,
  navigationOpen: false,
  scrollTop: false
}" x-init="...">
```

### Page-Specific Customization

Pages can customize components through:

1. **Page identifier**: Set the `page` variable to control navigation highlighting
   - `'home'` - Landing page
   - `'blog-grid'` - Blog grid page
   - `'blog-single'` - Blog single page
   - `'signin'` - Sign in page
   - `'signup'` - Sign up page
   - `'404'` - 404 error page
   - `'equipo'` - Team page
   - `'extraescolares'` - Extracurricular activities page

2. **CSS classes**: Pages can add custom classes to placeholders for page-specific styling

3. **Event handlers**: Pages can listen for custom events dispatched by the component loader

## Data Models

### Component Cache Entry

```javascript
{
  name: string,           // Component name (e.g., 'header', 'footer')
  html: string,           // Cached HTML content
  timestamp: number,      // Cache timestamp (Date.now())
  url: string            // Original fetch URL
}
```

### Component Loader Configuration

```javascript
{
  components: [
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
    }
  ],
  componentsPath: './components/',
  cache: true,
  timeout: 5000,
  onLoad: function(componentName) {},
  onError: function(componentName, error) {}
}
```

### Alpine.js State Model

```javascript
{
  page: string,              // Current page identifier
  darkMode: boolean,         // Dark mode enabled/disabled
  stickyMenu: boolean,       // Sticky header active/inactive
  navigationOpen: boolean,   // Mobile menu open/closed
  scrollTop: boolean,        // Show back-to-top button
  dropdown: boolean          // Navigation dropdown open/closed (scoped to dropdown element)
}
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After analyzing all acceptance criteria, I identified several areas where properties overlap or can be consolidated:

**Redundancy Analysis:**
- Properties about "preserving Alpine.js directives" (1.2, 1.5, 1.6) can be consolidated into a single comprehensive property about Alpine directive preservation
- Properties about "component rendering consistency" (7.1, 7.2, 5.3, 5.6) can be combined into one property about identical rendering across pages
- Properties about "navigation highlighting" (5.5, 6.2, 6.3) are essentially testing the same behavior and can be merged
- Properties about "CSS class preservation" (1.4, 2.3, 7.3, 7.4, 7.6) can be consolidated into a single property about style preservation
- Properties about "component injection" (3.2, 3.3) can be combined into one property about placeholder injection

**Consolidated Properties:**
The following properties represent the unique, non-redundant correctness requirements after reflection.

### Property 1: Alpine Directive Preservation

*For any* Alpine.js directive (x-data, @click, :class, @scroll.window, x-init, etc.) present in the original landing.html header or footer, that directive SHALL be present with identical syntax in the corresponding component file.

**Validates: Requirements 1.2, 1.5, 1.6, 4.7**

### Property 2: Component Placeholder Injection

*For any* component (header or footer) and its corresponding placeholder element, when the component loader executes, the component HTML SHALL be injected as a child of the placeholder element.

**Validates: Requirements 3.2, 3.3**

### Property 3: Component Loading Before Alpine Initialization

*For any* page using the component loader, the component injection SHALL complete before Alpine.js processes the DOM, ensuring all Alpine directives in components are available when Alpine initializes.

**Validates: Requirements 3.4, 4.1**

### Property 4: Error Logging on Load Failure

*For any* component that fails to load (network error, 404, timeout), the component loader SHALL log a descriptive error message to the console containing the component name and error details.

**Validates: Requirements 3.5, 10.2**

### Property 5: Cross-Page Compatibility

*For any* target page (landing.html, index.html, blog-grid.html, blog-single.html, equipo.html, extraescolares.html, signin.html, signup.html, 404.html) with header and footer placeholders, the component loader SHALL successfully inject both components without errors.

**Validates: Requirements 3.7, 5.6**

### Property 6: Dark Mode Persistence Round-Trip

*For any* boolean dark mode value (true or false), when set in Alpine state and persisted to localStorage, retrieving the value from localStorage SHALL return the same boolean value.

**Validates: Requirements 4.2**

### Property 7: Scroll Event Sticky Menu Activation

*For any* scroll position greater than 20 pixels from the top, the stickyMenu state SHALL be true, and for any scroll position less than or equal to 20 pixels, the stickyMenu state SHALL be false.

**Validates: Requirements 4.3**

### Property 8: Navigation Dropdown Toggle

*For any* dropdown element in the header navigation, clicking the dropdown trigger SHALL toggle the dropdown state from false to true or from true to false.

**Validates: Requirements 4.4**

### Property 9: Mobile Menu Toggle

*For any* state of navigationOpen (true or false), clicking the hamburger menu button SHALL toggle the state to its opposite value.

**Validates: Requirements 4.5**

### Property 10: Back-to-Top Scroll Behavior

*For any* page scroll position, when the back-to-top button is clicked, the page SHALL scroll to position 0 (top of page).

**Validates: Requirements 4.6**

### Property 11: Page-Specific State Preservation

*For any* page-specific Alpine state value (such as the page identifier), component loading SHALL NOT overwrite or modify that state value.

**Validates: Requirements 5.4, 6.1**

### Property 12: Navigation Highlighting Based on Page Identifier

*For any* page identifier value (e.g., 'home', 'blog-grid', 'signin'), the navigation menu item corresponding to that page SHALL have the active state class ('mk') applied.

**Validates: Requirements 5.5, 6.2, 6.3**

### Property 13: Consistent Component Rendering Across Pages

*For any* two target pages, the rendered HTML of the header component SHALL be identical (excluding page-specific state-dependent classes), and the rendered HTML of the footer component SHALL be identical.

**Validates: Requirements 5.3, 7.1, 7.2**

### Property 14: Style and Structure Preservation

*For any* CSS class, responsive breakpoint class, dark mode class, hover state class, or HTML structural element in the original landing.html header or footer, that class or element SHALL be present in the corresponding component file.

**Validates: Requirements 1.4, 2.3, 7.3, 7.4, 7.6**

### Property 15: Flash of Unstyled Content Prevention

*For any* page load, the component placeholders SHALL either have the components injected before first paint, or SHALL have CSS styling that prevents visible layout shift or unstyled content flash.

**Validates: Requirements 7.5**

### Property 16: Component Caching Behavior

*For any* component that has been loaded once, subsequent requests for that same component SHALL use the cached HTML content rather than making a new network fetch request.

**Validates: Requirements 8.2**

### Property 17: Parallel Component Loading

*For any* component loader execution, the fetch requests for header.html and footer.html SHALL be initiated concurrently (not sequentially).

**Validates: Requirements 8.3**

### Property 18: Component Injection Performance

*For any* component injection operation on a modern browser (Chrome, Firefox, Safari, Edge from the last 2 years), the time from fetch completion to DOM injection SHALL be less than 100 milliseconds.

**Validates: Requirements 8.4**

### Property 19: Semantic HTML Preservation

*For any* semantic HTML element (header, nav, footer, ul, li, a, button, form, input) in the original landing.html header or footer, that element SHALL be present with the same semantic meaning in the corresponding component file.

**Validates: Requirements 9.1, 9.4**

### Property 20: Keyboard Navigation Support

*For any* interactive element (links, buttons, form inputs) in the header or footer components, that element SHALL be keyboard-accessible (focusable via Tab key and activatable via Enter or Space key).

**Validates: Requirements 9.2**

### Property 21: ARIA Attribute Preservation

*For any* ARIA attribute (aria-label, aria-expanded, aria-hidden, etc.) present in the original landing.html header or footer, that attribute SHALL be present with the same value in the corresponding component file.

**Validates: Requirements 9.3**

### Property 22: Focus Management After Injection

*For any* focused element before component injection, the focus SHALL either remain on that element or move to a logical next element after injection, but SHALL NOT be lost or moved to an unexpected location.

**Validates: Requirements 9.5**

### Property 23: Image Alt Text Preservation

*For any* img element in the header or footer components, that element SHALL have an alt attribute with descriptive text.

**Validates: Requirements 9.6**

### Property 24: Placeholder Validation Before Injection

*For any* component injection attempt, the component loader SHALL verify that the target placeholder element exists in the DOM before attempting to inject content, and SHALL log an error if the placeholder is missing.

**Validates: Requirements 10.4**

### Property 25: Graceful Degradation on Injection Failure

*For any* component injection failure (missing file, network error, invalid HTML), the page SHALL remain functional with existing content intact, and SHALL NOT throw uncaught exceptions that break page functionality.

**Validates: Requirements 10.5**

### Property 26: SVG Icon Inline Embedding

*For any* SVG icon in the original landing.html footer, that SVG SHALL be embedded inline (not as an external reference) in the footer component file.

**Validates: Requirements 2.5**


## Error Handling

The component loading system must handle various failure scenarios gracefully to ensure the website remains functional even when components fail to load.

### Error Categories

#### 1. Network Errors

**Scenario**: Component file cannot be fetched due to network issues, CORS errors, or server unavailability.

**Handling Strategy**:
- Log descriptive error to console: `"Failed to load component [name]: [error details]"`
- Preserve existing page content without modification
- Set a flag indicating component load failure
- Optionally retry once after a short delay (500ms)
- Do not throw uncaught exceptions

**User Impact**: Page displays without header/footer but remains functional. Main content is accessible.

#### 2. Missing Component Files

**Scenario**: Component file does not exist (404 error).

**Handling Strategy**:
- Log error to console: `"Component file not found: [filename]"`
- Check if fallback content is configured
- If fallback exists, inject fallback content
- If no fallback, leave placeholder empty
- Continue loading other components

**User Impact**: Missing component is not displayed, but page remains functional.

#### 3. Invalid HTML in Component

**Scenario**: Component file contains malformed HTML or JavaScript errors.

**Handling Strategy**:
- Wrap injection in try-catch block
- Log error with component name and error details
- Preserve page state before injection attempt
- Do not inject invalid content
- Mark component as failed

**User Impact**: Component is not displayed, but page remains stable.

#### 4. Missing Placeholder Elements

**Scenario**: Page does not have the required placeholder elements.

**Handling Strategy**:
- Validate placeholder existence before injection
- Log warning: `"Placeholder not found: [placeholder-id]"`
- Skip injection for missing placeholder
- Continue with other components
- Do not throw errors

**User Impact**: Component is not injected, but page continues to function.

#### 5. Alpine.js Initialization Conflicts

**Scenario**: Components are injected after Alpine.js has already initialized.

**Handling Strategy**:
- Detect if Alpine is already initialized
- If Alpine is initialized, call `Alpine.initTree()` on injected components
- Log warning about late injection
- Ensure Alpine processes new directives

**User Impact**: Components work correctly even with late injection.

#### 6. Timeout Errors

**Scenario**: Component fetch takes longer than configured timeout (default 5000ms).

**Handling Strategy**:
- Abort fetch request after timeout
- Log timeout error with component name
- Treat as network error (see category 1)
- Do not block page rendering indefinitely

**User Impact**: Page loads without slow-loading component, remains responsive.

### Error Recovery Strategies

#### Retry Logic

For transient network errors, implement a simple retry mechanism:
- Single retry attempt after 500ms delay
- Only retry on network errors (not 404 or invalid HTML)
- Log retry attempts to console
- Give up after one retry to avoid blocking

#### Fallback Content

Support optional fallback content for critical components:
- Configure fallback HTML in component loader options
- Inject fallback if primary component fails
- Fallback should be minimal but functional
- Example: Simple header with logo and basic navigation

#### Progressive Enhancement

Design pages to work without components:
- Ensure main content is accessible without header/footer
- Use semantic HTML that works without JavaScript
- Provide skip-to-content links for accessibility
- Style placeholders to avoid layout shift

### Error Logging

All errors should be logged with structured information:

```javascript
{
  timestamp: Date.now(),
  component: 'header' | 'footer',
  error: Error object,
  context: {
    url: string,
    placeholder: string,
    retryAttempt: number
  }
}
```

Console messages should be clear and actionable:
- ✅ Good: `"Failed to load header component from './components/header.html': 404 Not Found"`
- ❌ Bad: `"Error loading component"`

### Monitoring and Debugging

Provide debugging utilities:

```javascript
// Enable verbose logging
ComponentLoader.debug = true;

// Check component load status
ComponentLoader.getStatus(); // Returns {header: 'loaded', footer: 'failed'}

// Manually retry failed components
ComponentLoader.retryFailed();

// Clear cache and reload
ComponentLoader.clearCache();
ComponentLoader.loadAll();
```

## Testing Strategy

The testing strategy employs a dual approach combining unit tests for specific scenarios and property-based tests for comprehensive coverage.

### Testing Approach

#### Unit Tests

Unit tests focus on specific examples, edge cases, and integration points:

**Component Extraction Verification**
- Verify header.html contains all required elements (logo, nav, dark mode toggle, CTA button)
- Verify footer.html contains all required sections (logo, social links, quick links, newsletter form)
- Check that all Alpine.js directives are present in components
- Validate that all CSS classes are preserved
- Ensure all SVG icons are inline in footer

**Component Loader Functionality**
- Test successful component loading with mock fetch
- Test error handling for 404 responses
- Test error handling for network failures
- Test timeout behavior
- Test cache hit vs cache miss scenarios
- Test parallel loading of multiple components
- Test placeholder validation before injection

**Alpine.js Integration**
- Test that components load before Alpine initializes
- Test that Alpine processes injected components
- Test dark mode toggle and localStorage persistence
- Test sticky menu activation on scroll
- Test mobile menu toggle
- Test navigation dropdown interactions
- Test back-to-top button functionality

**Page-Specific Customization**
- Test navigation highlighting for each page identifier
- Test that page-specific state is preserved
- Test that components render consistently across pages

**Accessibility**
- Test keyboard navigation through menu items
- Test focus management after component injection
- Test that all images have alt text
- Test semantic HTML structure
- Test ARIA attributes preservation

**Error Scenarios**
- Test graceful degradation when components fail to load
- Test error logging for various failure modes
- Test that page remains functional without components
- Test retry logic for transient failures

#### Property-Based Tests

Property-based tests verify universal properties across many generated inputs. Each test should run a minimum of 100 iterations.

**Configuration**: Use fast-check (JavaScript) for property-based testing

**Test Tagging**: Each property test must reference its design document property:
```javascript
// Feature: header-footer-components, Property 1: Alpine Directive Preservation
test('Alpine directives are preserved in components', () => { ... });
```

**Property Test Examples**:

**Property 1: Alpine Directive Preservation**
```javascript
// Generate random Alpine directives
// Extract component
// Verify all directives present in component
fc.assert(fc.property(
  fc.array(alpineDirectiveArbitrary),
  (directives) => {
    const component = extractComponent(htmlWithDirectives(directives));
    return directives.every(d => component.includes(d));
  }
));
```

**Property 6: Dark Mode Persistence Round-Trip**
```javascript
// Generate random boolean values
// Set dark mode, persist to localStorage, retrieve
// Verify retrieved value equals original
fc.assert(fc.property(
  fc.boolean(),
  (darkModeValue) => {
    setDarkMode(darkModeValue);
    const retrieved = getDarkMode();
    return retrieved === darkModeValue;
  }
));
```

**Property 12: Navigation Highlighting**
```javascript
// Generate random page identifiers
// Render header with page identifier
// Verify corresponding nav item has active class
fc.assert(fc.property(
  fc.constantFrom('home', 'blog-grid', 'signin', 'signup', '404', 'equipo', 'extraescolares'),
  (pageId) => {
    const header = renderHeader({ page: pageId });
    const activeItem = header.querySelector(`a[href*="${pageId}"].mk`);
    return activeItem !== null;
  }
));
```

**Property 16: Component Caching**
```javascript
// Load component multiple times
// Verify only one fetch call is made
fc.assert(fc.property(
  fc.nat(10), // Number of load attempts
  async (loadCount) => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    for (let i = 0; i < loadCount; i++) {
      await loader.loadComponent('header');
    }
    return fetchSpy.mock.calls.length === 1;
  }
));
```

**Property 25: Graceful Degradation**
```javascript
// Generate random error scenarios
// Attempt component injection
// Verify page remains functional
fc.assert(fc.property(
  fc.constantFrom('network-error', '404', 'timeout', 'invalid-html'),
  async (errorType) => {
    mockError(errorType);
    await loader.loadAll();
    return pageIsFunctional() && noUncaughtExceptions();
  }
));
```

### Test Coverage Goals

- **Line Coverage**: Minimum 90% for component-loader.js
- **Branch Coverage**: Minimum 85% for error handling paths
- **Property Tests**: All 26 correctness properties must have corresponding property-based tests
- **Integration Tests**: All 9 target pages must be tested with component loading
- **Accessibility Tests**: All WCAG 2.1 Level AA requirements for navigation components

### Testing Tools

- **Unit Testing**: Jest or Vitest
- **Property-Based Testing**: fast-check
- **DOM Testing**: jsdom or happy-dom
- **Accessibility Testing**: axe-core
- **Visual Regression**: Percy or Chromatic (optional)
- **Performance Testing**: Lighthouse CI

### Continuous Integration

All tests must pass before merging:
- Run unit tests on every commit
- Run property tests (100 iterations minimum) on every PR
- Run integration tests across all target pages
- Run accessibility tests with axe-core
- Measure and report component injection performance

### Manual Testing Checklist

Before release, manually verify:
- [ ] All 9 target pages load correctly with components
- [ ] Dark mode toggle works on all pages
- [ ] Sticky header activates on scroll
- [ ] Mobile menu works on small screens
- [ ] Navigation highlighting matches current page
- [ ] Back-to-top button scrolls to top
- [ ] All links in header and footer are functional
- [ ] Newsletter form submission works
- [ ] Components work with file:// protocol (local development)
- [ ] Components work on production server
- [ ] No console errors on any page
- [ ] Keyboard navigation works throughout header and footer
- [ ] Screen reader announces navigation correctly

