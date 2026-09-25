// The forge bot: turns $ROCK buys into Rockies, burns out sellers, and runs
// graduation (finalize, draw, walk, crown, thaw). Everything it does is a
// permissionless instruction, so anyone could run it; it only pays fees and rent.
//
// Usage: RPC_URL=... FORGE_KEYPAIR=path/to/keypair.json MINT=<$ROCK mint> node forge/forge.mjs
// Optional: PRIORITY_MICROLAMPORTS (default 50000), TICK_MS (default 2000).
// Safe to stop and restart at any time: all progress lives on-chain.
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { ix, planCrank, read, supernovaBiggestSeq } from '../client/rockhook.mjs';

// Each transaction is filled up to Solana's size limit (see `fit`); these are the ceilings.
const CRANK_BATCH = 12;
const MINT_BATCH = 8;
const WALK_BATCH = 10;
const TX_LIMIT = 1232;
// Compute units reserved per instruction (measured locally, with headroom).
const UNITS = { crank: 60_000, mint: 90_000, burn: 60_000, base: 30_000 };
const units = (per, n) => Math.min(1_400_000, UNITS.base + per * n);

export function createForge({
  conn,
  payer,
  mint,
  priorityMicroLamports = 0,
  log = (...a) => console.log(new Date().toISOString(), ...a),
}) {
  let ledger = null;
  const budget = (limit) => [
    ComputeBudgetProgram.setComputeUnitLimit({ units: limit }),
    ...(priorityMicroLamports > 0 ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports })] : []),
  ];

  /** The longest prefix of `instructions` that fits in one transaction (at least one). */
  function fit(instructions) {
    for (let n = instructions.length; n > 1; n--) {
      const tx = new Transaction().add(...budget(1_400_000), ...instructions.slice(0, n));
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = PublicKey.default.toBase58();
      try {
        // Leave room for the signature, which the unsigned serialization doesn't count.
        if (tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= TX_LIMIT) return instructions.slice(0, n);
      } catch {
        // web3.js throws once a transaction is over the limit
      }
    }
    return instructions.slice(0, 1);
  }

  async function send(label, instructions, limit) {
    const tx = new Transaction().add(...budget(limit), ...instructions);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.sign(payer);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, 'confirmed');
    log(label);
    return sig;
  }

  /** Processes ledger entries until caught up (bounded per tick); returns the entries still waiting. */
  async function crank() {
    ledger ??= (await read.state(conn, mint)).ledger;
    for (let round = 0; ; round++) {
      const forge = await read.forge(conn, mint);
      const { head, entries } = await read.ledger(conn, ledger);
      if (forge.nextSeq >= head || round === 50) return head - forge.nextSeq;
      const { steps } = planCrank({ mint, ledger, cranker: payer.publicKey, forge, entries, head, max: CRANK_BATCH });
      if (!steps.length) throw new Error(`ledger wrapped past entry ${forge.nextSeq}: call recover_overflow`);
      const batch = fit(steps);
      await send(`crank from #${forge.nextSeq} (${batch.length} steps)`, batch, units(UNITS.crank, batch.length));
    }
  }

  /** Mints every ticket without a Rocky, then burns out Rockies whose wallet sold or sent. */
  async function forgeRockies() {
    const tickets = await read.tickets(conn, mint);
    const toMint = tickets.filter((t) => !t.minted);
    for (let i = 0; i < toMint.length;) {
      const group = toMint.slice(i, i + MINT_BATCH);
      const instructions = fit(group.map((t) => ix.mintRocky({ payer: payer.publicKey, mint, seq: t.seq, wallet: t.wallet })));
      await send(`mint ${group.slice(0, instructions.length).map((t) => `#${t.number}`).join(' ')}`, instructions, units(UNITS.mint, instructions.length));
      i += instructions.length;
    }
    const holders = new Map();
    const burnt = [];
    for (const t of await read.tickets(conn, mint)) {
      if (!t.minted || t.ashed || t.supernova) continue;
      const key = t.wallet.toBase58();
      if (!holders.has(key)) holders.set(key, await read.holder(conn, mint, t.wallet));
      if (holders.get(key).burnBeforeSeq > t.seq) burnt.push(t);
    }
    for (let i = 0; i < burnt.length;) {
      const group = burnt.slice(i, i + MINT_BATCH);
      const instructions = fit(group.map((t) => ix.extinguish({ payer: payer.publicKey, mint, seq: t.seq, wallet: t.wallet })));
      await send(`burn out ${group.slice(0, instructions.length).map((t) => `#${t.number}`).join(' ')}`, instructions, units(UNITS.burn, instructions.length));
      i += instructions.length;
    }
    return tickets.length;
  }

  /** Graduation, step by step. Returns what it is waiting for. */
  async function graduate() {
    let rockies = await read.rockies(conn, mint);
    if (!rockies) return 'no collection yet';
    if (!rockies.graduated) {
      if (!(await read.hookRemoved(conn, mint))) return 'curve';
      const forge = await read.forge(conn, mint);
      if (forge.nextSeq < (await read.ledger(conn, ledger)).head) return 'catching up';
      const biggestBuySeq = await supernovaBiggestSeq(conn, mint, forge);
      await send('finalize: graduation recorded', [ix.finalize({ mint, ledger, forge, biggestBuySeq })], 300_000);
      rockies = await read.rockies(conn, mint);
    }
    if (!rockies.drawn && !rockies.randomDone) {
      if ((await conn.getSlot('confirmed')) <= rockies.drawSlot + 1) return 'waiting for the draw slot';
      await send('draw', [ix.draw({ mint })], 200_000);
      rockies = await read.rockies(conn, mint);
      if (!rockies.drawn) return 'draw re-armed';
    }
    while (!rockies.randomDone) {
      const next = (await read.tickets(conn, mint)).filter((t) => t.number >= rockies.walkNextNumber).slice(0, WALK_BATCH);
      await send(`walk from #${rockies.walkNextNumber}`, [ix.walk({ mint, tickets: next })], 600_000);
      rockies = await read.rockies(conn, mint);
    }
    const winners = new Set();
    if (rockies.hasTickets) {
      winners.add(rockies.lastBuySeq).add(rockies.biggestBuySeq);
      if (rockies.drawWeight > 0n) winners.add(rockies.randomWinnerSeq);
    }
    for (const seq of winners) {
      let t = await read.ticket(conn, mint, seq);
      if (!t.minted) {
        await send(`mint winner #${t.number}`, [ix.mintRocky({ payer: payer.publicKey, mint, seq, wallet: t.wallet })], 400_000);
        t = await read.ticket(conn, mint, seq);
      }
      if (!t.supernova) await send(`Supernova #${t.number}`, [ix.crown({ payer: payer.publicKey, mint, seq })], 400_000);
    }
    if (!rockies.thawed) await send('thaw: Rockies can be traded', [ix.thaw({ payer: payer.publicKey, mint })], 400_000);
    return 'done';
  }

  return {
    async tick() {
      // The ledger ring can wrap, so reading it out comes first: while the bot is
      // behind, minting waits (a ticket already guarantees its Rocky).
      const waiting = await crank();
      if (waiting > 0) return { tickets: null, phase: `catching up (${waiting} entries waiting)` };
      const tickets = await forgeRockies();
      const phase = await graduate();
      return { tickets, phase };
    },
  };
}

// ---- CLI ---------------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const conn = new Connection(process.env.RPC_URL ?? 'http://127.0.0.1:8899', 'confirmed');
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.FORGE_KEYPAIR, 'utf8'))));
  const mint = new PublicKey(process.env.MINT);
  const tickMs = Number(process.env.TICK_MS ?? 2000);
  // Priority fee per compute unit, so the bot's transactions land when the curve is busy.
  const priorityMicroLamports = Number(process.env.PRIORITY_MICROLAMPORTS ?? 50_000);
  const forge = createForge({ conn, payer, mint, priorityMicroLamports });
  console.log(`forge running for ${mint.toBase58()} as ${payer.publicKey.toBase58()}`);
  let last = '';
  for (;;) {
    try {
      const { tickets, phase } = await forge.tick();
      const status = `${tickets} tickets, ${phase}`;
      if (status !== last) console.log(new Date().toISOString(), status);
      last = status;
      if (phase === 'done') { console.log('graduation complete: forge closed'); break; }
    } catch (e) {
      console.error(new Date().toISOString(), 'error:', e.message.split('\n')[0]);
    }
    await new Promise((r) => setTimeout(r, tickMs));
  }
}
