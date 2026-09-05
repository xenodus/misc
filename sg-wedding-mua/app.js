const PROCESSED_STORAGE_KEY = 'sg-wedding-mua-processed-v1';
const SEEN_STORAGE_KEY = 'sg-wedding-mua-seen-handles-v1';

let artists = [];
let processed = loadProcessed();
let seenHandles = loadSeenHandles();

const tableBody = document.getElementById('table-body');
const statsEl = document.getElementById('stats');
const searchInput = document.getElementById('search');
const showNewOnly = document.getElementById('show-new-only');
const showProcessedOnly = document.getElementById('show-processed-only');
const clearProcessedBtn = document.getElementById('clear-processed');
const markAllSeenBtn = document.getElementById('mark-all-seen');
const emptyState = document.getElementById('empty-state');

function loadProcessed() {
  try {
    const raw = localStorage.getItem(PROCESSED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProcessed() {
  localStorage.setItem(PROCESSED_STORAGE_KEY, JSON.stringify(processed));
}

function loadSeenHandles() {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeenHandles() {
  localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify([...seenHandles]));
}

function isNew(artist) {
  return !seenHandles.has(artist.handle);
}

function markSeen(handle) {
  if (!seenHandles.has(handle)) {
    seenHandles.add(handle);
    saveSeenHandles();
  }
}

function markAllSeen() {
  artists.forEach((artist) => seenHandles.add(artist.handle));
  saveSeenHandles();
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
    const isProcessed = Boolean(processed[artist.handle]);
    if (newOnly && !isNew(artist)) return false;
    if (processedOnly && !isProcessed) return false;
    if (!query) return true;
    return (
      artist.name.toLowerCase().includes(query) ||
      artist.handle.toLowerCase().includes(query) ||
      (artist.description || '').toLowerCase().includes(query)
    );
  });
}

function updateStats() {
  const total = artists.length;
  const newCount = artists.filter((artist) => isNew(artist)).length;
  const done = Object.values(processed).filter(Boolean).length;
  statsEl.innerHTML = `
    <span class="stat-item"><strong>${total}</strong> artists listed</span>
    <span class="stat-item"><strong>${newCount}</strong> new</span>
    <span class="stat-item"><strong>${done}</strong> processed</span>
    <span class="stat-item"><strong>${total - done}</strong> remaining</span>
  `;
}

function render() {
  const filtered = getFilteredArtists();
  tableBody.innerHTML = '';

  filtered.forEach((artist, index) => {
    const isProcessed = Boolean(processed[artist.handle]);
    const row = document.createElement('tr');
    if (isProcessed) row.classList.add('is-processed');

    const description = (artist.description || '').trim();
    row.innerHTML = `
      <td class="col-rank">${index + 1}</td>
      <td class="col-name">
        <span class="artist-name">${escapeHtml(artist.name)}</span>${isNew(artist) ? ' <span class="new-badge">New</span>' : ''}
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
      if (event.target.checked) markSeen(artist.handle);
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
showNewOnly.addEventListener('change', render);
showProcessedOnly.addEventListener('change', render);

clearProcessedBtn.addEventListener('click', () => {
  if (!confirm('Clear all processed checkboxes?')) return;
  processed = {};
  saveProcessed();
  render();
});

markAllSeenBtn.addEventListener('click', () => {
  markAllSeen();
  render();
});

async function init() {
  try {
    const response = await fetch('artists.json');
    if (!response.ok) throw new Error(`Failed to load artists.json (${response.status})`);
    artists = await response.json();
    artists.sort((a, b) => (b.followers || 0) - (a.followers || 0));

    if (seenHandles.size === 0) {
      markAllSeen();
    }

    render();
  } catch (error) {
    tableBody.innerHTML = `<tr><td colspan="6">Could not load artist data: ${escapeHtml(error.message)}</td></tr>`;
  }
}

init();
