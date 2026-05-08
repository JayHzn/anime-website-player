// Popup: source selector for Shinani extension (dropdown version)

const SOURCES = new Set(['anime-sama', 'vostfree', 'jetanimes']);

async function getSelectedSource() {
  const result = await chrome.storage.local.get('selectedSource');
  return result.selectedSource || null;
}

async function setSelectedSource(source) {
  await chrome.storage.local.set({ selectedSource: source });
}

function render(selected) {
  const select = document.getElementById('sourceSelect');
  if (select) select.value = selected || '';
}

async function reloadShinaniTabs() {
  const origins = [
    'https://anime-website-player.onrender.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://localhost:8000',
  ];
  const tabs = await chrome.tabs.query({
    url: origins.map((o) => `${o}/*`),
  });
  for (const tab of tabs) {
    const origin = origins.find((o) => tab.url?.startsWith(o));
    await chrome.tabs.update(tab.id, { url: `${origin}/` });
  }
}

async function init() {
  const selected = await getSelectedSource();
  render(selected);

  document.getElementById('sourceSelect').addEventListener('change', async (e) => {
    const value = e.target.value || null;
    // Validate the source is in our known list (or null to deselect)
    const newSource = value === null || SOURCES.has(value) ? value : null;
    await setSelectedSource(newSource);
    await reloadShinaniTabs();
  });
}

init();
