use anchor_lang::prelude::*;

use crate::{constants::*, error::HookError, state::*};

/// Turns the next buy into a ticket, once every sell and send recorded before
/// it is processed. Anyone can call it: every value comes from the ledger, and
/// `wallet` and `seq` must match the buy.
#[derive(Accounts)]
#[instruction(wallet: Pubkey, seq: u64)]
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
        seeds = [TICKET_SEED, state.mint.as_ref(), &seq.to_le_bytes()],
        bump,
    )]
    pub ticket: Account<'info, Ticket>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<ProcessBuy>, wallet: Pubkey, seq: u64) -> Result<()> {
    let index = ctx.accounts.forge.next_buy;
    let (buy, owner, amount, consumed) = {
        let ledger = ctx.accounts.ledger.load()?;
        let buy = ledger.buy(index)?;
        if let Some(out_seq) = ledger.out_seq(ctx.accounts.forge.next_out)? {
            require!(out_seq > buy.seq, HookError::WrongEntryKind);
        }
        match buy.kind {
            KIND_BUY => (buy, buy.to, buy.amount, 1),
            KIND_ROUTER_BUY => {
                // The router bought for someone else: credit whoever it handed the tokens to.
                let handoff = handoff(&ledger, index, &buy).ok_or(HookError::RouterBuyWithoutHandoff)?;
                (buy, handoff.to, handoff.amount, 2)
            }
            _ => return err!(HookError::WrongEntryKind),
        }
    };
    require_eq!(buy.seq, seq, HookError::WrongSeq);
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

    forge.next_buy = index + consumed;
    Ok(())
}
