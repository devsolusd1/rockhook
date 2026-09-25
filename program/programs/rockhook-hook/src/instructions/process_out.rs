use anchor_lang::prelude::*;

use crate::{constants::*, error::HookError, state::*};

/// Processes the next ledger entry, a sell or a send out of `wallet`: every
/// ticket that wallet holds so far burns out. Anyone can call it.
#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct ProcessOut<'info> {
    #[account(seeds = [STATE_SEED, state.mint.as_ref()], bump = state.bump, has_one = ledger)]
    pub state: Account<'info, HookState>,
    #[account(mut, seeds = [FORGE_SEED, state.mint.as_ref()], bump = forge.bump)]
    pub forge: Account<'info, Forge>,
    pub ledger: AccountLoader<'info, Ledger>,
    /// CHECK: the wallet's holder; it doesn't exist if the wallet never got a ticket.
    #[account(mut, seeds = [HOLDER_SEED, state.mint.as_ref(), wallet.as_ref()], bump)]
    pub holder: UncheckedAccount<'info>,
}

pub(crate) fn handler(ctx: Context<ProcessOut>, wallet: Pubkey) -> Result<()> {
    let seq = ctx.accounts.forge.next_seq;
    let entry = ctx.accounts.ledger.load()?.entry(seq)?;
    require!(entry.kind == KIND_SELL || entry.kind == KIND_TRANSFER, HookError::WrongEntryKind);
    require_keys_eq!(entry.from, wallet, HookError::WrongWallet);

    let info = ctx.accounts.holder.to_account_info();
    if !info.data_is_empty() && info.owner == &crate::ID {
        let mut holder = Holder::try_deserialize(&mut &info.try_borrow_data()?[..])?;
        let forge = &mut ctx.accounts.forge;
        forge.lit_weight = forge.lit_weight.saturating_sub(holder.lit_weight);
        holder.lit_weight = 0;
        holder.burn_before_seq = seq + 1;
        holder.try_serialize(&mut &mut info.try_borrow_mut_data()?[..])?;
    }
    ctx.accounts.forge.next_seq = seq + 1;
    Ok(())
}
