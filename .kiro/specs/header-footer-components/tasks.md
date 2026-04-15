# Implementation Plan: Header and Footer Components

## Overview

This implementation plan breaks down the header and footer component extraction into discrete coding tasks. The approach follows a sequential build-up: first create the component files, then build the loader mechanism, then integrate into pages, and finally add optimizations and tests. Each task builds on previous work to ensure incremental validation.

## Tasks

- [ ] 1. Extract header and footer HTML into component files
  - [x] 1.1 Create components directory and extract header component
    - Create `components/` directory in project root
    - Copy complete `<header>` element from landing.html to `components/header.html`
    - Verify all Alpine.js directives are preserved (x-data, @click, :class, @scroll.window, x-init)
    - Verify all CSS classes, logo variants, navigation structure, and mobile menu are intact
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  
  - [x] 1.2 Write property test for Alpine directive preservation in header
    - **Property 1: Alpine Directive Preservation**
    - **Validates: Requirements 1.2, 1.5, 1.6, 4.7**
    - Test that all Alpine directives from landing.html header exist in header.html
  
  - [x] 1.3 Extract footer component
    - Copy complete `<footer>` element from landing.html to `components/footer.html`
    - Verify all sections are present (logo, social links, quick links, services, contact, newsletter)
    - Verify all SVG icons are embedded inline (not external references)
    - Verify all CSS classes and structure are preserved
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  
  - [x] 1.4 Write property test for style and structure preservation
    - **Property 14: Style and Structure Preservation**
    - **Validates: Requirements 1.4, 2.3, 7.3, 7.4, 7.6**
    - Test that all CSS classes and HTML elements from original are in components

- [ ] 2. Implement component loader core functionality
  - [x] 2.1 Create ComponentLoader class with basic structure
    - Create `component-loader.js` file
    - Implement ComponentLoader class with constructor accepting options (componentsPath, cache, timeout, fallbackContent)
    - Add in-memory cache object for storing loaded components
    - Add configuration for component definitions (name, file, placeholder, required)
    - _Requirements: 3.1, 8.2_
  
  - [x] 2.2 Implement loadComponent method with fetch and injection
    - Implement async loadComponent(componentName, placeholderId) method
    - Use fetch API to load component HTML from file
    - Implement placeholder validation before injection
    - Inject component HTML into placeholder element using innerHTML
    - Return boolean indicating success/failure
    - _Requirements: 3.1, 3.2, 3.3, 10.4_
  
  - [x] 2.3 Write property test for component placeholder injection
    - **Property 2: Component Placeholder Injection**
    - **Validates: Requirements 3.2, 3.3**
    - Test that component HTML is injected as child of placeholder element
  
  - [x] 2.4 Implement caching mechanism
    - Check cache before fetching component
    - Store fetched HTML in cache with timestamp and URL
    - Implement clearCache() method
    - Add cache hit/miss logging for debugging
    - _Requirements: 8.2_
  
  - [x] 2.5 Write property test for component caching behavior
    - **Property 16: Component Caching Behavior**
    - **Validates: Requirements 8.2**
    - Test that subsequent loads use cached content without new fetch requests

- [ ] 3. Implement error handling and resilience
  - [x] 3.1 Add comprehensive error handling to loadComponent
    - Wrap fetch in try-catch block
    - Handle network errors with descriptive logging
    - Handle 404 errors with component name in message
    - Handle timeout errors by aborting fetch after configured timeout
    - Preserve page state on any error (no uncaught exceptions)
    - _Requirements: 3.5, 10.2, 10.5_
  
  - [x] 3.2 Write property test for error logging on load failure
    - **Property 4: Error Logging on Load Failure**
    - **Validates: Requirements 3.5, 10.2**
    - Test that errors are logged with component name and error details
  
  - [x] 3.3 Write property test for graceful degradation
    - **Property 25: Graceful Degradation on Injection Failure**
    - **Validates: Requirements 10.5**
    - Test that page remains functional when component injection fails
  
  - [x] 3.4 Implement placeholder validation
    - Check that placeholder element exists before injection attempt
    - Log warning if placeholder is missing
    - Skip injection gracefully if placeholder not found
    - Continue loading other components
    - _Requirements: 10.4_
  
  - [x] 3.5 Write property test for placeholder validation
    - **Property 24: Placeholder Validation Before Injection**
    - **Validates: Requirements 10.4**
    - Test that loader validates placeholder existence and logs errors

- [ ] 4. Implement parallel loading and performance optimizations
  - [x] 4.1 Implement loadAll method with parallel loading
    - Create async loadAll() method
    - Use Promise.all() to load header and footer in parallel
    - Return object with status for each component {header: boolean, footer: boolean}
    - Handle partial failures gracefully (one component fails, other succeeds)
    - _Requirements: 8.3_
  
  - [x] 4.2 Write property test for parallel component loading
    - **Property 17: Parallel Component Loading**
    - **Validates: Requirements 8.3**
    - Test that fetch requests are initiated concurrently, not sequentially
  
  - [x] 4.3 Optimize component injection performance
    - Use innerHTML for fast DOM injection
    - Minimize DOM reflows by batching operations
    - Add performance.now() timing for debugging
    - Ensure injection completes within 100ms target
    - _Requirements: 8.4_
  
  - [x] 4.4 Write property test for component injection performance
    - **Property 18: Component Injection Performance**
    - **Validates: Requirements 8.4**
    - Test that injection time is less than 100ms on modern browsers

- [ ] 5. Ensure Alpine.js compatibility and timing
  - [x] 5.1 Implement synchronous blocking loader for initial page load
    - Create initialization function that blocks until components load
    - Ensure components are injected before Alpine.js processes DOM
    - Add script execution timing to run before Alpine.js script tag
    - Document the loading sequence in code comments
    - _Requirements: 3.4, 4.1_
  
  - [x] 5.2 Write property test for component loading before Alpine initialization
    - **Property 3: Component Loading Before Alpine Initialization**
    - **Validates: Requirements 3.4, 4.1**
    - Test that component injection completes before Alpine processes DOM
  
  - [x] 5.3 Add support for late Alpine initialization
    - Detect if Alpine is already initialized
    - Call Alpine.initTree() on injected components if needed
    - Log warning about late injection
    - Ensure Alpine processes new directives correctly
    - _Requirements: 4.7_
  
  - [x] 5.4 Preserve page-specific Alpine state
    - Ensure component injection doesn't overwrite page-level x-data
    - Test that page identifier, darkMode, navigationOpen, etc. are preserved
    - Document required Alpine state in code comments
    - _Requirements: 5.4, 6.1_
  
  - [x] 5.5 Write property test for page-specific state preservation
    - **Property 11: Page-Specific State Preservation**
    - **Validates: Requirements 5.4, 6.1**
    - Test that component loading doesn't modify page-specific state values

- [ ] 6. Implement page-specific customization support
  - [x] 6.1 Add navigation highlighting based on page identifier
    - Read page identifier from Alpine state
    - Apply active class ('mk') to corresponding navigation item
    - Support all page identifiers (home, blog-grid, blog-single, signin, signup, 404, equipo, extraescolares)
    - Test highlighting on each page type
    - _Requirements: 5.5, 6.2, 6.3_
  
  - [x] 6.2 Write property test for navigation highlighting
    - **Property 12: Navigation Highlighting Based on Page Identifier**
    - **Validates: Requirements 5.5, 6.2, 6.3**
    - Test that correct nav item has active class for any page identifier
  
  - [x] 6.3 Document page customization options
    - Add code comments explaining page identifier usage
    - Document how to customize CTA buttons per page
    - Document CSS class customization for placeholders
    - Add examples for common customization scenarios
    - _Requirements: 6.4, 6.5, 10.3_

- [ ] 7. Update all target pages with component placeholders
  - [x] 7.1 Update landing.html with component system
    - Replace inline header with `<div id="header-placeholder"></div>`
    - Replace inline footer with `<div id="footer-placeholder"></div>`
    - Add component-loader.js script before Alpine.js
    - Ensure Alpine state includes all required variables (page, darkMode, stickyMenu, navigationOpen, scrollTop)
    - Set page identifier to 'home'
    - _Requirements: 5.1, 5.2, 5.4_
  
  - [x] 7.2 Update index.html with component system
    - Replace inline header/footer with placeholders
    - Add component-loader.js script
    - Configure Alpine state with page identifier
    - _Requirements: 5.1, 5.2, 3.7_
  
  - [x] 7.3 Update blog pages (blog-grid.html, blog-single.html)
    - Replace inline header/footer with placeholders in both files
    - Add component-loader.js script to both files
    - Set appropriate page identifiers ('blog-grid', 'blog-single')
    - _Requirements: 5.1, 5.2, 3.7_
  
  - [x] 7.4 Update authentication pages (signin.html, signup.html)
    - Replace inline header/footer with placeholders in both files
    - Add component-loader.js script to both files
    - Set appropriate page identifiers ('signin', 'signup')
    - _Requirements: 5.1, 5.2, 3.7_
  
  - [x] 7.5 Update content pages (equipo.html, extraescolares.html)
    - Replace inline header/footer with placeholders in both files
    - Add component-loader.js script to both files
    - Set appropriate page identifiers ('equipo', 'extraescolares')
    - _Requirements: 5.1, 5.2, 3.7_
  
  - [x] 7.6 Update 404.html with component system
    - Replace inline header/footer with placeholders
    - Add component-loader.js script
    - Set page identifier to '404'
    - _Requirements: 5.1, 5.2, 3.7_
  
  - [x] 7.7 Write property test for cross-page compatibility
    - **Property 5: Cross-Page Compatibility**
    - **Validates: Requirements 3.7, 5.6**
    - Test that component loader works on all 9 target pages without errors
  
  - [x] 7.8 Write property test for consistent component rendering
    - **Property 13: Consistent Component Rendering Across Pages**
    - **Validates: Requirements 5.3, 7.1, 7.2**
    - Test that header and footer HTML is identical across all pages

- [x] 8. Checkpoint - Verify basic functionality
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement Alpine.js interactive features preservation
  - [x] 9.1 Verify dark mode toggle and localStorage persistence
    - Test dark mode toggle button in header
    - Verify state persists to localStorage
    - Verify state loads from localStorage on page refresh
    - Test dark mode classes apply correctly to body element
    - _Requirements: 4.2_
  
  - [x] 9.2 Write property test for dark mode persistence
    - **Property 6: Dark Mode Persistence Round-Trip**
    - **Validates: Requirements 4.2**
    - Test that dark mode value round-trips through localStorage correctly
  
  - [x] 9.3 Verify sticky menu scroll behavior
    - Test that stickyMenu state activates when scrolling past 20px
    - Test that sticky classes apply to header element
    - Verify smooth transition animations
    - _Requirements: 4.3_
  
  - [x] 9.4 Write property test for sticky menu activation
    - **Property 7: Scroll Event Sticky Menu Activation**
    - **Validates: Requirements 4.3**
    - Test that stickyMenu state changes based on scroll position
  
  - [x] 9.5 Verify navigation dropdown interactions
    - Test dropdown toggle on click
    - Test dropdown state management
    - Verify dropdown closes when clicking outside
    - _Requirements: 4.4_
  
  - [x] 9.6 Write property test for navigation dropdown toggle
    - **Property 8: Navigation Dropdown Toggle**
    - **Validates: Requirements 4.4**
    - Test that dropdown state toggles correctly on click
  
  - [x] 9.7 Verify mobile hamburger menu functionality
    - Test mobile menu toggle button
    - Test navigationOpen state changes
    - Verify mobile menu animations
    - Test menu closes when clicking menu items
    - _Requirements: 4.5_
  
  - [x] 9.8 Write property test for mobile menu toggle
    - **Property 9: Mobile Menu Toggle**
    - **Validates: Requirements 4.5**
    - Test that navigationOpen toggles on hamburger button click
  
  - [x] 9.9 Verify back-to-top button functionality
    - Test back-to-top button appears when scrolling down
    - Test button scrolls page to top when clicked
    - Verify smooth scroll behavior
    - _Requirements: 4.6_
  
  - [x] 9.10 Write property test for back-to-top scroll behavior
    - **Property 10: Back-to-Top Scroll Behavior**
    - **Validates: Requirements 4.6**
    - Test that clicking back-to-top scrolls page to position 0

- [ ] 10. Implement accessibility features and validation
  - [x] 10.1 Verify semantic HTML structure preservation
    - Check that header, nav, footer, ul, li, a, button elements are preserved
    - Verify heading hierarchy is correct
    - Ensure form elements have proper labels
    - _Requirements: 9.1, 9.4_
  
  - [x] 10.2 Write property test for semantic HTML preservation
    - **Property 19: Semantic HTML Preservation**
    - **Validates: Requirements 9.1, 9.4**
    - Test that all semantic elements from original are in components
  
  - [x] 10.3 Verify keyboard navigation support
    - Test Tab key navigation through all interactive elements
    - Test Enter/Space key activation of buttons and links
    - Verify focus indicators are visible
    - Test Escape key closes mobile menu and dropdowns
    - _Requirements: 9.2_
  
  - [x] 10.4 Write property test for keyboard navigation
    - **Property 20: Keyboard Navigation Support**
    - **Validates: Requirements 9.2**
    - Test that all interactive elements are keyboard-accessible
  
  - [x] 10.5 Verify ARIA attributes preservation
    - Check aria-label, aria-expanded, aria-hidden attributes
    - Verify aria-current for active navigation items
    - Test screen reader announcements (manual testing)
    - _Requirements: 9.3_
  
  - [x] 10.6 Write property test for ARIA attribute preservation
    - **Property 21: ARIA Attribute Preservation**
    - **Validates: Requirements 9.3**
    - Test that all ARIA attributes from original are in components
  
  - [x] 10.7 Verify focus management after component injection
    - Test that focus is not lost during component injection
    - Verify focus moves logically after injection
    - Test focus trap in mobile menu when open
    - _Requirements: 9.5_
  
  - [x] 10.8 Write property test for focus management
    - **Property 22: Focus Management After Injection**
    - **Validates: Requirements 9.5**
    - Test that focus is preserved or moves logically after injection
  
  - [x] 10.9 Verify image alt text preservation
    - Check that all img elements have alt attributes
    - Verify alt text is descriptive and meaningful
    - Test decorative images have empty alt=""
    - _Requirements: 9.6_
  
  - [x] 10.10 Write property test for image alt text
    - **Property 23: Image Alt Text Preservation**
    - **Validates: Requirements 9.6**
    - Test that all images have alt attributes with descriptive text

- [ ] 11. Implement visual consistency and styling
  - [x] 11.1 Verify responsive breakpoint behaviors
    - Test header layout at mobile, tablet, and desktop breakpoints
    - Test footer layout at all breakpoints
    - Verify mobile menu appears only on small screens
    - Test that all responsive classes are preserved
    - _Requirements: 7.3_
  
  - [x] 11.2 Prevent flash of unstyled content (FOUC)
    - Add CSS to hide placeholders until components load
    - Add loading state styling to placeholders
    - Ensure smooth transition when components appear
    - Test on slow network connections
    - _Requirements: 7.5_
  
  - [x] 11.3 Write property test for FOUC prevention
    - **Property 15: Flash of Unstyled Content Prevention**
    - **Validates: Requirements 7.5**
    - Test that placeholders have styling to prevent visible layout shift
  
  - [x] 11.4 Verify hover states and transitions
    - Test all hover effects on navigation items
    - Test button hover states
    - Test social icon hover effects
    - Verify transition timing is preserved
    - _Requirements: 7.6_

- [ ] 12. Add development and debugging support
  - [x] 12.1 Add comprehensive code comments
    - Document ComponentLoader class and methods
    - Explain loading sequence and Alpine.js timing
    - Document configuration options
    - Add examples for common use cases
    - _Requirements: 10.3_
  
  - [x] 12.2 Implement debug mode and logging
    - Add ComponentLoader.debug flag for verbose logging
    - Implement getStatus() method to check component load status
    - Add retryFailed() method for manual retry
    - Log component load timing for performance monitoring
    - _Requirements: 10.1_
  
  - [x] 12.3 Add file:// protocol support
    - Test component loading with file:// URLs
    - Handle CORS restrictions for local development
    - Document local development setup
    - Provide fallback for file:// protocol limitations
    - _Requirements: 3.6_

- [x] 13. Final checkpoint and integration testing
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Write remaining property-based tests
  - [x] 14.1 Write property test for SVG icon inline embedding
    - **Property 26: SVG Icon Inline Embedding**
    - **Validates: Requirements 2.5**
    - Test that all SVG icons are embedded inline in footer component

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All 9 target pages must be updated: landing.html, index.html, blog-grid.html, blog-single.html, equipo.html, extraescolares.html, signin.html, signup.html, 404.html
- The component loader must execute before Alpine.js to ensure proper initialization
- All Alpine.js interactive features must continue working after component extraction
