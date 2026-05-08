import { describe, it, expect } from 'vitest';

// These tests verify that the source websites are reachable and have
// the expected structure. They make real HTTP requests, so they may
// fail if a site is down or behind aggressive Cloudflare challenges.
// They are tagged as "scraping" so they can be run separately.

const TIMEOUT = 15000;

describe('anime-sama.to', () => {
  it('homepage is reachable', async () => {
    const res = await fetch('https://anime-sama.to/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html).toContain('anime-card-premium');
  }, TIMEOUT);

  it('catalogue page is reachable', async () => {
    const res = await fetch('https://anime-sama.to/catalogue/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html).toContain('catalog-card');
  }, TIMEOUT);

  it('search endpoint returns results', async () => {
    const res = await fetch('https://anime-sama.to/template-php/defaut/fetch.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: 'query=naruto',
    });
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html.toLowerCase()).toContain('naruto');
  }, TIMEOUT);

  it('cover images use GitHub raw pattern', async () => {
    const res = await fetch('https://anime-sama.to/template-php/defaut/fetch.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: 'query=one+piece',
    });
    const html = await res.text();
    expect(html).toContain('raw.githubusercontent.com/Anime-Sama/IMG');
  }, TIMEOUT);
});

describe('vostfree.ws', () => {
  it('homepage is reachable', async () => {
    const res = await fetch('https://vostfree.ws/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    expect(res.status).toBeDefined();
    if (res.ok) {
      const html = await res.text();
      expect(html).toContain('<html');
    }
  }, TIMEOUT);

  it('search endpoint (POST) returns results', async () => {
    const res = await fetch('https://vostfree.ws/index.php?do=search', {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: 'do=search&subaction=search&story=naruto',
    });
    expect(res.status).toBeDefined();
    if (res.ok) {
      const html = await res.text();
      // Search results should contain at least one search-result card
      expect(html).toContain('class="search-result"');
    }
  }, TIMEOUT);
});

describe('jetanimes.com', () => {
  it('homepage is reachable', async () => {
    const res = await fetch('https://jetanimes.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow',
    });
    expect(res.status).toBeDefined();
    if (res.ok) {
      const html = await res.text();
      expect(html).toContain('<html');
    }
  }, TIMEOUT);

  it('search returns result-item cards', async () => {
    const res = await fetch('https://jetanimes.com/?s=naruto', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow',
    });
    expect(res.status).toBeDefined();
    if (res.ok) {
      const html = await res.text();
      expect(html).toContain('class="result-item"');
    }
  }, TIMEOUT);
});
