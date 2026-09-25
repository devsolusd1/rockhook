use anchor_lang::prelude::*;

use crate::{constants::*, error::HookError, state::*};

/// Processes the next sells and sends, in order, while they come before the
/// next buy: each one burns out every ticket its wallet holds so far. Pass each
/// sender's holder account (writable) in `remaining_accounts`, once per wallet;
/// it doesn't have to exist. Anyone can call it.
#[derive(Accounts)]
pub struct ProcessOuts<'info> {
    #[account(seeds = [STATE_SEED, state.mint.as_ref()], bump = state.bump, has_one = ledger)]
    pub state: Account<'info, HookState>,
    #[account(mut, seeds = [FORGE_SEED, state.mint.as_ref()], bump = forge.bump)]
    pub forge: Account<'info, Forge>,
    pub ledger: AccountLoader<'info, Ledger>,
}

/// `holders[i]`: position in `remaining_accounts` of the holder of the i-th entry's sender.
pub(crate) fn handler<'info>(ctx: Context<'info, ProcessOuts<'info>>, holders: Vec<u8>) -> Result<()> {
    require!(!holders.is_empty(), HookError::NothingToProcess);
    let mint = ctx.accounts.state.mint;
    let accounts = ctx.remaining_accounts;
    let ledger = ctx.accounts.ledger.load()?;
    let forge = &mut ctx.accounts.forge;
    let next_buy_seq = ledger.buy_seq(forge.next_buy)?;

    // Per account: the wallet it was checked against, and its holder if one exists.
    let mut checked: Vec<Option<(Pubkey, Option<Holder>)>> = accounts.iter().map(|_| None).collect();
    for &position in &holders {
        let out = ledger.out(forge.next_out)?;
        if let Some(buy_seq) = next_buy_seq {
            require!(out.seq < buy_seq, HookError::WrongEntryKind);
        }
        let position = position as usize;
        let info = accounts.get(position).ok_or(HookError::WrongHolder)?;
        let slot = &mut checked[position];
        match slot {
            Some((wallet, _)) => require_keys_eq!(*wallet, out.from, HookError::WrongHolder),
            None => *slot = Some((out.from, load_holder(info, &mint, &out.from)?)),
        }
        if let Some((_, Some(holder))) = slot {
            forge.lit_weight = forge.lit_weight.saturating_sub(holder.lit_weight);
            holder.lit_weight = 0;
            holder.burn_before_seq = out.seq + 1;
        }
        forge.next_out += 1;
    }

    for (info, slot) in accounts.iter().zip(checked) {
        if let Some((_, Some(holder))) = slot {
            holder.try_serialize(&mut &mut info.try_borrow_mut_data()?[..])?;
        }
    }
    Ok(())
}

/// The holder of `wallet` if `info` is it, or `None` if `info` is that wallet's
/// holder address with nothing there yet (the wallet never got a ticket).
fn load_holder(info: &AccountInfo, mint: &Pubkey, wallet: &Pubkey) -> Result<Option<Holder>> {
    if info.owner == &crate::ID && !info.data_is_empty() {
        let holder = Holder::try_deserialize(&mut &info.try_borrow_data()?[..])?;
        let key = Pubkey::create_program_address(&[HOLDER_SEED, mint.as_ref(), wallet.as_ref(), &[holder.bump]], &crate::ID)
            .map_err(|_| HookError::WrongHolder)?;
        require!(key == info.key() && holder.wallet == *wallet, HookError::WrongHolder);
        Ok(Some(holder))
    } else {
        let (key, _) = Pubkey::find_program_address(&[HOLDER_SEED, mint.as_ref(), wallet.as_ref()], &crate::ID);
        require_keys_eq!(key, info.key(), HookError::WrongHolder);
        Ok(None)
    }
}
