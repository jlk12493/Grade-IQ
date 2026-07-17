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

          // Read memories
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

          // Call Anthropic
          const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ ...body, system: (body.system || '') + memoryContext }),
          });

          const rawText = await anthropicRes.text();
          if (!rawText || rawText.trim() === '') {
            return cors(new Response(JSON.stringify({ error: 'Empty response' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
          }

          // Save memories synchronously before returning
          await saveMemories(body.messages, rawText, env);

          return cors(new Response(rawText, { status: anthropicRes.status, headers: { 'Content-Type': 'application/json' } }));

        } catch (err) {
          return cors(new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
        }
      }
    }

    // ── EBAY SOLD LISTINGS SCRAPER ─────────────────────────────────────────
    if (url.pathname === '/api/ebay-sold') {
      if (request.method === 'OPTIONS') return cors(new Response(null));

      const q = url.searchParams.get('q');
      if (!q) return cors(new Response(JSON.stringify({ error: 'Missing q param' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));

      const cacheKey = 'ebay_' + q.toLowerCase().replace(/\s+/g, '_').substring(0, 100);
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

      // Check cache first
      try {
        const cacheRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/ebay_sold_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&cached_at=gte.${sixHoursAgo}&select=results`,
          { headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` } }
        );
        const cached = await cacheRes.json();
        if (Array.isArray(cached) && cached.length > 0) {
          return cors(new Response(JSON.stringify({ results: cached[0].results, cached: true }), { headers: { 'Content-Type': 'application/json' } }));
        }
      } catch (e) {}

      // Scrape eBay completed listings
      try {
        const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=25`;
        const ebayRes = await fetch(ebayUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          }
        });

        if (!ebayRes.ok) {
          return cors(new Response(JSON.stringify({ error: 'eBay fetch failed', status: ebayRes.status }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
        }

        const html = await ebayRes.text();
        const results = parseEbayListings(html);

        // Save to cache (upsert)
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

        return cors(new Response(JSON.stringify({ results, cached: false }), { headers: { 'Content-Type': 'application/json' } }));

      } catch (err) {
        return cors(new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
      }
    }

    return env.ASSETS.fetch(request);
  }
};

// ── PARSE EBAY HTML ────────────────────────────────────────────────────────
function parseEbayListings(html) {
  const results = [];

  // Match each listing item block
  const itemPattern = /<li[^>]+s-item[^>]*>([\s\S]*?)<\/li>/g;
  let itemMatch;

  while ((itemMatch = itemPattern.exec(html)) !== null) {
    const block = itemMatch[1];

    // Skip promoted/ad items
    if (/s-item__info-sponsored|Sponsored/i.test(block) && results.length > 0) continue;

    // Title
    const titleMatch = block.match(/class="s-item__title[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/);
    let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : null;
    if (!title || title === 'Shop on eBay') continue;

    // Price
    const priceMatch = block.match(/class="s-item__price"[^>]*>[\s\S]*?\$([0-9,]+\.?\d*)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : null;
    if (!price) continue;

    // Date sold
    const dateMatch = block.match(/class="s-item__ended-date[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/);
    let dateSold = null;
    if (dateMatch) {
      dateSold = dateMatch[1].replace(/<[^>]+>/g, '').replace(/Sold\s*/i, '').trim();
    }

    // Listing type (Buy It Now / Auction)
    const typeMatch = block.match(/class="s-item__purchase-options-with-icon[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/);
    const listingType = typeMatch ? typeMatch[1].replace(/<[^>]+>/g, '').trim() : 'Buy It Now';

    // Item URL
    const urlMatch = block.match(/href="(https:\/\/www\.ebay\.com\/itm\/[^"?]+)/);
    const itemUrl = urlMatch ? urlMatch[1] : null;

    results.push({ title, price, dateSold, listingType, itemUrl });
    if (results.length >= 20) break;
  }

  return results;
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
