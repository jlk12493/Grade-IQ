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

          const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
          });

          const rawText = await anthropicRes.text();

          console.log('Anthropic status:', anthropicRes.status);
          console.log('Anthropic response preview:', rawText.substring(0, 300));

          if (!rawText || rawText.trim() === '') {
            return new Response(JSON.stringify({ error: 'Empty response from Anthropic', status: anthropicRes.status }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
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

    return env.ASSETS.fetch(request);
  }
};
