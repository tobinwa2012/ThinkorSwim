# =========================================================
# MNQ_5m_Permission_GoNoGo v2
# Changes from v1:
#   (1) Replaced EMA/MACD with ADX/DMI — independent from Sniper's EMA/MACD
#   (2) ADX threshold replaces EMA spread as trend quality gate
#   (3) DI+/DI- directional spread replaces EMA crossover
#   (4) Kept: VWAP alignment, warmup gate, neutralizer, confirmBars
# =========================================================

declare upper;

def na = Double.NaN;
def ts = TickSize();

# ----------------------------
# Inputs
# ----------------------------
input adxLength             = 14;
input adxMinTrend           = 20;    # ADX must be >= this to confirm a trend exists
input adxStrongTrend        = 30;    # label-only: strong trend threshold
input diSpreadMin           = 3;     # DI+ must lead DI- by this much (or vice versa)

input atrLength             = 14;

# Permission quality filters
input confirmBars           = 2;     # require N consecutive 5m bars to CONFIRM a bias
input vwapBufferTicks       = 2;     # must clear VWAP by this many ticks
input holdBiasUntilOpposite = yes;   # reduces flip-flop

# Warmup Gate
input warmupBars            = 3;     # 3 bars = first 15 minutes of RTH (5m chart)

# Neutralizer
input neutralizeBars        = 2;
input neutralizeOnVWAPZone  = yes;
input neutralizeOnWeakTrend = yes;   # ADX drops below adxMinTrend
input neutralizeOnDISqueeze = yes;   # DI spread collapses below diSpreadMin

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
# Core: ADX/DMI (independent from Sniper's EMA/MACD)
# ----------------------------
def tr = TrueRange(high, close, low);
def atrSmooth = WildersAverage(tr, adxLength);

def plusDM  = if high - high[1] > low[1] - low and high - high[1] > 0
              then high - high[1] else 0;
def minusDM = if low[1] - low > high - high[1] and low[1] - low > 0
              then low[1] - low else 0;

def diPlus  = if atrSmooth > 0
              then 100 * WildersAverage(plusDM, adxLength) / atrSmooth else 0;
def diMinus = if atrSmooth > 0
              then 100 * WildersAverage(minusDM, adxLength) / atrSmooth else 0;

def dx = if (diPlus + diMinus) > 0
         then 100 * AbsValue(diPlus - diMinus) / (diPlus + diMinus) else 0;
def adxVal = WildersAverage(dx, adxLength);

def trendExists  = adxVal >= adxMinTrend;
def diSpread     = AbsValue(diPlus - diMinus);
def diSpreadOK   = diSpread >= diSpreadMin;
def bullDI       = diPlus > diMinus;
def bearDI       = diMinus > diPlus;
def adxRising    = adxVal > adxVal[1];

# VWAP with buffer
def vwap    = reference VWAP();
def vwapBuf = vwapBufferTicks * ts;

def aboveVWAP  = close > (vwap + vwapBuf);
def belowVWAP  = close < (vwap - vwapBuf);
def inVWAPZone = AbsValue(close - vwap) <= vwapBuf;

# ----------------------------
# Raw candidates
# ----------------------------
def bullCandidate =
    allowPerm and
    bullDI and
    trendExists and
    diSpreadOK and
    aboveVWAP;

def bearCandidate =
    allowPerm and
    bearDI and
    trendExists and
    diSpreadOK and
    belowVWAP;

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
# Neutralizer
# ----------------------------
def bullDegrade =
    (neutralizeOnVWAPZone and inVWAPZone) or
    (neutralizeOnWeakTrend and !trendExists) or
    (neutralizeOnDISqueeze and !diSpreadOK) or
    (!bullDI);

def bearDegrade =
    (neutralizeOnVWAPZone and inVWAPZone) or
    (neutralizeOnWeakTrend and !trendExists) or
    (neutralizeOnDISqueeze and !diSpreadOK) or
    (!bearDI);

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
    " | ADX: " + Round(adxVal, 1) +
    " | DI+: " + Round(diPlus, 1) +
    " DI-: " + Round(diMinus, 1),
    if !inRTH then Color.DARK_GRAY
    else if !warmupDone then Color.GRAY
    else if BullBias then Color.GREEN
    else if BearBias then Color.RED
    else Color.GRAY
);

AddLabel(yes,
    "TREND: " +
    (if adxVal >= adxStrongTrend then "STRONG"
     else if adxVal >= adxMinTrend then "TRENDING"
     else "WEAK/CHOP") +
    (if adxRising then " ^" else " v"),
    if adxVal >= adxStrongTrend then Color.GREEN
    else if adxVal >= adxMinTrend then Color.YELLOW
    else Color.RED
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
