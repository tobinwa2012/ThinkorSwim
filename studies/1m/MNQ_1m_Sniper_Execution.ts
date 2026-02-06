# =========================================================
# MNQ_1m_Sniper_Execution v2
# Changes from v1:
#   (1) Reduced latency: resetBarsNeeded=1, cooldownBars=1 (was 2 each)
#   (2) Momentum burst bypass: strong MACD histogram skips reset
#       requirement entirely — fast re-entry on impulsive moves
#   (3) Context-aware VWAP override: auto-detects VWAP cross and opens
#       a reclaim window (N bars) for counter-VWAP entries, replacing
#       the static allowShortAboveVWAP/allowLongBelowVWAP toggles
#   (4) Volume filter raised to 80% (was 30%), 120% for counter-VWAP
#       trades — volume must confirm conviction on reclaim/fade entries
#   (5) Default useRTHOnly=yes (was no) — no more globex noise arrows
# =========================================================

declare upper;

def na = Double.NaN;
def ts = TickSize();

# ----------------------------
# Inputs
# ----------------------------
input fastEMA            = 9;
input slowEMA            = 20;

input macdFast           = 6;
input macdSlow           = 13;
input macdSignal         = 5;

input volLength          = 50;
input volThresholdPct    = 80;     # standard volume gate (was 30)
input volThresholdCounterPct = 120; # higher bar for counter-VWAP trades

input vwapBufferTicks    = 0;
input minEMASpreadTicks  = 2;

input cooldownBars       = 1;      # was 2 — faster re-fire for scalping
input allowResetReFire   = yes;
input resetBarsNeeded    = 1;      # was 2 — faster re-arm
input fullResetBars      = 4;

input requirePriceVsVWAP = yes;

# Context-aware VWAP override (replaces static toggles)
input reclaimWindowBars  = 5;      # bars after VWAP cross where counter-VWAP is allowed

# Momentum burst: bypass reset when MACD histogram is very strong
input momentumBurstMult  = 2.0;    # histogram must be >= 2x its average to bypass reset
input momentumBurstLength = 20;    # lookback for average histogram strength

# Visuals
input paintBars          = yes;
input showArrows         = yes;
input showLabels         = yes;

# ----------------------------
# Session gate
# ----------------------------
input useRTHOnly         = yes;    # was no — globex arrows were noise
input rthStart           = 0930;
input rthEnd             = 1600;

def inRTH =
    if !useRTHOnly then 1
    else if SecondsFromTime(rthStart) >= 0 and SecondsTillTime(rthEnd) > 0 then 1
    else 0;

# ----------------------------
# Core indicators
# ----------------------------
def EMA9  = ExpAverage(close, fastEMA);
def EMA20 = ExpAverage(close, slowEMA);

def emaSpreadTicks = AbsValue(EMA9 - EMA20) / ts;
def spreadOK = emaSpreadTicks >= minEMASpreadTicks;

def vwapRT  = reference VWAP();
def vwapBuf = vwapBufferTicks * ts;

# MACD 1m (fast)
def macdVal = ExpAverage(close, macdFast) - ExpAverage(close, macdSlow);
def macdAvg = ExpAverage(macdVal, macdSignal);
def macdHist = macdVal - macdAvg;

def momUp = macdVal > macdAvg;
def momDn = macdVal < macdAvg;

# ----------------------------
# Momentum burst detection
# ----------------------------
def avgHistStrength = Average(AbsValue(macdHist), momentumBurstLength);
def momentumBurst = avgHistStrength > 0 and AbsValue(macdHist) >= (avgHistStrength * momentumBurstMult);

# ----------------------------
# Context-aware VWAP override
# Detects VWAP crosses and opens a reclaim window for counter-VWAP trades
# ----------------------------
def aboveVW = close > (vwapRT + vwapBuf);
def belowVW = close < (vwapRT - vwapBuf);

def vwapCrossUp   = close > vwapRT and close[1] <= vwapRT;
def vwapCrossDown = close < vwapRT and close[1] >= vwapRT;

rec barsSinceVWAPCross =
    if BarNumber() == 1 then 999
    else if vwapCrossUp or vwapCrossDown then 0
    else barsSinceVWAPCross[1] + 1;

def inReclaimWindow = barsSinceVWAPCross <= reclaimWindowBars;

# Direction of last VWAP cross
rec lastCrossDir =
    if BarNumber() == 1 then 0
    else if vwapCrossUp then 1
    else if vwapCrossDown then -1
    else lastCrossDir[1];

# Longs: normally need above VWAP; after a cross-down, allow below for N bars (reclaim long)
# Shorts: normally need below VWAP; after a cross-up, allow above for N bars (rejection short)
def longVWOK  = aboveVW or (inReclaimWindow and lastCrossDir == -1);
def shortVWOK = belowVW or (inReclaimWindow and lastCrossDir == 1);

def isCounterVWAP =
    (inReclaimWindow and lastCrossDir == -1 and !aboveVW) or
    (inReclaimWindow and lastCrossDir == 1 and !belowVW);

# ----------------------------
# Volume filter (tiered)
# ----------------------------
def avgVol = Average(volume, volLength);
def volStandard = volume >= (avgVol * (volThresholdPct / 100));
def volCounter  = volume >= (avgVol * (volThresholdCounterPct / 100));

# Counter-VWAP trades require higher volume conviction
def volOK = if isCounterVWAP then volCounter else volStandard;

# ----------------------------
# ARMED conditions
# ----------------------------
def ArmedLong =
    inRTH and
    EMA9 > EMA20 and
    momUp and
    (if requirePriceVsVWAP then longVWOK else yes) and
    volOK and
    spreadOK;

def ArmedShort =
    inRTH and
    EMA9 < EMA20 and
    momDn and
    (if requirePriceVsVWAP then shortVWOK else yes) and
    volOK and
    spreadOK;

def Armed = ArmedLong or ArmedShort;

# ----------------------------
# Reset tracking
# ----------------------------
rec offCount =
    if BarNumber() == 1 then 999
    else if Armed then 0
    else offCount[1] + 1;

def rearmOK = offCount[1] >= resetBarsNeeded;
def fullResetOK = offCount >= fullResetBars;

# ----------------------------
# Trigger logic (with momentum burst bypass)
# ----------------------------
def LongTurnOn  = ArmedLong  and !ArmedLong[1]  and (rearmOK or momentumBurst);
def ShortTurnOn = ArmedShort and !ArmedShort[1] and (rearmOK or momentumBurst);

rec longLocked =
    if BarNumber() == 1 then 0
    else if fullResetOK then 0
    else if longLocked[1] == 1 and ArmedShort then 0
    else if LongTurnOn and !allowResetReFire then 1
    else longLocked[1];

rec shortLocked =
    if BarNumber() == 1 then 0
    else if fullResetOK then 0
    else if shortLocked[1] == 1 and ArmedLong then 0
    else if ShortTurnOn and !allowResetReFire then 1
    else shortLocked[1];

def LongPulseRaw =
    LongTurnOn and (if allowResetReFire then 1 else longLocked[1] == 0);

def ShortPulseRaw =
    ShortTurnOn and (if allowResetReFire then 1 else shortLocked[1] == 0);

# ----------------------------
# Cooldown (anti-spam)
# ----------------------------
rec cool =
    if BarNumber() == 1 then 0
    else if (LongPulseRaw or ShortPulseRaw) then cooldownBars
    else Max(cool[1] - 1, 0);

def LongPulse  = LongPulseRaw  and cool[1] == 0;
def ShortPulse = ShortPulseRaw and cool[1] == 0;

# ----------------------------
# Visuals
# ----------------------------
AssignPriceColor(
    if !paintBars then Color.CURRENT
    else if ArmedLong then Color.CYAN
    else if ArmedShort then Color.MAGENTA
    else Color.CURRENT
);

plot UpArrow = if showArrows and LongPulse then low - ts else na;
UpArrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
UpArrow.SetDefaultColor(Color.CYAN);
UpArrow.SetLineWeight(4);

plot DnArrow = if showArrows and ShortPulse then high + ts else na;
DnArrow.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
DnArrow.SetDefaultColor(Color.MAGENTA);
DnArrow.SetLineWeight(4);

# ----------------------------
# Labels
# ----------------------------
AddLabel(showLabels,
    "1m SNIPER: " +
    (if !inRTH then "OFF"
     else if LongPulse then "FIRE LONG"
     else if ShortPulse then "FIRE SHORT"
     else if ArmedLong then "ARMED LONG"
     else if ArmedShort then "ARMED SHORT"
     else "WAIT"),
    if !inRTH then Color.DARK_GRAY
    else if LongPulse or ArmedLong then Color.CYAN
    else if ShortPulse or ArmedShort then Color.MAGENTA
    else Color.GRAY
);

AddLabel(showLabels,
    "Vol: " + Round((volume / avgVol) * 100, 0) + "%" +
    (if isCounterVWAP then " (need " + volThresholdCounterPct + "%)" else "") +
    " | Spread: " + Round(emaSpreadTicks, 1) + "t" +
    " | Cool: " + cool,
    if volOK then Color.GREEN else Color.GRAY
);

# Reclaim window status
AddLabel(showLabels,
    "VWAP: " +
    (if inReclaimWindow then
        "RECLAIM WINDOW (" + barsSinceVWAPCross + "/" + reclaimWindowBars + "b)" +
        (if lastCrossDir == 1 then " Short OK" else " Long OK")
     else "STRICT"),
    if inReclaimWindow then Color.YELLOW else Color.DARK_GRAY
);

# Momentum burst indicator
AddLabel(showLabels and momentumBurst,
    "BURST",
    Color.WHITE
);

# ----------------------------
# Directional Bias (Proxy — informational only)
# ----------------------------
input volBiasLookback   = 10;
input volBiasImbalance  = 1.2;

def upVol = if close > open then volume else 0;
def dnVol = if close < open then volume else 0;

def upVolAvg = Average(upVol, volBiasLookback);
def dnVolAvg = Average(dnVol, volBiasLookback);

def volBias =
    if upVolAvg > dnVolAvg * volBiasImbalance then 1
    else if dnVolAvg > upVolAvg * volBiasImbalance then -1
    else 0;

AddLabel(showLabels,
    "Bias(" + volBiasLookback + "): " +
    (if volBias == 1 then "BULL"
     else if volBias == -1 then "BEAR"
     else "MIX"),
    if volBias == 1 then Color.GREEN
    else if volBias == -1 then Color.RED
    else Color.GRAY
);

# ----------------------------
# Alerts
# ----------------------------
Alert(LongPulse,  "MNQ 1m BUY",  Alert.BAR, Sound.Ding);
Alert(ShortPulse, "MNQ 1m SELL", Alert.BAR, Sound.Ding);

plot _keepAlive = na;
_keepAlive.SetHiding(yes);
