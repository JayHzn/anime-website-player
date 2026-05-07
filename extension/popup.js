// Popup: source selector for Shinani extension

const SOURCES = ['anime-sama', 'vostfree', 'jetanimes'];

async function getSelectedSource() {
  const result = await chrome.storage.local.get('selectedSource');
  return result.selectedSource || null;
}

async function setSelectedSource(source) {
  await chrome.storage.local.set({ selectedSource: source });
}

function render(selected) {
  document.querySelectorAll('li[data-source]').forEach((li) => {
    const src = li.dataset.source;
    li.classList.toggle('active', src === selected);
  });
}

async function init() {
  const selected = await getSelectedSource();
  render(selected);

  document.getElementById('sourcesList').addEventListener('click', async (e) => {
    const li = e.target.closest('li[data-source]');
    if (!li) return;

    const source = li.dataset.source;
    const current = await getSelectedSource();

    // Toggle: click same source again to deselect
    const newSource = source === current ? null : source;
    await setSelectedSource(newSource);
    render(newSource);

    // Navigate all Shinani tabs to homepage and reload (reset)
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
      // Navigate to homepage root, which forces a full reset
      await chrome.tabs.update(tab.id, { url: `${origin}/` });
    }
  });
}

init();
