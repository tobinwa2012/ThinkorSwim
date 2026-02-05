# =========================================================
# MNQ_5m_Permission_GoNoGo_for_1m_vFinal_PLUS
# Upgrades:
#  (1) Warmup gate: ignore permission signals until N RTH bars complete
#  (2) Neutralizer: if bias degrades for N bars, force NEUTRAL (reduces "stale bias")
# =========================================================

declare upper;

def na = Double.NaN;
def ts = TickSize();

# ----------------------------
# Inputs
# ----------------------------
input fastEMA               = 9;
input slowEMA               = 20;

input macdFast              = 12;
input macdSlow              = 26;
input macdSignal            = 9;

input atrLength             = 14;

# Permission quality filters
input confirmBars           = 2;     # require N consecutive 5m bars to CONFIRM a bias
input vwapBufferTicks       = 2;     # must clear VWAP by this many ticks
input minEMASpreadTicks     = 2;     # EMA9-EMA20 spread must be >= this many ticks
input requireEMASlope       = yes;   # EMA9 rising for bull / falling for bear
input holdBiasUntilOpposite = yes;   # reduces flip-flop

# UPGRADE #1: Warmup Gate
input warmupBars            = 3;     # 3 bars = first 15 minutes of RTH (5m chart)

# UPGRADE #2: Neutralizer
input neutralizeBars        = 2;     # require N consecutive "degrade" bars to force NEUTRAL
input neutralizeOnVWAPZone  = yes;   # if price returns into VWAP buffer zone, neutralize
input neutralizeOnSpreadLoss= yes;   # if EMA spread compresses below min, neutralize
input neutralizeOnMomLoss   = yes;   # if MACD momentum condition fails, neutralize

# Session control
input useRTHOnly            = yes;
input rthStart              = 0930;
input rthEnd                = 1600;

# Visuals
input paintBars             = yes;
input paintBackground       = yes;

# Risk sizing (optional label math)
input scalpRiskPoints       = 5.0;
input useATRForRisk         = yes;
input atrStopMult           = 0.5;
input atrTargetMult         = 1.0;

# Alerts
input enableAlerts          = yes;
input alertBull             = yes;
input alertBear             = yes;
input alertNeutral          = yes;

# ----------------------------
# RTH gate + session start
# ----------------------------
def newDay = GetDay() <> GetDay()[1];

def inRTH =
    if !useRTHOnly then 1
    else if SecondsFromTime(rthStart) >= 0 and SecondsTillTime(rthEnd) > 0 then 1
    else 0;

rec seenRTHToday =
    if BarNumber() == 1 then 0
    else if newDay then 0
    else if inRTH then 1
    else seenRTHToday[1];

def newSession =
    if !useRTHOnly then newDay
    else (inRTH and seenRTHToday[1] == 0);

# RTH bar counter (for warmup)
rec rthBarCount =
    if BarNumber() == 1 then 0
    else if !inRTH then 0
    else if newSession then 1
    else rthBarCount[1] + 1;

def warmupDone = if !useRTHOnly then 1 else (rthBarCount > warmupBars);
def allowPerm  = inRTH and warmupDone;

# ----------------------------
# Core calculations
# ----------------------------
def emaF = ExpAverage(close, fastEMA);
def emaS = ExpAverage(close, slowEMA);

def emaSpreadTicks = AbsValue(emaF - emaS) / ts;
def spreadOK = emaSpreadTicks >= minEMASpreadTicks;

def emaSlopeUp = emaF > emaF[1];
def emaSlopeDn = emaF < emaF[1];

# MACD-style momentum
def macdValue   = ExpAverage(close, macdFast) - ExpAverage(close, macdSlow);
def macdSignalV = ExpAverage(macdValue, macdSignal);

def momUp = macdValue > macdSignalV;
def momDn = macdValue < macdSignalV;

# VWAP with buffer
def vwap    = reference VWAP();
def vwapBuf = vwapBufferTicks * ts;

def aboveVWAP = close > (vwap + vwapBuf);
def belowVWAP = close < (vwap - vwapBuf);
def inVWAPZone = AbsValue(close - vwap) <= vwapBuf;

# Raw candidates (permission attempts) — only allowed after warmup
def bullCandidate =
    allowPerm and
    emaF > emaS and
    momUp and
    aboveVWAP and
    spreadOK and
    (if requireEMASlope then emaSlopeUp else 1);

def bearCandidate =
    allowPerm and
    emaF < emaS and
    momDn and
    belowVWAP and
    spreadOK and
    (if requireEMASlope then emaSlopeDn else 1);

# ----------------------------
# Confirmation counters
# ----------------------------
rec bullCount =
    if !allowPerm then 0
    else if bullCandidate then bullCount[1] + 1
    else 0;

rec bearCount =
    if !allowPerm then 0
    else if bearCandidate then bearCount[1] + 1
    else 0;

def bullConfirmed = bullCount >= confirmBars;
def bearConfirmed = bearCount >= confirmBars;

# ----------------------------
# UPGRADE #2: Neutralizer (degrade counters)
# Degrade = you were biased, but structure/momentum/value quality deteriorated
# ----------------------------
def bullDegrade =
    (neutralizeOnVWAPZone and inVWAPZone) or
    (neutralizeOnSpreadLoss and !spreadOK) or
    (neutralizeOnMomLoss and !momUp) or
    (emaF <= emaS) or
    (if requireEMASlope then !emaSlopeUp else 0);

def bearDegrade =
    (neutralizeOnVWAPZone and inVWAPZone) or
    (neutralizeOnSpreadLoss and !spreadOK) or
    (neutralizeOnMomLoss and !momDn) or
    (emaF >= emaS) or
    (if requireEMASlope then !emaSlopeDn else 0);

rec bullDegCount =
    if !allowPerm then 0
    else if bullDegrade then bullDegCount[1] + 1
    else 0;

rec bearDegCount =
    if !allowPerm then 0
    else if bearDegrade then bearDegCount[1] + 1
    else 0;

def neutralizeBull = bullDegCount >= neutralizeBars;
def neutralizeBear = bearDegCount >= neutralizeBars;

# ----------------------------
# Permission state machine
# perm: 1 = long ok, -1 = short ok, 0 = neutral
# ----------------------------
rec perm =
    if BarNumber() == 1 then 0
    else if !allowPerm then 0
    else if holdBiasUntilOpposite then
        (if perm[1] == 1 then
            (if bearConfirmed then -1 else if neutralizeBull then 0 else 1)
         else if perm[1] == -1 then
            (if bullConfirmed then 1 else if neutralizeBear then 0 else -1)
         else
            (if bullConfirmed then 1 else if bearConfirmed then -1 else 0))
    else
        (if bullConfirmed then 1 else if bearConfirmed then -1 else 0);

def BullBias    = perm == 1;
def BearBias    = perm == -1;
def NeutralBias = perm == 0;

# ----------------------------
# Visuals
# ----------------------------
AssignPriceColor(
    if !paintBars then Color.CURRENT
    else if !allowPerm then Color.GRAY
    else if BullBias then Color.GREEN
    else if BearBias then Color.RED
    else Color.DARK_GRAY
);

AssignBackgroundColor(
    if !paintBackground then Color.CURRENT
    else if !allowPerm then Color.BLACK
    else if BullBias then Color.DARK_GREEN
    else if BearBias then Color.DARK_RED
    else Color.DARK_GRAY
);

# ----------------------------
# ATR + bracket math (label only)
# ----------------------------
def atrPoints  = Average(TrueRange(high, close, low), atrLength);
def stopPts    = if useATRForRisk then (atrPoints * atrStopMult) else scalpRiskPoints;
def targetPts  = if useATRForRisk then (atrPoints * atrTargetMult) else (scalpRiskPoints * 2);

def stopTicks   = Round(stopPts * 4, 0);
def targetTicks = Round(targetPts * 4, 0);

# ----------------------------
# Labels
# ----------------------------
AddLabel(yes,
    "5m PERM: " +
    (if !inRTH then "RTH OFF"
     else if !warmupDone then "WARMUP (" + rthBarCount + "/" + (warmupBars + 1) + ")"
     else if BullBias then "BULL (Longs OK)"
     else if BearBias then "BEAR (Shorts OK)"
     else "NEUTRAL") +
    " | Spread: " + Round(emaSpreadTicks, 1) + "t | VWAPbuf: " + vwapBufferTicks + "t",
    if !inRTH then Color.DARK_GRAY
    else if !warmupDone then Color.GRAY
    else if BullBias then Color.GREEN
    else if BearBias then Color.RED
    else Color.GRAY
);

AddLabel(yes,
    "ATR(5m): " + Round(atrPoints, 2) +
    " | STOP: " + Round(stopPts, 2) + " (" + stopTicks + "t)" +
    " | TGT: " + Round(targetPts, 2) + " (" + targetTicks + "t)",
    Color.WHITE
);

# ----------------------------
# Alerts (permission shifts only)
# ----------------------------
def bullShift = enableAlerts and allowPerm and !BullBias[1] and BullBias;
def bearShift = enableAlerts and allowPerm and !BearBias[1] and BearBias;
def neutShift = enableAlerts and allowPerm and !NeutralBias[1] and NeutralBias;

Alert(alertBull and bullShift, "5m PERMISSION: BULL (1m LONGS OK)", Alert.BAR, Sound.Ring);
Alert(alertBear and bearShift, "5m PERMISSION: BEAR (1m SHORTS OK)", Alert.BAR, Sound.Ring);
Alert(alertNeutral and neutShift, "5m PERMISSION: NEUTRAL (NO-GO)", Alert.BAR, Sound.Chimes);

plot _keepAlive = na;
_keepAlive.SetHiding(yes);
