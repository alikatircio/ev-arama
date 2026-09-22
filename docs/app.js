const WORKER_URL = (window.EV_ARAMA_CONFIG && window.EV_ARAMA_CONFIG.WORKER_URL) || '';

const SITE_LABELS = {
  kleinanzeigen: 'Kleinanzeigen',
  immowelt: 'Immowelt',
  immoscout: 'ImmoScout24',
};

let state = { searches: [], listings: [], status: {}, favorites: [] };
let activeTab = 'all';

async function loadData() {
  const bust = `?t=${Date.now()}`;
  const [searches, listings, status, favorites] = await Promise.all([
    fetchJson(`data/searches.json${bust}`, []),
    fetchJson(`data/listings.json${bust}`, []),
    fetchJson(`data/status.json${bust}`, {}),
    fetchJson(`data/favorites.json${bust}`, []),
  ]);
  state = { searches, listings, status, favorites };
  renderStatusBar();
  renderSearchFilter();
  renderSearchList();
  renderListings();
}

async function fetchJson(url, fallback) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

function timeAgo(iso) {
  if (!iso) return 'hiç';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'az önce';
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.round(hours / 24);
  return `${days} gün önce`;
}

function renderStatusBar() {
  const el = document.getElementById('status-bar');
  el.innerHTML = '';
  for (const [site, s] of Object.entries(state.status)) {
    const pill = document.createElement('span');
    const hasError = !!s.lastError;
    const neverRan = !s.lastAttempt;
    pill.className = `status-pill ${neverRan ? '' : hasError ? 'error' : 'ok'}`;
    if (neverRan) {
      pill.textContent = `${SITE_LABELS[site] || site}: henüz taranmadı`;
    } else if (hasError) {
      pill.textContent = `${SITE_LABELS[site] || site}: ⚠ bu turda alınamadı (son başarı: ${timeAgo(s.lastSuccess)})`;
      pill.title = s.lastError;
    } else {
      pill.textContent = `${SITE_LABELS[site] || site}: ✓ ${timeAgo(s.lastSuccess)}`;
    }
    el.appendChild(pill);
  }
}

function renderSearchFilter() {
  const sel = document.getElementById('filter-search');
  const current = sel.value;
  sel.innerHTML = '<option value="">Tüm aramalar</option>';
  for (const s of state.searches) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.nickname} (${SITE_LABELS[s.site] || s.site})`;
    sel.appendChild(opt);
  }
  sel.value = current;
}

function renderSearchList() {
  const wrap = document.getElementById('search-list');
  wrap.innerHTML = '';
  if (state.searches.length === 0) {
    wrap.innerHTML = '<p class="empty-msg">Henüz arama eklenmedi.</p>';
    return;
  }
  for (const s of state.searches) {
    const row = document.createElement('div');
    row.className = 'search-row';
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(s.nickname)}</strong>
        <div class="meta">${SITE_LABELS[s.site] || s.site} · ekleyen: ${escapeHtml(s.owner || '?')} · ${s.active === false ? 'pasif' : 'aktif'}</div>
      </div>
      <div class="meta"><a href="${s.url}" target="_blank" rel="noopener">arama linki ↗</a></div>
    `;
    wrap.appendChild(row);
  }
}

function currentUser() {
  let user = localStorage.getItem('ev-arama-user');
  if (!user) {
    user = prompt('Adın? (favorileri ayırt etmek için)') || 'misafir';
    localStorage.setItem('ev-arama-user', user);
  }
  return user;
}

function isFavorite(listingId) {
  const user = localStorage.getItem('ev-arama-user');
  return state.favorites.some((f) => f.listingId === listingId && f.user === user);
}

function renderListings() {
  const searchFilter = document.getElementById('filter-search').value;
  const siteFilter = document.getElementById('filter-site').value;
  const showOriginal = document.getElementById('show-original').checked;
  const user = localStorage.getItem('ev-arama-user');

  let items = [...state.listings].sort((a, b) => new Date(b.firstSeenAt) - new Date(a.firstSeenAt));

  if (activeTab === 'favorites') {
    const favIds = new Set(state.favorites.filter((f) => f.user === user).map((f) => f.listingId));
    items = items.filter((i) => favIds.has(i.id));
  }
  if (searchFilter) items = items.filter((i) => i.searchId === searchFilter);
  if (siteFilter) items = items.filter((i) => i.site === siteFilter);

  const container = document.getElementById('listings');
  container.innerHTML = '';
  document.getElementById('empty-msg').hidden = items.length > 0;

  const tpl = document.getElementById('listing-card-tpl');
  for (const item of items) {
    const node = tpl.content.cloneNode(true);
    const img = node.querySelector('img');
    if (item.imageUrl) {
      img.src = item.imageUrl;
    } else {
      img.remove();
    }
    node.querySelector('.site-badge').textContent = SITE_LABELS[item.site] || item.site;
    node.querySelector('.card-title').textContent =
      (!showOriginal && item.titleTr) ? item.titleTr : item.title;
    node.querySelector('.card-facts').textContent = item.facts || '';
    node.querySelector('.card-location').textContent = item.location || '';
    node.querySelector('.card-price').textContent = item.price || '';
    node.querySelector('.card-link').href = item.url;

    const favBtn = node.querySelector('.fav-btn');
    const fav = isFavorite(item.id);
    favBtn.textContent = fav ? '★ Favori' : '☆ Favori';
    favBtn.classList.toggle('active', fav);
    favBtn.addEventListener('click', () => toggleFavorite(item.id, favBtn));

    container.appendChild(node);
  }
}

async function toggleFavorite(listingId, btn) {
  const user = currentUser();
  btn.disabled = true;
  try {
    const res = await fetch(`${WORKER_URL}/favorites/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId, user }),
    });
    if (!res.ok) throw new Error(await res.text());
    const { favorited } = await res.json();
    if (favorited) {
      state.favorites.push({ listingId, user, at: new Date().toISOString() });
    } else {
      state.favorites = state.favorites.filter((f) => !(f.listingId === listingId && f.user === user));
    }
    btn.textContent = favorited ? '★ Favori' : '☆ Favori';
    btn.classList.toggle('active', favorited);
  } catch (err) {
    alert('Favori kaydedilemedi: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      document.getElementById('view-all').hidden = activeTab === 'searches';
      document.getElementById('view-searches').hidden = activeTab !== 'searches';
      document.querySelector('.filters').hidden = activeTab === 'searches';
      if (activeTab !== 'searches') renderListings();
    });
  });
}

function setupFilters() {
  document.getElementById('filter-search').addEventListener('change', renderListings);
  document.getElementById('filter-site').addEventListener('change', renderListings);
  document.getElementById('show-original').addEventListener('change', renderListings);
}

function setupAddSearchForm() {
  const form = document.getElementById('add-search-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById('add-search-status');
    statusEl.textContent = 'Ekleniyor...';
    statusEl.style.color = 'var(--muted)';

    const payload = {
      nickname: document.getElementById('f-nickname').value.trim(),
      site: document.getElementById('f-site').value,
      url: document.getElementById('f-url').value.trim(),
      owner: document.getElementById('f-owner').value.trim(),
      ntfyTopic: document.getElementById('f-ntfy').value.trim() || null,
    };

    try {
      const res = await fetch(`${WORKER_URL}/searches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      statusEl.style.color = 'var(--ok)';
      statusEl.textContent = 'Eklendi. Bir sonraki taramada sonuçlar gelecek.';
      form.reset();
      await loadData();
    } catch (err) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = 'Hata: ' + err.message;
    }
  });
}

function setupTriggerScrape() {
  const btn = document.getElementById('trigger-scrape-btn');
  const statusEl = document.getElementById('trigger-scrape-status');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    statusEl.style.color = 'var(--muted)';
    statusEl.textContent = 'Tarama tetikleniyor...';
    try {
      const res = await fetch(`${WORKER_URL}/trigger-scrape`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      statusEl.style.color = 'var(--ok)';
      statusEl.textContent = 'Tetiklendi. Sonuçlar birkaç dakika içinde sitede görünür.';
    } catch (err) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = 'Hata: ' + err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

setupTabs();
setupFilters();
setupAddSearchForm();
setupTriggerScrape();
loadData();
