# CLAUDE.md — MNQ Futures Trading System

## Project Overview

A **4-study thinkScript system for scalping MNQ (Micro E-mini Nasdaq-100) futures** on ThinkorSwim (TOS). The system uses a multi-timeframe approach: a 30-minute study provides macro context, two 5-minute studies establish directional bias and structural context, and a 1-minute study provides precise execution triggers.

**Instrument:** MNQ (tick size = 0.25 points, $0.50/tick)
**Platform:** ThinkorSwim by Charles Schwab
**Language:** thinkScript

## Repository Structure

```
ThinkorSwim/
├── CLAUDE.md                                    # This file
├── studies/
│   ├── 30m/
│   │   └── MNQ_30m_Macro_Context.ts            # Session type, IB, migration, weekly VWAP
│   ├── 5m/
│   │   ├── MNQ_5m_Permission_GoNoGo.ts         # Directional bias filter (ADX/DMI/VWAP)
│   │   └── MNQ_5m_Value_Framework.ts           # Value area levels & structural alerts
│   └── 1m/
│       └── MNQ_1m_Sniper_Execution.ts          # Execution triggers with arrows
```

## System Architecture

### Design Principle: Signal Independence
Each layer uses a different information source:
- **Macro Context (30m)**: Price structure + value migration (IB range, VA shift, weekly VWAP)
- **Permission (5m)**: Trend strength via **ADX/DMI** (directional movement)
- **Value Framework (5m)**: Market microstructure (volume profile, value areas)
- **Sniper (1m)**: Momentum timing via **EMA/MACD** (price smoothing)

Agreement across independent sources carries more weight than correlated signals.

### Layer 0: Macro Context (`MNQ_30m_Macro_Context.ts`)
**Timeframe:** 30-minute chart | **Role:** Session classification + macro structure

Answers: Is this a trend day or rotation day? How extended is the move? Is value migrating?

**Core logic:**
- **Initial Balance** (IB): First hour's high/low (2 bars on 30m). Key intraday reference.
- **Session type**: TREND UP (accepted above IB), TREND DOWN (accepted below IB), ROTATION (inside IB or both-sided breakout), IB BREAK (testing, not yet accepted)
- **Value migration**: Compares today's developing POC/VAL/VAH vs yesterday's. Adaptive threshold (15% of Y-VA range) prevents noise.
- **Weekly VWAP**: Manual computation of volume-weighted average price across the week. Institutional-scale value anchor independent from daily VWAP.

**Key features:**
- **IB extension metric**: Shows how far price has moved beyond IB in multiples of IB range (e.g., 1.5R = 1.5x the IB range)
- **Background color**: Green tint = trend up day, red tint = trend down day, no tint = rotation/forming
- **Adjustable IB period**: Change `ibBars` for other timeframes (4 for 15m, 1 for 1h)
- **Y-VA latch**: Same endOfRTH snapshot + fallback fix as Value Framework

### Layer 1: Permission Filter (`MNQ_5m_Permission_GoNoGo.ts`)
**Timeframe:** 5-minute chart | **Role:** Directional gatekeeper

Determines whether longs, shorts, or neither are permitted. Outputs a 3-state bias: BULL / BEAR / NEUTRAL.

**Core logic:**
- ADX(14) >= 20 confirms a trend exists (replaces EMA spread filter)
- DI+ vs DI- directional spread for trend direction (replaces EMA crossover)
- DI spread minimum (default 3) filters ambiguous readings
- Price vs VWAP (with buffer) for value alignment
- `confirmBars` (default 2) consecutive qualifying bars required before bias flips
- `holdBiasUntilOpposite` keeps bias sticky to reduce flip-flop

**Key features:**
- **Warmup gate**: Ignores first N RTH bars (default 3 = 15 min) to skip opening chaos
- **Neutralizer**: Forces NEUTRAL if ADX weakens, DI spread compresses, or price re-enters VWAP zone
- **TREND label**: Shows STRONG (ADX >= 30), TRENDING (>= 20), or WEAK/CHOP with rising/falling arrow
- ATR-based stop/target bracket labels

### Layer 2: Value Framework (`MNQ_5m_Value_Framework.ts`)
**Timeframe:** 5-minute chart | **Role:** Structural level mapping + event alerts

Provides yesterday's value area (Y-VAH, Y-VAL, Y-POC), developing POC, overlap zones, and kill zones.

**Core logic:**
- VolumeProfile to compute developing VAH/VAL/POC each RTH session
- **Dual-source Y-VA latch**: Primary snapshot at end-of-RTH transition (16:00, profile is complete); fallback running tracker for RTH-only charts. Prevents today's developing profile from contaminating yesterday's frozen levels on TOS recalculation.
- Structural context: BULL (dVAL > yVAH), BEAR (dVAH < yVAL), BALANCED (overlap)
- 2-step confirmation for breakout/reclaim signals (attempt bar + confirmation bar)

**Key features:**
- **Kill Zones**: Execution clouds around Y-VAH and Y-VAL (default +/- 12 ticks)
- **Gap Fade detection**: Alerts when price opens outside Y-VA and fades back in
- **Overlap zone**: Intersection of yesterday's VA and today's developing VA
- **LOC label**: Real-time location relative to value (ABOVE VAH, IN VALUE, etc.)
- **SIG label**: Tracks last structural event (BREAK, RECLAIM, GAP FADE, KZ)
- **Debug mode**: `showDebugPlots` shows Y-VA source (SNAP vs FALLBACK) and session count
- **Exports**: Hidden plots for Y-VAH, Y-VAL, dPOC

### Layer 3: Sniper Execution (`MNQ_1m_Sniper_Execution.ts`)
**Timeframe:** 1-minute chart | **Role:** Entry trigger generation

Fires discrete LONG/SHORT pulse arrows when all conditions align. Optimized for scalping latency.

**Core logic:**
- EMA(9) vs EMA(20) for micro-trend
- MACD(6,13,5) — faster settings for 1m momentum
- Volume >= 80% of 50-bar average (meaningful filter); 120% for counter-VWAP trades
- Context-aware VWAP override via reclaim window (see below)
- Minimum EMA spread of 2 ticks to avoid knot zones

**Key features:**
- **Reduced latency**: cooldown=1, reset=1 (was 2 each) — minimum 2-bar delay instead of 4
- **Momentum burst bypass**: When MACD histogram is >= 2x its 20-bar average, the reset requirement is skipped entirely for fast re-entry on impulsive moves
- **Context-aware VWAP override**: Detects VWAP crosses and opens a 5-bar reclaim window. During the window, counter-VWAP entries are allowed (shorts above VWAP after a cross-up, longs below VWAP after a cross-down). Replaces the old static `allowShortAboveVWAP` / `allowLongBelowVWAP` toggles.
- **Tiered volume**: Standard trades need 80% of average volume; counter-VWAP trades need 120% — higher conviction required when fighting the value anchor
- **Volume Bias proxy**: 10-bar up/down volume imbalance label (informational only)
- Uses `useRTHOnly = yes` by default (no globex noise)

## Intended Workflow

1. Check **Macro Context** on 30m — trend day or rotation? How extended beyond IB? Where is weekly VWAP?
2. Check **Permission** study on 5m — is bias BULL, BEAR, or NEUTRAL?
3. Check **Value Framework** on 5m — where is price relative to Y-VA? Any fresh signals?
4. If permission is granted and location is favorable, watch **Sniper** on 1m for arrows
5. Only take 1m arrows that align with 5m permission direction
6. Use kill zones, IB levels, and value levels for stop/target placement
7. **Trend days**: hold runners, favor breakout entries, widen targets
8. **Rotation days**: take quick profits, favor mean-reversion at edges, tighten targets

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
- **End-of-RTH detection**: `inRTH[1] and !inRTH` fires once at RTH close (for snapshots)
- **Export pattern**: Hidden plots (`SetHiding(yes)`) to share data between studies
- **Dual-source latch**: Primary snapshot + fallback tracker for robustness

### File Format
- `.ts` extension for thinkScript files
- Header block with `# ===...===` separators listing changes from previous version
- Section separators with `# ---...---`
- Inline comments for non-obvious logic

## Development Workflow

### Modifying a Study
1. Read the existing file first — understand the state machine before changing it
2. Test in ThinkorSwim's thinkScript editor (compile check)
3. Verify on historical data before live use
4. Preserve `_keepAlive` plot and export plots
5. TOS does not allow studies to be wired together — each must be self-contained

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
   - TOS cannot wire studies together — each study must be independent
   - VolumeProfile can repaint on chart reload — design latch logic accordingly
7. **Maintain signal independence** — Permission uses ADX/DMI, Sniper uses EMA/MACD. Do not introduce correlated indicators across the two layers.
8. **Tick math**: MNQ tick = 0.25 points. When the code says `Round(pts * 4, 0)` it's converting points to ticks
