export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-alberto-secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const requiredSecret = process.env.ALBERTO_SECRET;
  if (requiredSecret) {
    const providedSecret = req.headers['x-alberto-secret'];
    if (providedSecret !== requiredSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: ANTHROPIC_API_KEY missing' });
  }

  try {
    const { model, max_tokens, system, messages } = req.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid messages array' });
    }

    const safeMaxTokens = Math.min(max_tokens || 600, 2000);
    const safeModel = model || 'claude-sonnet-4-5';

    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: safeModel,
        max_tokens: safeMaxTokens,
        system: system || '',
        messages: messages
      })
    });

    const data = await apiResp.json();

    if (!apiResp.ok) {
      console.error('Anthropic API error:', apiResp.status, data);
      return res.status(apiResp.status).json({
        error: (data && data.error && data.error.message) || 'Anthropic API error',
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
