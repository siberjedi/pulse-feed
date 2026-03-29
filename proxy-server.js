const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ai-survivor-proxy' });
});

app.all('/relay', async (req, res) => {
  const target = req.query.target;
  if (!target) {
    return res.status(400).json({ error: 'Missing target query parameter' });
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        'content-type': req.headers['content-type'] || 'application/json',
        authorization: req.headers.authorization || '',
        'x-api-key': req.headers['x-api-key'] || '',
        'anthropic-version': req.headers['anthropic-version'] || '',
        'anthropic-dangerous-direct-browser-access': req.headers['anthropic-dangerous-direct-browser-access'] || '',
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.setHeader('content-type', ct);
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: `Proxy request failed: ${String(err.message || err)}` });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy running at http://localhost:${PORT}`);
  console.log('Health check: GET /health');
  console.log('Relay: POST /relay?target=https%3A%2F%2Fapi.anthropic.com%2Fv1%2Fmessages');
});
