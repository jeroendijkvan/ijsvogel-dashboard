// Vercel serverless function — proxies observation.org API for IJsvogel (species 37)
export default async function handler(req, res) {
  // Allow CORS so the static frontend can call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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

  let allResults = [];
  let nextUrl = `${BASE}?species=37&limit=100&country=NL&date_after=${dateAfter}&date_before=${dateBefore}`;
  let pages = 0;
  const MAX_PAGES = 15; // cap at 1500 observations

  try {
    while (nextUrl && pages < MAX_PAGES) {
      const resp = await fetch(nextUrl, { headers: HEADERS });
      if (!resp.ok) throw new Error(`API error ${resp.status}`);
      const json = await resp.json();
      allResults = allResults.concat(json.results || []);
      nextUrl = json.next || null;
      pages++;
    }

    // Return a slimmed-down payload — only what the frontend needs
    const slim = allResults.map((o) => ({
      id:       o.id,
      date:     o.date,
      time:     o.time,
      number:   o.number ?? 1,
      lat:      o.point?.coordinates?.[1] ?? null,
      lng:      o.point?.coordinates?.[0] ?? null,
      location: o.location_detail?.name ?? 'Unknown',
      location_id: o.location,
      notes:    o.notes ?? '',
      permalink: o.permalink ?? '',
      observer: o.user_detail?.name ?? 'Anonymous',
    }));

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.json({ ok: true, count: slim.length, dateAfter, dateBefore, observations: slim });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
