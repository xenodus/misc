const STORAGE_KEY = 'sg-wedding-mua-processed-v2';
const PLATFORMS = {
  instagram: {
    label: 'Instagram',
    dataFile: 'artists.json',
    subtitle: 'Bridal MUAs on Instagram — sorted by followers',
    handleHeader: 'Instagram Handle',
    profileUrl: (handle) => `https://www.instagram.com/${encodeURIComponent(handle)}/`,
  },
  tiktok: {
    label: 'TikTok',
    dataFile: 'artists-tiktok.json',
    subtitle: 'Bridal MUAs on TikTok — sorted by followers',
    handleHeader: 'TikTok Handle',
    profileUrl: (handle) => `https://www.tiktok.com/@${encodeURIComponent(handle)}`,
  },
};

let currentPlatform = 'instagram';
let artists = [];
let processed = loadProcessed();

const tableBody = document.getElementById('table-body');
const statsEl = document.getElementById('stats');
const subtitleEl = document.getElementById('subtitle');
const handleHeaderEl = document.getElementById('handle-header');
const searchInput = document.getElementById('search');
const showNewOnly = document.getElementById('show-new-only');
const showProcessedOnly = document.getElementById('show-processed-only');
const clearProcessedBtn = document.getElementById('clear-processed');
const emptyState = document.getElementById('empty-state');
const platformTabs = document.querySelectorAll('.platform-tab');

function processedKey(handle) {
  return `${currentPlatform}:${handle}`;
}

function loadProcessed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);

    const legacy = localStorage.getItem('sg-wedding-mua-processed-v1');
    if (!legacy) return {};

    const migrated = {};
    for (const [handle, value] of Object.entries(JSON.parse(legacy))) {
      if (value) migrated[`instagram:${handle}`] = true;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return {};
  }
}

function saveProcessed() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(processed));
}

function formatFollowers(count) {
  if (!count) return '—';
  return count.toLocaleString('en-SG');
}

function getFilteredArtists() {
  const query = searchInput.value.trim().toLowerCase();
  const newOnly = showNewOnly.checked;
  const processedOnly = showProcessedOnly.checked;

  return artists.filter((artist) => {
    const isProcessed = Boolean(processed[processedKey(artist.handle)]);
    if (newOnly && artist.tag !== 'new') return false;
    if (processedOnly && !isProcessed) return false;
    if (!query) return true;
    return (
      artist.name.toLowerCase().includes(query) ||
      artist.handle.toLowerCase().includes(query) ||
      (artist.description || '').toLowerCase().includes(query)
    );
  });
}

function formatTagLabel(tag) {
  if (!tag) return '';
  return String(tag)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function renderTagBadge(tag) {
  if (!tag) return '';
  const label = formatTagLabel(tag);
  return `<span class="artist-tag artist-tag--${escapeHtml(tag)}">${escapeHtml(label)}</span>`;
}

function updateStats() {
  const total = artists.length;
  const prefix = `${currentPlatform}:`;
  const done = Object.entries(processed).filter(([key, value]) => value && key.startsWith(prefix)).length;
  const tagged = artists.filter((artist) => artist.tag === 'new').length;
  const config = PLATFORMS[currentPlatform];

  statsEl.innerHTML = `
    <span class="stat-item"><strong>${total}</strong> ${config.label} artists listed</span>
    <span class="stat-item"><strong>${done}</strong> processed</span>
    <span class="stat-item"><strong>${total - done}</strong> remaining</span>
    ${tagged ? `<span class="stat-item"><strong>${tagged}</strong> tagged new</span>` : ''}
  `;
}

function render() {
  const filtered = getFilteredArtists();
  const config = PLATFORMS[currentPlatform];
  tableBody.innerHTML = '';

  filtered.forEach((artist, index) => {
    const isProcessed = Boolean(processed[processedKey(artist.handle)]);
    const row = document.createElement('tr');
    if (isProcessed) row.classList.add('is-processed');
    if (artist.tag) row.classList.add('has-tag', `has-tag--${artist.tag}`);

    const description = (artist.description || '').trim();
    const profileUrl = artist.tiktok || artist.instagram || config.profileUrl(artist.handle);

    row.innerHTML = `
      <td class="col-rank">${index + 1}</td>
      <td class="col-name">
        <span class="artist-name-row">
          <span class="artist-name">${escapeHtml(artist.name)}</span>
          ${renderTagBadge(artist.tag)}
        </span>
      </td>
      <td class="col-description">${
        description
          ? `<span class="artist-description">${escapeHtml(description)}</span>`
          : '<span class="artist-description is-empty">—</span>'
      }</td>
      <td class="col-handle">
        <a class="handle-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(artist.handle)}</a>
      </td>
      <td class="col-followers">${formatFollowers(artist.followers)}</td>
      <td class="col-processed">
        <input type="checkbox" class="processed-checkbox" data-handle="${escapeHtml(artist.handle)}" ${isProcessed ? 'checked' : ''} aria-label="Mark ${escapeHtml(artist.name)} as processed">
      </td>
    `;

    const checkbox = row.querySelector('.processed-checkbox');
    checkbox.addEventListener('change', (event) => {
      const key = processedKey(artist.handle);
      processed[key] = event.target.checked;
      if (!event.target.checked) delete processed[key];
      saveProcessed();
      updateStats();
      render();
    });

    tableBody.appendChild(row);
  });

  emptyState.hidden = filtered.length > 0;
  updateStats();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setActiveTab(platform) {
  currentPlatform = platform;
  const config = PLATFORMS[platform];
  subtitleEl.textContent = config.subtitle;
  handleHeaderEl.textContent = config.handleHeader;

  platformTabs.forEach((tab) => {
    const isActive = tab.dataset.platform === platform;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

async function loadPlatform(platform) {
  const config = PLATFORMS[platform];
  setActiveTab(platform);

  try {
    const response = await fetch(config.dataFile);
    if (!response.ok) throw new Error(`Failed to load ${config.dataFile} (${response.status})`);
    artists = await response.json();
    artists.sort((a, b) => (b.followers || 0) - (a.followers || 0));
    render();
  } catch (error) {
    artists = [];
    tableBody.innerHTML = `<tr><td colspan="6">Could not load ${escapeHtml(config.label)} data: ${escapeHtml(error.message)}</td></tr>`;
    updateStats();
  }
}

platformTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const platform = tab.dataset.platform;
    if (platform === currentPlatform) return;
    loadPlatform(platform);
  });
});

searchInput.addEventListener('input', render);
showNewOnly.addEventListener('change', render);
showProcessedOnly.addEventListener('change', render);

clearProcessedBtn.addEventListener('click', () => {
  if (!confirm(`Clear all processed checkboxes for ${PLATFORMS[currentPlatform].label}?`)) return;
  const prefix = `${currentPlatform}:`;
  for (const key of Object.keys(processed)) {
    if (key.startsWith(prefix)) delete processed[key];
  }
  saveProcessed();
  render();
});

loadPlatform('instagram');
