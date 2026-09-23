const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export const site = 'immowelt';

export async function scrape(browser, searchUrl) {
  const page = await browser.newPage({ userAgent: UA });
  const listings = [];
  try {
    await page.goto(searchUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="serp-core-classified-card-testid"]', { timeout: 10000 }).catch(() => {});

    // Immowelt's bot wall (DataDome) returns a normal 200 page and renders its
    // block message inside an iframe, so checking the main document's visible
    // text never sees it — the DataDome script tag in the page source is the
    // only reliable signal that survives in the outer document.
    const html = await page.content();
    if (/captcha-delivery\.com/i.test(html)) {
      throw new Error('BOT_BLOCKED: Immowelt bot koruması gösterdi (DataDome)');
    }

    const cards = await page.$$('[data-testid="serp-core-classified-card-testid"]');
    for (const card of cards) {
      const id = await card.getAttribute('id');
      const externalId = id ? id.replace('classified-card-', '') : null;

      const link = await card.$('a[data-testid="card-mfe-covering-link-testid"]');
      if (!link || !externalId) continue;

      const href = await link.getAttribute('href');
      const summary = (await link.getAttribute('title')) || '';

      const priceMatch = summary.match(/([\d.,]+)\s?€/);
      const sizeMatch = summary.match(/([\d.,]+)\s?m²/);
      const roomsMatch = summary.match(/([\d.,]+)\s?Zi(?:mmer)?/);

      // The first <img> in a card is often the agency's logo, not the listing photo —
      // the real photo lives inside the picture-box gallery specifically.
      const imgEl = await card.$('[data-testid="card-mfe-picture-box-gallery-test-id"] img');
      const imageUrl = imgEl ? await imgEl.getAttribute('src') : null;

      listings.push({
        externalId,
        url: href,
        title: summary || 'Immowelt Anzeige',
        price: priceMatch ? `${priceMatch[1]} €` : null,
        facts: [sizeMatch ? `${sizeMatch[1]} m²` : null, roomsMatch ? `${roomsMatch[1]} Zi.` : null]
          .filter(Boolean)
          .join(' · '),
        location: null,
        imageUrl,
      });
    }
  } finally {
    await page.close();
  }
  return listings;
}
