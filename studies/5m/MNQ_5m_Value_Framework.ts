# =========================================================
# MNQ_5m_Value_Framework_CLEAN_v1c_ASCII_B (Y-VA LOCK + SIG EVENT FIX)
# Fixes:
#   (1) Deterministic newSession (fires ONCE when entering RTH)
#   (2) Hard guard so Y-VAH/Y-VAL/Y-POC can only latch once per day
#   (3) SIG label now tracks last fired EVENT (matches Message Center)
#   (4) Tick-rounding for cleaner prices / consistent levels
# =========================================================

declare upper;

def na = Double.NaN;
def ts = TickSize();

# ----------------------------
# Inputs
# ----------------------------
input useRTHOnly              = yes;
input rthStart                = 0930;
input rthEnd                  = 1600;

# VISUALS (DEFAULTS = CLEAN)
input showYellowYVA           = yes;
input showYellowYPOC          = no;
input showRedDevelopingPOC    = yes;

input showCyanDevelopingVA    = no;
input showOverlapLines        = no;
input showOverlapCloud        = no;

# LABELS
input showStatusLabel         = yes;
input statusLastBarOnly       = yes;

# ALERT MODES (hard barriers)
input alertOnBreakout         = yes;
input alertOnReclaim          = yes;
input alertOnGapFade          = yes;

# Optional alerts
input alertOnPOC              = no;
input alertOnOverlap          = no;

# SENSITIVITY
input useCloseCross           = yes;   # YES=close-confirmed; NO=touch
input reArmTicks              = 10;
input reArmTicksPOC           = 16;

# 2-step confirmation buffers (ticks beyond level on confirmation bar)
input confirmTicksVA          = 2;
input confirmTicksOverlap     = 2;
input confirmTicksPOC         = 4;

# Overlap Gate
input gateOverlapUntilTime    = yes;
input overlapStartTime        = 1015;

# Kill Zones (execution zones around Y-VAH / Y-VAL)
input kzEnable            = yes;
input kzToleranceTicks    = 12;
input kzReArmTicks        = 24;
input kzShowCloud         = yes;
input kzEnableAlerts      = yes;
input kzUseCloseEntry     = yes;  # yes=close inside zone; no=touch (hi/lo)

# 2-Label system
input showLocationLabel   = yes;
input showSignalLabel     = yes;
input signalFreshBars     = 5;

# Debug
input showDebugPlots          = no;

def reArmDist    = reArmTicks * ts;
def reArmDistPOC = reArmTicksPOC * ts;

def confVA       = confirmTicksVA * ts;
def confOL       = confirmTicksOverlap * ts;
def confPOC      = confirmTicksPOC * ts;

# =========================================================
# 1) Deterministic Day + RTH Session Logic (NO re-triggers)
# =========================================================
def newDay = GetDay() <> GetDay()[1];

def inRTH_now =
    if !useRTHOnly then 1
    else if SecondsFromTime(rthStart) >= 0 and SecondsTillTime(rthEnd) > 0 then 1
    else 0;

# Fires once: the bar that ENTERS RTH
def newSession =
    if !useRTHOnly then newDay
    else inRTH_now and !inRTH_now[1];

def showNow = if useRTHOnly then inRTH_now else 1;

# No alerts on first RTH bar
def safeToAlert = showNow and !newSession and BarNumber() > 1;

# Label gate (last bar only if desired)
def isLastBar = !IsNaN(close) and IsNaN(close[-1]);
def statusGate = if statusLastBarOnly then isLastBar else yes;

# =========================================================
# 2) Volume Profile Core (RTH session profile)
# =========================================================
profile vp = VolumeProfile(
    "startNewProfile" = newSession,
    "onExpansion"     = no
);

def rawVAH = vp.GetHighestValueArea();
def rawVAL = vp.GetLowestValueArea();
def rawPOC = vp.GetPointOfControl();

# Tick-round helper
def RoundToTick = if ts > 0 then Round(close / ts, 0) * ts else close; # dummy to satisfy syntax

# Developing levels (update only during RTH if useRTHOnly=yes)
rec dVAH =
    if BarNumber() == 1 then na
    else if newSession then rawVAH
    else if (showNow and !IsNaN(rawVAH)) then rawVAH
    else dVAH[1];

rec dVAL =
    if BarNumber() == 1 then na
    else if newSession then rawVAL
    else if (showNow and !IsNaN(rawVAL)) then rawVAL
    else dVAL[1];

rec dPOC =
    if BarNumber() == 1 then na
    else if newSession then rawPOC
    else if (showNow and !IsNaN(rawPOC)) then rawPOC
    else dPOC[1];

# Tick-rounded developing (clean display + consistent levels)
def dVAH_L = if !IsNaN(dVAH) then Round(dVAH / ts, 0) * ts else na;
def dVAL_L = if !IsNaN(dVAL) then Round(dVAL / ts, 0) * ts else na;
def dPOC_L = if !IsNaN(dPOC) then Round(dPOC / ts, 0) * ts else na;

# =========================================================
# 3) Capture FINAL RTH levels, then roll forward at RTH open
# =========================================================
rec lastRTH_VAH =
    if BarNumber() == 1 then na
    else if (showNow and !IsNaN(rawVAH)) then rawVAH
    else lastRTH_VAH[1];

rec lastRTH_VAL =
    if BarNumber() == 1 then na
    else if (showNow and !IsNaN(rawVAL)) then rawVAL
    else lastRTH_VAL[1];

rec lastRTH_POC =
    if BarNumber() == 1 then na
    else if (showNow and !IsNaN(rawPOC)) then rawPOC
    else lastRTH_POC[1];

# --- HARD GUARD: latch Y values ONCE per day only ---
rec yLatchDay =
    if BarNumber() == 1 then 0
    else if newSession then GetDay()
    else yLatchDay[1];

rec yVAH =
    if BarNumber() == 1 then na
    else if newSession and yLatchDay[1] <> GetDay() and !IsNaN(lastRTH_VAH[1]) then lastRTH_VAH[1]
    else yVAH[1];

rec yVAL =
    if BarNumber() == 1 then na
    else if newSession and yLatchDay[1] <> GetDay() and !IsNaN(lastRTH_VAL[1]) then lastRTH_VAL[1]
    else yVAL[1];

rec yPOC =
    if BarNumber() == 1 then na
    else if newSession and yLatchDay[1] <> GetDay() and !IsNaN(lastRTH_POC[1]) then lastRTH_POC[1]
    else yPOC[1];

# Tick-rounded Y levels (use everywhere)
def yVAH_L = if !IsNaN(yVAH) then Round(yVAH / ts, 0) * ts else na;
def yVAL_L = if !IsNaN(yVAL) then Round(yVAL / ts, 0) * ts else na;
def yPOC_L = if !IsNaN(yPOC) then Round(yPOC / ts, 0) * ts else na;

# Use locked Y-VA from the bar BEFORE the open for gap detection
def yVAH_s = if newSession then yVAH_L[1] else yVAH_L;
def yVAL_s = if newSession then yVAL_L[1] else yVAL_L;

def yReady = !IsNaN(yVAH_L) and !IsNaN(yVAL_L) and !IsNaN(yPOC_L);
def tReady = !IsNaN(dPOC_L) and !IsNaN(dVAH_L) and !IsNaN(dVAL_L);

# Context code: 1=bull structure, -1=bear structure, 2=balanced
def ctxCode =
    if !yReady or !tReady then 0
    else if dVAL_L > yVAH_L then 1
    else if dVAH_L < yVAL_L then -1
    else 2;

# =========================================================
# 4) Overlap (Y ∩ dVA) + time gate
# =========================================================
def overlapHighRaw = Min(dVAH_L, yVAH_L);
def overlapLowRaw  = Max(dVAL_L, yVAL_L);
def hasOverlapRaw  = overlapHighRaw > overlapLowRaw;

def afterGate =
    if gateOverlapUntilTime then SecondsFromTime(overlapStartTime) >= 0 else 1;

def hasOverlap = hasOverlapRaw and afterGate;

def overlapHigh = if hasOverlap then overlapHighRaw else na;
def overlapLow  = if hasOverlap then overlapLowRaw  else na;

def overlapHighChanged = hasOverlap and !IsNaN(overlapHigh) and overlapHigh != overlapHigh[1];
def overlapLowChanged  = hasOverlap and !IsNaN(overlapLow)  and overlapLow  != overlapLow[1];

# =========================================================
# 4B) KILL ZONES (Execution Zones around Y-VAH / Y-VAL)
# =========================================================
def kzTol  = kzToleranceTicks * ts;
def kzReA  = kzReArmTicks * ts;

def kzReady = yReady;

def kzTopTop = yVAH_L + kzTol;
def kzTopBot = yVAH_L - kzTol;

def kzBotTop = yVAL_L + kzTol;
def kzBotBot = yVAL_L - kzTol;

def kzInTop =
    kzEnable and showNow and kzReady and
    (if kzUseCloseEntry
     then (close <= kzTopTop and close >= kzTopBot)
     else (high >= kzTopBot and low <= kzTopTop));

def kzInBot =
    kzEnable and showNow and kzReady and
    (if kzUseCloseEntry
     then (close <= kzBotTop and close >= kzBotBot)
     else (high >= kzBotBot and low <= kzBotTop));

def kzEnterTop = kzInTop and !kzInTop[1];
def kzEnterBot = kzInBot and !kzInBot[1];

def kzFarFromVAH = kzReady and AbsValue(close - yVAH_L) > (kzTol + kzReA);
def kzFarFromVAL = kzReady and AbsValue(close - yVAL_L) > (kzTol + kzReA);

rec kzTopArmed =
    if BarNumber() == 1 then 1
    else if !showNow then 1
    else if kzTopArmed[1] == 0 and kzFarFromVAH then 1
    else if kzTopArmed[1] == 1 and kzEnterTop then 0
    else kzTopArmed[1];

rec kzBotArmed =
    if BarNumber() == 1 then 1
    else if !showNow then 1
    else if kzBotArmed[1] == 0 and kzFarFromVAL then 1
    else if kzBotArmed[1] == 1 and kzEnterBot then 0
    else kzBotArmed[1];

def kzTopAlert = kzEnableAlerts and safeToAlert and kzTopArmed[1] == 1 and kzEnterTop;
def kzBotAlert = kzEnableAlerts and safeToAlert and kzBotArmed[1] == 1 and kzEnterBot;

AddCloud(
    if kzShowCloud and kzEnable and showNow and kzReady then kzTopTop else na,
    if kzShowCloud and kzEnable and showNow and kzReady then kzTopBot else na,
    Color.LIGHT_GREEN, Color.LIGHT_GREEN
);

AddCloud(
    if kzShowCloud and kzEnable and showNow and kzReady then kzBotTop else na,
    if kzShowCloud and kzEnable and showNow and kzReady then kzBotBot else na,
    Color.PINK, Color.PINK
);

Alert(kzTopAlert, "5m: @ Y-VAH ZONE - Watch for Rejection", Alert.BAR, Sound.Ding);
Alert(kzBotAlert, "5m: @ Y-VAL ZONE - Watch for Support", Alert.BAR, Sound.Ding);

# =========================================================
# 5) Cross Helper (directional)
# =========================================================
script CheckCrossDir {
    input level = 0.0;
    input useClose = yes;
    input dir = 1;

    def cross =
        if IsNaN(level) then 0
        else if useClose then
            (if dir == 1
             then (close[1] <= level and close > level)
             else (close[1] >= level and close < level))
        else
            (if dir == 1
             then (high >= level and high[1] < level)
             else (low  <= level and low[1]  > level));

    plot out = cross;
}

# =========================================================
# 6) 2-step Confirmation
# =========================================================
def pocLevel = if !IsNaN(dPOC_L[1]) then dPOC_L[1] else dPOC_L;
def olhLevel = if !IsNaN(overlapHigh[1]) then overlapHigh[1] else overlapHigh;
def ollLevel = if !IsNaN(overlapLow[1])  then overlapLow[1]  else overlapLow;

def attemptBreakYVAH =
    safeToAlert and alertOnBreakout and yReady and
    CheckCrossDir(level = yVAH_L, useClose = useCloseCross, dir = 1);

def attemptBreakYVAL =
    safeToAlert and alertOnBreakout and yReady and
    CheckCrossDir(level = yVAL_L, useClose = useCloseCross, dir = -1);

def attemptReclaimYVAH =
    safeToAlert and alertOnReclaim and yReady and
    CheckCrossDir(level = yVAH_L, useClose = useCloseCross, dir = -1);

def attemptReclaimYVAL =
    safeToAlert and alertOnReclaim and yReady and
    CheckCrossDir(level = yVAL_L, useClose = useCloseCross, dir = 1);

def attemptCrossOLH =
    safeToAlert and alertOnOverlap and hasOverlap and !IsNaN(olhLevel) and
    CheckCrossDir(level = olhLevel, useClose = useCloseCross, dir = 1);

def attemptCrossOLL =
    safeToAlert and alertOnOverlap and hasOverlap and !IsNaN(ollLevel) and
    CheckCrossDir(level = ollLevel, useClose = useCloseCross, dir = -1);

def attemptPOCUp =
    safeToAlert and alertOnPOC and !IsNaN(pocLevel) and
    CheckCrossDir(level = pocLevel, useClose = useCloseCross, dir = 1);

def attemptPOCDn =
    safeToAlert and alertOnPOC and !IsNaN(pocLevel) and
    CheckCrossDir(level = pocLevel, useClose = useCloseCross, dir = -1);

def confirmBreakYVAH =
    attemptBreakYVAH[1] and
    (if useCloseCross then close > (yVAH_L + confVA) else high > (yVAH_L + confVA));

def confirmBreakYVAL =
    attemptBreakYVAL[1] and
    (if useCloseCross then close < (yVAL_L - confVA) else low < (yVAL_L - confVA));

def confirmReclaimYVAH =
    attemptReclaimYVAH[1] and
    (if useCloseCross then close < (yVAH_L - confVA) else low < (yVAH_L - confVA));

def confirmReclaimYVAL =
    attemptReclaimYVAL[1] and
    (if useCloseCross then close > (yVAL_L + confVA) else high > (yVAL_L + confVA));

def confirmCrossOLH =
    attemptCrossOLH[1] and
    (if useCloseCross then close > (olhLevel + confOL) else high > (olhLevel + confOL));

def confirmCrossOLL =
    attemptCrossOLL[1] and
    (if useCloseCross then close < (ollLevel - confOL) else low < (ollLevel - confOL));

def confirmPOCUp =
    attemptPOCUp[1] and
    (if useCloseCross then close > (pocLevel + confPOC) else high > (pocLevel + confPOC));

def confirmPOCDn =
    attemptPOCDn[1] and
    (if useCloseCross then close < (pocLevel - confPOC) else low < (pocLevel - confPOC));

def confirmCrossPOC = confirmPOCUp or confirmPOCDn;

# =========================================================
# 6B) GAP FADE (Open outside -> Cross back inside, one-shot)
# =========================================================
def gapOpenBuf = confVA;

rec gapDir =
    if BarNumber() == 1 then 0
    else if newSession then
        (if yReady[1] and open > (yVAH_s + gapOpenBuf) then 1
         else if yReady[1] and open < (yVAL_s - gapOpenBuf) then -1
         else 0)
    else gapDir[1];

rec gapOutside =
    if BarNumber() == 1 then 0
    else if newSession then (if gapDir != 0 then 1 else 0)
    else if gapOutside[1] == 1 then
        (if gapDir[1] == 1 then
            (if useCloseCross then (if close < yVAH_L then 0 else 1)
             else (if low <= yVAH_L then 0 else 1))
         else if gapDir[1] == -1 then
            (if useCloseCross then (if close > yVAL_L then 0 else 1)
             else (if high >= yVAL_L then 0 else 1))
         else 0)
    else 0;

def crossedBackIn =
    showNow and alertOnGapFade and gapOutside[1] == 1 and gapOutside == 0;

# =========================================================
# 7) Re-arm states
# =========================================================
rec stateYVAH =
    if newSession or !yReady then 0
    else if stateYVAH[1] == 0 and confirmBreakYVAH then 1
    else if stateYVAH[1] == 1 and confirmReclaimYVAH then 2
    else if stateYVAH[1] == 1 and close >= (yVAH_L + reArmDist) then 3
    else if stateYVAH[1] == 2 and AbsValue(close - yVAH_L) > reArmDist then 0
    else if stateYVAH[1] == 3 and AbsValue(close - yVAH_L) <= reArmDist then 0
    else stateYVAH[1];

rec stateYVAL =
    if newSession or !yReady then 0
    else if stateYVAL[1] == 0 and confirmBreakYVAL then 1
    else if stateYVAL[1] == 1 and confirmReclaimYVAL then 2
    else if stateYVAL[1] == 1 and close <= (yVAL_L - reArmDist) then 3
    else if stateYVAL[1] == 2 and AbsValue(close - yVAL_L) > reArmDist then 0
    else if stateYVAL[1] == 3 and AbsValue(close - yVAL_L) <= reArmDist then 0
    else stateYVAL[1];

rec stateOLH =
    if newSession or !hasOverlap or overlapHighChanged then 0
    else if stateOLH[1] == 0 and confirmCrossOLH then 1
    else if stateOLH[1] == 1 and AbsValue(close - olhLevel) > reArmDist then 0
    else stateOLH[1];

rec stateOLL =
    if newSession or !hasOverlap or overlapLowChanged then 0
    else if stateOLL[1] == 0 and confirmCrossOLL then 1
    else if stateOLL[1] == 1 and AbsValue(close - ollLevel) > reArmDist then 0
    else stateOLL[1];

rec statePOC =
    if newSession or !alertOnPOC or IsNaN(pocLevel) then 0
    else if statePOC[1] == 0 and confirmCrossPOC then 1
    else if statePOC[1] == 1 and AbsValue(close - pocLevel) > reArmDistPOC then 0
    else statePOC[1];

# =========================================================
# 8) Alerts
# =========================================================
Alert(confirmBreakYVAH and stateYVAH[1] == 0, "MNQ 5m: CONFIRMED BREAKOUT ABOVE Y-VAH", Alert.BAR, Sound.Ring);
Alert(confirmBreakYVAL and stateYVAL[1] == 0, "MNQ 5m: CONFIRMED BREAKOUT BELOW Y-VAL", Alert.BAR, Sound.Ring);

Alert(confirmReclaimYVAH and stateYVAH[1] == 1, "MNQ 5m: CONFIRMED FAILED BREAKOUT (Reclaim Y-VAH)", Alert.BAR, Sound.Ding);
Alert(confirmReclaimYVAL and stateYVAL[1] == 1, "MNQ 5m: CONFIRMED FAILED BREAKOUT (Reclaim Y-VAL)", Alert.BAR, Sound.Ding);

Alert(crossedBackIn and gapDir[1] == 1, "MNQ 5m: GAP FADE (Opened ABOVE Y-VAH, back INTO VALUE)", Alert.BAR, Sound.Chimes);
Alert(crossedBackIn and gapDir[1] == -1, "MNQ 5m: GAP FADE (Opened BELOW Y-VAL, back INTO VALUE)", Alert.BAR, Sound.Chimes);

Alert(confirmCrossOLH and stateOLH[1] == 0, "MNQ 5m: CONFIRMED OVERLAP HIGH CROSS (OLH)", Alert.BAR, Sound.Bell);
Alert(confirmCrossOLL and stateOLL[1] == 0, "MNQ 5m: CONFIRMED OVERLAP LOW CROSS (OLL)", Alert.BAR, Sound.Bell);
Alert(confirmCrossPOC and statePOC[1] == 0, "MNQ 5m: CONFIRMED CROSS OF d-POC", Alert.BAR, Sound.Ding);

# =========================================================
# 8B) LOCATION + SIGNAL labels
# =========================================================
def distToYVAH_loc = if yReady then Round(AbsValue(close - yVAH_L) / ts, 0) else Double.NaN;
def distToYVAL_loc = if yReady then Round(AbsValue(close - yVAL_L) / ts, 0) else Double.NaN;

def useVAH_loc      = yReady and distToYVAH_loc < distToYVAL_loc;
def nearestDist_loc = if !yReady then Double.NaN else (if useVAH_loc then distToYVAH_loc else distToYVAL_loc);

def inOverlapNow = hasOverlap and close >= overlapLow and close <= overlapHigh;

AddLabel(showLocationLabel and showNow and statusGate,
    if !yReady then "LOC: LOADING"
    else if kzInTop then "LOC: @ VAH ZONE"
    else if kzInBot then "LOC: @ VAL ZONE"
    else if close > yVAH_L then "LOC: ABOVE VAH (" + AsText(distToYVAH_loc) + "t)"
    else if close < yVAL_L then "LOC: BELOW VAL (" + AsText(distToYVAL_loc) + "t)"
    else if inOverlapNow then "LOC: IN OVERLAP"
    else "LOC: IN VALUE (" + (if useVAH_loc then "VAH" else "VAL") + " " + AsText(nearestDist_loc) + "t)",
    if !yReady then Color.RED
    else if kzInTop or kzInBot then Color.YELLOW
    else if close > yVAH_L then Color.GREEN
    else if close < yVAL_L then Color.RED
    else if nearestDist_loc <= 10 then Color.YELLOW
    else if nearestDist_loc <= 20 then Color.ORANGE
    else Color.GRAY
);

# --- Event flags (these match the Alerts exactly) ---
def fireBreakAbove   = confirmBreakYVAH and stateYVAH[1] == 0;
def fireBreakBelow   = confirmBreakYVAL and stateYVAL[1] == 0;

def fireReclaimVAH   = confirmReclaimYVAH and stateYVAH[1] == 1;
def fireReclaimVAL   = confirmReclaimYVAL and stateYVAL[1] == 1;

def fireGapAboveFade = crossedBackIn and gapDir[1] == 1;
def fireGapBelowFade = crossedBackIn and gapDir[1] == -1;

def fireKZTop = kzTopAlert;
def fireKZBot = kzBotAlert;

# --- SIG EVENT FIX: record the last *event* that fired (no contradictions) ---
def eventCode =
    if fireReclaimVAH then 5
    else if fireReclaimVAL then 6
    else if fireBreakAbove then 3
    else if fireBreakBelow then 4
    else if fireGapAboveFade then 1
    else if fireGapBelowFade then 2
    else if fireKZTop then 7
    else if fireKZBot then 8
    else 0;

rec lastEventBar =
    if BarNumber() == 1 then 0
    else if safeToAlert and eventCode != 0 then BarNumber()
    else lastEventBar[1];

rec lastEventCode =
    if BarNumber() == 1 then 0
    else if safeToAlert and eventCode != 0 then eventCode
    else lastEventCode[1];

def sigAge   = if lastEventBar == 0 then 999 else (BarNumber() - lastEventBar);
def sigFresh = sigAge <= signalFreshBars;

AddLabel(showSignalLabel and showNow and statusGate,
    if !yReady then "SIG: --"
    else if sigFresh then
        (if lastEventCode == 1 then "SIG GAP FADE (Above->In) -> SHORT (" + sigAge + "b)"
         else if lastEventCode == 2 then "SIG GAP FADE (Below->In) -> LONG (" + sigAge + "b)"
         else if lastEventCode == 3 then "SIG BREAK ABOVE -> LONG (" + sigAge + "b)"
         else if lastEventCode == 4 then "SIG BREAK BELOW -> SHORT (" + sigAge + "b)"
         else if lastEventCode == 5 then "SIG RECLAIM VAH -> SHORT (" + sigAge + "b)"
         else if lastEventCode == 6 then "SIG RECLAIM VAL -> LONG (" + sigAge + "b)"
         else if lastEventCode == 7 then "SIG @ VAH - Watch Reject (" + sigAge + "b)"
         else if lastEventCode == 8 then "SIG @ VAL - Watch Support (" + sigAge + "b)"
         else "SIG: --")
    else "SIG: none",
    if !yReady then Color.DARK_GRAY
    else if sigFresh then Color.CYAN
    else Color.DARK_GRAY
);

# =========================================================
# 9) Plots (minimal by default)
# =========================================================
plot YVAHLine = if showYellowYVA and showNow and yReady then yVAH_L else na;
YVAHLine.SetDefaultColor(Color.YELLOW);
YVAHLine.SetStyle(Curve.SHORT_DASH);
YVAHLine.SetLineWeight(2);

plot YVALLine = if showYellowYVA and showNow and yReady then yVAL_L else na;
YVALLine.SetDefaultColor(Color.YELLOW);
YVALLine.SetStyle(Curve.SHORT_DASH);
YVALLine.SetLineWeight(2);

plot YPOCLine = if showYellowYPOC and showNow and yReady then yPOC_L else na;
YPOCLine.SetDefaultColor(Color.YELLOW);
YPOCLine.SetStyle(Curve.LONG_DASH);
YPOCLine.SetLineWeight(1);

plot DPOCLine = if showRedDevelopingPOC and showNow and !IsNaN(dPOC_L) then dPOC_L else na;
DPOCLine.SetDefaultColor(Color.RED);
DPOCLine.SetStyle(Curve.SHORT_DASH);
DPOCLine.SetLineWeight(2);

plot DVAHLine = if showCyanDevelopingVA and showNow and !IsNaN(dVAH_L) then dVAH_L else na;
DVAHLine.SetDefaultColor(Color.CYAN);
DVAHLine.SetStyle(Curve.SHORT_DASH);
DVAHLine.SetLineWeight(1);

plot DVALLine = if showCyanDevelopingVA and showNow and !IsNaN(dVAL_L) then dVAL_L else na;
DVALLine.SetDefaultColor(Color.CYAN);
DVALLine.SetStyle(Curve.SHORT_DASH);
DVALLine.SetLineWeight(1);

plot OverlapHighLine = if showOverlapLines and showNow and hasOverlap then overlapHigh else na;
OverlapHighLine.SetDefaultColor(Color.ORANGE);
OverlapHighLine.SetStyle(Curve.SHORT_DASH);
OverlapHighLine.SetLineWeight(1);

plot OverlapLowLine = if showOverlapLines and showNow and hasOverlap then overlapLow else na;
OverlapLowLine.SetDefaultColor(Color.ORANGE);
OverlapLowLine.SetStyle(Curve.SHORT_DASH);
OverlapLowLine.SetLineWeight(1);

AddCloud(
    if showOverlapCloud and showNow and hasOverlap then OverlapHighLine else na,
    if showOverlapCloud and showNow and hasOverlap then OverlapLowLine  else na,
    Color.DARK_ORANGE,
    Color.DARK_ORANGE
);

# =========================================================
# 10) Status label (ASCII)
# =========================================================
AddLabel(showStatusLabel and statusGate,
    if !showNow then "5m: RTH OFF"
    else if !yReady then "5m: LOADING"
    else
        "Y-VAH " + AsPrice(yVAH_L) + " | Y-VAL " + AsPrice(yVAL_L) + " | dPOC " + AsPrice(dPOC_L) +
        " || " +
        (if ctxCode == 1 then "BULL STRUCTURE"
         else if ctxCode == -1 then "BEAR STRUCTURE"
         else "BALANCED") +
        (if gapDir == 1 then " | GAP UP" else if gapDir == -1 then " | GAP DN" else ""),
    if !showNow then Color.DARK_GRAY
    else if !yReady then Color.RED
    else if ctxCode == 1 then Color.GREEN
    else if ctxCode == -1 then Color.RED
    else Color.GRAY
);

# =========================================================
# OPTIONAL DEBUG (toggle via input)
# =========================================================
rec sessionCount = if BarNumber() == 1 then 0 else if newSession then sessionCount[1] + 1 else sessionCount[1];
AddLabel(showDebugPlots, "DBG sessionsToday=" + sessionCount + " | inRTH=" + inRTH_now, Color.WHITE);

# ----------------------------
# EXPORTS (for other studies)
# ----------------------------
plot Export_YVAH = yVAH_L; Export_YVAH.SetHiding(yes);
plot Export_YVAL = yVAL_L; Export_YVAL.SetHiding(yes);
plot Export_dPOC = dPOC_L; Export_dPOC.SetHiding(yes);

plot Export_InOverlap = hasOverlap and (close >= overlapLow and close <= overlapHigh);
Export_InOverlap.SetHiding(yes);

plot Export_OverlapActive = hasOverlap;
Export_OverlapActive.SetHiding(yes);

plot _keepAlive = na;
_keepAlive.SetHiding(yes);
