use anchor_lang::prelude::*;

use crate::{constants::*, error::HookError, state::*};

/// Accounts in the order Token-2022 passes them to a transfer hook, followed
/// by the extra accounts from the list written in `initialize`.
#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// CHECK: source token account; checked below to be mid-transfer.
    pub source_token: UncheckedAccount<'info>,
    /// CHECK: the $ROCK mint, matched against the state.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: destination token account.
    pub destination_token: UncheckedAccount<'info>,
    /// CHECK: authority of the source account.
    pub owner: UncheckedAccount<'info>,
    /// CHECK: this mint's extra-account list.
    #[account(seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    #[account(
        seeds = [STATE_SEED, mint.key().as_ref()],
        bump = state.bump,
        has_one = mint,
        has_one = ledger,
    )]
    pub state: Account<'info, HookState>,
    #[account(mut)]
    pub ledger: AccountLoader<'info, Ledger>,
    /// CHECK: the DBC virtual pool, read for the price.
    #[account(address = state.dbc_pool)]
    pub dbc_pool: UncheckedAccount<'info>,
}

pub(crate) fn handler(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
    // Anyone can call this instruction directly; only a real Token-2022
    // transfer sets the `transferring` flag on the source account.
    require!(is_transferring(&ctx.accounts.source_token)?, HookError::NotTransferring);

    let state = &ctx.accounts.state;
    if state.paused {
        return Ok(());
    }

    let from = token_owner(&ctx.accounts.source_token)?;
    let to = token_owner(&ctx.accounts.destination_token)?;
    let buy = |kind, value_lamports| -> Result<Entry> {
        Ok(Entry { seq: 0, slot: Clock::get()?.slot, amount, value_lamports, from, to, kind, padding: [0; 7] })
    };
    let mut ledger = ctx.accounts.ledger.load_mut()?;
    if ctx.accounts.source_token.key() == state.base_vault {
        let value = value_in_lamports(&ctx.accounts.dbc_pool, amount).unwrap_or(0);
        if value < state.min_buy_lamports {
            return Ok(());
        }
        let kind = if state.is_router(&to) { KIND_ROUTER_BUY } else { KIND_BUY };
        ledger.push_buy(buy(kind, value)?);
    } else if ctx.accounts.destination_token.key() == state.base_vault {
        ledger.push_out(from, KIND_SELL);
    } else if state.is_router(&from) {
        ledger.push_buy(buy(KIND_HANDOFF, 0)?);
    } else {
        ledger.push_out(from, KIND_TRANSFER);
    }
    Ok(())
}

/// Owner field of an SPL / Token-2022 token account.
fn token_owner(account: &AccountInfo) -> Result<Pubkey> {
    let data = account.try_borrow_data()?;
    require!(data.len() >= TOKEN_ACCOUNT_BASE_LEN, HookError::InvalidTokenAccount);
    let bytes: [u8; 32] = data[TOKEN_ACCOUNT_OWNER_OFFSET..TOKEN_ACCOUNT_OWNER_OFFSET + 32]
        .try_into()
        .unwrap();
    Ok(Pubkey::new_from_array(bytes))
}

/// Reads the `transferring` flag of the TransferHookAccount extension.
fn is_transferring(account: &AccountInfo) -> Result<bool> {
    let data = account.try_borrow_data()?;
    // Extensions start after the base account and the account-type byte.
    let mut i = TOKEN_ACCOUNT_BASE_LEN + 1;
    while i + 4 <= data.len() {
        let kind = u16::from_le_bytes([data[i], data[i + 1]]);
        let len = u16::from_le_bytes([data[i + 2], data[i + 3]]) as usize;
        if kind == EXT_TRANSFER_HOOK_ACCOUNT {
            return Ok(len >= 1 && i + 4 < data.len() && data[i + 4] == 1);
        }
        if kind == 0 {
            break;
        }
        i += 4 + len;
    }
    Ok(false)
}

/// `amount` base units valued at the curve's current price, in lamports.
/// `None` if the pool can't be read, which records the buy as worth nothing.
fn value_in_lamports(pool: &AccountInfo, amount: u64) -> Option<u64> {
    if pool.owner != &DBC_PROGRAM_ID {
        return None;
    }
    let data = pool.try_borrow_data().ok()?;
    let raw = data.get(POOL_SQRT_PRICE_OFFSET..POOL_SQRT_PRICE_OFFSET + 16)?;
    let sqrt_price = u128::from_le_bytes(raw.try_into().ok()?);
    // price = sqrt_price^2 / 2^128 lamports per base unit; split the shifts
    // so the products stay inside u128.
    let half = (amount as u128).checked_mul(sqrt_price)? >> 64;
    let value = half.checked_mul(sqrt_price)? >> 64;
    Some(value.min(u64::MAX as u128) as u64)
}
