use anchor_lang::prelude::*;

use crate::{constants::*, error::HookError, state::*};

/// Freezes the results once the curve graduated: Meteora removes the hook from
/// the mint with the last curve swap, and every ledger entry must be processed.
/// Anyone can call it.
#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(seeds = [STATE_SEED, state.mint.as_ref()], bump = state.bump, has_one = ledger)]
    pub state: Account<'info, HookState>,
    #[account(seeds = [FORGE_SEED, state.mint.as_ref()], bump = forge.bump)]
    pub forge: Account<'info, Forge>,
    pub ledger: AccountLoader<'info, Ledger>,
    #[account(mut, seeds = [ROCKIES_SEED, state.mint.as_ref()], bump = rockies.bump)]
    pub rockies: Account<'info, Rockies>,
    /// CHECK: the $ROCK mint, read for its transfer-hook extension.
    #[account(address = state.mint)]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: holder of the biggest buyer (absent when there were no tickets).
    #[account(seeds = [HOLDER_SEED, state.mint.as_ref(), forge.biggest_wallet.as_ref()], bump)]
    pub biggest_holder: UncheckedAccount<'info>,
    /// CHECK: holder of the runner-up (absent when there is none).
    #[account(seeds = [HOLDER_SEED, state.mint.as_ref(), forge.second_wallet.as_ref()], bump)]
    pub second_holder: UncheckedAccount<'info>,
    /// CHECK: the biggest-buyer Supernova's ticket (the biggest buyer's, or the
    /// runner-up's); checked in the handler.
    pub biggest_ticket: UncheckedAccount<'info>,
    /// CHECK: holder of the wallet behind the filling buy.
    #[account(seeds = [HOLDER_SEED, state.mint.as_ref(), forge.last_buy_wallet.as_ref()], bump)]
    pub last_holder: UncheckedAccount<'info>,
    /// CHECK: the filling buy's ticket.
    #[account(seeds = [TICKET_SEED, state.mint.as_ref(), &forge.last_buy_seq.to_le_bytes()], bump)]
    pub last_ticket: UncheckedAccount<'info>,
}

pub(crate) fn handler(ctx: Context<Finalize>) -> Result<()> {
    require!(!ctx.accounts.rockies.graduated, HookError::AlreadyFinalized);
    require!(hook_removed(&ctx.accounts.mint)?, HookError::NotGraduated);
    let forge = &ctx.accounts.forge;
    require!(forge.caught_up(&*ctx.accounts.ledger.load()?), HookError::CrankBehind);

    let rockies = &mut ctx.accounts.rockies;
    rockies.graduated = true;
    rockies.has_tickets = forge.tickets > 0;
    rockies.lit_snapshot = forge.lit_weight;
    rockies.draw_weight = forge.lit_weight;
    rockies.last_buy_seq = forge.last_buy_seq;
    if rockies.has_tickets {
        let mut biggest_holder = read::<Holder>(&ctx.accounts.biggest_holder)?;
        // One Rocky can't carry two Supernovas: if the biggest buyer's biggest buy
        // also filled the curve, the biggest-buyer Supernova goes to the runner-up.
        if biggest_holder.biggest_buy_seq == forge.last_buy_seq && forge.second_wallet != Pubkey::default() {
            biggest_holder = read::<Holder>(&ctx.accounts.second_holder)?;
        }
        rockies.biggest_buy_seq = biggest_holder.biggest_buy_seq;
        let expected = Pubkey::find_program_address(
            &[TICKET_SEED, rockies.mint.as_ref(), &rockies.biggest_buy_seq.to_le_bytes()],
            &crate::ID,
        )
        .0;
        require_keys_eq!(expected, ctx.accounts.biggest_ticket.key(), HookError::WrongTicket);

        // Take the other two winners out of the draw if they are still lit.
        let last_ticket = read::<Ticket>(&ctx.accounts.last_ticket)?;
        let last_holder = read::<Holder>(&ctx.accounts.last_holder)?;
        if last_holder.burn_before_seq <= last_ticket.seq {
            rockies.draw_weight -= last_ticket.amount;
        }
        if rockies.biggest_buy_seq != rockies.last_buy_seq {
            let biggest_ticket = read::<Ticket>(&ctx.accounts.biggest_ticket)?;
            if biggest_holder.burn_before_seq <= biggest_ticket.seq {
                rockies.draw_weight -= biggest_ticket.amount;
            }
        }
    }
    rockies.draw_slot = Clock::get()?.slot + DRAW_DELAY_SLOTS;
    rockies.walk_next_number = 1;
    // Nothing left to draw from.
    rockies.random_done = rockies.draw_weight == 0;
    rockies.winners = if rockies.has_tickets {
        1 + (rockies.biggest_buy_seq != rockies.last_buy_seq) as u8 + (rockies.draw_weight > 0) as u8
    } else {
        0
    };
    Ok(())
}

fn read<T: AccountDeserialize>(account: &AccountInfo) -> Result<T> {
    require!(account.owner == &crate::ID, HookError::WrongTicket);
    T::try_deserialize(&mut &account.try_borrow_data()?[..])
}

/// True once the mint's transfer-hook program id is cleared.
fn hook_removed(mint: &AccountInfo) -> Result<bool> {
    let data = mint.try_borrow_data()?;
    let mut i = TOKEN_ACCOUNT_BASE_LEN + 1;
    while i + 4 <= data.len() {
        let kind = u16::from_le_bytes([data[i], data[i + 1]]);
        let len = u16::from_le_bytes([data[i + 2], data[i + 3]]) as usize;
        if kind == EXT_TRANSFER_HOOK {
            let program_id = data.get(i + 4 + 32..i + 4 + 64).ok_or(HookError::InvalidTokenAccount)?;
            return Ok(program_id.iter().all(|&b| b == 0));
        }
        if kind == 0 {
            break;
        }
        i += 4 + len;
    }
    Ok(true)
}
