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

        // Upsert cache
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

// ── PARSE SCP SOLD LISTINGS ────────────────────────────────────────────────
// SCP renders sold listings in a table with class "pricehistory" or similar.
// Each tab (Ungraded, Grade 9, PSA 10, etc) has its own table section.
function parseScpListings(html, tab) {
  const results = [];

  // Map our tab names to SCP grade labels in the HTML
  const gradeMap = {
    raw: ['Ungraded', 'ungraded', 'Raw'],
    psa10: ['PSA 10', 'Grade 10', 'PSA10', 'Gem Mint 10'],
    psa9: ['PSA 9', 'Grade 9', 'PSA9', 'Mint 9']
  };
  const targetGrades = gradeMap[tab] || gradeMap['raw'];

  // Find the correct sold listings table section for this grade
  // SCP uses tab panels — find the one matching our grade
  let sectionHtml = '';
  for (const grade of targetGrades) {
    // Look for a section/div/table that contains this grade label
    const sectionPattern = new RegExp(
      '(' + escapeRegex(grade) + '[\\s\\S]{0,200}?<table[\\s\\S]*?</table>)',
      'i'
    );
    const sectionMatch = html.match(sectionPattern);
    if (sectionMatch) {
      sectionHtml = sectionMatch[1];
      break;
    }
  }

  // If no grade-specific section, try to find any sold listings table
  if (!sectionHtml) {
    const tableMatch = html.match(/<table[^>]*class="[^"]*sold[^"]*"[^>]*>([\s\S]*?)<\/table>/i)
      || html.match(/<table[^>]*id="[^"]*sold[^"]*"[^>]*>([\s\S]*?)<\/table>/i)
      || html.match(/Sold Listings([\s\S]{0,100}?<table[\s\S]*?<\/table>)/i);
    if (tableMatch) sectionHtml = tableMatch[0];
  }

  if (!sectionHtml) return results;

  // Parse table rows: <tr> with date, title, price cells
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(sectionHtml)) !== null) {
    const row = rowMatch[1];
    const cells = [];
    const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(row)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length < 2) continue;

    // Try to extract date, title, price from cells
    // SCP format is typically: Date | Title | Price
    let dateSold = null, title = null, price = null, itemUrl = null;

    // Find price cell (contains $)
    for (const cell of cells) {
      const priceMatch = cell.match(/\$([0-9,]+\.?\d*)/);
      if (priceMatch) { price = parseFloat(priceMatch[1].replace(',', '')); break; }
    }

    // Find date cell (contains date pattern)
    for (const cell of cells) {
      if (/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i.test(cell)) {
        dateSold = cell; break;
      }
    }

    // Title — longest non-date, non-price cell
    for (const cell of cells) {
      if (cell === dateSold) continue;
      if (/^\$/.test(cell)) continue;
      if (cell.length > (title ? title.length : 0)) title = cell;
    }

    // Get item URL from the row
    const urlMatch = rowMatch[0].match(/href="(https?:\/\/[^"]+ebay[^"]+)"/i);
    if (urlMatch) itemUrl = urlMatch[1];

    if (price && price > 0) {
      results.push({ title: title || '--', price, dateSold: dateSold || '--', listingType: 'Buy It Now', itemUrl });
    }
    if (results.length >= 25) break;
  }

  return results;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
