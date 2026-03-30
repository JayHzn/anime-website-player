// Mock browser globals for testing
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (typeof navigator === 'undefined') {
  globalThis.navigator = { userAgent: 'Mozilla/5.0 (Test)' };
}

const _manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'extension/manifest.json'), 'utf8')
);

// Mock chrome extension APIs for testing

const storage = {};

globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn(async (key) => {
        if (typeof key === 'string') {
          return { [key]: storage[key] ?? undefined };
        }
        return {};
      }),
      set: vi.fn(async (obj) => {
        Object.assign(storage, obj);
      }),
      _storage: storage,
    },
  },
  runtime: {
    onMessage: {
      addListener: vi.fn(),
    },
    sendMessage: vi.fn(),
    lastError: null,
    getManifest: () => _manifest,
  },
  tabs: {
    query: vi.fn(async () => []),
    reload: vi.fn(async () => {}),
    create: vi.fn(async () => ({ id: 1 })),
    remove: vi.fn(async () => {}),
    get: vi.fn(async () => ({})),
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onRemoved: {
      addListener: vi.fn(),
    },
  },
  scripting: {
    executeScript: vi.fn(async () => []),
  },
};

// Reset storage between tests
beforeEach(() => {
  for (const key of Object.keys(storage)) {
    delete storage[key];
  }
  vi.clearAllMocks();
});
