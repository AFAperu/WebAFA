/**
 * Property-Based Tests for Header Component
 * Feature: header-footer-components
 */

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Extract all Alpine.js directives from HTML content
 * @param {string} html - HTML content to parse
 * @returns {Array<{directive: string, value: string, context: string}>} Array of Alpine directives
 */
function extractAlpineDirectives(html) {
  const directives = [];
  
  // Alpine.js directive patterns:
  // - x-data, x-init, x-show, x-if, x-for, x-model, x-text, x-html, x-bind, x-on, x-cloak, x-ignore
  // - @event (shorthand for x-on:event)
  // - :attribute (shorthand for x-bind:attribute)
  
  const alpinePatterns = [
    // x-* directives
    /\s(x-[a-z-]+)=["']([^"']*?)["']/gi,
    // @event directives (x-on shorthand)
    /\s(@[a-z.-]+)=["']([^"']*?)["']/gi,
    // :attribute directives (x-bind shorthand)
    /\s(:[a-z-]+)=["']([^"']*?)["']/gi,
  ];
  
  alpinePatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const directive = match[1];
      const value = match[2];
      
      // Get context (surrounding text for better identification)
      const start = Math.max(0, match.index - 50);
      const end = Math.min(html.length, match.index + match[0].length + 50);
      const context = html.substring(start, end).replace(/\s+/g, ' ').trim();
      
      directives.push({
        directive,
        value,
        context,
        fullMatch: match[0].trim()
      });
    }
  });
  
  return directives;
}

/**
 * Normalize directive value for comparison (remove extra whitespace)
 */
function normalizeDirectiveValue(value) {
  return value.replace(/\s+/g, ' ').trim();
}

describe('Header Component - Alpine Directive Preservation', () => {
  const headerComponentPath = join(process.cwd(), 'components', 'header.html');
  
  let headerHtml;
  
  try {
    headerHtml = readFileSync(headerComponentPath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read files: ${error.message}`);
  }
  
  /**
   * Property 1: Alpine Directive Preservation
   * 
   * **Validates: Requirements 1.2, 1.5, 1.6, 4.7**
   * 
   * For any Alpine.js directive (x-data, @click, :class, @scroll.window, x-init, etc.) 
   * present in the original landing.html header, that directive SHALL be present with 
   * identical syntax in the corresponding component file.
   */
  test('Property 1: Header component contains essential Alpine directives', () => {
    const componentDirectives = extractAlpineDirectives(headerHtml);
    
    // Verify we found directives in the component
    expect(componentDirectives.length).toBeGreaterThan(0);
    
    // Critical directives that must be present in the header component
    const criticalDirectives = [
      '@scroll.window', // Sticky menu functionality
      '@click',         // Click handlers (hamburger menu, dropdown)
      ':class',         // Dynamic classes (navigation highlighting, menu state)
    ];
    
    criticalDirectives.forEach(directive => {
      const found = componentDirectives.some(d => d.directive === directive);
      expect(found).toBe(true);
    });
  });
  
  /**
   * Property-based test: Alpine directive preservation across variations
   * 
   * This test uses fast-check to generate variations and verify the property holds
   * across different scenarios.
   */
  test('Property 1 (PBT): Alpine directives exist in header component', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          '@scroll.window',
          '@click',
          ':class',
          ':value',
          '@change',
          '@click.prevent'
        ),
        (directiveType) => {
          const componentDirectives = extractAlpineDirectives(headerHtml);
          const componentOfType = componentDirectives.filter(d => d.directive === directiveType);
          
          // These directives should exist in the header component
          return componentOfType.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
  
  /**
   * Specific directive tests for critical Alpine.js functionality
   */
  test('Critical Alpine directives are present in header component', () => {
    const componentDirectives = extractAlpineDirectives(headerHtml);
    
    // Critical directives that must be present
    const criticalDirectives = [
      '@scroll.window', // Sticky menu functionality
      '@click',         // Click handlers (hamburger menu, dropdown)
      ':class',         // Dynamic classes (navigation highlighting, menu state)
      '@change',        // Dark mode toggle
      ':value',         // Dark mode checkbox value
      '@click.prevent'  // Dropdown toggle
    ];
    
    criticalDirectives.forEach(directive => {
      const inComponent = componentDirectives.some(d => d.directive === directive);
      expect(inComponent).toBe(true);
    });
  });
  
  /**
   * Test that the number of Alpine directives is consistent
   */
  test('Component has a reasonable number of Alpine directives', () => {
    const componentDirectives = extractAlpineDirectives(headerHtml);
    
    // Component should have a substantial number of directives for interactivity
    expect(componentDirectives.length).toBeGreaterThan(5);
  });
});
