// Read-only Solana JSON-RPC proxy for the site's My Rockies tab, so the RPC key
// stays on the server. Set RPC_URL (a mainnet RPC URL with its key, e.g. Helius)
// in the Vercel project's environment variables.
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.RPC_URL) return res.status(500).json({ error: 'RPC_URL is not set' });
  let body = req.body;
  try {
    if (typeof body === 'string') body = JSON.parse(body);
  } catch {
    return res.status(400).json({ error: 'invalid JSON' });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 20 || !calls.every(allowed)) {
    return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32601, message: 'method not allowed' } });
  }
  const upstream = await fetch(process.env.RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  res.status(upstream.status).setHeader('content-type', 'application/json');
  res.send(await upstream.text());
};
