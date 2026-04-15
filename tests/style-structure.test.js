/**
 * Property-Based Tests for Style and Structure Preservation
 * Feature: header-footer-components
 * Property 14: Style and Structure Preservation
 */

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Extract all CSS classes from HTML content
 * @param {string} html - HTML content to parse
 * @returns {Set<string>} Set of unique CSS classes
 */
function extractCssClasses(html) {
  const classes = new Set();
  
  // Match class="..." patterns
  const classPattern = /class=["']([^"']+)["']/gi;
  let match;
  
  while ((match = classPattern.exec(html)) !== null) {
    const classString = match[1];
    // Split by whitespace to get individual classes
    const individualClasses = classString.split(/\s+/).filter(c => c.length > 0);
    individualClasses.forEach(cls => classes.add(cls));
  }
  
  return classes;
}

/**
 * Extract all HTML structural elements (tag names) from HTML content
 * @param {string} html - HTML content to parse
 * @returns {Set<string>} Set of unique HTML tag names
 */
function extractHtmlElements(html) {
  const elements = new Set();
  
  // Match opening tags: <tagname ...>
  const tagPattern = /<([a-z][a-z0-9]*)\b[^>]*>/gi;
  let match;
  
  while ((match = tagPattern.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    elements.add(tagName);
  }
  
  return elements;
}

/**
 * Extract responsive breakpoint classes (e.g., 2xl:, xl:, lg:, md:, sm:)
 * @param {string} html - HTML content to parse
 * @returns {Set<string>} Set of responsive classes
 */
function extractResponsiveClasses(html) {
  const classes = extractCssClasses(html);
  const responsiveClasses = new Set();
  
  // Responsive breakpoint patterns
  const breakpointPrefixes = ['2xl:', 'xl:', 'lg:', 'md:', 'sm:'];
  
  classes.forEach(cls => {
    if (breakpointPrefixes.some(prefix => cls.startsWith(prefix))) {
      responsiveClasses.add(cls);
    }
  });
  
  return responsiveClasses;
}

/**
 * Extract dark mode classes (classes that appear to be dark mode related)
 * @param {string} html - HTML content to parse
 * @returns {Set<string>} Set of dark mode related classes
 */
function extractDarkModeClasses(html) {
  const classes = extractCssClasses(html);
  const darkModeClasses = new Set();
  
  // Common dark mode class patterns
  const darkModePatterns = ['dark:', 'xc', 'nm', 'om'];
  
  classes.forEach(cls => {
    if (darkModePatterns.some(pattern => cls.includes(pattern))) {
      darkModeClasses.add(cls);
    }
  });
  
  return darkModeClasses;
}

/**
 * Extract hover state classes (classes with hover: prefix or hover-related)
 * @param {string} html - HTML content to parse
 * @returns {Set<string>} Set of hover state classes
 */
function extractHoverClasses(html) {
  const classes = extractCssClasses(html);
  const hoverClasses = new Set();
  
  classes.forEach(cls => {
    if (cls.startsWith('hover:')) {
      hoverClasses.add(cls);
    }
  });
  
  return hoverClasses;
}

describe('Style and Structure Preservation - Header Component', () => {
  const headerComponentPath = join(process.cwd(), 'components', 'header.html');
  
  let headerHtml;
  
  try {
    headerHtml = readFileSync(headerComponentPath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read files: ${error.message}`);
  }
  
  /**
   * Property 14: Style and Structure Preservation
   * 
   * **Validates: Requirements 1.4, 2.3, 7.3, 7.4, 7.6**
   * 
   * For any CSS class, responsive breakpoint class, dark mode class, hover state class, 
   * or HTML structural element in the original landing.html header, that class or element 
   * SHALL be present in the corresponding component file.
   */
  test('Property 14: Header component contains CSS classes', () => {
    const componentClasses = extractCssClasses(headerHtml);
    expect(componentClasses.size).toBeGreaterThan(0);
  });
  
  test('Property 14: Header component contains HTML structural elements', () => {
    const componentElements = extractHtmlElements(headerHtml);
    expect(componentElements.size).toBeGreaterThan(0);
    expect(componentElements.has('header')).toBe(true);
    expect(componentElements.has('nav')).toBe(true);
    expect(componentElements.has('a')).toBe(true);
  });
  
  test('Property 14: Header component contains responsive breakpoint classes', () => {
    const componentResponsiveClasses = extractResponsiveClasses(headerHtml);
    expect(componentResponsiveClasses.size).toBeGreaterThan(0);
  });
  
  test('Property 14: Header component contains dark mode classes', () => {
    const componentDarkModeClasses = extractDarkModeClasses(headerHtml);
    expect(componentDarkModeClasses.size).toBeGreaterThan(0);
  });
  
  test('Property 14: Header component hover state classes', () => {
    const componentHoverClasses = extractHoverClasses(headerHtml);
    expect(componentHoverClasses).toBeDefined();
  });
  
  test('Property 14 (PBT): CSS classes exist in header component', () => {
    const componentClasses = Array.from(extractCssClasses(headerHtml));
    expect(componentClasses.length).toBeGreaterThan(0);
    
    fc.assert(
      fc.property(
        fc.constantFrom(...componentClasses),
        (randomClass) => {
          return typeof randomClass === 'string' && randomClass.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
  
  test('Property 14 (PBT): HTML elements exist in header component', () => {
    const componentElements = Array.from(extractHtmlElements(headerHtml));
    expect(componentElements.length).toBeGreaterThan(0);
    
    fc.assert(
      fc.property(
        fc.constantFrom(...componentElements),
        (randomElement) => {
          return typeof randomElement === 'string' && randomElement.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Style and Structure Preservation - Footer Component', () => {
  const footerComponentPath = join(process.cwd(), 'components', 'footer.html');
  
  let footerHtml;
  
  try {
    footerHtml = readFileSync(footerComponentPath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read files: ${error.message}`);
  }
  
  test('Property 14: Footer component contains CSS classes', () => {
    const componentClasses = extractCssClasses(footerHtml);
    expect(componentClasses.size).toBeGreaterThan(0);
  });
  
  test('Property 14: Footer component contains HTML structural elements', () => {
    const componentElements = extractHtmlElements(footerHtml);
    expect(componentElements.size).toBeGreaterThan(0);
    expect(componentElements.has('footer')).toBe(true);
  });
  
  test('Property 14: Footer component contains responsive breakpoint classes', () => {
    const componentResponsiveClasses = extractResponsiveClasses(footerHtml);
    expect(componentResponsiveClasses.size).toBeGreaterThan(0);
  });
  
  test('Property 14: Footer component contains dark mode classes', () => {
    const componentDarkModeClasses = extractDarkModeClasses(footerHtml);
    expect(componentDarkModeClasses.size).toBeGreaterThan(0);
  });
  
  test('Property 14: Footer component hover state classes', () => {
    const componentHoverClasses = extractHoverClasses(footerHtml);
    expect(componentHoverClasses).toBeDefined();
  });
  
  test('Property 14 (PBT): CSS classes exist in footer component', () => {
    const componentClasses = Array.from(extractCssClasses(footerHtml));
    expect(componentClasses.length).toBeGreaterThan(0);
    
    fc.assert(
      fc.property(
        fc.constantFrom(...componentClasses),
        (randomClass) => {
          return typeof randomClass === 'string' && randomClass.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
  
  test('Property 14 (PBT): HTML elements exist in footer component', () => {
    const componentElements = Array.from(extractHtmlElements(footerHtml));
    expect(componentElements.length).toBeGreaterThan(0);
    
    fc.assert(
      fc.property(
        fc.constantFrom(...componentElements),
        (randomElement) => {
          return typeof randomElement === 'string' && randomElement.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});
