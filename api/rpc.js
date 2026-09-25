// Read-only Solana JSON-RPC proxy for the site's My Rockies tab, so the RPC key
// stays on the server. Set RPC_URL (a mainnet RPC URL with its key, e.g. Helius)
// in the Vercel project's environment variables. Errors never echo the URL.
const PROGRAM = '342z5Sawvar7fcAiyt9J82ysEYs5rGaJp5wuH27Q9AAS';
const ALLOWED = new Set([
  'getAccountInfo',
  'getMultipleAccounts',
  'getProgramAccounts',
  'getLatestBlockhash',
  'getSignatureStatuses',
  'getSlot',
]);

const allowed = (call) =>
  call && ALLOWED.has(call.method) && (call.method !== 'getProgramAccounts' || call.params?.[0] === PROGRAM);

// Tolerates a value pasted with surrounding quotes or spaces.
const rpcUrl = () => (process.env.RPC_URL || '').trim().replace(/^["']|["']$/g, '').trim();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const url = rpcUrl();
  if (!url) return res.status(500).json({ error: 'RPC_URL is not set' });
  if (!/^https?:\/\//.test(url)) return res.status(500).json({ error: 'RPC_URL must start with https://' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'invalid JSON' });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 20 || !calls.every(allowed)) {
    return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32601, message: 'method not allowed' } });
  }

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    res.status(upstream.status).setHeader('content-type', 'application/json');
    return res.send(await upstream.text());
  } catch (e) {
    // e.message can contain the URL; report only the kind of failure.
    return res.status(502).json({ error: 'upstream RPC failed', reason: e?.cause?.code || e?.name || 'unknown' });
  }
};
