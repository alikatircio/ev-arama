const WORKER_URL = (window.EV_ARAMA_CONFIG && window.EV_ARAMA_CONFIG.WORKER_URL) || '';

const SITE_LABELS = {
  kleinanzeigen: 'Kleinanzeigen',
  immowelt: 'Immowelt',
  immoscout: 'ImmoScout24',
};

let state = { searches: [], listings: [], status: {}, favorites: [], dismissed: [] };
let activeTab = 'all';
let editingSearchId = null;
const detailCache = new Map();

function parsePrice(priceStr) {
  if (!priceStr) return null;
  const digits = priceStr.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

// Kalt-/Warmmiete only exists as a separate field for Kleinanzeigen ads that
// filled it in — everything else falls back to the single price the card showed.
function effectivePriceStr(item, priceType) {
  if (priceType === 'cold') return item.priceCold || item.price;
  return item.priceWarm || item.price;
}

async function loadData() {
  const bust = `?t=${Date.now()}`;
  const [searches, listings, status, favorites, dismissed] = await Promise.all([
    fetchJson(`data/searches.json${bust}`, []),
    fetchJson(`data/listings.json${bust}`, []),
    fetchJson(`data/status.json${bust}`, {}),
    fetchJson(`data/favorites.json${bust}`, []),
    fetchJson(`data/dismissed.json${bust}`, []),
  ]);
  state = { searches, listings, status, favorites, dismissed };
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
        <div class="meta"><a href="${s.url}" target="_blank" rel="noopener">arama linki ↗</a></div>
      </div>
      <div class="row-actions">
        <button type="button" class="edit-search-btn">Düzenle</button>
        <button type="button" class="danger delete-search-btn">Sil</button>
      </div>
    `;
    row.querySelector('.edit-search-btn').addEventListener('click', () => startEditSearch(s));
    row.querySelector('.delete-search-btn').addEventListener('click', () => deleteSearch(s));
    wrap.appendChild(row);
  }
}

function startEditSearch(s) {
  editingSearchId = s.id;
  document.getElementById('f-nickname').value = s.nickname;
  document.getElementById('f-site').value = s.site;
  document.getElementById('f-url').value = s.url;
  document.getElementById('f-owner').value = s.owner || '';
  document.getElementById('f-ntfy').value = s.ntfyTopic || '';
  const form = document.getElementById('add-search-form');
  form.querySelector('h2').textContent = 'Aramayı düzenle';
  form.querySelector('button[type="submit"]').textContent = 'Güncelle';
  if (!form.querySelector('.cancel-edit-btn')) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Vazgeç';
    cancelBtn.className = 'cancel-edit-btn';
    cancelBtn.addEventListener('click', cancelEditSearch);
    form.querySelector('button[type="submit"]').after(cancelBtn);
  }
  form.scrollIntoView({ behavior: 'smooth' });
}

function cancelEditSearch() {
  editingSearchId = null;
  const form = document.getElementById('add-search-form');
  form.reset();
  form.querySelector('h2').textContent = 'Yeni arama ekle';
  form.querySelector('button[type="submit"]').textContent = 'Ekle';
  form.querySelector('.cancel-edit-btn')?.remove();
}

async function deleteSearch(s) {
  if (!confirm(`"${s.nickname}" aramasını silmek istediğine emin misin?`)) return;
  try {
    const res = await fetch(`${WORKER_URL}/searches/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id }),
    });
    if (!res.ok) throw new Error(await res.text());
    await loadData();
  } catch (err) {
    alert('Silinemedi: ' + err.message);
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

  let items = [...state.listings];
  const dismissedIds = new Set(state.dismissed.map((d) => d.listingId));

  if (activeTab === 'dismissed') {
    items = items.filter((i) => dismissedIds.has(i.id));
  } else {
    items = items.filter((i) => !dismissedIds.has(i.id));
  }
  if (activeTab === 'favorites') {
    const favIds = new Set(state.favorites.filter((f) => f.user === user).map((f) => f.listingId));
    items = items.filter((i) => favIds.has(i.id));
  }
  if (searchFilter) items = items.filter((i) => i.searchId === searchFilter);
  if (siteFilter) items = items.filter((i) => i.site === siteFilter);

  const priceType = document.getElementById('price-type').value;
  const priceMin = parseInt(document.getElementById('filter-price-min').value, 10);
  const priceMax = parseInt(document.getElementById('filter-price-max').value, 10);
  if (!isNaN(priceMin)) items = items.filter((i) => { const p = parsePrice(effectivePriceStr(i, priceType)); return p !== null && p >= priceMin; });
  if (!isNaN(priceMax)) items = items.filter((i) => { const p = parsePrice(effectivePriceStr(i, priceType)); return p !== null && p <= priceMax; });

  const sortOrder = document.getElementById('sort-order').value;
  const byDate = (a, b) => new Date(a.firstSeenAt) - new Date(b.firstSeenAt);
  // Listings without a parseable price sort last, regardless of direction.
  const byPrice = (a, b) => {
    const pa = parsePrice(effectivePriceStr(a, priceType));
    const pb = parsePrice(effectivePriceStr(b, priceType));
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  };
  const byPriceDesc = (a, b) => {
    const pa = parsePrice(effectivePriceStr(a, priceType));
    const pb = parsePrice(effectivePriceStr(b, priceType));
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pb - pa;
  };
  if (sortOrder === 'oldest') items.sort(byDate);
  else if (sortOrder === 'price-asc') items.sort(byPrice);
  else if (sortOrder === 'price-desc') items.sort(byPriceDesc);
  else items.sort((a, b) => byDate(b, a));

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

    const dismissBtn = node.querySelector('.dismiss-btn');
    const isDismissed = dismissedIds.has(item.id);
    dismissBtn.textContent = isDismissed ? '↩︎ Geri getir' : '🚫 Gizle';
    dismissBtn.classList.toggle('restore', isDismissed);
    dismissBtn.addEventListener('click', () => toggleDismiss(item.id));

    node.querySelectorAll('.card-open').forEach((el) => {
      el.addEventListener('click', () => openDetailModal(item));
    });

    container.appendChild(node);
  }
}

async function toggleDismiss(listingId) {
  const user = currentUser();
  try {
    const res = await fetch(`${WORKER_URL}/listings/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId, user }),
    });
    if (!res.ok) throw new Error(await res.text());
    const { dismissed } = await res.json();
    if (dismissed) {
      state.dismissed.push({ listingId, by: user, at: new Date().toISOString() });
    } else {
      state.dismissed = state.dismissed.filter((d) => d.listingId !== listingId);
    }
    renderListings();
  } catch (err) {
    alert('Gizlenemedi: ' + err.message);
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

async function openDetailModal(item) {
  const modal = document.getElementById('detail-modal');
  const showOriginal = document.getElementById('show-original').checked;

  document.getElementById('modal-site-badge').textContent = SITE_LABELS[item.site] || item.site;
  document.getElementById('modal-title').textContent = (!showOriginal && item.titleTr) ? item.titleTr : item.title;
  document.getElementById('modal-facts').textContent = item.facts || '';
  document.getElementById('modal-location').textContent = item.location || '';
  document.getElementById('modal-price').textContent = item.price || '';
  document.getElementById('modal-link').href = item.url;

  const breakdownEl = document.getElementById('modal-price-breakdown');
  const breakdownParts = [];
  if (item.priceCold) breakdownParts.push(`Soğuk kira: ${item.priceCold}`);
  if (item.priceWarm) breakdownParts.push(`Sıcak kira: ${item.priceWarm}`);
  breakdownEl.textContent = breakdownParts.join(' · ');
  breakdownEl.hidden = breakdownParts.length === 0;

  const loadingEl = document.getElementById('modal-description-loading');
  const descEl = document.getElementById('modal-description');
  const toggleEl = document.getElementById('modal-lang-toggle');
  const toggleInput = document.getElementById('modal-show-original');
  descEl.hidden = true;
  toggleEl.hidden = true;
  loadingEl.hidden = false;
  loadingEl.textContent = 'Açıklama yükleniyor...';
  modal.hidden = false;

  let detail = detailCache.get(item.id);
  if (!detail) {
    try {
      const res = await fetch(`${WORKER_URL}/detail?site=${encodeURIComponent(item.site)}&url=${encodeURIComponent(item.url)}`);
      detail = await res.json();
      // Only cache real successes — a 403/transient failure shouldn't get stuck
      // showing an error forever if the user reopens the same listing later.
      if (detail.supported) detailCache.set(item.id, detail);
    } catch (err) {
      detail = { supported: false, reason: 'Bağlantı hatası: ' + err.message };
    }
  }

  loadingEl.hidden = true;
  if (!detail.supported) {
    loadingEl.hidden = false;
    loadingEl.textContent = detail.reason || 'Açıklama alınamadı. Orijinal ilana gidebilirsin.';
    return;
  }

  const renderDesc = () => {
    const useOriginal = toggleInput.checked;
    descEl.textContent = (!useOriginal && detail.descriptionTr) ? detail.descriptionTr : detail.description;
  };
  toggleInput.checked = false;
  toggleInput.onchange = renderDesc;
  toggleEl.hidden = !detail.descriptionTr;
  descEl.hidden = false;
  renderDesc();
}

function setupModal() {
  const modal = document.getElementById('detail-modal');
  document.getElementById('modal-close').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.hidden = true; });
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
  document.getElementById('price-type').addEventListener('change', renderListings);
  document.getElementById('filter-price-min').addEventListener('input', renderListings);
  document.getElementById('filter-price-max').addEventListener('input', renderListings);
  document.getElementById('sort-order').addEventListener('change', renderListings);
}

function setupAddSearchForm() {
  const form = document.getElementById('add-search-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById('add-search-status');
    const isEdit = !!editingSearchId;
    statusEl.textContent = isEdit ? 'Güncelleniyor...' : 'Ekleniyor...';
    statusEl.style.color = 'var(--muted)';

    const payload = {
      nickname: document.getElementById('f-nickname').value.trim(),
      site: document.getElementById('f-site').value,
      url: document.getElementById('f-url').value.trim(),
      owner: document.getElementById('f-owner').value.trim(),
      ntfyTopic: document.getElementById('f-ntfy').value.trim() || null,
    };
    if (isEdit) payload.id = editingSearchId;

    try {
      const res = await fetch(`${WORKER_URL}${isEdit ? '/searches/update' : '/searches'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      statusEl.style.color = 'var(--ok)';
      statusEl.textContent = isEdit ? 'Güncellendi.' : 'Eklendi. Bir sonraki taramada sonuçlar gelecek.';
      if (isEdit) cancelEditSearch(); else form.reset();
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
setupModal();
loadData();
