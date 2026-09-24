/**
 * Launches RockHook ($ROCK) on Meteora DBC (Dynamic Bonding Curve), paired with SOL.
 *
 * Supply of exactly 1 token with 9 decimals (1,000,000,000 base units). Trading
 * opens at a $10k market cap and the curve graduates to a DAMM v2 pool at $200k;
 * 3% trading fee on the bonding curve, 4% on the DAMM v2 pool after migration;
 * the standard curve shape (no extra weight). USD targets are converted to SOL
 * at launch time — after that the curve is fixed in SOL. The LP created at
 * migration is 100% permanently locked; its fees go to the fee claimer.
 *
 * The token image is read from token-image/ (put exactly one image there).
 *
 * .env (next to this file):
 *   LAUNCH_KEYPAIR  wallet that pays for and creates the launch: path to a
 *                   keypair .json file, or its secret key (base58 or [1,2,...])
 *   RPC_URL         mainnet RPC
 *   PINATA_JWT      used to pin the image + metadata JSON to IPFS
 *
 * Usage (inside launch/):
 *   npm run launch             dry run: prints the numbers and simulates, sends nothing
 *   npm run launch -- --send   uploads the metadata and launches for real
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import bs58 from 'bs58';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SendTransactionError,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  DammV2DynamicFeeMode,
  DynamicBondingCurveClient,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  Rounding,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  buildCurveWithLiquidityWeights,
  convertToLamports,
  deriveDbcPoolAddress,
  getDeltaAmountQuoteUnsigned,
  getSqrtPriceFromMarketCap,
  type ConfigParameters,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { parseSecretKey } from './keys';
import { fetchSolPriceUsd } from './sol-price';

// =============================================================================
//  TOKEN
// =============================================================================
const TOKEN = {
  name: 'RockHook', // max 32 characters
  ticker: 'ROCK', // max 10 characters, without the $
  // png/jpg/gif/webp: a folder holding exactly one image, a file path, or an https:// image link
  image: 'token-image',
  description: '', // optional
  website: 'https://rockhook.fun', // optional
  twitter: '', // optional, e.g. 'https://x.com/rockhook'
  telegram: '', // optional
};

// =============================================================================
//  LAUNCH SETTINGS
// =============================================================================
const LAUNCH = {
  startMarketCapUsd: 10_000, // market cap when trading opens
  migrationMarketCapUsd: 200_000, // market cap at which the curve graduates to DAMM v2
  bondingCurveFeePct: 3, // trading fee on the bonding curve (Meteora keeps 20% of it)
  postMigrationFeePct: 4, // trading fee on the DAMM v2 pool after migration (0.1% to 10%)
  devBuySol: 0, // optional first buy, in the same transaction that creates the pool
  totalSupply: 1, // exactly one token...
  decimals: TokenDecimal.NINE, // ...split into 1,000,000,000 base units
  mutableMetadata: false, // false = name/ticker/image can never be changed (recommended)
  feeClaimer: '', // wallet that claims the fees and owns the locked LP (empty = launch wallet)
  solPriceUsd: 0, // 0 = live price; set a number to override
  priorityFeeMicroLamports: 200_000,
};

// =============================================================================

const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
// The curve builder needs a little slack for rounding: 0.00001% of the supply,
// but never under 10,000 base units, or a tiny supply fails the build. Whatever
// is left is claimable by the fee claimer after migration.
const LEFTOVER_TOKENS = Math.max(LAUNCH.totalSupply / 10_000_000, 10_000 / 10 ** LAUNCH.decimals);
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
const MAX_TX_BYTES = 1232;
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const SEND = process.argv.includes('--send');

const bps = (pct: number) => Math.round(pct * 100);
const toSol = (lamports: { toString(): string }) => Number(lamports.toString()) / LAMPORTS_PER_SOL;
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const isUrl = (s: string) => /^https?:\/\//i.test(s);

// ----- Curve ------------------------------------------------------------------

/**
 * The standard curve: 16 segments with equal liquidity. It is the same curve
 * buildCurveWithMarketCap produces, but that builder's rounding check fails
 * on a supply this small.
 */
function buildCurve(startMcSol: number, migrationMcSol: number): ConfigParameters {
  return buildCurveWithLiquidityWeights({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: LAUNCH.decimals,
      tokenQuoteDecimal: TokenDecimal.NINE,
      tokenAuthorityOption: LAUNCH.mutableMetadata
        ? TokenAuthorityOption.CreatorUpdateAuthority
        : TokenAuthorityOption.Immutable,
      totalTokenSupply: LAUNCH.totalSupply,
      leftover: LEFTOVER_TOKENS,
    },
    fee: {
      // Same starting and ending fee = a flat fee for the whole bonding curve.
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: bps(LAUNCH.bondingCurveFeePct),
          endingFeeBps: bps(LAUNCH.bondingCurveFeePct),
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Disabled,
        poolFeeBps: bps(LAUNCH.postMigrationFeePct),
      },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 100,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    initialMarketCap: startMcSol,
    migrationMarketCap: migrationMcSol,
    liquidityWeights: Array(16).fill(1),
  });
}

/** SOL (after the trading fee) that must enter the curve to push the market cap to `mcSol`. */
function solToReach(curve: ConfigParameters, mcSol: number): number {
  const target = getSqrtPriceFromMarketCap(mcSol, LAUNCH.totalSupply, LAUNCH.decimals, TokenDecimal.NINE);
  let lower = curve.sqrtStartPrice;
  let lamports = 0;
  for (const { sqrtPrice, liquidity } of curve.curve) {
    const upper = sqrtPrice.lt(target) ? sqrtPrice : target;
    if (upper.gt(lower)) {
      lamports += Number(getDeltaAmountQuoteUnsigned(lower, upper, liquidity, Rounding.Up).toString());
    }
    if (!sqrtPrice.lt(target)) break;
    lower = sqrtPrice;
  }
  return lamports / LAMPORTS_PER_SOL;
}

// ----- Token + metadata ---------------------------------------------------------

/** TOKEN.image as a link or an image file path; a folder must hold exactly one image. */
function resolveImage(): { image?: string; problem?: string } {
  const { image } = TOKEN;
  if (!image) return { problem: 'TOKEN.image is empty' };
  if (isUrl(image)) return { image };
  if (!fs.existsSync(image)) return { problem: `image not found: ${image}` };
  if (fs.statSync(image).isDirectory()) {
    const images = fs.readdirSync(image).filter((file) => IMAGE_TYPES[path.extname(file).toLowerCase()]);
    if (images.length !== 1) {
      return { problem: `put exactly one .png, .jpg, .jpeg, .gif or .webp image in ${image}/ (found ${images.length})` };
    }
    return { image: path.join(image, images[0]) };
  }
  if (!IMAGE_TYPES[path.extname(image).toLowerCase()]) {
    return { problem: 'TOKEN.image must be a .png, .jpg, .jpeg, .gif or .webp file' };
  }
  return { image };
}

function settingsProblems(): string[] {
  const problems: string[] = [];
  if (!TOKEN.name.trim()) problems.push('TOKEN.name is empty');
  else if (Buffer.byteLength(TOKEN.name) > 32) problems.push('TOKEN.name is longer than 32 characters');
  if (!TOKEN.ticker.trim()) problems.push('TOKEN.ticker is empty');
  else if (TOKEN.ticker.startsWith('$')) problems.push('TOKEN.ticker must not start with $');
  else if (Buffer.byteLength(TOKEN.ticker) > 10) problems.push('TOKEN.ticker is longer than 10 characters');
  const { problem } = resolveImage();
  if (problem) problems.push(problem);
  if (LAUNCH.bondingCurveFeePct < 0.25 || LAUNCH.bondingCurveFeePct > 99) {
    problems.push('bondingCurveFeePct must be between 0.25 and 99');
  }
  if (LAUNCH.postMigrationFeePct < 0.1 || LAUNCH.postMigrationFeePct > 10) {
    problems.push('postMigrationFeePct must be between 0.1 and 10');
  }
  return problems;
}

async function pinata(endpoint: string, body: FormData | string, contentType?: string): Promise<string> {
  const res = await fetch(`https://api.pinata.cloud/pinning/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PINATA_JWT}`,
      ...(contentType ? { 'Content-Type': contentType } : {}),
    },
    body,
  });
  if (!res.ok) throw new Error(`Pinata upload failed: ${res.status} ${await res.text()}`);
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return IPFS_GATEWAY + IpfsHash;
}

/** Pins the image (unless it is already a link) and the metadata JSON; returns the metadata URI. */
async function uploadMetadata(): Promise<string> {
  if (!process.env.PINATA_JWT) throw new Error('Set PINATA_JWT in .env to upload the image and metadata.');
  let { image } = resolveImage();
  if (!image) throw new Error('TOKEN.image is not usable; see the dry run.');
  if (!isUrl(image)) {
    console.log('Uploading the image to IPFS...');
    const form = new FormData();
    const type = IMAGE_TYPES[path.extname(image).toLowerCase()];
    form.append('file', new Blob([new Uint8Array(fs.readFileSync(image))], { type }), path.basename(image));
    image = await pinata('pinFileToIPFS', form);
  }
  const links = Object.entries({ website: TOKEN.website, twitter: TOKEN.twitter, telegram: TOKEN.telegram })
    .filter(([, value]) => value);
  const metadata = {
    name: TOKEN.name,
    symbol: TOKEN.ticker,
    description: TOKEN.description,
    image,
    showName: true,
    ...Object.fromEntries(links),
    ...(TOKEN.website ? { external_url: TOKEN.website } : {}),
  };
  console.log('Uploading the metadata to IPFS...');
  return pinata(
    'pinJSONToIPFS',
    JSON.stringify({ pinataContent: metadata, pinataMetadata: { name: `${TOKEN.ticker} metadata` } }),
    'application/json',
  );
}

// ----- Transactions -------------------------------------------------------------

function loadWallet(): Keypair | null {
  const value = process.env.LAUNCH_KEYPAIR?.trim();
  if (!value) return null;
  const secret = fs.existsSync(value) ? fs.readFileSync(value, 'utf8') : value;
  return Keypair.fromSecretKey(parseSecretKey(secret));
}

function withComputeBudget(tx: Transaction, units: number, payer: PublicKey): Transaction {
  const out = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: LAUNCH.priorityFeeMicroLamports }),
    ...tx.instructions,
  );
  out.feePayer = payer;
  return out;
}

/** Simulates without signatures and returns the compute units used. */
async function simulate(connection: Connection, tx: Transaction, payer: PublicKey): Promise<number> {
  const probe = withComputeBudget(tx, 1_400_000, payer);
  probe.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const size = probe.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  if (size > MAX_TX_BYTES) throw new Error(`Transaction too large (${size} > ${MAX_TX_BYTES} bytes)`);
  const { value } = await connection.simulateTransaction(new VersionedTransaction(probe.compileMessage()), {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  if (value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(value.err)}\n${(value.logs ?? []).slice(-15).join('\n')}`);
  }
  return value.unitsConsumed ?? 200_000;
}

/**
 * Sends and confirms, retrying when the blockhash expires. `created` is an
 * account the transaction creates: if it exists, the transaction landed even
 * when its confirmation was missed.
 */
async function sendTx(
  connection: Connection,
  label: string,
  tx: Transaction,
  signers: Keypair[],
  created: PublicKey,
): Promise<string> {
  const units = await simulate(connection, tx, signers[0].publicKey);
  const final = withComputeBudget(tx, Math.ceil(units * 1.2) + 10_000, signers[0].publicKey);
  for (let attempt = 1; ; attempt++) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    final.recentBlockhash = blockhash;
    final.sign(...signers);
    const signature = bs58.encode(final.signature!);
    try {
      await connection.sendRawTransaction(final.serialize());
      const { value } = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      if (value.err) throw new Error(`${label} transaction failed: ${JSON.stringify(value.err)} (${signature})`);
      return signature;
    } catch (err) {
      if (await connection.getAccountInfo(created, 'confirmed')) return signature;
      // A rejected preflight simulation would fail again the same way.
      if (err instanceof SendTransactionError || attempt === 3) throw err;
      console.log(`  ${label}: not confirmed (${(err as Error).message}), retrying...`);
    }
  }
}

// ----- Main ---------------------------------------------------------------------

async function main() {
  const connection = new Connection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  const client = new DynamicBondingCurveClient(connection, 'confirmed');
  const wallet = loadWallet();

  const { price, source } =
    LAUNCH.solPriceUsd > 0
      ? { price: LAUNCH.solPriceUsd, source: 'manual' }
      : await fetchSolPriceUsd().catch((err: Error) => {
          throw new Error(`${err.message} Set LAUNCH.solPriceUsd manually.`);
        });
  const startMcSol = LAUNCH.startMarketCapUsd / price;
  const migrationMcSol = LAUNCH.migrationMarketCapUsd / price;
  const curve = buildCurve(startMcSol, migrationMcSol);
  const migrationSol = toSol(curve.migrationQuoteThreshold);
  const migratedPct = (migrationSol / migrationMcSol) * 100;
  const spendFactor = 100 / (100 - LAUNCH.bondingCurveFeePct);

  console.log(SEND ? '\n=== DBC LAUNCH ===' : '\n=== DBC launch — DRY RUN (nothing is sent; add --send to launch) ===');
  console.log(`Token          ${TOKEN.name} ($${TOKEN.ticker}) — ${LAUNCH.totalSupply.toLocaleString('en-US')} supply (${LAUNCH.decimals} decimals), ${LAUNCH.mutableMetadata ? 'mutable' : 'immutable'} metadata`);
  console.log(`Image          ${resolveImage().image ?? '(missing)'}`);
  console.log(`SOL price      $${price.toFixed(2)} (${source})`);
  console.log(`Start MC       ${usd(LAUNCH.startMarketCapUsd)} = ${startMcSol.toFixed(2)} SOL`);
  console.log(`Migration MC   ${usd(LAUNCH.migrationMarketCapUsd)} = ${migrationMcSol.toFixed(2)} SOL -> Meteora DAMM v2, LP 100% locked`);
  console.log(`Fees           ${LAUNCH.bondingCurveFeePct}% on the bonding curve, ${LAUNCH.postMigrationFeePct}% after migration`);
  console.log(`Curve          standard: ${migrationSol.toFixed(2)} SOL (${usd(migrationSol * price)}) must enter the curve to migrate`);
  console.log(`Supply         ${(100 - migratedPct).toFixed(1)}% sold on the curve, ${migratedPct.toFixed(1)}% seeded into the DAMM v2 pool`);

  console.log(`\nSOL that must enter the curve to reach each market cap (buyers spend ~${spendFactor.toFixed(2)}x that, the rest is the fee):`);
  console.log(`  ${'market cap'.padStart(10)}${'SOL in'.padStart(12)}`);
  for (let i = 1; i <= 6; i++) {
    const mcUsd = (LAUNCH.migrationMarketCapUsd * i) / 6;
    if (mcUsd <= LAUNCH.startMarketCapUsd) continue;
    // Just below the migration price, so rounding never lands past the curve's end.
    const mcSol = (i === 6 ? mcUsd * 0.99999 : mcUsd) / price;
    console.log(`  ${usd(mcUsd).padStart(10)}${solToReach(curve, mcSol).toFixed(2).padStart(12)}`);
  }

  const problems = settingsProblems();
  if (problems.length > 0) {
    if (SEND) throw new Error(`Fix these first:\n- ${problems.join('\n- ')}`);
    console.log(`\nStill to fill in before --send:\n- ${problems.join('\n- ')}`);
  }
  if (!wallet) {
    if (SEND) throw new Error('Set LAUNCH_KEYPAIR in .env (keypair file path or secret key).');
    console.log('\nSet LAUNCH_KEYPAIR in .env to simulate the launch transactions.');
    return;
  }

  const balance = (await connection.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL;
  const feeClaimer = LAUNCH.feeClaimer ? new PublicKey(LAUNCH.feeClaimer) : wallet.publicKey;
  console.log(`\nWallet         ${wallet.publicKey.toBase58()} (${balance.toFixed(4)} SOL)`);
  console.log(`Fee claimer    ${feeClaimer.toBase58()}`);
  if (LAUNCH.devBuySol > 0) console.log(`Dev buy        ${LAUNCH.devBuySol} SOL`);
  const needed = LAUNCH.devBuySol + 0.05;
  if (balance < needed) {
    const message = `The wallet needs at least ~${needed} SOL (rent + fees + dev buy).`;
    if (SEND) throw new Error(message);
    console.log(`\n${message} Fund it and run again to simulate.`);
    return;
  }

  const configKeypair = Keypair.generate();
  const mintKeypair = Keypair.generate();
  const pool = deriveDbcPoolAddress(SOL_MINT, mintKeypair.publicKey, configKeypair.publicKey);
  const uri = SEND ? await uploadMetadata() : `${IPFS_GATEWAY}${'x'.repeat(59)}`;

  const { createConfigTx, createPoolWithFirstBuyTx } = await client.partner.createConfigAndPoolWithFirstBuy({
    ...curve,
    config: configKeypair.publicKey,
    feeClaimer,
    leftoverReceiver: feeClaimer,
    quoteMint: SOL_MINT,
    payer: wallet.publicKey,
    preCreatePoolParam: {
      name: TOKEN.name,
      symbol: TOKEN.ticker,
      uri,
      poolCreator: wallet.publicKey,
      baseMint: mintKeypair.publicKey,
    },
    firstBuyParam:
      LAUNCH.devBuySol > 0
        ? {
            buyer: wallet.publicKey,
            buyAmount: convertToLamports(LAUNCH.devBuySol, TokenDecimal.NINE),
            // Same transaction as the pool creation, so nobody can trade before it.
            minimumAmountOut: convertToLamports(0, LAUNCH.decimals),
            referralTokenAccount: null,
          }
        : undefined,
  });

  if (!SEND) {
    const units = await simulate(connection, createConfigTx, wallet.publicKey);
    console.log(`\nConfig transaction simulated OK (${units.toLocaleString('en-US')} compute units).`);
    console.log('The token/pool transaction can only be simulated once the config exists on-chain.');
    console.log('Dry run finished. Run with --send to launch.');
    return;
  }

  console.log(`\nCreating the curve config ${configKeypair.publicKey.toBase58()}...`);
  const configSig = await sendTx(connection, 'config', createConfigTx, [wallet, configKeypair], configKeypair.publicKey);
  console.log(`  ${configSig}`);
  console.log('Creating the token and its pool...');
  const poolSig = await sendTx(connection, 'pool', createPoolWithFirstBuyTx, [wallet, mintKeypair], pool);
  console.log(`  ${poolSig}`);

  const mint = mintKeypair.publicKey.toBase58();
  const record = {
    name: TOKEN.name,
    ticker: TOKEN.ticker,
    mint,
    pool: pool.toBase58(),
    config: configKeypair.publicKey.toBase58(),
    feeClaimer: feeClaimer.toBase58(),
    metadataUri: uri,
    launchedAt: new Date().toISOString(),
    solPriceUsd: price,
    startMarketCapSol: startMcSol,
    migrationMarketCapSol: migrationMcSol,
    migrationThresholdSol: migrationSol,
    launch: LAUNCH,
    transactions: { config: configSig, pool: poolSig },
  };
  const recordFile = path.join('launches', `${mint}.json`);
  fs.mkdirSync(path.dirname(recordFile), { recursive: true });
  fs.writeFileSync(recordFile, JSON.stringify(record, null, 2));

  const cluster = connection.rpcEndpoint.includes('devnet') ? '?cluster=devnet' : '';
  const spent = balance - (await connection.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL;
  console.log('\n========================================');
  console.log('TOKEN LAUNCHED');
  console.log(`Mint         ${mint}`);
  console.log(`DBC pool     ${pool.toBase58()}`);
  console.log(`Config       ${configKeypair.publicKey.toBase58()}`);
  console.log(`Solscan      https://solscan.io/token/${mint}${cluster}`);
  console.log(`Jupiter      https://jup.ag/tokens/${mint}`);
  console.log(`DexScreener  https://dexscreener.com/solana/${mint}`);
  console.log(`SOL spent    ${spent.toFixed(4)} (rent + fees${LAUNCH.devBuySol > 0 ? ' + dev buy' : ''})`);
  console.log(`Saved to     ${recordFile}`);
  console.log('========================================');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
