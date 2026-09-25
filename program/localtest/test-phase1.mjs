// Phase 1 integration test: the RockHook transfer hook against the real Meteora DBC
// program (cloned from mainnet) on a local validator.
import fs from 'fs';
import crypto from 'crypto';
import BN from 'bn.js';
import {
  ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram,
  Transaction, TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedWithTransferHookInstruction, getAccount, getAssociatedTokenAddressSync,
  getMint, getTransferHook,
} from '@solana/spl-token';
import * as dbc from '@meteora-ag/dynamic-bonding-curve-sdk';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';

const HOOK = new PublicKey('342z5Sawvar7fcAiyt9J82ysEYs5rGaJp5wuH27Q9AAS');
const SOL = new PublicKey('So11111111111111111111111111111111111111112');
const IDL = JSON.parse(fs.readFileSync(new URL('../target/idl/rockhook_hook.json', import.meta.url)));
const conn = new Connection('http://127.0.0.1:8899', 'confirmed');
const client = new dbc.DynamicBondingCurveClient(conn, 'confirmed');

const SUPPLY = 777, DECIMALS = 9, SOL_USD = 117;
const LEDGER_CAPACITY = 4096, ENTRY_SIZE = 104, LEDGER_SIZE = 8 + 32 + 8 + LEDGER_CAPACITY * ENTRY_SIZE;
const KIND = { 1: 'BUY', 2: 'SELL', 3: 'TRANSFER' };

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; };
const ixDisc = (name) => Buffer.from(IDL.instructions.find((i) => i.name === name).discriminator);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const short = (k) => k.toBase58().slice(0, 6);

async function send(label, tx, signers) {
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(...signers);
  try {
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction(sig, 'confirmed');
    return sig;
  } catch (e) {
    const logs = e.logs ?? e.transactionLogs ?? [];
    throw new Error(`${label}: ${e.message}\n${logs.slice(-45).join('\n')}`);
  }
}
async function fund(kp, sol) {
  const sig = await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, 'confirmed');
}
async function readLedger(ledger) {
  const data = (await conn.getAccountInfo(ledger)).data;
  const head = Number(data.readBigUInt64LE(40));
  const entries = [];
  for (let seq = Math.max(0, head - LEDGER_CAPACITY); seq < head; seq++) {
    const o = 48 + (seq % LEDGER_CAPACITY) * ENTRY_SIZE;
    entries.push({
      seq: Number(data.readBigUInt64LE(o)),
      slot: Number(data.readBigUInt64LE(o + 8)),
      amount: Number(data.readBigUInt64LE(o + 16)) / 10 ** DECIMALS,
      valueSol: Number(data.readBigUInt64LE(o + 24)) / LAMPORTS_PER_SOL,
      from: new PublicKey(data.subarray(o + 32, o + 64)),
      to: new PublicKey(data.subarray(o + 64, o + 96)),
      kind: KIND[data[o + 96]] ?? data[o + 96],
    });
  }
  return { head, entries };
}
const ataOf = (owner, mint) => getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
async function rockBalance(owner, mint) {
  try { return Number((await getAccount(conn, ataOf(owner, mint), 'confirmed', TOKEN_2022_PROGRAM_ID)).amount); } catch { return 0; }
}

function curveConfig() {
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

async function buy(who, pool, sol, label) {
  const tx = await client.pool.swap2WithTransferHook({
    owner: who.publicKey, pool, swapBaseForQuote: false, swapMode: dbc.SwapMode.PartialFill,
    amountIn: new BN(Math.round(sol * LAMPORTS_PER_SOL)), minimumAmountOut: new BN(0), referralTokenAccount: null,
  });
  tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
  return send(label, tx, [who]);
}
async function sell(who, pool, rockUnits, label) {
  const tx = await client.pool.swap2WithTransferHook({
    owner: who.publicKey, pool, swapBaseForQuote: true, swapMode: dbc.SwapMode.ExactIn,
    amountIn: new BN(rockUnits), minimumAmountOut: new BN(0), referralTokenAccount: null,
  });
  tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
  return send(label, tx, [who]);
}

// ---------------------------------------------------------------------------
const payer = Keypair.generate(), A = Keypair.generate(), B = Keypair.generate(), C = Keypair.generate();
await Promise.all([fund(payer, 5000), fund(A, 100), fund(B, 100), fund(C, 100)]);
const mintKp = Keypair.generate(), configKp = Keypair.generate(), ledgerKp = Keypair.generate();
const mint = mintKp.publicKey;
const pool = dbc.deriveDbcPoolAddress(SOL, mint, configKp.publicKey);
const baseVault = dbc.deriveDbcTokenVaultAddress(pool, mint);
const [state] = PublicKey.findProgramAddressSync([Buffer.from('state'), mint.toBuffer()], HOOK);
const [extraMetas] = PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'), mint.toBuffer()], HOOK);
console.log(`mint ${mint}\npool ${pool}\nvault ${baseVault}\nstate ${state}\nledger ${ledgerKp.publicKey}`);

// 1. Hook set up before the pool exists.
{
  const rent = await conn.getMinimumBalanceForRentExemption(LEDGER_SIZE);
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: ledgerKp.publicKey, lamports: rent, space: LEDGER_SIZE, programId: HOOK }),
    new TransactionInstruction({
      programId: HOOK,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: state, isSigner: false, isWritable: true },
        { pubkey: ledgerKp.publicKey, isSigner: false, isWritable: true },
        { pubkey: extraMetas, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([ixDisc('initialize'), pool.toBuffer(), baseVault.toBuffer(), u64(0.1 * LAMPORTS_PER_SOL)]),
    }),
  );
  await send('initialize hook', tx, [payer, ledgerKp]);
  check(!!(await conn.getAccountInfo(extraMetas)), 'hook initialized before the pool');
}

// 2. DBC config + Token-2022 pool with our hook.
{
  const curve = curveConfig();
  const configTx = await client.partner.createConfigWithTransferHook({
    ...curve, config: configKp.publicKey, feeClaimer: payer.publicKey, leftoverReceiver: payer.publicKey,
    quoteMint: SOL, payer: payer.publicKey, transferHookProgram: HOOK,
  });
  await send('create config', configTx, [payer, configKp]);
  const poolTx = await client.creator.createPoolWithTransferHook({
    name: 'RockHook', symbol: 'ROCK', uri: 'https://rockhook.fun/test.json', poolCreator: payer.publicKey,
    baseMint: mint, config: configKp.publicKey, payer: payer.publicKey, transferHookProgram: HOOK,
  });
  await send('create pool', poolTx, [payer, mintKp]);
  const mintInfo = await getMint(conn, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const hook = getTransferHook(mintInfo);
  check(hook?.programId.equals(HOOK), `mint is Token-2022 with the RockHook hook (supply ${Number(mintInfo.supply) / 1e9})`);
}

// 3. The price offset the hook reads matches the SDK's decoding.
{
  const raw = (await conn.getAccountInfo(pool)).data;
  const onchain = raw.readBigUInt64LE(280) + (raw.readBigUInt64LE(288) << 64n);
  const p = await client.state.getPool(pool);
  const decoded = BigInt((p.poolState ?? p).sqrtPrice.toString());
  check(onchain === decoded, `sqrt_price at byte 280 matches the SDK (${decoded})`);
}

// 4. Trades.
const before = (await readLedger(ledgerKp.publicKey)).head;
await buy(A, pool, 1, 'A buys 1 SOL');
check(true, `A bought 1 SOL -> ${(await rockBalance(A.publicKey, mint)) / 1e9} ROCK`);
await buy(B, pool, 0.05, 'B buys 0.05 SOL');
check(true, `B bought 0.05 SOL (under the minimum) -> ${(await rockBalance(B.publicKey, mint)) / 1e9} ROCK`);
{
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(A.publicKey, ataOf(C.publicKey, mint), C.publicKey, mint, TOKEN_2022_PROGRAM_ID),
    await createTransferCheckedWithTransferHookInstruction(conn, ataOf(A.publicKey, mint), mint, ataOf(C.publicKey, mint), A.publicKey, BigInt(1e9), DECIMALS, [], 'confirmed', TOKEN_2022_PROGRAM_ID),
  );
  await send('A sends 1 ROCK to C', tx, [A]);
  check(true, 'A sent 1 ROCK to C (wallet to wallet)');
}
await sell(A, pool, 2e9, 'A sells 2 ROCK');
check(true, 'A sold 2 ROCK');

// 5. Calling the hook directly, outside a transfer, must fail.
{
  const execDisc = crypto.createHash('sha256').update('spl-transfer-hook-interface:execute').digest().subarray(0, 8);
  const ix = new TransactionInstruction({
    programId: HOOK,
    keys: [ataOf(A.publicKey, mint), mint, ataOf(C.publicKey, mint), A.publicKey, extraMetas, state, ledgerKp.publicKey, pool]
      .map((pubkey, i) => ({ pubkey, isSigner: false, isWritable: i === 6 })),
    data: Buffer.concat([execDisc, u64(123e9)]),
  });
  let rejected = false;
  try { await send('fake entry', new Transaction().add(ix), [A]); } catch (e) { rejected = /NotTransferring|0x1770/.test(e.message); if (!rejected) console.log(e.message); }
  check(rejected, 'a direct call to the hook is rejected (NotTransferring)');
}

// 6. Kill switch: paused hook records nothing and trades still work.
async function setPaused(paused) {
  const ix = new TransactionInstruction({
    programId: HOOK,
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }, { pubkey: state, isSigner: false, isWritable: true }],
    data: Buffer.concat([ixDisc('set_paused'), Buffer.from([paused ? 1 : 0])]),
  });
  await send(`set_paused ${paused}`, new Transaction().add(ix), [payer]);
}
await setPaused(true);
const headPaused = (await readLedger(ledgerKp.publicKey)).head;
await buy(C, pool, 0.5, 'C buys while paused');
check((await readLedger(ledgerKp.publicKey)).head === headPaused, 'paused: C bought 0.5 SOL and nothing was recorded');
await setPaused(false);

// 7. What the ledger holds.
{
  const { head, entries } = await readLedger(ledgerKp.publicKey);
  console.log(`\nledger head ${head}`);
  for (const e of entries.slice(before)) {
    console.log(`  #${e.seq} ${e.kind.padEnd(8)} ${e.amount.toFixed(4).padStart(9)} ROCK  value ${e.valueSol.toFixed(4)} SOL  from ${short(e.from)} to ${short(e.to)}`);
  }
  const kinds = entries.slice(before).map((e) => e.kind).join(',');
  check(kinds === 'BUY,TRANSFER,SELL', `recorded BUY (A), TRANSFER (A->C), SELL (A); skipped B's small buy [${kinds}]`);
  const buyEntry = entries[before];
  check(buyEntry.to.equals(A.publicKey) && buyEntry.valueSol > 0.9 && buyEntry.valueSol < 1.05, `buy credited to A's wallet, valued ${buyEntry.valueSol.toFixed(4)} SOL`);
  const tr = entries[before + 1];
  check(tr.from.equals(A.publicKey) && tr.to.equals(C.publicKey), 'transfer recorded from A to C');
}

// 8. Graduation: fill the curve, check the hook is removed, migrate, trade on DAMM v2.
{
  await buy(payer, pool, 1000, 'fill the curve');
  const vp = await client.state.getPool(pool);
  const cfg = await client.state.getPoolConfig(configKp.publicKey);
  const progress = Number((vp.poolState ?? vp).quoteReserve.toString()) / Number((cfg.config ?? cfg).migrationQuoteThreshold.toString());
  check(progress >= 0.999, `curve filled (progress ${(progress * 100).toFixed(2)}%)`);
  const hookAfter = getTransferHook(await getMint(conn, mint, 'confirmed', TOKEN_2022_PROGRAM_ID));
  check(!hookAfter || hookAfter.programId.equals(PublicKey.default), `hook removed from the mint after the last curve swap (now ${hookAfter?.programId})`);

  // On mainnet Meteora keeps the DBC pool authority funded; it pays for the
  // DAMM v2 pool accounts during migration. The local copy starts empty.
  await fund({ publicKey: dbc.deriveDbcPoolAuthority() }, 10);
  const dammConfig = dbc.DAMM_V2_MIGRATION_FEE_ADDRESS[dbc.MigrationFeeOption.Customizable];
  const { transaction, firstPositionNftKeypair, secondPositionNftKeypair } = await client.migration.migrateToDammV2({ payer: payer.publicKey, pool, dammConfig });
  await send('migrate to DAMM v2', transaction, [payer, firstPositionNftKeypair, secondPositionNftKeypair]);
  const dammPool = dbc.deriveDammV2PoolAddress(dammConfig, mint, SOL);
  check(!!(await conn.getAccountInfo(dammPool)), `migrated to DAMM v2 pool ${short(dammPool)}`);

  const cp = new CpAmm(conn);
  const ps = await cp.fetchPoolState(dammPool);
  const headBefore = (await readLedger(ledgerKp.publicKey)).head;
  const programOf = (m) => (m.equals(mint) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID);
  const swapTx = await cp.swap({
    payer: B.publicKey, pool: dammPool, inputTokenMint: SOL, outputTokenMint: mint,
    amountIn: new BN(0.5 * LAMPORTS_PER_SOL), minimumAmountOut: new BN(0),
    tokenAMint: ps.tokenAMint, tokenBMint: ps.tokenBMint, tokenAVault: ps.tokenAVault, tokenBVault: ps.tokenBVault,
    tokenAProgram: programOf(ps.tokenAMint), tokenBProgram: programOf(ps.tokenBMint), referralTokenAccount: null,
  });
  const bBefore = await rockBalance(B.publicKey, mint);
  await send('B buys on DAMM v2', swapTx, [B]);
  const got = (await rockBalance(B.publicKey, mint)) - bBefore;
  check(got > 0, `B bought 0.5 SOL on DAMM v2 -> ${(got / 1e9).toFixed(4)} ROCK`);
  check((await readLedger(ledgerKp.publicKey)).head === headBefore, 'after graduation the hook records nothing');
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
