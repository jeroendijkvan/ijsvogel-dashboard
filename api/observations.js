// Vercel serverless function — proxies observation.org API for IJsvogel (species 37)
// Simplified: single-page fetch only (no pagination) to stay within Vercel Hobby 10s limit
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

  // Fetch a single page of up to 100 recent observations — no pagination,
  // so we comfortably stay within Vercel Hobby's 10 s function limit.
  const url = `https://observation.org/api/v1/observations/?species=37&limit=100&country=NL&date_after=${dateAfter}&date_before=${dateBefore}&ordering=-date`;

  try {
    const resp = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'IJsvogel-Dashboard/1.0' },
    });
    if (!resp.ok) throw new Error(`API error ${resp.status}`);
    const json = await resp.json();
    const results = json.results || [];

    const slim = results.map((o) => ({
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
    return res.json({ ok: true, count: slim.length, total: json.count, dateAfter, dateBefore, observations: slim });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
