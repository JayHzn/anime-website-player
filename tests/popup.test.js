import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const popupHtml = readFileSync(
  join(import.meta.dirname, '..', 'extension', 'popup.html'),
  'utf-8'
);

const popupJs = readFileSync(
  join(import.meta.dirname, '..', 'extension', 'popup.js'),
  'utf-8'
);

describe('popup.html', () => {
  it('uses a <select> dropdown for source selection', () => {
    expect(popupHtml).toMatch(/<select\s+id="sourceSelect"/);
  });

  it('contains an option for every active source', () => {
    expect(popupHtml).toContain('value="anime-sama"');
    expect(popupHtml).toContain('value="vostfree"');
    expect(popupHtml).toContain('value="jetanimes"');
  });

  it('has an empty option to allow deselecting', () => {
    expect(popupHtml).toMatch(/<option\s+value=""/);
  });

  it('does not contain removed sources', () => {
    expect(popupHtml).not.toContain('voiranime');
    expect(popupHtml).not.toContain('voirdrama');
    expect(popupHtml).not.toContain('value="french-anime"');
  });

  it('loads popup.js', () => {
    expect(popupHtml).toContain('src="popup.js"');
  });
});

describe('popup.js', () => {
  it('listens to the change event of the select', () => {
    expect(popupJs).toMatch(/getElementById\(['"]sourceSelect['"]\)\.addEventListener\(['"]change['"]/);
  });

  it('persists the selected source in chrome.storage', () => {
    expect(popupJs).toMatch(/chrome\.storage\.local\.set\(/);
  });

  it('reloads Shinani tabs after a source change', () => {
    expect(popupJs).toMatch(/chrome\.tabs\.update/);
  });
});

describe('source selection logic', () => {
  // Mirrors the validation in popup.js
  const SOURCES = new Set(['anime-sama', 'vostfree', 'jetanimes']);
  function pickSource(value) {
    if (value === '' || value === null) return null;
    return SOURCES.has(value) ? value : null;
  }

  it('returns null for empty value (deselect)', () => {
    expect(pickSource('')).toBeNull();
    expect(pickSource(null)).toBeNull();
  });

  it('returns the source when valid', () => {
    expect(pickSource('anime-sama')).toBe('anime-sama');
    expect(pickSource('vostfree')).toBe('vostfree');
    expect(pickSource('jetanimes')).toBe('jetanimes');
  });

  it('returns null for unknown sources', () => {
    expect(pickSource('voiranime')).toBeNull();
    expect(pickSource('french-anime')).toBeNull();
    expect(pickSource('garbage')).toBeNull();
  });
});
