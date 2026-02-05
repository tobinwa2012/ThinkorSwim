# CLAUDE.md — MNQ Futures Trading System

## Project Overview

A **3-study thinkScript system for scalping MNQ (Micro E-mini Nasdaq-100) futures** on ThinkorSwim (TOS). The system uses a multi-timeframe approach: two 5-minute studies establish directional bias and structural context, while a 1-minute study provides precise execution triggers.

**Instrument:** MNQ (tick size = 0.25 points, $0.50/tick)
**Platform:** ThinkorSwim by Charles Schwab
**Language:** thinkScript

## Repository Structure

```
ThinkorSwim/
├── CLAUDE.md                                    # This file
├── studies/
│   ├── 5m/
│   │   ├── MNQ_5m_Permission_GoNoGo.ts         # Directional bias filter (EMA/MACD/VWAP)
│   │   └── MNQ_5m_Value_Framework.ts           # Value area levels & structural alerts
│   └── 1m/
│       └── MNQ_1m_Sniper_Execution.ts          # Execution triggers with arrows
```

## System Architecture

### Layer 1: Permission Filter (`MNQ_5m_Permission_GoNoGo.ts`)
**Timeframe:** 5-minute chart | **Role:** Directional gatekeeper

Determines whether longs, shorts, or neither are permitted. Outputs a 3-state bias: BULL / BEAR / NEUTRAL.

**Core logic:**
- EMA(9) vs EMA(20) crossover for trend direction
- MACD(12,26,9) above/below signal for momentum confirmation
- Price vs VWAP (with buffer) for value alignment
- Minimum EMA spread filter to avoid chop zones
- `confirmBars` (default 2) consecutive qualifying bars required before bias flips
- `holdBiasUntilOpposite` keeps bias sticky to reduce flip-flop

**Key features:**
- **Warmup gate**: Ignores first N RTH bars (default 3 = 15 min) to skip opening chaos
- **Neutralizer**: Forces NEUTRAL if bias conditions degrade for N consecutive bars (VWAP zone re-entry, spread compression, momentum loss)
- ATR-based stop/target bracket labels

### Layer 2: Value Framework (`MNQ_5m_Value_Framework.ts`)
**Timeframe:** 5-minute chart | **Role:** Structural level mapping + event alerts

Provides yesterday's value area (Y-VAH, Y-VAL, Y-POC), developing POC, overlap zones, and kill zones.

**Core logic:**
- VolumeProfile to compute developing VAH/VAL/POC each RTH session
- Yesterday's levels latched once per day at RTH open (hard guard prevents re-latch)
- Structural context: BULL (dVAL > yVAH), BEAR (dVAH < yVAL), BALANCED (overlap)
- 2-step confirmation for breakout/reclaim signals (attempt bar + confirmation bar)

**Key features:**
- **Kill Zones**: Execution clouds around Y-VAH and Y-VAL (default +/- 12 ticks)
- **Gap Fade detection**: Alerts when price opens outside Y-VA and fades back in
- **Overlap zone**: Intersection of yesterday's VA and today's developing VA
- **LOC label**: Real-time location relative to value (ABOVE VAH, IN VALUE, etc.)
- **SIG label**: Tracks last structural event (BREAK, RECLAIM, GAP FADE, KZ)
- **Exports**: Hidden plots for Y-VAH, Y-VAL, dPOC usable by other studies

### Layer 3: Sniper Execution (`MNQ_1m_Sniper_Execution.ts`)
**Timeframe:** 1-minute chart | **Role:** Entry trigger generation

Fires discrete LONG/SHORT pulse arrows when all conditions align.

**Core logic:**
- EMA(9) vs EMA(20) for micro-trend
- MACD(6,13,5) — faster settings for 1m momentum
- Volume >= 30% of 50-bar average (loose "wake up" check)
- Price vs VWAP (with optional override for counter-trend entries)
- Minimum EMA spread of 2 ticks to avoid knot zones

**Key features:**
- **Cooldown**: Minimum 2 bars between signals to prevent spam
- **Reset logic**: Requires 2 bars of "off" before re-arming (prevents inside-bar whipsaws)
- **VWAP Override**: `allowShortAboveVWAP` / `allowLongBelowVWAP` for reclaim/fade trades
- **Volume Bias proxy**: 10-bar up/down volume imbalance label
- Uses `useRTHOnly = no` by default (can trigger on globex data)

## Intended Workflow

1. Check **Permission** study on 5m — is bias BULL, BEAR, or NEUTRAL?
2. Check **Value Framework** on 5m — where is price relative to Y-VA? Any fresh signals?
3. If permission is granted and location is favorable, watch **Sniper** on 1m for arrows
4. Only take 1m arrows that align with 5m permission direction
5. Use kill zones and value levels for stop/target placement

## thinkScript Conventions Used

### Naming
- `camelCase` for local variables (`emaSpreadTicks`, `bullCandidate`)
- `UPPER_CASE` for input parameters (`fastEMA`, `confirmBars` — mixed convention)
- `rec` prefix pattern for stateful accumulators (`rec perm`, `rec bullCount`)
- `_keepAlive` plot at end of each script (prevents TOS from optimizing away unused code paths)

### Patterns
- **State machines** via `rec` variables with `if/else if` chains
- **2-step confirmation**: attempt on bar N, confirm on bar N+1
- **Re-arm logic**: state tracks fired/distance/reset to prevent alert spam
- **Tick rounding**: `Round(value / ts, 0) * ts` for clean price levels
- **Session detection**: `inRTH and !inRTH[1]` fires exactly once at RTH open
- **Export pattern**: Hidden plots (`SetHiding(yes)`) to share data between studies

### File Format
- `.ts` extension for thinkScript files
- Header block with `# ===...===` separators
- Section separators with `# ---...---`
- Inline comments for non-obvious logic

## Development Workflow

### Modifying a Study
1. Read the existing file first — understand the state machine before changing it
2. Test in ThinkorSwim's thinkScript editor (compile check)
3. Verify on historical data before live use
4. Preserve `_keepAlive` plot and export plots

### Commit Message Format
```
<type>: <short description>

Types: add, fix, update, remove, refactor
Examples:
  add: RSI divergence filter to permission study
  fix: Y-VA latch firing twice on gap days
  update: sniper cooldown from 2 to 3 bars
```

## AI Assistant Guidelines

1. **Read before editing** — these scripts have complex state machines with subtle interdependencies
2. **Do not guess thinkScript syntax** — verify against patterns in existing files
3. **Preserve state machine integrity** — `rec` variable chains are order-sensitive; changing one branch can break downstream logic
4. **Keep `_keepAlive` plots** — removing them may cause TOS to skip code evaluation
5. **Keep exports intact** — the Value Framework exports are designed for cross-study consumption
6. **thinkScript limitations to remember**:
   - No arrays, no user-defined functions (use `script` blocks for reusable logic)
   - `def` recalculates each bar; `rec` carries state forward
   - `fold` is the only loop construct
   - Max lookback is ~252 bars for daily aggregation
   - No external API calls
   - `reference VWAP()` must be used to access built-in VWAP
7. **The 1m Sniper has `useRTHOnly = no` by default** — this is intentional for globex pre-market signals; don't change without asking
8. **Tick math**: MNQ tick = 0.25 points. When the code says `Round(pts * 4, 0)` it's converting points to ticks
