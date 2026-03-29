import { describe, it, expect } from 'vitest';
import { AnimeSamaSource } from '../extension/sources/anime-sama.js';

// These tests make real HTTP requests to anime-sama.to
// They verify that the scraper correctly parses the site structure.

const TIMEOUT = 15000;
const source = new AnimeSamaSource();

describe('AnimeSamaSource - search', () => {
  it('returns results for a known anime', async () => {
    const results = await source.search('naruto');
    expect(results.length).toBeGreaterThan(0);

    const first = results[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('title');
    expect(first).toHaveProperty('cover');
    expect(first.title.toLowerCase()).toContain('naruto');
    expect(first.source).toBe('anime-sama');
  }, TIMEOUT);

  it('returns results with GitHub cover URLs', async () => {
    const results = await source.search('one piece');
    expect(results.length).toBeGreaterThan(0);
    const withCover = results.find((r) => r.cover.includes('raw.githubusercontent.com'));
    expect(withCover).toBeDefined();
  }, TIMEOUT);

  it('returns empty array for gibberish query', async () => {
    const results = await source.search('zzzxxxyyy123456');
    expect(results).toEqual([]);
  }, TIMEOUT);
});

describe('AnimeSamaSource - catalogue (empty search)', () => {
  it('returns catalogue items when query is empty', async () => {
    const results = await source.search('');
    expect(results.length).toBeGreaterThan(0);

    const first = results[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('title');
    expect(first).toHaveProperty('cover');
  }, TIMEOUT);
});

describe('AnimeSamaSource - getLatestEpisodes', () => {
  it('returns latest episodes from homepage', async () => {
    const latest = await source.getLatestEpisodes();
    expect(latest.length).toBeGreaterThan(0);

    const first = latest[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('title');
    expect(first).toHaveProperty('cover');
    expect(first.source).toBe('anime-sama');
  }, TIMEOUT);
});

describe('AnimeSamaSource - getAnimeInfo', () => {
  it('returns info for a known anime', async () => {
    const info = await source.getAnimeInfo('naruto');
    expect(info).toHaveProperty('id', 'naruto');
    expect(info).toHaveProperty('title');
    expect(info).toHaveProperty('cover');
    expect(info.cover).toContain('naruto');
    expect(info).toHaveProperty('seasons');
    expect(info.seasons.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('returns seasons with name and url', async () => {
    const info = await source.getAnimeInfo('naruto');
    const season = info.seasons[0];
    expect(season).toHaveProperty('name');
    expect(season).toHaveProperty('url');
  }, TIMEOUT);
});

describe('AnimeSamaSource - getEpisodes', () => {
  it('returns episodes for a known anime', async () => {
    const episodes = await source.getEpisodes('naruto');
    expect(episodes.length).toBeGreaterThan(0);

    const first = episodes[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('number', 1);
    expect(first).toHaveProperty('title');
    // id should be in format slug/seasonPath/epNumber
    expect(first.id).toMatch(/^naruto\//);
  }, TIMEOUT);
});

describe('AnimeSamaSource - getVideoUrl', () => {
  it('returns video sources for an episode', async () => {
    // First get episodes to have a valid episodeId
    const episodes = await source.getEpisodes('naruto');
    expect(episodes.length).toBeGreaterThan(0);

    const video = await source.getVideoUrl(episodes[0].id);
    expect(video).toHaveProperty('url');
    expect(video).toHaveProperty('sources');
    expect(video.sources.length).toBeGreaterThan(0);

    // Each source should have a name and url
    const src = video.sources[0];
    expect(src).toHaveProperty('name');
    expect(src).toHaveProperty('url');
    expect(src.url).toMatch(/^https?:\/\//);
  }, TIMEOUT);
});
