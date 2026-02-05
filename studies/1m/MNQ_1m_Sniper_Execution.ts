# =========================================================
# MNQ_1Min_Sniper_Execution_AGG_v2c (Polished + FIXED) - VWAP OVERRIDE UPGRADE
# NEW:
#  - allowShortAboveVWAP: lets SHORT triggers fire even if price is above VWAP
#  - allowLongBelowVWAP:  lets LONG triggers fire even if price is below VWAP (optional)
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

# Keep loose: "wake up" check
input volThresholdPct    = 30;

# Aggressive controls
input vwapBufferTicks    = 0;

# IMPORTANT: Default ON so we don't fire in an EMA knot
input minEMASpreadTicks  = 2;

input cooldownBars       = 2;
input allowResetReFire   = yes;

# Default to 2 to prevent "inside bar" whipsaws
input resetBarsNeeded    = 2;

# If allowResetReFire = NO, require a larger "full reset" to re-arm same direction
input fullResetBars      = 4;

# Hard Filter (Optional)
input requirePriceVsVWAP = yes;

# NEW: VWAP overrides (Option 1)
input allowShortAboveVWAP = no;  # set YES for reclaim/fade shorts
input allowLongBelowVWAP  = no;  # optional symmetry

# Visuals
input paintBars          = yes;
input showArrows         = yes;
input showLabels         = yes;

# ----------------------------
# Session gate
# ----------------------------
input useRTHOnly         = no;
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

# Volume filter
def avgVol = Average(volume, volLength);
def volConfirm = volume >= (avgVol * (volThresholdPct / 100));

# VWAP Logic
def aboveVW = close > (vwapRT + vwapBuf);
def belowVW = close < (vwapRT - vwapBuf);

# NEW: per-side VWAP permission
def longVWOK  = if allowLongBelowVWAP  then 1 else aboveVW;
def shortVWOK = if allowShortAboveVWAP then 1 else belowVW;

# MACD 1m (fast)
def Value = ExpAverage(close, macdFast) - ExpAverage(close, macdSlow);
def Avg   = ExpAverage(Value, macdSignal);

def momUp = Value > Avg;
def momDn = Value < Avg;

# ----------------------------
# ARMED conditions
# ----------------------------
def ArmedLong =
    inRTH and
    EMA9 > EMA20 and
    momUp and
    (if requirePriceVsVWAP then longVWOK else yes) and
    volConfirm and
    spreadOK;

def ArmedShort =
    inRTH and
    EMA9 < EMA20 and
    momDn and
    (if requirePriceVsVWAP then shortVWOK else yes) and
    volConfirm and
    spreadOK;

def Armed = ArmedLong or ArmedShort;

# ----------------------------
# Reset tracking (FIXED)
# ----------------------------
rec offCount =
    if BarNumber() == 1 then 999
    else if Armed then 0
    else offCount[1] + 1;

def rearmOK = offCount[1] >= resetBarsNeeded;
def fullResetOK = offCount >= fullResetBars;

# ----------------------------
# Trigger logic (FIXED)
# ----------------------------
def LongTurnOn  = ArmedLong  and !ArmedLong[1]  and rearmOK;
def ShortTurnOn = ArmedShort and !ArmedShort[1] and rearmOK;

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
    "Vol: " + Round((volume / avgVol) * 100, 0) + "% | Spread: " + Round(emaSpreadTicks, 1) +
    "t | Cool: " + cool + " | Off: " + offCount,
    if volConfirm then Color.GREEN else Color.GRAY
);

# NEW: reminder label so you don't forget override is ON
AddLabel(showLabels,
    "VWAP OVERRIDE | ShortAbove: " + (if allowShortAboveVWAP then "ON" else "OFF") +
    " | LongBelow: " + (if allowLongBelowVWAP then "ON" else "OFF"),
    if (allowShortAboveVWAP or allowLongBelowVWAP) then Color.YELLOW else Color.DARK_GRAY
);

# ----------------------------
# Directional Bias (Proxy)
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
