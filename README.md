# Exhaustion Rider — make.fun `u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122`

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/gowther18/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/gowther18/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A long-only pump.fun paper-trading bot for the `pumpfun-replay/v2` harness
(TypeScript, Node 22, `main.ts` at the repo root). It trades 10 SOL of paper
money over a 24-hour replay of pump.fun bonding-curve activity; places go by
net PnL.

## Strategy: spray and ride

The money in this replay is the handful of slow completers: a few coins a day
climb from creation to the 85 SOL completion line over hundreds of slots,
worth ~14x from the create price. Everything else mostly bleeds out (the
average forward return on the dev window is negative at every horizon), so
the bot is shaped spray-and-ride:

- **Spray (the main edge):** buy a small starter (0.05 SOL) on a FRESH coin
  whose opening tape is hot — 100+ buy trades, 60+ distinct buyers, 25+ SOL
  net inflow, price already 2x, no single wallet dominating the buys, in its
  first 600 slots. The 578 coins that die early show 2 trades from 2 buyers;
  the runners show 100+ trades from 100+ buyers in their first 100 slots.
- **Pyramid into strength:** add 0.10 SOL per step (price +15% from the last
  add, net SOL still flowing in) up to 0.60 SOL per position. Size comes only
  from strength; false starts cost little.
- **Bank early, ride free:** once a position reaches 1.5x its cost, sell half
  the tokens. The remainder rides at no risk to the stake. This is what turns
  the mid-runners (coins that run 3–8x then dump) from losses into wins.
- **Patient rider exits:** a hard stop at −30% of cost, a liquidity-drain
  exit (real SOL falling below 60% of its peak), a 40% trail off a big peak,
  or a 300-slot stall with no inflow. No fade or big-sell exits on riders —
  on a runner those fire constantly. A dip family (overhang exhaustion) is
  implemented in the same file but switched off by default: it lost money on
  the dev window.

Guardrail probes keep the run above the 20-distinct-mint bar: when fills or
coins lag a block-time pace, tiny 0.01 SOL probe round trips open on liquid
curves and sell as soon as the buy lands.

## Why this shape

Measured on the kit's dev window (24 h, 1,222 coins, 35 completions, of
which 7 slow ones a bot can actually catch):

- Momentum chasing and dip-buying both lose: the house momentum pilot scores
  −9.38 SOL and the reversion pilot ~−0.30 SOL on the same window, and the
  average forward return is −12% at 600 slots for any entry point.
- The 7 slow completers show a sharply different opening tape from the 156
  coins that reach 20 SOL and dump (median first-100-slots: 153 trades, 99
  buyers, +38 SOL net, 4.4x price vs 72 trades, 41 buyers, +17 SOL, 1.8x).
  Tight thresholds on exactly those features are what selects them.
- Banking at 1.5x (not 2x or 3x) is the single biggest lever: it flips the
  no-completer half of the window from −0.59 SOL to +0.40 SOL.

## Local results (dev window, full 128,058-event dataset)

Local replay sim, mean over 4 failed-tx draws:

| config | net PnL | worst | ex-best | fills | coins | trips | wins | max DD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Exhaustion Rider (defaults) | **+0.99 SOL** | +0.86 | +0.58 | 109 | 41 | 41 | 7 | 0.025 |
| first half of the window | +0.40 SOL | +0.36 | +0.17 | 61 | 26 | 26 | 3 | 0.013 |
| second half of the window | +0.62 SOL | +0.61 | +0.21 | 123 | 36 | 52 | 7 | 0.026 |

Both halves are positive with a positive ex-best PnL, so the score does not
lean on one coin. At 2x fees the full-window net is still +0.85 SOL.

## Layout

- `main.ts` — entrypoint: runs the strategy through the kit SDK.
- `strategy.ts` — the whole strategy (spray + dip + momentum families,
  exits, probes). No dependencies beyond the SDK.
- `vendor/agentfun-bot.ts` — the kit's SDK, vendored byte for byte.

## License

MIT. See `LICENSE`.
