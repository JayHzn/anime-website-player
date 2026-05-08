import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const manifestPath = join(import.meta.dirname, '..', 'extension', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

describe('manifest.json', () => {
  it('is valid manifest v3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('has a popup defined', () => {
    expect(manifest.action).toBeDefined();
    expect(manifest.action.default_popup).toBe('popup.html');
  });

  it('has storage permission', () => {
    expect(manifest.permissions).toContain('storage');
  });

  it('has host permissions for active sources', () => {
    const hosts = manifest.host_permissions;
    expect(hosts).toContain('https://anime-sama.to/*');
    expect(hosts).toContain('https://vostfree.ws/*');
    expect(hosts).toContain('https://on.jetanimes.com/*');
  });

  it('does not have removed source host permissions', () => {
    const hosts = manifest.host_permissions;
    const hasRemoved = hosts.some(
      (h) => h.includes('voiranime') || h.includes('voirdrama') || h.includes('french-anime.com')
    );
    expect(hasRemoved).toBe(false);
  });

  it('has both content scripts (site bridge + player extractor)', () => {
    expect(manifest.content_scripts).toHaveLength(2);
    const siteCs = manifest.content_scripts.find((cs) => cs.js.includes('content.js'));
    expect(siteCs).toBeDefined();
    expect(siteCs.run_at).toBe('document_start');
    expect(siteCs.matches).toContain('https://anime-website-player.onrender.com/*');

    const playerCs = manifest.content_scripts.find((cs) => cs.js.includes('player-extractor.js'));
    expect(playerCs).toBeDefined();
    expect(playerCs.world).toBe('MAIN');
    expect(playerCs.all_frames).toBe(true);
  });

  it('has a background service worker', () => {
    expect(manifest.background.service_worker).toBe('background.js');
    expect(manifest.background.type).toBe('module');
  });

  it('has an icon', () => {
    expect(manifest.icons).toBeDefined();
    expect(manifest.icons['48']).toBe('icons/icon48.png');
  });

  it('references only files that exist in the extension folder', () => {
    const extDir = join(import.meta.dirname, '..', 'extension');
    const filesToCheck = [
      manifest.background.service_worker,
      manifest.action.default_popup,
      ...manifest.content_scripts.flatMap((cs) => cs.js),
      ...Object.values(manifest.icons),
    ];

    for (const file of filesToCheck) {
      const fullPath = join(extDir, file);
      expect(() => readFileSync(fullPath), `Missing file: ${file}`).not.toThrow();
    }
  });
});
