const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const DETAIL_SELECTORS = {
  kleinanzeigen: '#viewad-description-text',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/searches') {
        return await handleAddSearch(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/favorites/toggle') {
        return await handleToggleFavorite(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/searches/update') {
        return await handleUpdateSearch(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/searches/delete') {
        return await handleDeleteSearch(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/trigger-scrape') {
        return await handleTriggerScrape(env);
      }
      if (request.method === 'GET' && url.pathname === '/detail') {
        return await handleDetail(url, env);
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function githubGetFile(env, path) {
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`,
    { headers: githubHeaders(env) }
  );
  if (!res.ok) throw new Error(`GitHub okuma hatası (${path}): ${res.status}`);
  const data = await res.json();
  const content = JSON.parse(atob(data.content));
  return { content, sha: data.sha };
}

async function githubPutFile(env, path, content, sha, message) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: githubHeaders(env),
    body: JSON.stringify({
      message,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2) + '\n'))),
      sha,
      branch: env.GITHUB_BRANCH,
    }),
  });
  if (!res.ok) throw new Error(`GitHub yazma hatası (${path}): ${res.status} ${await res.text()}`);
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ev-arama-worker',
  };
}

async function handleAddSearch(request, env) {
  const body = await request.json();
  const { nickname, site, url: searchUrl, owner, ntfyTopic } = body;

  if (!nickname || !site || !searchUrl || !owner) {
    return json({ error: 'nickname, site, url ve owner zorunlu' }, 400);
  }
  if (!['kleinanzeigen', 'immowelt', 'immoscout'].includes(site)) {
    return json({ error: 'geçersiz site' }, 400);
  }

  const { content: searches, sha } = await githubGetFile(env, 'docs/data/searches.json');
  const newSearch = {
    id: `s${Date.now()}`,
    nickname,
    site,
    url: searchUrl,
    owner,
    ntfyTopic: ntfyTopic || null,
    active: true,
    createdAt: new Date().toISOString(),
  };
  searches.push(newSearch);
  await githubPutFile(env, 'docs/data/searches.json', searches, sha, `Yeni arama: ${nickname}`);

  return json({ ok: true, search: newSearch });
}

async function handleUpdateSearch(request, env) {
  const body = await request.json();
  const { id, nickname, site, url: searchUrl, ntfyTopic, active } = body;
  if (!id) return json({ error: 'id zorunlu' }, 400);

  const { content: searches, sha } = await githubGetFile(env, 'docs/data/searches.json');
  const search = searches.find((s) => s.id === id);
  if (!search) return json({ error: 'arama bulunamadı' }, 404);

  if (nickname !== undefined) search.nickname = nickname;
  if (site !== undefined) search.site = site;
  if (searchUrl !== undefined) search.url = searchUrl;
  if (ntfyTopic !== undefined) search.ntfyTopic = ntfyTopic || null;
  if (active !== undefined) search.active = active;

  await githubPutFile(env, 'docs/data/searches.json', searches, sha, `Arama güncellendi: ${search.nickname}`);
  return json({ ok: true, search });
}

async function handleDeleteSearch(request, env) {
  const body = await request.json();
  const { id } = body;
  if (!id) return json({ error: 'id zorunlu' }, 400);

  const { content: searches, sha } = await githubGetFile(env, 'docs/data/searches.json');
  const idx = searches.findIndex((s) => s.id === id);
  if (idx === -1) return json({ error: 'arama bulunamadı' }, 404);
  const [removed] = searches.splice(idx, 1);

  await githubPutFile(env, 'docs/data/searches.json', searches, sha, `Arama silindi: ${removed.nickname}`);
  return json({ ok: true });
}

async function handleToggleFavorite(request, env) {
  const body = await request.json();
  const { listingId, user } = body;
  if (!listingId || !user) return json({ error: 'listingId ve user zorunlu' }, 400);

  const { content: favorites, sha } = await githubGetFile(env, 'docs/data/favorites.json');
  const idx = favorites.findIndex((f) => f.listingId === listingId && f.user === user);

  let favorited;
  if (idx >= 0) {
    favorites.splice(idx, 1);
    favorited = false;
  } else {
    favorites.push({ listingId, user, at: new Date().toISOString() });
    favorited = true;
  }

  await githubPutFile(
    env,
    'docs/data/favorites.json',
    favorites,
    sha,
    `Favori güncelleme: ${user} - ${listingId}`
  );
  return json({ ok: true, favorited });
}

async function handleDetail(url, env) {
  const site = url.searchParams.get('site');
  const targetUrl = url.searchParams.get('url');
  if (!site || !targetUrl) return json({ error: 'site ve url zorunlu' }, 400);

  const selector = DETAIL_SELECTORS[site];
  if (!selector) {
    return json({ supported: false, reason: 'Bu site için otomatik açıklama desteklenmiyor.' });
  }

  const res = await fetch(targetUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    },
  });
  if (!res.ok) {
    return json({ supported: false, reason: `Kaynak sayfa alınamadı (${res.status}).` });
  }

  let description = '';
  const rewriter = new HTMLRewriter().on(selector, {
    text(chunk) {
      description += chunk.text;
      // Original line breaks (often <br> tags) don't appear in text chunks,
      // so without this, sentences run together with no spacing at all.
      if (chunk.lastInTextNode) description += '\n';
    },
  });
  await rewriter.transform(res).arrayBuffer();
  description = decodeEntities(description).trim().replace(/\n{3,}/g, '\n\n');

  if (!description) {
    return json({ supported: false, reason: 'Açıklama bulunamadı.' });
  }

  const descriptionTr = await translateToTurkish(description, env);
  return json({ supported: true, description, descriptionTr });
}

// HTMLRewriter's text chunks can leak numeric/named character references
// (e.g. a plain "/" comes back as "&#x2F;") instead of decoded text.
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

async function translateToTurkish(text, env) {
  if (!env.DEEPL_API_KEY) return null;
  try {
    const res = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${env.DEEPL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: [text], target_lang: 'TR', source_lang: 'DE' }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.translations?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

async function handleTriggerScrape(env) {
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/scrape.yml/dispatches`,
    {
      method: 'POST',
      headers: githubHeaders(env),
      body: JSON.stringify({ ref: env.GITHUB_BRANCH }),
    }
  );
  if (!res.ok) throw new Error(`Tarama tetiklenemedi: ${res.status} ${await res.text()}`);
  return json({ ok: true });
}
