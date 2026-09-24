# RockHook ($ROCK)

Landing page for RockHook, a Solana token with a supply of exactly one $ROCK (9 decimals) launched on a Meteora bonding curve. Every buy on the curve forges an Ember NFT whose rarity is its flame temperature; the collection closes when the curve graduates at a $200K market cap.

![Ember rarities](nft/rarity-sheet.png)

## Layout

- `index.html` – the whole site (static, no build step). Deploy the repo root as-is on Vercel and point `rockhook.fun` at it.
- `art/` – 64×64 tier images used by the site (scaled up with pixelated rendering).
- `nft/base.png` – the original drawing.
- `nft/generate.py` – rebuilds every tier from `base.png`: 1024px images in `nft/tiers/`, the 64px copies in `art/`, and `nft/rarity-sheet.png`. Requires Pillow: `python nft/generate.py`.
- `launch/` – the token launcher (kept out of the Vercel deploy by `.vercelignore`).

## Launching $ROCK

`launch/launch.ts` creates the token and its Meteora DBC pool: supply of 1 ROCK with 9 decimals, trading opens at a $10K market cap, graduation to a DAMM v2 pool at $200K with the LP 100% locked, 3% fee on the curve and 4% after migration, standard curve shape.

```
cd launch
npm install
cp .env.example .env         # fill in LAUNCH_KEYPAIR, RPC_URL, PINATA_JWT
npm run launch               # dry run: prints the curve and simulates, sends nothing
npm run launch -- --send     # launches for real
```

Put exactly one token image in `launch/token-image/` first.

## Tiers

| Tier | Buy size | Flame |
|---|---|---|
| Ember | under 0.1 SOL | ≈ 900 K |
| Flame | 0.1 to 0.5 SOL | ≈ 1,300 K |
| White-hot | 0.5 to 1 SOL | ≈ 1,800 K |
| Blue Flame | 1 to 3 SOL | ≈ 2,200 K |
| Plasma | 3 SOL or more | ≈ 10,000 K |
| Supernova | 1 of 1: first buy, graduating buy, biggest buyer | ≈ 10⁹ K |
| Burnt out | sold before graduation | cold ash |

## Status

The transfer hook that records buys and the Ember minting are not built yet. The site describes the planned mechanics, so don't point the domain at it until they are live.
