// Vercel serverless function — proxies observation.org API for IJsvogel (species 37)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const dateAfter  = req.query.date_after  || fmt(thirtyDaysAgo);
  const dateBefore = req.query.date_before || fmt(today);

  const BASE = 'https://observation.org/api/v1/observations/';
  const HEADERS = {
    Accept: 'application/json',
    'User-Agent': 'IJsvogel-Dashboard/1.0',
  };
  const PAGE_SIZE = 100;
  const MAX_PAGES = 3; // 300 observations max

  // No AbortController — rely on Vercel maxDuration (30s in vercel.json)
  const fetchPage = async (url) => {
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) throw new Error(`API error ${resp.status}`);
    return await resp.json();
  };

  try {
    // Use search=alcedo+atthis to correctly filter for IJsvogel (kingfisher).
    // Note: the species=37 URL param is silently ignored by the API; the correct
    // filter is a free-text search on scientific name via the `search` parameter.
    const firstUrl = `${BASE}?search=alcedo+atthis&limit=${PAGE_SIZE}&country=NL&date_after=${dateAfter}&date_before=${dateBefore}`;
    const firstPage = await fetchPage(firstUrl);
    let allResults = firstPage.results || [];

    // Calculate how many additional pages exist (up to MAX_PAGES total)
    const total = firstPage.count || 0;
    const totalPages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);

    // Fetch remaining pages in parallel
    if (totalPages > 1) {
      const pageUrls = [];
      for (let p = 2; p <= totalPages; p++) {
        const offset = (p - 1) * PAGE_SIZE;
        pageUrls.push(`${BASE}?search=alcedo+atthis&limit=${PAGE_SIZE}&country=NL&date_after=${dateAfter}&date_before=${dateBefore}&offset=${offset}`);
      }
      const pages = await Promise.all(pageUrls.map(fetchPage));
      for (const page of pages) {
        allResults = allResults.concat(page.results || []);
      }
    }

    const slim = allResults.map((o) => ({
      id:          o.id,
      date:        o.date,
      time:        o.time,
      number:      o.number ?? 1,
      lat:         o.point?.coordinates?.[1] ?? null,
      lng:         o.point?.coordinates?.[0] ?? null,
      location:    o.location_detail?.name ?? 'Unknown',
      location_id: o.location,
      notes:       o.notes ?? '',
      permalink:   o.permalink ?? '',
      observer:    o.user_detail?.name ?? 'Anonymous',
    }));

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.json({ ok: true, count: slim.length, total, dateAfter, dateBefore, observations: slim });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
