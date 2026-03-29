import { describe, it, expect } from 'vitest';
import { FrenchAnimeSource } from '../extension/sources/french-anime.js';

const TIMEOUT = 15000;
const source = new FrenchAnimeSource();

describe('FrenchAnimeSource - search', () => {
  it('returns results for a known anime', async () => {
    const results = await source.search('one piece');
    expect(results.length).toBeGreaterThan(0);

    const first = results[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('title');
    expect(first).toHaveProperty('cover');
    expect(first.source).toBe('french-anime');
  }, TIMEOUT);

  it('returns results even for unknown query (site shows defaults)', async () => {
    // french-anime.com always shows some results (featured/recommended)
    const results = await source.search('zzzxxxyyy123456');
    expect(Array.isArray(results)).toBe(true);
  }, TIMEOUT);
});

describe('FrenchAnimeSource - getLatestEpisodes', () => {
  it('returns latest episodes from homepage', async () => {
    const latest = await source.getLatestEpisodes();
    expect(latest.length).toBeGreaterThan(0);

    const first = latest[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('title');
    expect(first).toHaveProperty('cover');
    expect(first.source).toBe('french-anime');
  }, TIMEOUT);
});

describe('FrenchAnimeSource - getAnimeInfo', () => {
  it('returns info for a known anime', async () => {
    const info = await source.getAnimeInfo('exclue/1862-one-punch-man');
    expect(info).toHaveProperty('title');
    expect(info.title).toContain('One Punch Man');
    expect(info).toHaveProperty('cover');
    expect(info).toHaveProperty('synopsis');
    expect(info.synopsis.length).toBeGreaterThan(0);
  }, TIMEOUT);
});

describe('FrenchAnimeSource - getEpisodes', () => {
  it('returns episodes for a known anime', async () => {
    const episodes = await source.getEpisodes('exclue/1862-one-punch-man');
    expect(episodes.length).toBeGreaterThan(0);

    const first = episodes[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('number', 1);
    expect(first).toHaveProperty('title');
    expect(first.id).toContain('#1');
  }, TIMEOUT);
});

describe('FrenchAnimeSource - getVideoUrl', () => {
  it('returns video sources for an episode', async () => {
    const video = await source.getVideoUrl('exclue/1862-one-punch-man#1');
    expect(video).toHaveProperty('url');
    expect(video).toHaveProperty('sources');
    expect(video.sources.length).toBeGreaterThan(0);

    const src = video.sources[0];
    expect(src).toHaveProperty('name');
    expect(src).toHaveProperty('url');
    expect(src.url).toMatch(/^https?:\/\//);
  }, TIMEOUT);
});
