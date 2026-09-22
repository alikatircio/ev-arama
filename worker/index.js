const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
      if (request.method === 'POST' && url.pathname === '/trigger-scrape') {
        return await handleTriggerScrape(env);
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
