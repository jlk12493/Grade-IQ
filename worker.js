export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/discord-members') {
      try {
        const res = await fetch(`https://discordapp.com/api/guilds/1484224198036426884?with_counts=true`, {
          headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const data = await res.json();
        return cors(new Response(JSON.stringify({ count: data.approximate_member_count || data.member_count || 0 }), {
          headers: { 'Content-Type': 'application/json' }
        }));
      } catch (err) {
        return cors(new Response(JSON.stringify({ count: 0, error: err.message }), {
          headers: { 'Content-Type': 'application/json' }
        }));
      }
    }

    if (url.pathname === '/api/test-memory') {
      try {
        const writeRes = await fetch(`${env.SUPABASE_URL}/rest/v1/jarvis_memory`, {
          method: 'POST',
          headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ type: 'test', content: 'Memory test at ' + new Date().toISOString(), updated_at: new Date().toISOString() })
        });
        const writeText = await writeRes.text();
        const readRes = await fetch(`${env.SUPABASE_URL}/rest/v1/jarvis_memory?select=*&limit=5`, {
          headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` }
        });
        const readText = await readRes.text();
        return cors(new Response(JSON.stringify({ writeStatus: writeRes.status, writeResponse: writeText, readStatus: readRes.status, readResponse: readText }), { headers: { 'Content-Type': 'application/json' } }));
      } catch (err) {
        return cors(new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
      }
    }

    if (url.pathname === '/api/memories') {
      if (request.method === 'OPTIONS') return cors(new Response(null));
      if (request.method === 'GET') {
        try {
          const res = await fetch(`${env.SUPABASE_URL}/rest/v1/jarvis_memory?select=*&order=updated_at.desc&limit=50`, {
            headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` }
          });
          return cors(new Response(await res.text(), { headers: { 'Content-Type': 'application/json' } }));
        } catch (err) {
          return cors(new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
        }
      }
      if (request.method === 'DELETE') {
        try {
          await fetch(`${env.SUPABASE_URL}/rest/v1/jarvis_memory?id=not.is.null`, {
            method: 'DELETE',
            headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` }
          });
          return cors(new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }));
        } catch (err) {
          return cors(new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
        }
      }
    }

    if (url.pathname === '/api/jarvis') {
      if (request.method === 'OPTIONS') return cors(new Response(null));

      if (request.method === 'GET') {
        return cors(new Response(JSON.stringify({ status: 'ok', hasKey: !!env.ANTHROPIC_API_KEY, hasSupabase: !!env.SUPABASE_KEY }), { headers: { 'Content-Type': 'application/json' } }));
      }

      if (request.method === 'POST') {
        try {
          if (!env.ANTHROPIC_API_KEY) {
            return cors(new Response(JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
          }

          const body = await request.json();

          let memoryContext = '';
          try {
            const memRes = await fetch(`${env.SUPABASE_URL}/rest/v1/jarvis_memory?select=type,content&order=updated_at.desc&limit=20`, {
              headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` }
            });
            const mems = await memRes.json();
            if (Array.isArray(mems) && mems.length > 0) {
              memoryContext = '\n\nMEMORY FROM PAST SESSIONS:\n' + mems.map(m => '[' + m.type + '] ' + m.content).join('\n');
            }
          } catch (e) {}

          const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ ...body, system: (body.system || '') + memoryContext }),
          });

          const rawText = await anthropicRes.text();
          if (!rawText || rawText.trim() === '') {
            return cors(new Response(JSON.stringify({ error: 'Empty response' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
          }

          await saveMemories(body.messages, rawText, env);

          return cors(new Response(rawText, { status: anthropicRes.status, headers: { 'Content-Type': 'application/json' } }));

        } catch (err) {
          return cors(new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
        }
      }
    }

    // ── SCP SOLD LISTINGS SCRAPER ──────────────────────────────────────────
    if (url.pathname === '/api/ebay-sold') {
      if (request.method === 'OPTIONS') return cors(new Response(null));

      const scpId = url.searchParams.get('scp_id');
      const tab = url.searchParams.get('tab') || 'raw';
      if (!scpId) return cors(new Response(JSON.stringify({ error: 'Missing scp_id param' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));

      const cacheKey = 'scp_' + scpId + '_' + tab;
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

      // Check Supabase cache first
      try {
        const cacheRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/ebay_sold_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&cached_at=gte.${encodeURIComponent(sixHoursAgo)}&select=results`,
          { headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` } }
        );
        const cached = await cacheRes.json();
        if (Array.isArray(cached) && cached.length > 0) {
          return cors(new Response(JSON.stringify({ results: cached[0].results, cached: true }), { headers: { 'Content-Type': 'application/json' } }));
        }
      } catch (e) {}

      // Scrape SCP product page
      try {
        const scpUrl = `https://www.sportscardspro.com/game/${scpId}`;
        const scpRes = await fetch(scpUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          }
        });

        if (!scpRes.ok) {
          return cors(new Response(JSON.stringify({ error: 'SCP fetch failed', status: scpRes.status }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
        }

        const html = await scpRes.text();
        const results = parseScpListings(html, tab);

        // Parse page-level meta (sales volume + pop) — only on raw tab to avoid redundant work
        let salesVolume = null;
        let popData = null;
        const metaCacheKey = 'scp_' + scpId + '_meta';
        if (tab === 'raw') {
          salesVolume = parseScpVolume(html);
          popData = parseScpPop(html);
          // Cache meta separately
          try {
            await fetch(`${env.SUPABASE_URL}/rest/v1/ebay_sold_cache`, {
              method: 'POST',
              headers: {
                apikey: env.SUPABASE_KEY,
                Authorization: `Bearer ${env.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'resolution=merge-duplicates'
              },
              body: JSON.stringify({ cache_key: metaCacheKey, results: { salesVolume, popData }, cached_at: new Date().toISOString() })
            });
          } catch (e) {}
        } else {
          // Try to pull meta from cache for non-raw tabs
          try {
            const metaRes = await fetch(
              `${env.SUPABASE_URL}/rest/v1/ebay_sold_cache?cache_key=eq.${encodeURIComponent(metaCacheKey)}&cached_at=gte.${encodeURIComponent(sixHoursAgo)}&select=results`,
              { headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` } }
            );
            const metaCached = await metaRes.json();
            if (Array.isArray(metaCached) && metaCached.length > 0) {
              salesVolume = metaCached[0].results.salesVolume;
              popData = metaCached[0].results.popData;
            }
          } catch (e) {}
        }

        // Upsert listings cache
        try {
          await fetch(`${env.SUPABASE_URL}/rest/v1/ebay_sold_cache`, {
            method: 'POST',
            headers: {
              apikey: env.SUPABASE_KEY,
              Authorization: `Bearer ${env.SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates'
            },
            body: JSON.stringify({ cache_key: cacheKey, results: results, cached_at: new Date().toISOString() })
          });
        } catch (e) {}

        return cors(new Response(JSON.stringify({ results, salesVolume, popData, cached: false }), { headers: { 'Content-Type': 'application/json' } }));

      } catch (err) {
        return cors(new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
      }
    }

    return env.ASSETS.fetch(request);
  }
};

// ── PARSE SCP SOLD LISTINGS ────────────────────────────────────────────────
// SCP structure:
// - Rows: <tr id="ebay-ITEMID">
// - Date: <td class="date">2026-07-17</td>
// - Title: <a class="js-ebay-completed-sale" href="...">TITLE</a>
// - Price: first <span class="js-price">$28.00</span> in the row
// - Grade tabs: completed-auctions-used=Ungraded, completed-auctions-graded=Grade9, completed-auctions-manual-only=PSA10
//
// All tabs are server-rendered in the same page. We find the correct
// tab section by its div class, then grab the table inside it.
function parseScpListings(html, tab) {
  const results = [];

  // Map our tab to SCP's div class
  // SCP structure: <div class="completed-auctions-used"> ... <table> ... </table> ... </div>
  const tabClassMap = {
    raw: 'completed-auctions-used',
    psa9: 'completed-auctions-graded',
    psa10: 'completed-auctions-manual-only'
  };
  const tabClass = tabClassMap[tab] || tabClassMap['raw'];

  // Find the position of the div for this tab, then extract the table inside it
  const divMarker = '<div class="' + tabClass + '"';
  // Note: no closing > since SCP adds style="display:block" on the active tab
  const divIdx = html.indexOf(divMarker);
  if (divIdx === -1) return results;

  // From that position, find the first hoverable-rows table
  const afterDiv = html.slice(divIdx);
  const tableStart = afterDiv.indexOf('<table class="hoverable-rows sortable">');
  if (tableStart === -1) return results;

  // Find the matching </table>
  const tableEnd = afterDiv.indexOf('</table>', tableStart);
  if (tableEnd === -1) return results;

  const tableHtml = afterDiv.slice(tableStart, tableEnd + 8);

  // Match each ebay row by id pattern
  const rowPattern = /<tr id="ebay-\d+"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
    const row = rowMatch[0];

    // Date: <td class="date">2026-07-17</td>
    const dateMatch = row.match(/<td class="date">([^<]+)<\/td>/i);
    const dateSold = dateMatch ? dateMatch[1].trim() : '--';

    // Title + URL: <a class="js-ebay-completed-sale" href="...">TITLE</a>
    const titleMatch = row.match(/<a[^>]+class="js-ebay-completed-sale"[^>]+href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/i);
    const itemUrl = titleMatch ? titleMatch[1].replace(/&amp;/g, '&') : null;
    const title = titleMatch ? titleMatch[2].replace(/<[^>]+>/g, '').trim() : '--';

    // Price: first <span class="js-price">$28.00</span>
    const priceMatch = row.match(/<span class="js-price"[^>]*>\s*\$([0-9,]+\.?\d*)\s*<\/span>/i);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : null;

    if (price && price > 0) {
      results.push({ title, price, dateSold, listingType: 'Buy It Now', itemUrl });
    }

    if (results.length >= 25) break;
  }

  return results;
}


// ── PARSE SCP SALES VOLUME ────────────────────────────────────────────────
// Pulls volume strings from the sales_volume row in the price table
// e.g. "2 sales per day", "3 sales per week", "rare"
function parseScpVolume(html) {
  const volume = { raw: null, psa9: null, psa10: null };

  const tabMap = [
    { key: 'raw', tab: 'completed-auctions-used' },
    { key: 'psa9', tab: 'completed-auctions-graded' },
    { key: 'psa10', tab: 'completed-auctions-manual-only' }
  ];

  for (const { key, tab } of tabMap) {
    // Find <td class="js-show-tab" data-show-tab="completed-auctions-used">...<a>TEXT</a>
    const pattern = new RegExp(
      'data-show-tab="' + tab + '"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>',
      'i'
    );
    const match = html.match(pattern);
    if (match) {
      volume[key] = match[1].trim();
    }
  }

  return volume;
}

// ── PARSE SCP POP DATA ─────────────────────────────────────────────────────
// Pulls VGPC.pop_data from the embedded JS on the page
// Format: {"psa":[0,0,0,0,0,0,0,0,0,0],"cgc":[...]}
// Index = grade - 1, so index 8 = PSA 9, index 9 = PSA 10
function parseScpPop(html) {
  const match = html.match(/VGPC\.pop_data\s*=\s*(\{[^;]+\});/);
  if (!match) return null;

  try {
    const raw = JSON.parse(match[1]);
    // PSA array: index 8 = grade 9, index 9 = grade 10
    const psa = raw.psa || [];
    return {
      psa9: psa[8] || 0,
      psa10: psa[9] || 0,
      psaTotal: psa.reduce((a, b) => a + b, 0),
      raw: raw
    };
  } catch (e) {
    return null;
  }
}

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return r;
}

async function saveMemories(messages, responseText, env) {
  try {
    let assistantReply = '';
    try {
      const parsed = JSON.parse(responseText);
      assistantReply = parsed.content?.[0]?.text || '';
    } catch (e) { return; }

    if (!assistantReply || assistantReply.length < 10) return;

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;

    const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: 'You extract memories from conversations. Return ONLY a raw JSON array with no markdown, no backticks, no explanation. Each object must have "type" (one of: decision, task, context, insight) and "content" (max one sentence). Only include things worth remembering long-term. If nothing notable, return exactly: []',
        messages: [{ role: 'user', content: 'User said: "' + lastUserMsg.content.substring(0, 200) + '"\nJarvis replied: "' + assistantReply.substring(0, 200) + '"\nExtract memories.' }]
      })
    });

    const extractData = await extractRes.json();
    let extractText = extractData.content?.[0]?.text?.trim() || '[]';
    extractText = extractText.replace(/```json|```/g, '').trim();

    let memories = [];
    try { memories = JSON.parse(extractText); } catch (e) { return; }
    if (!Array.isArray(memories) || memories.length === 0) return;

    for (const mem of memories) {
      if (!mem.type || !mem.content) continue;
      await fetch(`${env.SUPABASE_URL}/rest/v1/jarvis_memory`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ type: mem.type, content: mem.content, updated_at: new Date().toISOString() })
      });
    }
  } catch (e) {}
}
