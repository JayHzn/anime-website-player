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

  it('has host permissions for new sources', () => {
    const hosts = manifest.host_permissions;
    expect(hosts).toContain('https://anime-sama.to/*');
    expect(hosts).toContain('https://french-anime.com/*');
    expect(hosts).toContain('https://vostfree.ws/*');
  });

  it('does not have old source host permissions', () => {
    const hosts = manifest.host_permissions;
    const hasOld = hosts.some(
      (h) => h.includes('voiranime') || h.includes('voirdrama')
    );
    expect(hasOld).toBe(false);
  });

  it('has content scripts for AnimeHub pages', () => {
    expect(manifest.content_scripts).toHaveLength(1);
    const cs = manifest.content_scripts[0];
    expect(cs.js).toContain('content.js');
    expect(cs.run_at).toBe('document_start');
    expect(cs.matches).toContain('https://anime-website-player.onrender.com/*');
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
