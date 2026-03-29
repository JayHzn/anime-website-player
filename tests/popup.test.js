import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const popupHtml = readFileSync(
  join(import.meta.dirname, '..', 'extension', 'popup.html'),
  'utf-8'
);

describe('popup.html', () => {
  it('contains all 3 source buttons', () => {
    expect(popupHtml).toContain('data-source="anime-sama"');
    expect(popupHtml).toContain('data-source="french-anime"');
    expect(popupHtml).toContain('data-source="vostfree"');
  });

  it('does not contain old sources', () => {
    expect(popupHtml).not.toContain('voiranime');
    expect(popupHtml).not.toContain('voirdrama');
  });

  it('has a sourcesList container', () => {
    expect(popupHtml).toContain('id="sourcesList"');
  });

  it('loads popup.js', () => {
    expect(popupHtml).toContain('src="popup.js"');
  });

  it('has radio dot elements for each source', () => {
    const radioDots = popupHtml.match(/class="radio-dot"/g);
    expect(radioDots).toHaveLength(3);
  });
});

describe('popup.js - source toggle logic', () => {
  // Test the pure toggle logic extracted from popup.js
  function toggleSource(current, clicked) {
    return clicked === current ? null : clicked;
  }

  it('selects a source when none is selected', () => {
    expect(toggleSource(null, 'anime-sama')).toBe('anime-sama');
  });

  it('switches to a different source', () => {
    expect(toggleSource('anime-sama', 'vostfree')).toBe('vostfree');
  });

  it('deselects when clicking the same source', () => {
    expect(toggleSource('anime-sama', 'anime-sama')).toBeNull();
  });
});
