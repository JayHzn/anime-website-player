// Mock browser globals for testing

if (typeof navigator === 'undefined') {
  globalThis.navigator = { userAgent: 'Mozilla/5.0 (Test)' };
}

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
