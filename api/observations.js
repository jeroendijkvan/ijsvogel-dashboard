// Vercel serverless function â proxies observation.org API for IJsvogel (species 37)
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
  const CHUNK_DAYS = 5;
  // Max concurrent day-count requests â keeps us well under observation.org rate limits
  const DAY_BATCH = 3;

  const fetchPage = async (url) => {
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) throw new Error(`API error ${resp.status}`);
    return await resp.json();
  };

  try {
    const startMs = new Date(dateAfter).getTime();
    const endMs   = new Date(dateBefore).getTime();
    const dayMs   = 24 * 60 * 60 * 1000;
    const chunkMs = CHUNK_DAYS * dayMs;

    // -- 1. Observation sample chunks (6 parallel requests) --
    const chunks = [];
    for (let ms = startMs; ms < endMs; ms += chunkMs) {
      chunks.push({
        after:  fmtDate(new Date(ms)),
        before: fmtDate(new Date(Math.min(ms + chunkMs, endMs))),
      });
    }

    // -- 2. Per-day count queries --
    const dayQueries = [];
    for (let ms = startMs; ms < endMs; ms += dayMs) {
      const dayDate = fmtDate(new Date(ms));
      const nextDay = fmtDate(new Date(ms + dayMs));
      dayQueries.push({ date: dayDate, before: nextDay });
    }

    // Start chunk queries immediately (only 6 â fine to run in parallel)
    const chunkPromise = Promise.all(
      chunks.map((c) =>
        fetchPage(
          `${BASE}?search=alcedo+atthis&limit=${PAGE_SIZE}&country=NL` +
          `&date_after=${c.after}&date_before=${c.before}`
        )
      )
    );

    // Day-count queries run concurrently with chunks but internally in small
    // sequential batches (DAY_BATCH at a time) to avoid rate-limiting.
    // Each individual query is fault-tolerant: a failure returns count=0 so
    // a single bad response can never take down the whole dashboard.
    const dayCountPromise = (async () => {
      const results = [];
      for (let i = 0; i < dayQueries.length; i += DAY_BATCH) {
        const batch = dayQueries.slice(i, i + DAY_BATCH);
        const batchResults = await Promise.all(
          batch.map(async (d) => {
            try {
              const page = await fetchPage(
                `${BASE}?search=alcedo+atthis&limit=1&country=NL` +
                `&date_after=${d.date}&date_before=${d.before}`
              );
              return { date: d.date, count: page.count || 0 };
            } catch {
              return { date: d.date, count: 0 };
            }
          })
        );
        results.push(...batchResults);
      }
      return results;
    })();

    const [chunkResults, dayCountResults] = await Promise.all([chunkPromise, dayCountPromise]);

    // Aggregate observation sample
    let allResults = [];
    let total = 0;
    for (const page of chunkResults) {
      allResults = allResults.concat(page.results || []);
      total += page.count || 0;
    }

    // Build accurate daily counts map
    const dailyCounts = {};
    for (const { date, count } of dayCountResults) {
      dailyCounts[date] = count;
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
    return res.json({
      ok: true,
      count: slim.length,
      total,
      dailyCounts,
      dateAfter,
      dateBefore,
      observations: slim,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
