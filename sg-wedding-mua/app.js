const STORAGE_KEY = 'sg-wedding-mua-processed-v1';

let artists = [];
let processed = loadProcessed();

const tableBody = document.getElementById('table-body');
const statsEl = document.getElementById('stats');
const searchInput = document.getElementById('search');
const showProcessedOnly = document.getElementById('show-processed-only');
const clearProcessedBtn = document.getElementById('clear-processed');
const emptyState = document.getElementById('empty-state');

function loadProcessed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
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
  const processedOnly = showProcessedOnly.checked;

  return artists.filter((artist) => {
    const isProcessed = Boolean(processed[artist.handle]);
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
  const done = Object.values(processed).filter(Boolean).length;
  const tagged = artists.filter((artist) => artist.tag).length;
  statsEl.innerHTML = `
    <span class="stat-item"><strong>${total}</strong> artists listed</span>
    <span class="stat-item"><strong>${done}</strong> processed</span>
    <span class="stat-item"><strong>${total - done}</strong> remaining</span>
    ${tagged ? `<span class="stat-item"><strong>${tagged}</strong> tagged new</span>` : ''}
  `;
}

function render() {
  const filtered = getFilteredArtists();
  tableBody.innerHTML = '';

  filtered.forEach((artist, index) => {
    const isProcessed = Boolean(processed[artist.handle]);
    const row = document.createElement('tr');
    if (isProcessed) row.classList.add('is-processed');
    if (artist.tag) row.classList.add('has-tag', `has-tag--${artist.tag}`);

    const description = (artist.description || '').trim();
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
        <a class="handle-link" href="https://www.instagram.com/${encodeURIComponent(artist.handle)}/" target="_blank" rel="noopener noreferrer">@${escapeHtml(artist.handle)}</a>
      </td>
      <td class="col-followers">${formatFollowers(artist.followers)}</td>
      <td class="col-processed">
        <input type="checkbox" class="processed-checkbox" data-handle="${escapeHtml(artist.handle)}" ${isProcessed ? 'checked' : ''} aria-label="Mark ${escapeHtml(artist.name)} as processed">
      </td>
    `;

    const checkbox = row.querySelector('.processed-checkbox');
    checkbox.addEventListener('change', (event) => {
      processed[artist.handle] = event.target.checked;
      if (!event.target.checked) delete processed[artist.handle];
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

searchInput.addEventListener('input', render);
showProcessedOnly.addEventListener('change', render);

clearProcessedBtn.addEventListener('click', () => {
  if (!confirm('Clear all processed checkboxes?')) return;
  processed = {};
  saveProcessed();
  render();
});

async function init() {
  try {
    const response = await fetch('artists.json');
    if (!response.ok) throw new Error(`Failed to load artists.json (${response.status})`);
    artists = await response.json();
    artists.sort((a, b) => (b.followers || 0) - (a.followers || 0));
    render();
  } catch (error) {
    tableBody.innerHTML = `<tr><td colspan="6">Could not load artist data: ${escapeHtml(error.message)}</td></tr>`;
  }
}

init();
