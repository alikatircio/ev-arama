const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export const site = 'immoscout';

export async function scrape(browser, searchUrl) {
  const page = await browser.newPage({ userAgent: UA });
  const listings = [];
  try {
    await page.goto(searchUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const title = await page.title();
    if (/roboter|robot|captcha/i.test(title)) {
      throw new Error('BOT_BLOCKED: ImmoScout24 bot koruması gösterdi');
    }

    const cards = await page.$$('article[data-testid="result-list-entry"], article.result-list-entry');
    for (const card of cards) {
      const link = await card.$('a[href*="/expose/"]');
      if (!link) continue;
      const href = await link.getAttribute('href');
      const externalIdMatch = href ? href.match(/expose\/(\d+)/) : null;
      if (!externalIdMatch) continue;

      const titleText = (await link.innerText()).trim();
      const priceEl = await card.$('[data-testid*="price"], .result-list-entry__primary-criterion');
      const price = priceEl ? (await priceEl.innerText()).trim() : null;

      listings.push({
        externalId: externalIdMatch[1],
        url: href.startsWith('http') ? href : `https://www.immobilienscout24.de${href}`,
        title: titleText || 'ImmoScout24 Anzeige',
        price,
        facts: null,
        location: null,
        imageUrl: null,
      });
    }
  } finally {
    await page.close();
  }
  return listings;
}
