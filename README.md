# RockHook ($ROCK)

Landing page for RockHook, a Solana token with a supply of 777 $ROCK launched on a Meteora bonding curve. Every buy on the curve forges an Ember NFT whose rarity is its flame temperature; the collection closes when the curve graduates at a $200K market cap.

![Ember rarities](nft/rarity-sheet.png)

## Layout

- `index.html` – the whole site (static, no build step). Deploy the repo root as-is on Vercel and point `rockhook.fun` at it.
- `art/` – 64×64 tier images used by the site (scaled up with pixelated rendering).
- `nft/base.png` – the original drawing.
- `nft/generate.py` – rebuilds every tier from `base.png`: 1024px images in `nft/tiers/`, the 64px copies in `art/`, and `nft/rarity-sheet.png`. Requires Pillow: `python nft/generate.py`.

## Tiers

| Tier | $ROCK received in one buy | Flame |
|---|---|---|
| Ember | under 0.77 | ≈ 900 K |
| Flame | 0.77 to 1.77 | ≈ 1,300 K |
| White-hot | 1.77 to 3.77 | ≈ 1,800 K |
| Blue Flame | 3.77 to 7.77 | ≈ 2,200 K |
| Plasma | 7.77 or more | ≈ 10,000 K |
| Supernova | 1 of 1: a random lit Ember drawn at graduation, the graduating buy, the biggest buyer on the curve | ≈ 10⁹ K |
| Burnt out | sold before graduation | cold ash |

Buys under 0.1 SOL don't forge an Ember. The same SOL buys more $ROCK early on the curve, so early buys burn hotter.

## Why 777

777 °C is forge heat. It sits just past 770 °C, the Curie point of iron, where hot steel stops sticking to a magnet and a blacksmith knows it's ready to be hardened. That's the moment a lump of metal becomes something that keeps its shape, which is what the hook does to every buy. The sevens run through the rest too: an Ember can end in seven states (five flames, the Supernova and the ash), and the tiers step up at 0.77, 1.77, 3.77 and 7.77 $ROCK.

## Status

The transfer hook that records buys and the Ember minting are not built yet. The site describes the planned mechanics, so don't point the domain at it until they are live.
