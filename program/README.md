# RockHook hook program

The on-chain side of RockHook: a Token-2022 transfer hook for $ROCK on the Meteora Dynamic Bonding Curve, the Rocky NFT collection it forges from buys, and the forge bot that drives it.

Program id: `342z5Sawvar7fcAiyt9J82ysEYs5rGaJp5wuH27Q9AAS` (Anchor 1.0).

## How it works

**Recording.** Token-2022 calls the hook on every $ROCK transfer. The hook classifies it from the curve's base vault: tokens leaving the vault are a buy, tokens entering it are a sell, anything else is a transfer. It appends one entry (buyer or sender, amount, value in SOL at the curve's current price, slot) to a 4,096-entry ring ledger. Buys worth less than 0.1 SOL are not recorded. The hook never mints or calls another program and only uses fixed extra accounts, so it stays cheap and fits inside aggregator routes.

**Crank.** `process_buy`, `process_out` and `process_skip` read the ledger in order. Anyone can call them. A buy becomes a `Ticket` with a number and a tier set by the $ROCK it received. A sell or send flags every earlier ticket of that wallet as burnt out. A buy that lands on a known router account and is sent on to a user in the same slot is credited to that user.

**Rockies.** `mint_rocky` turns a ticket into a Metaplex Core asset in the program-owned collection. Anyone can call it and pay the rent, which is how the site's claim button works. The collection carries a permanent freeze, so no Rocky can move before graduation, and a 5% royalty. `extinguish` switches a burnt-out Rocky to the ash artwork.

| Tier | $ROCK received in one buy |
|---|---|
| Ember | under 0.77 |
| Flame | 0.77 to 1.77 |
| White-hot | 1.77 to 3.77 |
| Blue Flame | 3.77 to 7.77 |
| Plasma | 7.77 or more |

**Graduation.** DBC removes the hook from the mint when the curve fills. From then on:

1. `finalize` checks the hook is gone and every ledger entry is processed, then fixes the two Supernovas that are facts on the chain: the buy that filled the curve, and the biggest buy of the wallet with the largest total bought on the curve. If that biggest buy is also the one that filled the curve, the second Supernova goes to the runner-up's biggest buy instead. It also picks a draw slot 8 slots ahead.
2. `draw` takes that slot's hash from the SlotHashes sysvar and turns it into a target inside the combined weight of every other Rocky still lit. If nobody draws before the slot leaves the sysvar (about 512 slots), the draw re-arms on a new future slot rather than using an older hash that the caller could time.
3. `walk` scans tickets in number order until the running weight passes the target. That ticket is the third Supernova. A ticket's weight is the $ROCK its buy received.
4. `crown` switches the three winners to the Supernova artwork.
5. `thaw` removes the freeze, and Rockies trade like any other Core NFT.
6. `close_ledger` lets the admin reclaim the ledger's rent (about 2.97 SOL).

**Admin powers.** The admin can pause recording (`set_paused`; trading is never blocked), change the router list (`set_routers`) and close the ledger after graduation. The upgrade authority is revoked after graduation, so the rules can't change afterwards.

## Layout

- `programs/rockhook-hook/` – the Anchor program.
- `client/rockhook.mjs` – addresses, account decoders and instruction builders in plain `@solana/web3.js`.
- `forge/forge.mjs` – the forge bot: crank, mint, burn-out, then graduation from start to finish.
- `localtest/` – end-to-end tests against a local validator with the real Meteora, Metaplex and Core programs cloned from mainnet.

## Build and test

Tested with Rust 1.89 (see `rust-toolchain.toml`), Solana CLI 3.1, Anchor 1.0.2 and Node 20, on Linux or WSL.

```bash
anchor build
npm install
npm run validator        # in its own terminal
npm run test:phase1      # hook: recording, access checks, pause, graduation to DAMM v2
npm run test:phase2      # crank: tickets, routers, burn-outs, biggest buyer
npm run test:phase3      # Rockies: mint, freeze, ash, finalize, draw, walk, crown, thaw
npm run test:phase4      # a launch day with the bot running on its own
npm run test:runnerup    # the filling buy is also the biggest buyer's biggest buy
npm run test:stress      # 210 trades in a few seconds; the bot has to catch up
npm run test:draw-late   # nobody draws in time: the draw re-arms (takes about 4 minutes)
```

## Running the forge

```bash
RPC_URL=<rpc url> FORGE_KEYPAIR=<keypair.json> MINT=<$ROCK mint> npm run forge
```

Every instruction the bot sends is permissionless, so anyone can run it. The bot only pays fees and rent: about 0.006 SOL per Rocky. It can be stopped and restarted at any time, because all progress is stored on-chain. The one limit is the ledger ring: if more than 4,096 transfers happen while nobody runs the crank, the oldest unread entries are overwritten and `recover_overflow` skips past them. Optional settings are `PRIORITY_MICROLAMPORTS` (default 50000) and `TICK_MS` (default 2000).
