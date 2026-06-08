export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/jarvis') {
      if (request.method === 'OPTIONS') {
        return cors(new Response(null));
      }

      if (request.method === 'GET') {
        return cors(new Response(JSON.stringify({
          status: 'ok',
          hasKey: !!env.ANTHROPIC_API_KEY,
          hasSupabase: !!env.SUPABASE_KEY,
        }), { headers: { 'Content-Type': 'application/json' } }));
      }

      if (request.method === 'POST') {
        try {
          if (!env.ANTHROPIC_API_KEY) {
            return cors(new Response(JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
          }

          const body = await request.json();

          // Fetch memories
          let memoryContext = '';
          if (env.SUPABASE_KEY && env.SUPABASE_URL) {
            try {
              const memRes = await fetch(
                `${env.SUPABASE_URL}/rest/v1/jarvis_memory?select=type,content,created_at&order=updated_at.desc&limit=20`,
                { headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` } }
              );
              const mems = await memRes.json();
              if (Array.isArray(mems) && mems.length > 0) {
                memoryContext = '\n\nMEMORY FROM PAST SESSIONS:\n' + mems.map(m => `[${m.type}] ${m.content}`).join('\n');
              }
            } catch (e) {
              console.log('Memory read error:', e.message);
            }
          }

          const systemWithMemory = (body.system || '') + memoryContext;

          const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({ ...body, system: systemWithMemory }),
          });

          const rawText = await anthropicRes.text();

          if (!rawText || rawText.trim() === '') {
            return cors(new Response(JSON.stringify({ error: 'Empty response from Anthropic' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
          }

          // Save memories in background
          if (env.SUPABASE_KEY && env.SUPABASE_URL) {
            ctx.waitUntil(saveMemories(body.messages, rawText, env));
          }

          return cors(new Response(rawText, { status: anthropicRes.status, headers: { 'Content-Type': 'application/json' } }));

        } catch (err) {
          return cors(new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
        }
      }
    }

    if (url.pathname === '/api/memories') {
      if (request.method === 'OPTIONS') return cors(new Response(null));

      if (request.method === 'GET') {
        try {
          const res = await fetch(
            `${env.SUPABASE_URL}/rest/v1/jarvis_memory?select=*&order=updated_at.desc&limit=50`,
            { headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` } }
          );
          const data = await res.text();
          return cors(new Response(data, { headers: { 'Content-Type': 'application/json' } }));
        } catch (err) {
          return cors(new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
        }
      }

      if (request.method === 'DELETE') {
        try {
          await fetch(
            `${env.SUPABASE_URL}/rest/v1/jarvis_memory?id=not.is.null`,
            { method: 'DELETE', headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` } }
          );
          return cors(new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }));
        } catch (err) {
          return cors(new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
        }
      }
    }

    return env.ASSETS.fetch(request);
  }
};

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

    if (!assistantReply || assistantReply.length < 20) return;

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;

    const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: 'Extract memories from this conversation exchange. Return ONLY a valid JSON array. Each object has "type" (decision, task, context, or insight) and "content" (one sentence). Only include things genuinely worth remembering across sessions. If nothing notable, return []. No markdown, no explanation, just the JSON array.',
        messages: [{
          role: 'user',
          content: 'User: "' + lastUserMsg.content.substring(0, 300) + '"\n\nJarvis: "' + assistantReply.substring(0, 300) + '"'
        }]
      })
    });

    const extractData = await extractRes.json();
    const extractText = extractData.content?.[0]?.text?.trim() || '[]';

    let memories = [];
    try {
      memories = JSON.parse(extractText);
    } catch (e) { return; }

    if (!Array.isArray(memories) || memories.length === 0) return;

    for (const mem of memories) {
      if (!mem.type || !mem.content) continue;
      await fetch(`${env.SUPABASE_URL}/rest/v1/jarvis_memory`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ type: mem.type, content: mem.content, updated_at: new Date().toISOString() })
      });
    }
  } catch (e) {
    console.log('saveMemories error:', e.message);
  }
}
