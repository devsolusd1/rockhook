// RockHook program client: addresses, account readers and instruction builders.
// Plain @solana/web3.js, no Anchor client; used by the forge bot, the launcher and the tests.
import crypto from 'crypto';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey('342z5Sawvar7fcAiyt9J82ysEYs5rGaJp5wuH27Q9AAS');
export const CORE_PROGRAM_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
export const SLOT_HASHES = new PublicKey('SysvarS1otHashes111111111111111111111111111');

export const LEDGER_CAPACITY = 4096;
export const ENTRY_SIZE = 104;
export const LEDGER_SIZE = 8 + 32 + 8 + LEDGER_CAPACITY * ENTRY_SIZE;
export const TICKET_SIZE = 81;
export const KIND = { BUY: 1, SELL: 2, TRANSFER: 3 };
export const KIND_NAME = { 1: 'BUY', 2: 'SELL', 3: 'TRANSFER' };
export const TIER_NAMES = ['Ember', 'Flame', 'White-hot', 'Blue Flame', 'Plasma'];

// ---- encoding ------------------------------------------------------------------------
const disc = (name) => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
export const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const str = (s) => { const b = Buffer.from(s); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, b]); };
const pubkeys = (keys) => { const len = Buffer.alloc(4); len.writeUInt32LE(keys.length); return Buffer.concat([len, ...keys.map((k) => k.toBuffer())]); };
const ro = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
const signer = (pubkey, isWritable = true) => ({ pubkey, isSigner: true, isWritable });

// ---- addresses -----------------------------------------------------------------------
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const seed = (s) => Buffer.from(s);
export const pdas = {
  state: (mint) => pda(seed('state'), mint.toBuffer()),
  extraMetas: (mint) => pda(seed('extra-account-metas'), mint.toBuffer()),
  forge: (mint) => pda(seed('forge'), mint.toBuffer()),
  holder: (mint, wallet) => pda(seed('holder'), mint.toBuffer(), wallet.toBuffer()),
  ticket: (mint, seq) => pda(seed('ticket'), mint.toBuffer(), u64(seq)),
  rockies: (mint) => pda(seed('rockies'), mint.toBuffer()),
  authority: (mint) => pda(seed('authority'), mint.toBuffer()),
  collection: (mint) => pda(seed('collection'), mint.toBuffer()),
  rocky: (mint, seq) => pda(seed('rocky'), mint.toBuffer(), u64(seq)),
};

// ---- readers -------------------------------------------------------------------------
function cursor(d, start = 8) {
  let o = start;
  return {
    pk: () => { const k = new PublicKey(d.subarray(o, o + 32)); o += 32; return k; },
    u64: () => { const v = d.readBigUInt64LE(o); o += 8; return v; },
    num: () => { const v = Number(d.readBigUInt64LE(o)); o += 8; return v; },
    u32: () => { const v = d.readUInt32LE(o); o += 4; return v; },
    u8: () => d[o++],
    bool: () => d[o++] === 1,
    str: () => { const len = d.readUInt32LE(o); o += 4; const s = d.subarray(o, o + len).toString(); o += len; return s; },
  };
}
async function data(conn, key) {
  const info = await conn.getAccountInfo(key, 'confirmed');
  return info ? info.data : null;
}

export function decodeState(d) {
  const c = cursor(d);
  return { admin: c.pk(), mint: c.pk(), dbcPool: c.pk(), baseVault: c.pk(), ledger: c.pk(), minBuyLamports: c.u64(), paused: c.bool() };
}
export function decodeLedger(d) {
  const head = Number(d.readBigUInt64LE(40));
  const entries = [];
  for (let seq = Math.max(0, head - LEDGER_CAPACITY); seq < head; seq++) {
    const o = 48 + (seq % LEDGER_CAPACITY) * ENTRY_SIZE;
    entries.push({
      seq: Number(d.readBigUInt64LE(o)), slot: Number(d.readBigUInt64LE(o + 8)),
      amount: d.readBigUInt64LE(o + 16), value: d.readBigUInt64LE(o + 24),
      from: new PublicKey(d.subarray(o + 32, o + 64)), to: new PublicKey(d.subarray(o + 64, o + 96)),
      kind: d[o + 96], kindName: KIND_NAME[d[o + 96]],
    });
  }
  return { head, entries };
}
export function decodeForge(d) {
  const c = cursor(d);
  return {
    mint: c.pk(), nextSeq: c.num(), lost: c.num(), tickets: c.u32(), totalWeight: c.u64(), litWeight: c.u64(),
    biggestWallet: c.pk(), biggestTotal: c.u64(), secondWallet: c.pk(), secondTotal: c.u64(), lastBuySeq: c.num(), lastBuyWallet: c.pk(),
    thresholds: [c.u64(), c.u64(), c.u64(), c.u64()], routers: [c.pk(), c.pk(), c.pk(), c.pk()],
  };
}
export function decodeHolder(d) {
  const c = cursor(d);
  return {
    wallet: c.pk(), tickets: c.u32(), totalBought: c.u64(), litWeight: c.u64(), burnBeforeSeq: c.num(),
    biggestBuySeq: c.num(), biggestBuyAmount: c.u64(),
  };
}
export function decodeTicket(d) {
  const c = cursor(d);
  return {
    wallet: c.pk(), seq: c.num(), slot: c.num(), amount: c.u64(), value: c.u64(), number: c.u32(), tier: c.u8(),
    minted: c.bool(), ashed: c.bool(), supernova: c.bool(),
  };
}
export function decodeRockies(d) {
  const c = cursor(d);
  return {
    mint: c.pk(), collection: c.pk(), uriBase: c.str(), graduated: c.bool(), litSnapshot: c.u64(), drawWeight: c.u64(),
    lastBuySeq: c.num(), biggestBuySeq: c.num(), hasTickets: c.bool(), drawSlot: c.num(), drawn: c.bool(), drawTarget: c.u64(),
    walkNextNumber: c.u32(), walkCumulative: c.u64(), randomDone: c.bool(), randomWinnerSeq: c.num(), thawed: c.bool(),
  };
}
/** Metaplex Core AssetV1: key, owner, update authority, name, uri. */
export function decodeAsset(d) {
  let o = 1;
  const owner = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const kind = d[o++];
  const updateAuthority = kind ? new PublicKey(d.subarray(o, o + 32)) : null;
  if (kind) o += 32;
  const text = () => { const len = d.readUInt32LE(o); o += 4; const s = d.subarray(o, o + len).toString(); o += len; return s; };
  return { owner, updateAuthority, name: text(), uri: text() };
}

export const read = {
  state: async (conn, mint) => { const d = await data(conn, pdas.state(mint)); return d && decodeState(d); },
  ledger: async (conn, ledger) => decodeLedger(await data(conn, ledger)),
  forge: async (conn, mint) => { const d = await data(conn, pdas.forge(mint)); return d && decodeForge(d); },
  holder: async (conn, mint, wallet) => { const d = await data(conn, pdas.holder(mint, wallet)); return d && decodeHolder(d); },
  ticket: async (conn, mint, seq) => { const d = await data(conn, pdas.ticket(mint, seq)); return d && decodeTicket(d); },
  rockies: async (conn, mint) => { const d = await data(conn, pdas.rockies(mint)); return d && decodeRockies(d); },
  asset: async (conn, key) => { const d = await data(conn, key); return d && decodeAsset(d); },
  /** Every ticket of this mint (optionally only one wallet's). */
  tickets: async (conn, mint, wallet) => {
    const filters = [{ dataSize: TICKET_SIZE }];
    if (wallet) filters.push({ memcmp: { offset: 8, bytes: wallet.toBase58() } });
    const accounts = await conn.getProgramAccounts(PROGRAM_ID, { commitment: 'confirmed', filters });
    return accounts
      .map(({ pubkey, account }) => ({ pubkey, ...decodeTicket(account.data) }))
      .filter((t) => pdas.ticket(mint, t.seq).equals(t.pubkey))
      .sort((a, b) => a.number - b.number);
  },
  /** True once Meteora cleared the mint's transfer hook (the curve graduated). */
  hookRemoved: async (conn, mint) => {
    const d = await data(conn, mint);
    let i = 166;
    while (i + 4 <= d.length) {
      const type = d.readUInt16LE(i), len = d.readUInt16LE(i + 2);
      if (type === 14) return d.subarray(i + 36, i + 68).every((b) => b === 0);
      if (type === 0) break;
      i += 4 + len;
    }
    return true;
  },
};

// ---- instructions --------------------------------------------------------------------
const instruction = (keys, data) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
export const ix = {
  initialize: ({ admin, mint, ledger, dbcPool, baseVault, minBuyLamports }) => instruction(
    [signer(admin), ro(mint), rw(pdas.state(mint)), rw(ledger), rw(pdas.extraMetas(mint)), ro(SystemProgram.programId)],
    Buffer.concat([disc('initialize'), dbcPool.toBuffer(), baseVault.toBuffer(), u64(minBuyLamports)]),
  ),
  setPaused: ({ admin, mint, paused }) => instruction(
    [signer(admin, false), rw(pdas.state(mint))], Buffer.concat([disc('set_paused'), Buffer.from([paused ? 1 : 0])]),
  ),
  initForge: ({ admin, mint, thresholds, routers = [] }) => instruction(
    [signer(admin), ro(pdas.state(mint)), rw(pdas.forge(mint)), ro(SystemProgram.programId)],
    Buffer.concat([disc('init_forge'), ...thresholds.map(u64), pubkeys(routers)]),
  ),
  setRouters: ({ admin, mint, routers }) => instruction(
    [signer(admin, false), ro(pdas.state(mint)), rw(pdas.forge(mint))], Buffer.concat([disc('set_routers'), pubkeys(routers)]),
  ),
  processBuy: ({ cranker, mint, ledger, seq, wallet }) => instruction(
    [signer(cranker), ro(pdas.state(mint)), rw(pdas.forge(mint)), ro(ledger), rw(pdas.holder(mint, wallet)), rw(pdas.ticket(mint, seq)), ro(SystemProgram.programId)],
    Buffer.concat([disc('process_buy'), wallet.toBuffer()]),
  ),
  processOut: ({ mint, ledger, wallet }) => instruction(
    [ro(pdas.state(mint)), rw(pdas.forge(mint)), ro(ledger), rw(pdas.holder(mint, wallet))],
    Buffer.concat([disc('process_out'), wallet.toBuffer()]),
  ),
  processSkip: ({ mint, ledger }) => instruction([ro(pdas.state(mint)), rw(pdas.forge(mint)), ro(ledger)], disc('process_skip')),
  initCollection: ({ admin, mint, name, uri, uriBase, royaltyBps }) => instruction(
    [signer(admin), ro(pdas.state(mint)), rw(pdas.rockies(mint)), ro(pdas.authority(mint)), rw(pdas.collection(mint)), ro(CORE_PROGRAM_ID), ro(SystemProgram.programId)],
    Buffer.concat([disc('init_collection'), str(name), str(uri), str(uriBase), u16(royaltyBps)]),
  ),
  mintRocky: ({ payer, mint, seq, wallet }) => instruction(
    [signer(payer), ro(pdas.rockies(mint)), rw(pdas.ticket(mint, seq)), ro(pdas.holder(mint, wallet)), ro(wallet), ro(pdas.authority(mint)),
      rw(pdas.collection(mint)), rw(pdas.rocky(mint, seq)), ro(CORE_PROGRAM_ID), ro(SystemProgram.programId)],
    disc('mint_rocky'),
  ),
  extinguish: ({ payer, mint, seq, wallet }) => instruction(
    [signer(payer), ro(pdas.rockies(mint)), rw(pdas.ticket(mint, seq)), ro(pdas.holder(mint, wallet)), ro(pdas.authority(mint)),
      ro(pdas.collection(mint)), rw(pdas.rocky(mint, seq)), ro(CORE_PROGRAM_ID), ro(SystemProgram.programId)],
    disc('extinguish'),
  ),
  /** `forge` from read.forge; `biggestBuySeq` from supernovaBiggestSeq (0 when there are no tickets). */
  finalize: ({ mint, ledger, forge, biggestBuySeq }) => instruction(
    [ro(pdas.state(mint)), ro(pdas.forge(mint)), ro(ledger), rw(pdas.rockies(mint)), ro(mint),
      ro(pdas.holder(mint, forge.biggestWallet)), ro(pdas.holder(mint, forge.secondWallet)), ro(pdas.ticket(mint, biggestBuySeq)),
      ro(pdas.holder(mint, forge.lastBuyWallet)), ro(pdas.ticket(mint, forge.lastBuySeq))],
    disc('finalize'),
  ),
  draw: ({ mint }) => instruction([rw(pdas.rockies(mint)), ro(SLOT_HASHES)], disc('draw')),
  /** `tickets`: [{ seq, wallet }] in ticket-number order. */
  walk: ({ mint, tickets }) => instruction(
    [rw(pdas.rockies(mint)), ...tickets.flatMap((t) => [ro(pdas.ticket(mint, t.seq)), ro(pdas.holder(mint, t.wallet))])],
    disc('walk'),
  ),
  crown: ({ payer, mint, seq }) => instruction(
    [signer(payer), ro(pdas.rockies(mint)), rw(pdas.ticket(mint, seq)), ro(pdas.authority(mint)), ro(pdas.collection(mint)),
      rw(pdas.rocky(mint, seq)), ro(CORE_PROGRAM_ID), ro(SystemProgram.programId)],
    disc('crown'),
  ),
  closeLedger: ({ admin, mint, ledger }) => instruction(
    [signer(admin), ro(pdas.state(mint)), ro(pdas.forge(mint)), ro(pdas.rockies(mint)), rw(ledger)],
    disc('close_ledger'),
  ),
  thaw: ({ payer, mint }) => instruction(
    [signer(payer), rw(pdas.rockies(mint)), ro(pdas.authority(mint)), rw(pdas.collection(mint)), ro(CORE_PROGRAM_ID), ro(SystemProgram.programId)],
    disc('thaw'),
  ),
};

/**
 * Ledger seq of the biggest-buyer Supernova, the way `finalize` picks it: the
 * biggest buyer's biggest buy, or the runner-up's when that buy also filled the curve.
 */
export async function supernovaBiggestSeq(conn, mint, forge) {
  if (forge.tickets === 0) return 0;
  const biggest = await read.holder(conn, mint, forge.biggestWallet);
  if (biggest.biggestBuySeq === forge.lastBuySeq && !forge.secondWallet.equals(PublicKey.default)) {
    return (await read.holder(conn, mint, forge.secondWallet)).biggestBuySeq;
  }
  return biggest.biggestBuySeq;
}

/**
 * The next crank steps from the forge cursor: one instruction per ledger entry
 * (two entries for a router hand-off). Returns { steps, outWallets }.
 */
export function planCrank({ mint, ledger, cranker, forge, entries, head, max = 4 }) {
  const bySeq = new Map(entries.map((e) => [e.seq, e]));
  const steps = [];
  const outWallets = [];
  let seq = forge.nextSeq;
  while (steps.length < max && seq < head) {
    const e = bySeq.get(seq);
    if (!e) break; // overwritten: recover_overflow is needed
    const isRouter = forge.routers.some((r) => r.equals(e.to));
    if (e.kind === KIND.BUY && isRouter) {
      const next = bySeq.get(seq + 1);
      if (next && next.kind === KIND.TRANSFER && next.from.equals(e.to) && next.slot === e.slot) {
        steps.push(ix.processBuy({ cranker, mint, ledger, seq, wallet: next.to }));
        seq += 2;
      } else {
        steps.push(ix.processSkip({ mint, ledger }));
        seq += 1;
      }
    } else if (e.kind === KIND.BUY) {
      steps.push(ix.processBuy({ cranker, mint, ledger, seq, wallet: e.to }));
      seq += 1;
    } else {
      steps.push(ix.processOut({ mint, ledger, wallet: e.from }));
      outWallets.push(e.from);
      seq += 1;
    }
  }
  return { steps, outWallets, nextSeq: seq };
}
