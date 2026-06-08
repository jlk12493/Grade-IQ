export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/jarvis') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          }
        });
      }

      if (request.method === 'GET') {
        return new Response(JSON.stringify({
          status: 'ok',
          hasKey: !!env.ANTHROPIC_API_KEY,
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (request.method === 'POST') {
        try {
          if (!env.ANTHROPIC_API_KEY) {
            return new Response(JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
          }

          const body = await request.json();

          // Fetch memories from Supabase
          let memories = [];
          if (env.SUPABASE_URL && env.SUPABASE_KEY) {
            try {
              const memRes = await fetch(
                `${env.SUPABASE_URL}/rest/v1/jarvis_memory?select=type,content,created_at&order=updated_at.desc&limit=20`,
                {
                  headers: {
                    apikey: env.SUPABASE_KEY,
                    Authorization: `Bearer ${env.SUPABASE_KEY}`,
                  }
                }
              );
              memories = await memRes.json();
            } catch (e) {
              console.log('Memory fetch error:', e.message);
            }
          }

          // Build memory context string
          const memoryContext = memories.length > 0
            ? '\n\nYOUR MEMORY FROM PAST SESSIONS:\n' + memories.map(m => `[${m.type}] ${m.content}`).join('\n')
            : '';

          // Inject memory into system prompt
          const systemWithMemory = (body.system || '') + memoryContext;

          // Call Anthropic
          const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              ...body,
              system: systemWithMemory,
            }),
          });

          const rawText = await anthropicRes.text();

          if (!rawText || rawText.trim() === '') {
            return new Response(JSON.stringify({ error: 'Empty response from Anthropic' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
          }

          // Extract and save memories in the background
          if (env.SUPABASE_URL && env.SUPABASE_KEY) {
            ctx.waitUntil(extractAndSaveMemories(body.messages, rawText, env));
          }

          return new Response(rawText, {
            status: anthropicRes.status,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          });

        } catch (err) {
          console.log('Worker error:', err.message);
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
      }
    }

    if (url.pathname === '/api/memories') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          }
        });
      }

      if (request.method === 'GET') {
        try {
          const memRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/jarvis_memory?select=*&order=updated_at.desc&limit=50`,
            {
              headers: {
                apikey: env.SUPABASE_KEY,
                Authorization: `Bearer ${env.SUPABASE_KEY}`,
              }
            }
          );
          const data = await memRes.text();
          return new Response(data, {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
      }
    }

    return env.ASSETS.fetch(request);
  }
};

async function extractAndSaveMemories(messages, responseText, env) {
  try {
    // Parse the assistant response
    let assistantReply = '';
    try {
      const parsed = JSON.parse(responseText);
      assistantReply = parsed.content?.[0]?.text || '';
    } catch (e) {
      return;
    }

    if (!assistantReply) return;

    // Get the last user message
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;

    // Ask Claude to extract memories
    const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: 'You extract memories from conversations. Return ONLY a JSON array. Each item has "type" (one of: decision, task, context, insight) and "content" (one sentence max). Only include things genuinely worth remembering long-term. If nothing is worth remembering, return an empty array []. No explanation, just the JSON array.',
        messages: [
          {
            role: 'user',
            content: `User said: "${lastUserMsg.content}"\n\nJarvis replied: "${assistantReply.substring(0, 500)}"\n\nExtract memories worth saving.`
          }
        ]
      })
    });

    const extractData = await extractRes.json();
    const extractText = extractData.content?.[0]?.text || '[]';

    let memories = [];
    try {
      const cleaned = extractText.replace(/```json|```/g, '').trim();
      memories = JSON.parse(cleaned);
    } catch (e) {
      return;
    }

    if (!Array.isArray(memories) || memories.length === 0) return;

    // Save each memory to Supabase
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
        body: JSON.stringify({
          type: mem.type,
          content: mem.content,
          updated_at: new Date().toISOString(),
        })
      });
    }
  } catch (e) {
    console.log('Memory extraction error:', e.message);
  }
}
