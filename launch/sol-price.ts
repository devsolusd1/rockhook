const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** Live SOL/USD price from Jupiter, falling back to CoinGecko and Binance. */
export async function fetchSolPriceUsd(): Promise<{ price: number; source: string }> {
  const sources: [string, string, (data: any) => unknown][] = [
    ['Jupiter', `https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`, (d) => d?.[SOL_MINT]?.usdPrice],
    ['CoinGecko', 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', (d) => d?.solana?.usd],
    ['Binance', 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', (d) => d?.price],
  ];
  for (const [source, url, pick] of sources) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      const price = res.ok ? Number(pick(await res.json())) : NaN;
      if (price > 0) return { price, source };
    } catch {
      // try the next source
    }
  }
  throw new Error('Could not fetch the SOL price (Jupiter, CoinGecko and Binance all failed).');
}
