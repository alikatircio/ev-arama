import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import * as kleinanzeigen from './sites/kleinanzeigen.mjs';
import * as immowelt from './sites/immowelt.mjs';
import * as immoscout from './sites/immoscout.mjs';
import { notify } from './notify.mjs';
import { translateToTurkish } from './translate.mjs';

const DATA_DIR = path.join(import.meta.dirname, '..', 'docs', 'data');
const SITE_MODULES = { kleinanzeigen, immowelt, immoscout };

function readJson(file, fallback) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function writeJson(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2) + '\n');
}

async function main() {
  const searches = readJson('searches.json', []);
  const listings = readJson('listings.json', []);
  const status = readJson('status.json', {});

  const listingKey = (site, externalId) => `${site}:${externalId}`;
  const existingKeys = new Set(listings.map((l) => listingKey(l.site, l.externalId)));

  const browser = await chromium.launch();
  const newBySearch = new Map();

  const activeSearches = searches.filter((s) => s.active !== false);
  const bySite = new Map();
  for (const s of activeSearches) {
    if (!bySite.has(s.site)) bySite.set(s.site, []);
    bySite.get(s.site).push(s);
  }

  for (const [siteName, siteSearches] of bySite) {
    const mod = SITE_MODULES[siteName];
    const now = new Date().toISOString();
    status[siteName] = status[siteName] || {};

    if (!mod) {
      status[siteName].lastAttempt = now;
      status[siteName].lastError = `Bilinmeyen site: ${siteName}`;
      continue;
    }

    for (const search of siteSearches) {
      status[siteName].lastAttempt = now;
      try {
        const results = await mod.scrape(browser, search.url);
        status[siteName].lastSuccess = now;
        status[siteName].lastError = null;

        for (const r of results) {
          const key = listingKey(siteName, r.externalId);
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);

          const titleTr = await translateToTurkish(r.title);

          // Only Kleinanzeigen's detail page tolerates a plain fetch (Immowelt/
          // ImmoScout24 block it), so the Kalt-/Warmmiete breakdown is only
          // available for this site.
          let priceCold = null;
          let priceWarm = null;
          if (siteName === 'kleinanzeigen') {
            const breakdown = await kleinanzeigen.fetchPriceBreakdown(r.url);
            priceCold = breakdown.priceCold;
            priceWarm = breakdown.priceWarm;
          }

          const listing = {
            id: key,
            site: siteName,
            searchId: search.id,
            externalId: r.externalId,
            url: r.url,
            title: r.title,
            titleTr,
            price: r.price,
            priceCold,
            priceWarm,
            facts: r.facts,
            location: r.location,
            imageUrl: r.imageUrl,
            firstSeenAt: now,
          };
          listings.push(listing);

          if (!newBySearch.has(search.id)) newBySearch.set(search.id, []);
          newBySearch.get(search.id).push(listing);
        }
      } catch (err) {
        status[siteName].lastError = err.message;
        console.error(`[${siteName}] "${search.nickname}" taranamadı:`, err.message);
      }
    }
  }

  await browser.close();

  // Daha önce çevirisi başarısız/eksik kalmış ilanları da tamamla
  // (örn. DeepL o an erişilemezdi ya da anahtar sonradan eklendi).
  for (const listing of listings) {
    if (!listing.titleTr) {
      const titleTr = await translateToTurkish(listing.title);
      if (titleTr) listing.titleTr = titleTr;
    }
  }

  // Kalt-/Warmmiete alanları bu özellik eklenmeden önce taranmış ilanlarda
  // eksik olacağı için, sadece Kleinanzeigen'de ve sadece bir kere doldurulur.
  for (const listing of listings) {
    if (listing.site === 'kleinanzeigen' && listing.priceCold === undefined && listing.priceWarm === undefined) {
      const breakdown = await kleinanzeigen.fetchPriceBreakdown(listing.url);
      listing.priceCold = breakdown.priceCold;
      listing.priceWarm = breakdown.priceWarm;
    }
  }

  // Yeni bulunanlar için, arama sahibine tek bir özet bildirim gönder.
  for (const [searchId, items] of newBySearch) {
    const search = searches.find((s) => s.id === searchId);
    if (!search?.ntfyTopic) continue;
    const preview = items
      .slice(0, 3)
      .map((i) => `• ${i.titleTr || i.title} — ${i.price ?? ''}`)
      .join('\n');
    await notify(search.ntfyTopic, {
      title: `${search.nickname}: ${items.length} yeni ilan`,
      message: preview,
      url: items[0].url,
    });
  }

  // Sürekli başarısız kalan siteler için ayrı bir uyarı (spam olmasın diye sessizce statüde tutulur,
  // site arayüzü zaten "son başarılı" zamanını gösterecek).
  writeJson('listings.json', listings);
  writeJson('status.json', status);

  console.log('Tarama tamamlandı.', {
    toplamIlan: listings.length,
    yeniIlan: [...newBySearch.values()].reduce((a, b) => a + b.length, 0),
  });
}

main().catch((err) => {
  console.error('Scraper genel hata:', err);
  process.exit(1);
});
