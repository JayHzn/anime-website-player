import { describe, it, expect, beforeEach } from 'vitest';
import {
  AVAILABLE_SOURCES,
  handleAction,
  getCachedSearch,
  setSearchCache,
  searchCache,
  SEARCH_CACHE_TTL,
} from '../extension/background.js';

// ── AVAILABLE_SOURCES ────────────────────────────────────────

describe('AVAILABLE_SOURCES', () => {
  it('contains exactly the 3 expected sources', () => {
    expect(AVAILABLE_SOURCES).toEqual(['anime-sama', 'french-anime', 'vostfree']);
  });

  it('does not contain old sources', () => {
    expect(AVAILABLE_SOURCES).not.toContain('voiranime');
    expect(AVAILABLE_SOURCES).not.toContain('voirdrama');
  });
});

// ── handleAction: ping ───────────────────────────────────────

describe('handleAction - ping', () => {
  it('returns version, sources list, and selectedSource', async () => {
    const result = await handleAction('ping', {}, {});
    expect(result).toEqual({
      version: '2.0.0',
      sources: AVAILABLE_SOURCES,
      selectedSource: null,
    });
  });

  it('returns the selected source when one is stored', async () => {
    chrome.storage.local._storage.selectedSource = 'vostfree';
    const result = await handleAction('ping', {}, {});
    expect(result.selectedSource).toBe('vostfree');
  });
});

// ── handleAction: getSelectedSource ──────────────────────────

describe('handleAction - getSelectedSource', () => {
  it('returns null when no source is selected', async () => {
    const result = await handleAction('getSelectedSource', {}, {});
    expect(result).toEqual({ selectedSource: null });
  });

  it('returns stored source', async () => {
    chrome.storage.local._storage.selectedSource = 'anime-sama';
    const result = await handleAction('getSelectedSource', {}, {});
    expect(result).toEqual({ selectedSource: 'anime-sama' });
  });
});

// ── handleAction: unknown source ─────────────────────────────

describe('handleAction - source validation', () => {
  it('throws when no source is provided for a source action', async () => {
    await expect(handleAction('search', {}, {})).rejects.toThrow('Source non configurée');
  });

  it('throws when an invalid source is provided', async () => {
    await expect(
      handleAction('search', { source: 'voiranime' }, {})
    ).rejects.toThrow('Source non configurée');
  });

  it('throws "not implemented" for unimplemented sources', async () => {
    const implemented = new Set(['anime-sama', 'french-anime']);
    const unimplemented = AVAILABLE_SOURCES.filter((s) => !implemented.has(s));
    for (const source of unimplemented) {
      await expect(
        handleAction('search', { source }, {})
      ).rejects.toThrow('pas encore implémentée');
    }
  });
});

// ── handleAction: unknown action ─────────────────────────────

describe('handleAction - unknown actions', () => {
  it('throws "Action inconnue" for unknown actions with an implemented source', async () => {
    await expect(
      handleAction('nonexistent', { source: 'anime-sama' }, {})
    ).rejects.toThrow('Action inconnue');
  });

  it('throws "not implemented" for unknown actions with an unimplemented source', async () => {
    await expect(
      handleAction('nonexistent', { source: 'vostfree' }, {})
    ).rejects.toThrow('pas encore implémentée');
  });
});

// ── Search cache ─────────────────────────────────────────────

describe('Search cache', () => {
  beforeEach(() => {
    searchCache.clear();
  });

  it('returns null for cache miss', () => {
    expect(getCachedSearch('anime-sama', 'naruto')).toBeNull();
  });

  it('caches and retrieves search results', () => {
    const results = [{ id: '1', title: 'Naruto' }];
    setSearchCache('anime-sama', 'naruto', results);
    const cached = getCachedSearch('anime-sama', 'naruto');
    expect(cached).toEqual(results);
  });

  it('returns a copy, not the original array', () => {
    const results = [{ id: '1', title: 'Naruto' }];
    setSearchCache('anime-sama', 'naruto', results);
    const cached = getCachedSearch('anime-sama', 'naruto');
    expect(cached).not.toBe(results); // different reference
  });

  it('isolates caches by source', () => {
    setSearchCache('anime-sama', 'naruto', [{ id: 'a' }]);
    setSearchCache('vostfree', 'naruto', [{ id: 'b' }]);
    expect(getCachedSearch('anime-sama', 'naruto')).toEqual([{ id: 'a' }]);
    expect(getCachedSearch('vostfree', 'naruto')).toEqual([{ id: 'b' }]);
  });

  it('expires after TTL', () => {
    const results = [{ id: '1' }];
    setSearchCache('anime-sama', 'test', results);

    // Manually expire
    const key = 'anime-sama:test';
    searchCache.get(key).at = Date.now() - SEARCH_CACHE_TTL - 1;

    expect(getCachedSearch('anime-sama', 'test')).toBeNull();
    // Entry should be deleted after expiry check
    expect(searchCache.has(key)).toBe(false);
  });
});
