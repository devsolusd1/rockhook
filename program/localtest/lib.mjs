// Shared helpers for the RockHook local tests.
import fs from 'fs';
import BN from 'bn.js';
import {
  ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram,
  Transaction, TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedWithTransferHookInstruction, getAccount, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import * as dbc from '@meteora-ag/dynamic-bonding-curve-sdk';
import * as client_ from '../client/rockhook.mjs';

export { BN, dbc, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram, TOKEN_2022_PROGRAM_ID };

export const HOOK = new PublicKey('342z5Sawvar7fcAiyt9J82ysEYs5rGaJp5wuH27Q9AAS');
export const SOL = new PublicKey('So11111111111111111111111111111111111111112');
export const IDL = JSON.parse(fs.readFileSync(new URL('../target/idl/rockhook_hook.json', import.meta.url)));
export const conn = new Connection('http://127.0.0.1:8899', 'confirmed');
export const client = new dbc.DynamicBondingCurveClient(conn, 'confirmed');

export const SUPPLY = 777, DECIMALS = 9, SOL_USD = 117;
export const LEDGER_CAPACITY = 4096, ENTRY_SIZE = 104, LEDGER_SIZE = 8 + 32 + 8 + LEDGER_CAPACITY * ENTRY_SIZE;
export const KIND = { BUY: 1, SELL: 2, TRANSFER: 3 };
const KIND_NAME = { 1: 'BUY', 2: 'SELL', 3: 'TRANSFER' };
export const TIER_NAMES = ['Ember', 'Flame', 'White-hot', 'Blue Flame', 'Plasma'];
export const TIER_THRESHOLDS = [0.77, 1.77, 3.77, 7.77].map((r) => BigInt(Math.round(r * 1e9)));

let failures = 0;
export const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; };
export const finish = () => { console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED'); process.exit(failures ? 1 : 0); };
export const ixDisc = (name) => Buffer.from(IDL.instructions.find((i) => i.name === name).discriminator);
export const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
export const short = (k) => k.toBase58().slice(0, 6);
export const rock = (units) => Number(units) / 10 ** DECIMALS;

export async function send(label, tx, signers) {
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(...signers);
  try {
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, 'confirmed');
    return sig;
  } catch (e) {
    const logs = e.logs ?? e.transactionLogs ?? [];
    throw new Error(`${label}: ${e.message}\n${logs.slice(-15).join('\n')}`);
  }
}
/** Sends and returns the error message, or null if it succeeded. */
export async function sendExpectError(label, tx, signers) {
  try { await send(label, tx, signers); return null; } catch (e) { return e.message; }
}
export async function fund(pubkey, sol) {
  const sig = await conn.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, 'confirmed');
}

export const ataOf = (owner, mint) => getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
export async function rockBalance(owner, mint) {
  try { return Number((await getAccount(conn, ataOf(owner, mint), 'confirmed', TOKEN_2022_PROGRAM_ID)).amount); } catch { return 0; }
}

export async function readLedger(ledger) {
  const data = (await conn.getAccountInfo(ledger)).data;
  const head = Number(data.readBigUInt64LE(40));
  const entries = [];
  for (let seq = Math.max(0, head - LEDGER_CAPACITY); seq < head; seq++) {
    const o = 48 + (seq % LEDGER_CAPACITY) * ENTRY_SIZE;
    entries.push({
      seq: Number(data.readBigUInt64LE(o)),
      slot: Number(data.readBigUInt64LE(o + 8)),
      amount: data.readBigUInt64LE(o + 16),
      value: data.readBigUInt64LE(o + 24),
      from: new PublicKey(data.subarray(o + 32, o + 64)),
      to: new PublicKey(data.subarray(o + 64, o + 96)),
      kind: data[o + 96],
      kindName: KIND_NAME[data[o + 96]],
    });
  }
  return { head, entries };
}

// ---- PDAs --------------------------------------------------------------------
export const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, HOOK)[0];
export const statePda = (mint) => pda(Buffer.from('state'), mint.toBuffer());
export const extraMetasPda = (mint) => pda(Buffer.from('extra-account-metas'), mint.toBuffer());
export const forgePda = (mint) => pda(Buffer.from('forge'), mint.toBuffer());
export const holderPda = (mint, wallet) => pda(Buffer.from('holder'), mint.toBuffer(), wallet.toBuffer());
export const ticketPda = (mint, seq) => pda(Buffer.from('ticket'), mint.toBuffer(), u64(seq));

// ---- Account decoders (Borsh, after the 8-byte discriminator) -----------------
export const readForge = (mint) => client_.read.forge(conn, mint);
export async function readHolder(mint, wallet) {
  const info = await conn.getAccountInfo(holderPda(mint, wallet));
  if (!info) return null;
  const d = info.data;
  return {
    wallet: new PublicKey(d.subarray(8, 40)), tickets: d.readUInt32LE(40), totalBought: d.readBigUInt64LE(44),
    litWeight: d.readBigUInt64LE(52), burnBeforeSeq: Number(d.readBigUInt64LE(60)),
    biggestBuySeq: Number(d.readBigUInt64LE(68)), biggestBuyAmount: d.readBigUInt64LE(76),
  };
}
export async function readTicket(mint, seq) {
  const info = await conn.getAccountInfo(ticketPda(mint, seq));
  if (!info) return null;
  const d = info.data;
  return {
    wallet: new PublicKey(d.subarray(8, 40)), seq: Number(d.readBigUInt64LE(40)), slot: Number(d.readBigUInt64LE(48)),
    amount: d.readBigUInt64LE(56), value: d.readBigUInt64LE(64), number: d.readUInt32LE(72), tier: d[76], minted: d[77] === 1,
    ashed: d[78] === 1, supernova: d[79] === 1,
  };
}

// ---- Rockies (phase 3) -------------------------------------------------------------
export const CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
export const SLOT_HASHES = new PublicKey('SysvarS1otHashes111111111111111111111111111');
export const rockiesPda = (mint) => pda(Buffer.from('rockies'), mint.toBuffer());
export const authorityPda = (mint) => pda(Buffer.from('authority'), mint.toBuffer());
export const collectionPda = (mint) => pda(Buffer.from('collection'), mint.toBuffer());
export const rockyPda = (mint, seq) => pda(Buffer.from('rocky'), mint.toBuffer(), u64(seq));

export async function readRockies(mint) {
  const d = (await conn.getAccountInfo(rockiesPda(mint))).data;
  let o = 8;
  const pk = () => { const k = new PublicKey(d.subarray(o, o + 32)); o += 32; return k; };
  const n64 = () => { const v = Number(d.readBigUInt64LE(o)); o += 8; return v; };
  const big = () => { const v = d.readBigUInt64LE(o); o += 8; return v; };
  const n32 = () => { const v = d.readUInt32LE(o); o += 4; return v; };
  const bool = () => d[o++] === 1;
  const str = () => { const len = d.readUInt32LE(o); o += 4; const s = d.subarray(o, o + len).toString(); o += len; return s; };
  return {
    mint: pk(), collection: pk(), uriBase: str(), graduated: bool(), litSnapshot: big(), drawWeight: big(), lastBuySeq: n64(), biggestBuySeq: n64(),
    hasTickets: bool(), drawSlot: n64(), drawn: bool(), drawTarget: big(), walkNextNumber: n32(), walkCumulative: big(),
    randomDone: bool(), randomWinnerSeq: n64(), thawed: bool(),
  };
}
/** Metaplex Core AssetV1: key, owner, update authority, name, uri. */
export async function readAsset(asset) {
  const info = await conn.getAccountInfo(asset);
  if (!info) return null;
  const d = info.data;
  let o = 1;
  const owner = new PublicKey(d.subarray(o, o + 32)); o += 32;
  const uaKind = d[o++]; const updateAuthority = uaKind ? new PublicKey(d.subarray(o, o + 32)) : null; if (uaKind) o += 32;
  const str = () => { const len = d.readUInt32LE(o); o += 4; const s = d.subarray(o, o + len).toString(); o += len; return s; };
  return { owner, updateAuthority, name: str(), uri: str() };
}
const borshString = (s) => { const b = Buffer.from(s); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, b]); };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };

export const rockyIx = {
  initCollection: (admin, mint, name, uri, uriBase, royaltyBps) => new TransactionInstruction({
    programId: HOOK,
    keys: [signer(admin), ro(statePda(mint)), rw(rockiesPda(mint)), ro(authorityPda(mint)), rw(collectionPda(mint)), ro(CORE), ro(SystemProgram.programId)],
    data: Buffer.concat([ixDisc('init_collection'), borshString(name), borshString(uri), borshString(uriBase), u16(royaltyBps)]),
  }),
  mint: (payer, mint, seq, wallet) => new TransactionInstruction({
    programId: HOOK,
    keys: [signer(payer), ro(rockiesPda(mint)), rw(ticketPda(mint, seq)), ro(holderPda(mint, wallet)), ro(wallet), ro(authorityPda(mint)),
      rw(collectionPda(mint)), rw(rockyPda(mint, seq)), ro(CORE), ro(SystemProgram.programId)],
    data: ixDisc('mint_rocky'),
  }),
  extinguish: (payer, mint, seq, wallet) => new TransactionInstruction({
    programId: HOOK,
    keys: [signer(payer), ro(rockiesPda(mint)), rw(ticketPda(mint, seq)), ro(holderPda(mint, wallet)), ro(authorityPda(mint)),
      ro(collectionPda(mint)), rw(rockyPda(mint, seq)), ro(CORE), ro(SystemProgram.programId)],
    data: ixDisc('extinguish'),
  }),
  finalize: (mint, ledger, forge, biggestBuySeq) => client_.ix.finalize({ mint, ledger, forge, biggestBuySeq }),
  draw: (mint) => new TransactionInstruction({
    programId: HOOK, keys: [rw(rockiesPda(mint)), ro(SLOT_HASHES)], data: ixDisc('draw'),
  }),
  walk: (mint, pairs) => new TransactionInstruction({
    programId: HOOK, keys: [rw(rockiesPda(mint)), ...pairs.flatMap(([t, h]) => [ro(t), ro(h)])], data: ixDisc('walk'),
  }),
  crown: (payer, mint, seq) => new TransactionInstruction({
    programId: HOOK,
    keys: [signer(payer), ro(rockiesPda(mint)), rw(ticketPda(mint, seq)), ro(authorityPda(mint)), ro(collectionPda(mint)),
      rw(rockyPda(mint, seq)), ro(CORE), ro(SystemProgram.programId)],
    data: ixDisc('crown'),
  }),
  thaw: (payer, mint) => new TransactionInstruction({
    programId: HOOK,
    keys: [signer(payer), rw(rockiesPda(mint)), ro(authorityPda(mint)), rw(collectionPda(mint)), ro(CORE), ro(SystemProgram.programId)],
    data: ixDisc('thaw'),
  }),
  /** Metaplex Core TransferV1 (optional accounts filled with the Core program id). */
  coreTransfer: (owner, asset, collection, newOwner) => new TransactionInstruction({
    programId: CORE,
    keys: [rw(asset), ro(collection), signer(owner), ro(CORE), ro(newOwner), ro(CORE), ro(CORE)],
    data: Buffer.from([14, 0]),
  }),
};

// ---- Hook instructions ---------------------------------------------------------
const ro = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
const signer = (pubkey, isWritable = true) => ({ pubkey, isSigner: true, isWritable });
const vecPubkeys = (keys) => { const len = Buffer.alloc(4); len.writeUInt32LE(keys.length); return Buffer.concat([len, ...keys.map((k) => k.toBuffer())]); };

export const ix = {
  initialize: (admin, mint, ledger, pool, baseVault, minBuyLamports) => new TransactionInstruction({
    programId: HOOK,
    keys: [signer(admin), ro(mint), rw(statePda(mint)), rw(ledger), rw(extraMetasPda(mint)), ro(SystemProgram.programId)],
    data: Buffer.concat([ixDisc('initialize'), pool.toBuffer(), baseVault.toBuffer(), u64(minBuyLamports)]),
  }),
  setPaused: (admin, mint, paused) => new TransactionInstruction({
    programId: HOOK, keys: [signer(admin, false), rw(statePda(mint))],
    data: Buffer.concat([ixDisc('set_paused'), Buffer.from([paused ? 1 : 0])]),
  }),
  initForge: (admin, mint, thresholds, routers) => new TransactionInstruction({
    programId: HOOK, keys: [signer(admin), ro(statePda(mint)), rw(forgePda(mint)), ro(SystemProgram.programId)],
    data: Buffer.concat([ixDisc('init_forge'), ...thresholds.map(u64), vecPubkeys(routers)]),
  }),
  setRouters: (admin, mint, routers) => new TransactionInstruction({
    programId: HOOK, keys: [signer(admin, false), ro(statePda(mint)), rw(forgePda(mint))],
    data: Buffer.concat([ixDisc('set_routers'), vecPubkeys(routers)]),
  }),
  processBuy: (cranker, mint, ledger, seq, wallet) => new TransactionInstruction({
    programId: HOOK,
    keys: [signer(cranker), ro(statePda(mint)), rw(forgePda(mint)), ro(ledger), rw(holderPda(mint, wallet)), rw(ticketPda(mint, seq)), ro(SystemProgram.programId)],
    data: Buffer.concat([ixDisc('process_buy'), wallet.toBuffer()]),
  }),
  processOut: (mint, ledger, wallet) => new TransactionInstruction({
    programId: HOOK, keys: [ro(statePda(mint)), rw(forgePda(mint)), ro(ledger), rw(holderPda(mint, wallet))],
    data: Buffer.concat([ixDisc('process_out'), wallet.toBuffer()]),
  }),
  processSkip: (mint, ledger) => new TransactionInstruction({
    programId: HOOK, keys: [ro(statePda(mint)), rw(forgePda(mint)), ro(ledger)], data: ixDisc('process_skip'),
  }),
};

/** The crank the forge bot runs: picks the right instruction for each unprocessed entry. */
export async function crank(cranker, mint, ledger, batch = 4) {
  let processed = 0;
  for (;;) {
    const forge = await readForge(mint);
    const { head, entries } = await readLedger(ledger);
    if (forge.nextSeq >= head) return processed;
    const bySeq = new Map(entries.map((e) => [e.seq, e]));
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }));
    let seq = forge.nextSeq;
    for (let n = 0; n < batch && seq < head; n++) {
      const e = bySeq.get(seq);
      const isRouter = forge.routers.some((r) => r.equals(e.to));
      if (e.kind === KIND.BUY && isRouter) {
        const next = bySeq.get(seq + 1);
        const handoff = next && next.kind === KIND.TRANSFER && next.from.equals(e.to) && next.slot === e.slot;
        if (handoff) { tx.add(ix.processBuy(cranker.publicKey, mint, ledger, seq, next.to)); seq += 2; }
        else { tx.add(ix.processSkip(mint, ledger)); seq += 1; }
      } else if (e.kind === KIND.BUY) {
        tx.add(ix.processBuy(cranker.publicKey, mint, ledger, seq, e.to)); seq += 1;
      } else {
        tx.add(ix.processOut(mint, ledger, e.from)); seq += 1;
      }
      processed++;
    }
    await send(`crank from #${forge.nextSeq}`, tx, [cranker]);
  }
}

// ---- Launch + trades -------------------------------------------------------------
export function curveConfig() {
  return dbc.buildCurveWithLiquidityWeights({
    token: {
      tokenType: dbc.TokenType.Token2022, tokenBaseDecimal: DECIMALS, tokenQuoteDecimal: 9,
      tokenAuthorityOption: dbc.TokenAuthorityOption.Immutable, totalTokenSupply: SUPPLY,
      leftover: Math.max(SUPPLY / 10_000_000, 10_000 / 10 ** DECIMALS),
    },
    fee: {
      baseFeeParams: { baseFeeMode: dbc.BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: 300, endingFeeBps: 300, numberOfPeriod: 0, totalDuration: 0 } },
      dynamicFeeEnabled: false, collectFeeMode: dbc.CollectFeeMode.QuoteToken, creatorTradingFeePercentage: 0,
      poolCreationFee: 0, enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: dbc.MigrationOption.MET_DAMM_V2, migrationFeeOption: dbc.MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: { collectFeeMode: dbc.MigratedCollectFeeMode.QuoteToken, dynamicFee: dbc.DammV2DynamicFeeMode.Disabled, poolFeeBps: 400 },
    },
    liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 100, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 0, creatorLiquidityPercentage: 0 },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: dbc.ActivationType.Timestamp,
    initialMarketCap: 10_000 / SOL_USD, migrationMarketCap: 200_000 / SOL_USD,
    liquidityWeights: Array(16).fill(1),
  });
}

/** Hook first, then the DBC config and the Token-2022 pool, like the launch day. */
export async function launch(payer) {
  const mintKp = Keypair.generate(), configKp = Keypair.generate(), ledgerKp = Keypair.generate();
  const mint = mintKp.publicKey;
  const pool = dbc.deriveDbcPoolAddress(SOL, mint, configKp.publicKey);
  const baseVault = dbc.deriveDbcTokenVaultAddress(pool, mint);
  const rent = await conn.getMinimumBalanceForRentExemption(LEDGER_SIZE);
  await send('initialize hook', new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: ledgerKp.publicKey, lamports: rent, space: LEDGER_SIZE, programId: HOOK }),
    ix.initialize(payer.publicKey, mint, ledgerKp.publicKey, pool, baseVault, 0.1 * LAMPORTS_PER_SOL),
  ), [payer, ledgerKp]);
  const curve = curveConfig();
  await send('create config', await client.partner.createConfigWithTransferHook({
    ...curve, config: configKp.publicKey, feeClaimer: payer.publicKey, leftoverReceiver: payer.publicKey,
    quoteMint: SOL, payer: payer.publicKey, transferHookProgram: HOOK,
  }), [payer, configKp]);
  await send('create pool', await client.creator.createPoolWithTransferHook({
    name: 'RockHook', symbol: 'ROCK', uri: 'https://rockhook.fun/test.json', poolCreator: payer.publicKey,
    baseMint: mint, config: configKp.publicKey, payer: payer.publicKey, transferHookProgram: HOOK,
  }), [payer, mintKp]);
  return { mint, pool, baseVault, config: configKp.publicKey, ledger: ledgerKp.publicKey };
}

export async function buyTx(who, pool, sol) {
  const tx = await client.pool.swap2WithTransferHook({
    owner: who, pool, swapBaseForQuote: false, swapMode: dbc.SwapMode.PartialFill,
    amountIn: new BN(Math.round(sol * LAMPORTS_PER_SOL)), minimumAmountOut: new BN(0), referralTokenAccount: null,
  });
  tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
  return tx;
}
export async function buyExactOutTx(who, pool, rockUnits, maxSol) {
  const tx = await client.pool.swap2WithTransferHook({
    owner: who, pool, swapBaseForQuote: false, swapMode: dbc.SwapMode.ExactOut,
    amountOut: new BN(rockUnits), maximumAmountIn: new BN(Math.round(maxSol * LAMPORTS_PER_SOL)), referralTokenAccount: null,
  });
  tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }));
  return tx;
}
export async function buy(who, pool, sol, label) { return send(label, await buyTx(who.publicKey, pool, sol), [who]); }
export async function sell(who, pool, rockUnits, label) {
  const tx = await client.pool.swap2WithTransferHook({
    owner: who.publicKey, pool, swapBaseForQuote: true, swapMode: dbc.SwapMode.ExactIn,
    amountIn: new BN(rockUnits), minimumAmountOut: new BN(0), referralTokenAccount: null,
  });
  tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
  return send(label, tx, [who]);
}
export async function transferIxs(from, to, mint, units) {
  return [
    createAssociatedTokenAccountIdempotentInstruction(from, ataOf(to, mint), to, mint, TOKEN_2022_PROGRAM_ID),
    await createTransferCheckedWithTransferHookInstruction(conn, ataOf(from, mint), mint, ataOf(to, mint), from, BigInt(units), DECIMALS, [], 'confirmed', TOKEN_2022_PROGRAM_ID),
  ];
}
