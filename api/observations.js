// Vercel serverless function — proxies observation.org API for IJsvogel (species 37)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const dateAfter  = req.query.date_after  || fmtDate(thirtyDaysAgo);
  const dateBefore = req.query.date_before || fmtDate(today);

  const BASE = 'https://observation.org/api/v1/observations/';
  const HEADERS = {
    Accept: 'application/json',
    'User-Agent': 'IJsvogel-Dashboard/1.0',
  };
  const PAGE_SIZE = 100;
  // Split the 30-day window into 5-day parallel chunks.
  // search=alcedo+atthis on a short date range resolves in ~8-10s;
  // running them in parallel keeps total response well under 30s.
  const CHUNK_DAYS = 5;

  const fetchPage = async (url) => {
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) throw new Error(`API error ${resp.status}`);
    return await resp.json();
  };

  try {
    // Build date chunks: [dateAfter, dateAfter+5), [dateAfter+5, dateAfter+10), ...
    const startMs = new Date(dateAfter).getTime();
    const endMs   = new Date(dateBefore).getTime();
    const chunkMs = CHUNK_DAYS * 24 * 60 * 60 * 1000;
    const chunks  = [];
    for (let ms = startMs; ms < endMs; ms += chunkMs) {
      chunks.push({
        after:  fmtDate(new Date(ms)),
        before: fmtDate(new Date(Math.min(ms + chunkMs, endMs))),
      });
    }

    // Fetch all chunks in parallel — each is a short date window so it responds fast
    const chunkResults = await Promise.all(
      chunks.map((c) =>
        fetchPage(
          `${BASE}?search=alcedo+atthis&limit=${PAGE_SIZE}&country=NL` +
          `&date_after=${c.after}&date_before=${c.before}`
        )
      )
    );

    // Aggregate results and sum totals across chunks
    let allResults = [];
    let total = 0;
    for (const page of chunkResults) {
      allResults = allResults.concat(page.results || []);
      total += page.count || 0;
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
