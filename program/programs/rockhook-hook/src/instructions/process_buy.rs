use anchor_lang::prelude::*;

use crate::{constants::*, error::HookError, state::*};

/// Turns the next ledger entry, a buy, into a ticket. Anyone can call it: every
/// value comes from the ledger, and `wallet` must match the buyer.
#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct ProcessBuy<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(seeds = [STATE_SEED, state.mint.as_ref()], bump = state.bump, has_one = ledger)]
    pub state: Account<'info, HookState>,
    #[account(mut, seeds = [FORGE_SEED, state.mint.as_ref()], bump = forge.bump)]
    pub forge: Account<'info, Forge>,
    pub ledger: AccountLoader<'info, Ledger>,
    #[account(
        init_if_needed,
        payer = cranker,
        space = 8 + Holder::INIT_SPACE,
        seeds = [HOLDER_SEED, state.mint.as_ref(), wallet.as_ref()],
        bump,
    )]
    pub holder: Account<'info, Holder>,
    #[account(
        init,
        payer = cranker,
        space = 8 + Ticket::INIT_SPACE,
        seeds = [TICKET_SEED, state.mint.as_ref(), &forge.next_seq.to_le_bytes()],
        bump,
    )]
    pub ticket: Account<'info, Ticket>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<ProcessBuy>, wallet: Pubkey) -> Result<()> {
    let seq = ctx.accounts.forge.next_seq;
    let (buy, owner, amount, consumed) = {
        let ledger = ctx.accounts.ledger.load()?;
        let buy = ledger.entry(seq)?;
        require!(buy.kind == KIND_BUY, HookError::WrongEntryKind);
        if ctx.accounts.forge.is_router(&buy.to) {
            // The router bought for someone else: credit whoever it handed the tokens to.
            let handoff = handoff(&ledger, &buy).ok_or(HookError::RouterBuyWithoutHandoff)?;
            (buy, handoff.to, handoff.amount, 2)
        } else {
            (buy, buy.to, buy.amount, 1)
        }
    };
    require_keys_eq!(owner, wallet, HookError::WrongWallet);

    let holder = &mut ctx.accounts.holder;
    if holder.tickets == 0 {
        holder.wallet = wallet;
        holder.bump = ctx.bumps.holder;
    }
    holder.tickets += 1;
    holder.total_bought += amount;
    holder.lit_weight += amount;
    if amount > holder.biggest_buy_amount {
        holder.biggest_buy_amount = amount;
        holder.biggest_buy_seq = seq;
    }

    let forge = &mut ctx.accounts.forge;
    forge.tickets += 1;
    forge.total_weight += amount;
    forge.lit_weight += amount;
    forge.rank(wallet, holder.total_bought);
    forge.last_buy_seq = seq;
    forge.last_buy_wallet = wallet;

    let ticket = &mut ctx.accounts.ticket;
    ticket.wallet = wallet;
    ticket.seq = seq;
    ticket.slot = buy.slot;
    ticket.amount = amount;
    ticket.value_lamports = buy.value_lamports;
    ticket.number = forge.tickets;
    ticket.tier = forge.tier_for(amount);
    ticket.minted = false;
    ticket.ashed = false;
    ticket.supernova = false;
    ticket.bump = ctx.bumps.ticket;

    forge.next_seq = seq + consumed;
    Ok(())
}
