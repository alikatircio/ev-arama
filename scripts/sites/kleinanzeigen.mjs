const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export const site = 'kleinanzeigen';

const MAX_PAGES = 10; // safety cap (250 listings) so a runaway search can't loop forever

export async function scrape(browser, searchUrl) {
  const page = await browser.newPage({ userAgent: UA });
  const listings = [];
  try {
    let currentUrl = searchUrl;
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      await page.goto(currentUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
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

      const nextHref = await page.locator('a[aria-label="Nächste"]').first().getAttribute('href').catch(() => null);
      if (!nextHref) break;
      currentUrl = nextHref.startsWith('http') ? nextHref : `https://www.kleinanzeigen.de${nextHref}`;
    }
  } finally {
    await page.close();
  }
  return listings;
}

// Kleinanzeigen's search-card price is whatever single figure the poster chose to
// headline (often Warmmiete, sometimes Kaltmiete). The Kalt/Warm breakdown only
// exists on the ad's own detail page, as structured fields — plain HTTP fetch
// works fine here (unlike Immowelt/ImmoScout24), so this is cheap to do per ad.
export async function fetchPriceBreakdown(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return { priceCold: null, priceWarm: null };
    const html = await res.text();
    const cold = html.match(/Kaltmiete<span[^>]*>\s*([^<]+?)\s*<\/span>/);
    const warm = html.match(/Warmmiete<span[^>]*>\s*([^<]+?)\s*<\/span>/);
    return {
      priceCold: cold ? cold[1].trim() : null,
      priceWarm: warm ? warm[1].trim() : null,
    };
  } catch {
    return { priceCold: null, priceWarm: null };
  }
}
