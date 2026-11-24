// Exhaustion Rider — a pump.fun bonding-curve replay bot (agent-fun/replay/v2).
//
// The money in this replay is the handful of slow completers: a few coins a
// day climb from creation to the 85 SOL completion line over hundreds of
// slots, worth ~14x from the create price. Everything else mostly bleeds out
// (the average forward return on this window is negative at every horizon),
// so the bot's shape is spray-and-ride:
//
//  S. Spray (the main edge): buy a small starter on a FRESH coin whose opening
//     tape is hot — many trades, many distinct buyers, strong net SOL inflow,
//     price already up, no single wallet dominating the buys. The 578 coins
//     that die early show 2 trades from 2 buyers; the runners show 100+
//     trades from 100+ buyers in their first 100 slots. Size comes only from
//     pyramiding into strength: add while the price steps up and net SOL keeps
//     flowing in, up to the stake. Losers are cut fast (stop, stall exit);
//     winners are ridden to completion with a wide trailing stop and no take
//     profit, because the completion line is where the multiples live.
//  A. Overhang exhaustion: a mature curve sold off hard from its recent high
//     while sell flow decelerates and buyers step back in. Small first, add
//     only as the bounce confirms.
//  B. Momentum continuation: a mature curve with accelerating net inflow,
//     price near its window high, many distinct buyers.
//
// All families refuse a coin when one wallet dominates the window's buy SOL
// (a bundle / farm waiting to dump). Dip and momentum also refuse a coin
// whose creator has sold; spray does not veto on that alone (2 of the 7 slow
// completers in the dev window had creator sells early).
//
// Guardrail probes keep the run above the 20-distinct-mint bar: when fills or
// coins lag a block-time pace, tiny 0.01 SOL probe round trips open on liquid
// curves and sell as soon as the buy lands.
//
// Deterministic by construction: no clock, no randomness, no I/O — iteration
// only over insertion-ordered maps fed by the batch stream, so the two graded
// executions produce byte-identical action logs.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/agentfun-bot.ts';

export interface Params {
  /** Families on/off (ablation switches). */
  useSpray: boolean;
  useDip: boolean;
  useMom: boolean;
  /** Spray: oldest age (slots since create) at which a starter may be bought. */
  sprayAge: number;
  /** Spray: lookback (slots) for the opening tape. */
  sprayWindow: number;
  /** Spray: buy trades in the window, at least. */
  sprayMinTrades: number;
  /** Spray: distinct buying wallets in the window, at least. */
  sprayMinBuyers: number;
  /** Spray: net buy SOL (buys minus sells) over the window, at least. */
  sprayMinNet: number;
  /** Spray: price now over price at the window start, minus 1, at least. */
  sprayMinUp: number;
  /** Spray: largest single wallet's share of the window's buy SOL, at most. */
  sprayTopShare: number;
  /** Spray: curve real SOL at entry, at least. */
  sprayMinRq: number;
  /** Dip lookback (slots) for the recent high the drawdown is measured from. */
  dipWindow: number;
  /** Enter when price is at least this far below the window high (fraction). */
  dipMin: number;
  /** ...and not further than this (a collapse, not a dip). */
  dipMax: number;
  /** Recent-third sell SOL must be at most this multiple of the middle-third's. */
  dipSellDecay: number;
  /** Of the last dipConfirmLast trades at least dipConfirmBuys must be buys. */
  dipConfirmLast: number;
  dipConfirmBuys: number;
  /** Net SOL over dipFlowWindow must be at least this (the dip is being bought). */
  dipFlowWindow: number;
  dipMinFlowSol: number;
  /** Price now must be at least this far above the window low (bouncing, not falling). */
  dipOffLow: number;
  /** Distinct buying wallets in the dip window, at least. */
  dipMinBuyers: number;
  /** Momentum entry window (slots). */
  momWindow: number;
  /** Net buy SOL (buys minus sells) over the momentum window. */
  momMinNetSol: number;
  /** Buy trades in the momentum window. */
  momMinBuys: number;
  /** Distinct buying wallets in the momentum window. */
  momMinBuyers: number;
  /** Price now over price at the window start, minus 1. */
  momMinUp: number;
  /** Upper bound on that rise: skip curves that already ran too far. */
  momMaxUp: number;
  /** Newer-half net inflow must be at least this multiple of the older half's. */
  momAccel: number;
  /** Price now at least this share of the window's high. */
  momNearHigh: number;
  /** Largest single wallet's share of the entry window's buy SOL, at most. */
  maxTopShare: number;
  /** Slots since the CreateEvent before a dip/momentum entry is allowed. */
  minAge: number;
  /** Curve real SOL bounds at a dip/momentum entry. */
  minRqSol: number;
  maxRqSol: number;
  /** SOL to put into one position in total. */
  stakeSol: number;
  /** First buy of a position (SOL). */
  initialSol: number;
  /** Each add-on buy (SOL). */
  addSol: number;
  /** Add only once the price is this much above the last buy's decision price. */
  addStep: number;
  /** Smallest buy worth sending. */
  minBuySol: number;
  /** Slippage on buys (bps); sells always go out at 10000. */
  buySlipBps: number;
  /** Most SOL per buy order (the 1% reserve cap applies too). */
  maxChunkSol: number;
  /** Most positions open at once. */
  maxMain: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureSol: number;
  /** Exits. */
  stopLoss: number;
  trail: number;
  /** The trailing stop arms once value reached cost * (1 + trailArm). */
  trailArm: number;
  /** Trailing stop (fraction off the peak) once real SOL is at/above rideRqSol. */
  riderTrail: number;
  /** Spray free ride: bank half the tokens once value reaches cost * bankMult. */
  bankMult: number;
  /** Spray hard stop: exit when value falls below cost * (1 - sprayStop). */
  sprayStop: number;
  /** Spray peak trail: exit when value falls below peak * (1 - sprayTrail) once armed. */
  sprayTrail: number;
  /** Spray stall: after this many slots held with no profit and no inflow, exit. */
  sprayStallSlots: number;
  /** Exit when net SOL over fadeWindow falls below -fadeNetSol. */
  fadeWindow: number;
  fadeNetSol: number;
  /** Exit on any single recorded sell of at least this many SOL. */
  bigSellSol: number;
  /** Exit after this many slots held. */
  maxHold: number;
  /** The time limit does not apply while the position is up at least this much. */
  holdIfUp: number;
  /** Stall exit: after stallSlots held with no profit and no inflow, exit. */
  stallSlots: number;
  stallNetSol: number;
  rideRqSol: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: number;
  /** Guardrail pacing targets (fills / coins over paceSecs of block time). */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
}

export const DEFAULT_PARAMS: Params = {
  useSpray: true,
  useDip: false,
  useMom: false,
  sprayAge: 600,
  sprayWindow: 100,
  sprayMinTrades: 100,
  sprayMinBuyers: 60,
  sprayMinNet: 25,
  sprayMinUp: 1.0,
  sprayTopShare: 0.35,
  sprayMinRq: 1,
  dipWindow: 90,
  dipMin: 0.25,
  dipMax: 0.75,
  dipSellDecay: 0.7,
  dipConfirmLast: 5,
  dipConfirmBuys: 3,
  dipFlowWindow: 20,
  dipMinFlowSol: 0.02,
  dipOffLow: 0.05,
  dipMinBuyers: 4,
  momWindow: 30,
  momMinNetSol: 1,
  momMinBuys: 3,
  momMinBuyers: 6,
  momMinUp: 0.05,
  momMaxUp: 0.8,
  momAccel: 1,
  momNearHigh: 0.95,
  maxTopShare: 0.45,
  minAge: 400,
  minRqSol: 2,
  maxRqSol: 60,
  stakeSol: 0.6,
  initialSol: 0.05,
  addSol: 0.1,
  addStep: 0.15,
  minBuySol: 0.01,
  buySlipBps: 1500,
  maxChunkSol: 0.3,
  maxMain: 5,
  maxExposureSol: 5,
  stopLoss: 0.15,
  trail: 0.25,
  trailArm: 0.1,
  riderTrail: 0.4,
  bankMult: 1.5,
  sprayStop: 0.3,
  sprayTrail: 0.4,
  sprayStallSlots: 300,
  fadeWindow: 20,
  fadeNetSol: 0.5,
  bigSellSol: 1.0,
  maxHold: 3000,
  holdIfUp: 0.1,
  stallSlots: 120,
  stallNetSol: 0,
  rideRqSol: 60,
  cooldown: 150,
  maxEntries: 2,
  targetCoins: 22,
  targetFills: 40,
  paceSecs: 14400,
  probeSol: 0.01,
  maxProbes: 1,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;
const BPS_PER_UNIT = 10_000;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Tape {
  created: number | null;
  creator: string | null;
  creatorSold: boolean;
  trades: Trade[];
  entries: number;
  lastExit: number;
}

interface Held {
  opened: number;
  peakValue: number;
  /** SOL sent in buys for this position (fees included). */
  invested: number;
  exiting: boolean;
  /** Some buy of this position filled. */
  filled: boolean;
  /** Recorded price when the last buy was decided. */
  lastAddPrice: number;
  /** Close value at the latest batch (SOL, curve and tx fees deducted). */
  lastValue: number;
  /** Highest real SOL seen while holding (for the spray liquidity exit). */
  rqPeak: number;
  /** Spray: half the position already banked at bankMult (the rest rides free). */
  banked: boolean;
  /** Which family opened the position. */
  kind: 'spray' | 'dip' | 'mom';
}

interface WinStats {
  buySol: number;
  sellSol: number;
  buys: number;
  sellers: number;
  buyers: number;
  topShare: number;
  startPrice: number;
  high: number;
  low: number;
  last: number;
  netOld: number;
  netNew: number;
  sellOld: number;
  sellNew: number;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  /** The bot's own filled orders and the coins they were on (harness closes excluded). */
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  const keep = Math.max(p.sprayWindow, p.dipWindow, p.momWindow, p.fadeWindow) + 5;

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = { created: null, creator: null, creatorSold: false, trades: [], entries: 0, lastExit: -1e12 };
      tapes.set(mint, t);
    }
    return t;
  };

  /** Rolling stats over the last `w` slots of a tape at slot `now`. */
  const winStats = (t: Tape, now: number, w: number): WinStats => {
    const from = now - w;
    const mid = now - w / 2;
    const s: WinStats = {
      buySol: 0, sellSol: 0, buys: 0, sellers: 0, buyers: 0, topShare: 1,
      startPrice: -1, high: 0, low: Infinity, last: 0, netOld: 0, netNew: 0,
      sellOld: 0, sellNew: 0,
    };
    const byUser = new Map<string, number>();
    const sellUsers = new Set<string>();
    for (const tr of t.trades) {
      if (tr.slot <= from) {
        s.startPrice = tr.price;
        continue;
      }
      if (s.startPrice < 0) s.startPrice = tr.price;
      const signed = tr.buy ? tr.sol : -tr.sol;
      if (tr.slot <= mid) {
        s.netOld += signed;
        if (!tr.buy) s.sellOld += tr.sol;
      } else {
        s.netNew += signed;
        if (!tr.buy) s.sellNew += tr.sol;
      }
      if (tr.buy) {
        s.buySol += tr.sol;
        s.buys++;
        byUser.set(tr.user, (byUser.get(tr.user) ?? 0) + tr.sol);
      } else {
        s.sellSol += tr.sol;
        sellUsers.add(tr.user);
      }
      if (tr.price > s.high) s.high = tr.price;
      if (tr.price < s.low) s.low = tr.price;
      s.last = tr.price;
    }
    s.buyers = byUser.size;
    s.sellers = sellUsers.size;
    let top = 0;
    for (const v of byUser.values()) if (v > top) top = v;
    s.topShare = s.buySol > 0 ? top / s.buySol : 1;
    if (s.low === Infinity) s.low = 0;
    return s;
  };

  /** Net recorded SOL (buys minus sells) over the last `w` slots. */
  const flow = (t: Tape, now: number, w: number): number => {
    let net = 0;
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i]!;
      if (tr.slot <= now - w) break;
      net += tr.buy ? tr.sol : -tr.sol;
    }
    return net;
  };

  /** Family S: spray — a fresh coin whose opening tape is hot. */
  const spraySignal = (t: Tape, now: number, rqSol: number): boolean => {
    if (t.created === null || now - t.created > p.sprayAge) return false;
    if (rqSol < p.sprayMinRq) return false;
    const s = winStats(t, now, p.sprayWindow);
    if (s.buys < p.sprayMinTrades || s.buyers < p.sprayMinBuyers) return false;
    if (s.buySol - s.sellSol < p.sprayMinNet) return false;
    if (s.startPrice <= 0) return false;
    if (s.last / s.startPrice - 1 < p.sprayMinUp) return false;
    if (s.topShare > p.sprayTopShare) return false;
    return true;
  };

  /** Shared gates for the dip and momentum families. */
  const gates = (t: Tape, now: number, rqSol: number): boolean => {
    if (t.creatorSold) return false;
    if (t.created === null || now - t.created < p.minAge) return false;
    if (rqSol < p.minRqSol || rqSol > p.maxRqSol) return false;
    return true;
  };

  /** Family A: overhang exhaustion — sold off from the high, sells decelerating, buyers returning. */
  const dipSignal = (t: Tape, now: number): boolean => {
    const s = winStats(t, now, p.dipWindow);
    if (s.buys === 0 || s.buyers < p.dipMinBuyers) return false;
    if (s.high <= 0 || s.startPrice <= 0) return false;
    const dd = 1 - s.last / s.high;
    if (dd < p.dipMin || dd > p.dipMax) return false;
    if (s.low <= 0 || s.last < s.low * (1 + p.dipOffLow)) return false;
    if (s.sellOld <= 0) return false;
    if (s.sellNew > p.dipSellDecay * s.sellOld) return false;
    const recent = t.trades.slice(-p.dipConfirmLast);
    if (recent.length < p.dipConfirmLast) return false;
    let recentBuys = 0;
    for (const tr of recent) if (tr.buy) recentBuys++;
    if (recentBuys < p.dipConfirmBuys) return false;
    if (flow(t, now, p.dipFlowWindow) < p.dipMinFlowSol) return false;
    if (s.topShare > p.maxTopShare) return false;
    return true;
  };

  /** Family B: momentum continuation — accelerating inflow, price near its high. */
  const momSignal = (t: Tape, now: number): boolean => {
    const s = winStats(t, now, p.momWindow);
    if (s.buys < p.momMinBuys || s.buyers < p.momMinBuyers) return false;
    const net = s.buySol - s.sellSol;
    if (net < p.momMinNetSol) return false;
    if (s.startPrice <= 0) return false;
    const up = s.last / s.startPrice - 1;
    if (up < p.momMinUp || up > p.momMaxUp) return false;
    if (s.last < s.high * p.momNearHigh) return false;
    if (s.netNew <= 0 || s.netNew < p.momAccel * s.netOld) return false;
    if (s.topShare > p.maxTopShare) return false;
    return true;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const bigSell = new Set<Pubkey>();
      const traded = new Set<Pubkey>();
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
        }
      }
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.created = e.slot;
          t.creator = e.creator;
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          if (t.creator === null) t.creator = e.creator;
          if (!e.is_buy && t.creator !== null && e.user === t.creator) t.creatorSold = true;
          const sol = Number(e.sol_amount) / LAMPORTS;
          t.trades.push({ slot: e.slot, buy: e.is_buy, sol, user: e.user, price: Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves) });
          traded.add(e.mint);
          if (!e.is_buy && sol >= p.bigSellSol) bigSell.add(e.mint);
        }
      }
      for (const mint of traded) {
        const t = tapes.get(mint)!;
        let cut = 0;
        while (cut < t.trades.length && t.trades[cut]!.slot <= now - keep) cut++;
        if (cut > 0) t.trades.splice(0, cut);
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // Exits first.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const t = tapeOf(mint);
            if (h.filled) t.lastExit = now;
            else t.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const rqSol = (mk ? Number(mk.real_quote_reserves) : Number(curve.real_quote_reserves)) / LAMPORTS;
        const tokens = Number(pos.token_amount);
        const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        if (rqSol > h.rqPeak) h.rqPeak = rqSol;
        h.lastValue = value;
        // Spray free ride: once the position reaches bankMult, bank half the
        // tokens and let the rest ride at no risk to the stake.
        if (h.kind === 'spray' && !h.banked && !h.exiting && value >= cost * p.bankMult) {
          let sellPending = false;
          for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          if (!sellPending && orders.length < cap) {
            orders.push({ side: 'sell', mint, token_amount: BigInt(pos.token_amount) / 2n, max_slippage_bps: 10_000 });
            h.banked = true;
            h.peakValue = value / 2;
          }
        }
        let exit = h.exiting;
        const t = tapeOf(mint);
        const riding = rqSol >= p.rideRqSol;
        if (h.kind === 'spray') {
          // Patient rider exits: only a hard stop, a liquidity drain (real SOL
          // falling well from its peak), a deep trail off a big peak, or a
          // long stall. No fade / big-sell exits: on a runner those fire
          // constantly.
          if (!exit && value < cost * (1 - p.sprayStop)) exit = true;
          if (!exit && h.rqPeak >= 20 && rqSol < h.rqPeak * 0.6) exit = true;
          if (!exit && h.peakValue >= cost * 1.5 && value < h.peakValue * (1 - p.sprayTrail)) exit = true;
          if (!exit && now - h.opened > p.sprayStallSlots && value < cost * (1 + p.holdIfUp) && flow(t, now, 100) <= 0) exit = true;
        } else {
          const trailPct = riding ? p.riderTrail : p.trail;
          if (!exit && value < cost * (1 - p.stopLoss)) exit = true;
          if (!exit && h.peakValue >= cost * (1 + p.trailArm) && value < h.peakValue * (1 - trailPct)) exit = true;
          if (!exit && !riding && flow(t, now, p.fadeWindow) < -p.fadeNetSol) exit = true;
          if (!exit && !riding && bigSell.has(mint)) exit = true;
        }
        if (!exit && now - h.opened > p.maxHold && value < cost * (1 + p.holdIfUp)) exit = true;
        if (!exit) continue;
        h.exiting = true;
        if (pendingByMint.has(mint)) {
          let sellPending = false;
          for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          if (sellPending) continue;
        }
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!selling) probes.set(mint, true);
      }

      // Then entries and adds.
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let mainLeft = p.maxMain - held.size;
      let exposure = 0;
      for (const [mint, h] of held) exposure += Math.max(h.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);
      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint) || probes.has(mint)) continue;
        const t = tapes.get(mint)!;
        const h = held.get(mint);
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        let want: number;
        let kind: Held['kind'] | null = null;
        if (h === undefined) {
          if (slotsLeft <= 0 || mainLeft <= 0) continue;
          if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) continue;
          if (p.useSpray && spraySignal(t, now, rqSol)) kind = 'spray';
          else if (p.useDip && gates(t, now, rqSol) && dipSignal(t, now)) kind = 'dip';
          else if (p.useMom && gates(t, now, rqSol) && momSignal(t, now)) kind = 'mom';
          if (kind === null) continue;
          want = Math.min(p.initialSol, p.stakeSol);
        } else {
          // Pyramid into strength only: price stepped up from the last add and
          // net SOL still flows in over the momentum window.
          if (h.exiting || !h.filled || h.invested >= p.stakeSol - p.minBuySol) continue;
          const pos = state.positions.get(mint);
          if (pos === undefined) continue;
          if (price < h.lastAddPrice * (1 + p.addStep)) continue;
          if (flow(t, now, p.momWindow) < 0) continue;
          if (rqSol > p.maxRqSol && h.kind !== 'spray') continue;
          want = Math.min(p.addSol, p.stakeSol - h.invested);
        }
        const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
        let amount = Math.min(capSol, want, p.maxChunkSol, p.maxExposureSol - exposure);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        const lamports = BigInt(Math.floor(amount * LAMPORTS));
        orders.push({ side: 'buy', mint, quote_lamports: lamports, max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        exposure += amount;
        if (h === undefined) {
          held.set(mint, { opened: now, peakValue: 0, invested: amount, exiting: false, filled: false, lastAddPrice: price, lastValue: 0, rqPeak: rqSol, banked: false, kind: kind! });
          t.entries++;
          slotsLeft--;
          mainLeft--;
        } else {
          h.invested += amount;
          h.lastAddPrice = price;
        }
      }

      // Guardrail pacing: open a probe when the bot's fills or coins lag the pace.
      if (probes.size < p.maxProbes && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if (needCoins || needFills) {
          const minRq = (p.probeSol * BPS_PER_UNIT) / state.hello.caps.max_order_bps_of_real_reserve;
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
