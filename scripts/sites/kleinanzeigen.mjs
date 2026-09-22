const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export const site = 'kleinanzeigen';

export async function scrape(browser, searchUrl) {
  const page = await browser.newPage({ userAgent: UA });
  const listings = [];
  try {
    await page.goto(searchUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#srchrslt-adtable', { timeout: 10000 }).catch(() => {});

    const cards = await page.$$('#srchrslt-adtable > li article[data-adid]');
    for (const card of cards) {
      const adId = await card.getAttribute('data-adid');
      const href = await card.getAttribute('data-href');
      if (!adId || !href) continue;

      const fields = await card.evaluate((el) => {
        const title = el.querySelector('h3 a')?.textContent?.trim() || null;

        const paragraphs = [...el.querySelectorAll('p')].map((p) => p.textContent.trim());
        const price = paragraphs.find((t) => /€\s*$/.test(t)) || null;
        // The compact facts line uses a middot separator, e.g. "63 m² · 2 Zi.";
        // plain description text can also mention "m²" so that alone isn't enough to identify it.
        const facts = paragraphs.find((t) => t.includes(' · ') && (/m²/.test(t) || /Zi\.?/.test(t))) || null;

        const locSvg = el.querySelector('svg[data-title="locationOutline"]');
        const location = locSvg?.closest('div')?.querySelector('span')?.textContent?.trim() || null;

        const imageUrl = el.querySelector('img')?.getAttribute('src') || null;

        return { title, price, facts, location, imageUrl };
      });

      const { title, price: priceText, facts: factsText, location, imageUrl } = fields;
      if (!title) continue;

      listings.push({
        externalId: adId,
        url: href.startsWith('http') ? href : `https://www.kleinanzeigen.de${href}`,
        title,
        price: priceText,
        facts: factsText,
        location,
        imageUrl,
      });
    }
  } finally {
    await page.close();
  }
  return listings;
}
