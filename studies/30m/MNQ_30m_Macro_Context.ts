# =========================================================
# MNQ_30m_Macro_Context v1.1
#
# v1.1 changes from v1:
#   Profile boundary added at endOfRTH so ETH bars go into
#   a separate throwaway profile. Without this, on chart
#   reload TOS retroactively includes ETH volume in the RTH
#   profile, shifting rawVAH/VAL/POC on historical bars and
#   contaminating the Y-VA snapshot. yVAH latches at next
#   morning's newSession, so the RTH-only profile is fully
#   frozen by then.
#
# Purpose: Higher-timeframe context layer for the MNQ scalping system.
#   Answers questions the 5m/1m studies cannot:
#   - Is this a TREND day or a ROTATION day?
#   - Where is Initial Balance? How extended beyond it?
#   - Is value migrating higher/lower across sessions?
#   - Where is the weekly VWAP (institutional anchor)?
#
# Designed for 30m chart. Adjustable via ibBars input for other TFs:
#   30m: ibBars=2 (1hr IB)  |  15m: ibBars=4  |  1h: ibBars=1
#
# Signal independence: This study uses PRICE STRUCTURE and VALUE
#   (IB range, VA migration, VWAP). No ADX/DMI (Permission's domain),
#   no EMA/MACD (Sniper's domain).
# =========================================================

declare upper;

def na = Double.NaN;
def ts = TickSize();

# ----------------------------
# Inputs
# ----------------------------

# Initial Balance
input ibBars                = 2;       # bars in IB (2 x 30m = 1 hour)
input ibExtensionAlert      = 1.5;     # alert when price extends this many IB ranges

# Value Migration
input useAdaptiveThreshold  = yes;     # % of Y-VA range vs fixed ticks
input adaptiveThresholdPct  = 0.15;    # 15% of yesterday's VA range
input fixedShiftTicks       = 8;       # fallback if adaptive is off

# Session Type
input acceptanceBars        = 2;       # bars beyond IB to confirm trend day

# Weekly VWAP
input showWeeklyVWAP        = yes;

# Visuals
input showIBLines           = yes;
input showYVALines          = yes;
input paintBackground       = yes;
input showLabels            = yes;
input labelsLastBarOnly     = yes;

# Session control
input useRTHOnly            = yes;
input rthStart              = 0930;
input rthEnd                = 1600;

# Alerts
input enableIBBreakoutAlert = yes;
input enableExtensionAlert  = yes;
input enableMigrationAlert  = yes;

# Debug
input showDebug             = no;

# ----------------------------
# 1) RTH / Session Logic
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

def endOfRTH = BarNumber() > 1 and inRTH[1] and !inRTH;

def showNow = if useRTHOnly then inRTH else 1;

# RTH bar counter
rec rthBarCount =
    if BarNumber() == 1 then 0
    else if newSession then 1
    else if inRTH then rthBarCount[1] + 1
    else rthBarCount[1];

# Label gate
def isLastBar = !IsNaN(close) and IsNaN(close[-1]);
def labelGate = if labelsLastBarOnly then isLastBar else yes;

# ----------------------------
# 2) Volume Profile + Y-VA (endOfRTH snapshot fix)
#
# Profile boundary at endOfRTH prevents ETH bars from
# contaminating the RTH profile on chart reload. ETH bars
# go into a separate throwaway profile.
# ----------------------------
profile vp = VolumeProfile(
    "startNewProfile" = newSession or endOfRTH,
    "onExpansion"     = no
);

def rawVAH = vp.GetHighestValueArea();
def rawVAL = vp.GetLowestValueArea();
def rawPOC = vp.GetPointOfControl();

# Developing levels
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

def dVAH_L = if !IsNaN(dVAH) then Round(dVAH / ts, 0) * ts else na;
def dVAL_L = if !IsNaN(dVAL) then Round(dVAL / ts, 0) * ts else na;
def dPOC_L = if !IsNaN(dPOC) then Round(dPOC / ts, 0) * ts else na;

# Primary: endOfRTH snapshot
rec snapVAH =
    if BarNumber() == 1 then na
    else if endOfRTH and !IsNaN(rawVAH[1]) then rawVAH[1]
    else snapVAH[1];

rec snapVAL =
    if BarNumber() == 1 then na
    else if endOfRTH and !IsNaN(rawVAL[1]) then rawVAL[1]
    else snapVAL[1];

rec snapPOC =
    if BarNumber() == 1 then na
    else if endOfRTH and !IsNaN(rawPOC[1]) then rawPOC[1]
    else snapPOC[1];

# Fallback: running tracker that resets on newSession
rec fallbackVAH =
    if BarNumber() == 1 then na
    else if newSession then na
    else if (showNow and !IsNaN(rawVAH)) then rawVAH
    else fallbackVAH[1];

rec fallbackVAL =
    if BarNumber() == 1 then na
    else if newSession then na
    else if (showNow and !IsNaN(rawVAL)) then rawVAL
    else fallbackVAL[1];

rec fallbackPOC =
    if BarNumber() == 1 then na
    else if newSession then na
    else if (showNow and !IsNaN(rawPOC)) then rawPOC
    else fallbackPOC[1];

# Hard guard: latch once per day
rec yLatchDay =
    if BarNumber() == 1 then 0
    else if newSession then GetDay()
    else yLatchDay[1];

def firstLatch = newSession and yLatchDay[1] <> GetDay();

rec yVAH =
    if BarNumber() == 1 then na
    else if firstLatch then
        (if !IsNaN(snapVAH) then snapVAH
         else if !IsNaN(fallbackVAH[1]) then fallbackVAH[1]
         else yVAH[1])
    else yVAH[1];

rec yVAL =
    if BarNumber() == 1 then na
    else if firstLatch then
        (if !IsNaN(snapVAL) then snapVAL
         else if !IsNaN(fallbackVAL[1]) then fallbackVAL[1]
         else yVAL[1])
    else yVAL[1];

rec yPOC =
    if BarNumber() == 1 then na
    else if firstLatch then
        (if !IsNaN(snapPOC) then snapPOC
         else if !IsNaN(fallbackPOC[1]) then fallbackPOC[1]
         else yPOC[1])
    else yPOC[1];

def yVAH_L = if !IsNaN(yVAH) then Round(yVAH / ts, 0) * ts else na;
def yVAL_L = if !IsNaN(yVAL) then Round(yVAL / ts, 0) * ts else na;
def yPOC_L = if !IsNaN(yPOC) then Round(yPOC / ts, 0) * ts else na;

def yReady = !IsNaN(yVAH_L) and !IsNaN(yVAL_L) and !IsNaN(yPOC_L);

# ----------------------------
# 3) Initial Balance (first N bars of RTH)
# ----------------------------
rec ibHigh =
    if BarNumber() == 1 then na
    else if newSession then high
    else if inRTH and rthBarCount <= ibBars and high > ibHigh[1] then high
    else ibHigh[1];

rec ibLow =
    if BarNumber() == 1 then na
    else if newSession then low
    else if inRTH and rthBarCount <= ibBars and low < ibLow[1] then low
    else ibLow[1];

def ibFormed = inRTH and rthBarCount > ibBars and !IsNaN(ibHigh) and !IsNaN(ibLow);
def ibRange  = if ibFormed then ibHigh - ibLow else na;

def ibHigh_L = if !IsNaN(ibHigh) then Round(ibHigh / ts, 0) * ts else na;
def ibLow_L  = if !IsNaN(ibLow) then Round(ibLow / ts, 0) * ts else na;

def aboveIB = ibFormed and close > ibHigh;
def belowIB = ibFormed and close < ibLow;
def insideIB = ibFormed and close >= ibLow and close <= ibHigh;

# How far beyond IB (in multiples of IB range)
def ibExtension =
    if !ibFormed or ibRange <= 0 then 0
    else if close > ibHigh then (close - ibHigh) / ibRange
    else if close < ibLow then (ibLow - close) / ibRange
    else 0;

# IB breakout detection
def ibBreakUp   = ibFormed and aboveIB and !aboveIB[1];
def ibBreakDown = ibFormed and belowIB and !belowIB[1];

# ----------------------------
# 4) Session Type Classification
# ----------------------------
# Track consecutive bars beyond IB
rec barsAboveIB =
    if BarNumber() == 1 then 0
    else if newSession then 0
    else if aboveIB then barsAboveIB[1] + 1
    else 0;

rec barsBelowIB =
    if BarNumber() == 1 then 0
    else if newSession then 0
    else if belowIB then barsBelowIB[1] + 1
    else 0;

# Once accepted, it stays for the session (trend days don't un-trend)
rec acceptedAbove =
    if BarNumber() == 1 then 0
    else if newSession then 0
    else if barsAboveIB >= acceptanceBars then 1
    else acceptedAbove[1];

rec acceptedBelow =
    if BarNumber() == 1 then 0
    else if newSession then 0
    else if barsBelowIB >= acceptanceBars then 1
    else acceptedBelow[1];

# Session type codes: 0=forming IB, 1=rotation, 2=trend up, -2=trend down, 3=IB break up, -3=IB break down
def sessionType =
    if !ibFormed then 0
    else if acceptedAbove == 1 and acceptedBelow == 1 then 1  # broke both ways = rotation
    else if acceptedAbove == 1 then 2
    else if acceptedBelow == 1 then -2
    else if aboveIB then 3      # just broke out, not yet accepted
    else if belowIB then -3
    else 1;                     # inside IB = rotation

# ----------------------------
# 5) Value Migration
# ----------------------------
def yVARange = if yReady then yVAH_L - yVAL_L else na;

def shiftThreshold =
    if useAdaptiveThreshold and !IsNaN(yVARange) and yVARange > 0
    then yVARange * adaptiveThresholdPct
    else fixedShiftTicks * ts;

def migrationUp =
    !IsNaN(dPOC_L) and !IsNaN(yPOC_L) and !IsNaN(dVAL_L) and !IsNaN(yVAL_L) and
    dPOC_L > yPOC_L + shiftThreshold and
    dVAL_L > yVAL_L + shiftThreshold;

def migrationDown =
    !IsNaN(dPOC_L) and !IsNaN(yPOC_L) and !IsNaN(dVAH_L) and !IsNaN(yVAH_L) and
    dPOC_L < yPOC_L - shiftThreshold and
    dVAH_L < yVAH_L - shiftThreshold;

def migrationBalanced = !migrationUp and !migrationDown;

# Migration code: 1=up, -1=down, 0=balanced
def migCode = if migrationUp then 1 else if migrationDown then -1 else 0;

# Track migration shift for alerts
def migShift = migCode != migCode[1] and migCode != 0;

# ----------------------------
# 6) Weekly VWAP (manual computation)
# ----------------------------
def dow  = GetDayOfWeek(GetYYYYMMDD());
def dow1 = GetDayOfWeek(GetYYYYMMDD()[1]);
def newWeek = dow < dow1 or BarNumber() == 1;

def tp = (high + low + close) / 3;

rec cumVolWeek =
    if newWeek then volume
    else cumVolWeek[1] + volume;

rec cumTPVWeek =
    if newWeek then tp * volume
    else cumTPVWeek[1] + tp * volume;

def weeklyVWAP = if cumVolWeek > 0 then cumTPVWeek / cumVolWeek else na;
def wVWAP_L = if !IsNaN(weeklyVWAP) then Round(weeklyVWAP / ts, 0) * ts else na;

def aboveWeeklyVWAP = !IsNaN(wVWAP_L) and close > wVWAP_L;
def belowWeeklyVWAP = !IsNaN(wVWAP_L) and close < wVWAP_L;

# ----------------------------
# 7) Plots
# ----------------------------

# IB lines
plot IBHighLine = if showIBLines and showNow and ibFormed then ibHigh_L else na;
IBHighLine.SetDefaultColor(Color.WHITE);
IBHighLine.SetStyle(Curve.MEDIUM_DASH);
IBHighLine.SetLineWeight(2);

plot IBLowLine = if showIBLines and showNow and ibFormed then ibLow_L else na;
IBLowLine.SetDefaultColor(Color.WHITE);
IBLowLine.SetStyle(Curve.MEDIUM_DASH);
IBLowLine.SetLineWeight(2);

# IB cloud
AddCloud(
    if showIBLines and showNow and ibFormed then IBHighLine else na,
    if showIBLines and showNow and ibFormed then IBLowLine else na,
    Color.DARK_GRAY,
    Color.DARK_GRAY
);

# Y-VA lines
plot YVAHLine = if showYVALines and showNow and yReady then yVAH_L else na;
YVAHLine.SetDefaultColor(Color.YELLOW);
YVAHLine.SetStyle(Curve.SHORT_DASH);
YVAHLine.SetLineWeight(1);

plot YVALLine = if showYVALines and showNow and yReady then yVAL_L else na;
YVALLine.SetDefaultColor(Color.YELLOW);
YVALLine.SetStyle(Curve.SHORT_DASH);
YVALLine.SetLineWeight(1);

# Weekly VWAP
plot WeeklyVWAPLine = if showWeeklyVWAP and showNow and !IsNaN(wVWAP_L) then wVWAP_L else na;
WeeklyVWAPLine.SetDefaultColor(Color.ORANGE);
WeeklyVWAPLine.SetStyle(Curve.FIRM);
WeeklyVWAPLine.SetLineWeight(2);

# ----------------------------
# 8) Background Color (session type at a glance)
# ----------------------------
AssignBackgroundColor(
    if !paintBackground then Color.CURRENT
    else if !showNow then Color.BLACK
    else if sessionType == 2 then Color.DARK_GREEN      # trend up
    else if sessionType == -2 then Color.DARK_RED        # trend down
    else if sessionType == 3 or sessionType == -3 then Color.CURRENT  # IB break, not confirmed
    else if !ibFormed then Color.CURRENT                 # forming IB
    else Color.CURRENT                                   # rotation = no tint
);

# ----------------------------
# 9) Labels
# ----------------------------

# SESSION TYPE — the most important label
AddLabel(showLabels and labelGate,
    "SESSION: " +
    (if !ibFormed then "FORMING IB (" + rthBarCount + "/" + ibBars + ")"
     else if sessionType == 2 then "TREND UP"
     else if sessionType == -2 then "TREND DOWN"
     else if sessionType == 3 then "IB BREAK UP (testing)"
     else if sessionType == -3 then "IB BREAK DOWN (testing)"
     else "ROTATION"),
    if !ibFormed then Color.GRAY
    else if sessionType == 2 or sessionType == 3 then Color.GREEN
    else if sessionType == -2 or sessionType == -3 then Color.RED
    else Color.YELLOW
);

# IB levels + extension
AddLabel(showLabels and labelGate and ibFormed,
    "IB: " + AsPrice(ibHigh_L) + " / " + AsPrice(ibLow_L) +
    " (" + Round(ibRange / ts, 0) + "t)" +
    (if ibExtension > 0
     then " | EXT: " + Round(ibExtension, 1) + "R"
     else ""),
    if ibExtension >= ibExtensionAlert then Color.CYAN
    else Color.WHITE
);

# VALUE MIGRATION
AddLabel(showLabels and labelGate and yReady,
    "MIGRATION: " +
    (if migrationUp then "HIGHER"
     else if migrationDown then "LOWER"
     else "BALANCED") +
    " | dPOC " + AsPrice(dPOC_L) + " vs yPOC " + AsPrice(yPOC_L),
    if migrationUp then Color.GREEN
    else if migrationDown then Color.RED
    else Color.YELLOW
);

# WEEKLY VWAP
AddLabel(showLabels and labelGate and showWeeklyVWAP and !IsNaN(wVWAP_L),
    "wkVWAP: " + AsPrice(wVWAP_L) +
    " (" + (if aboveWeeklyVWAP then "ABOVE" else "BELOW") + ")" +
    " | " + Round(AbsValue(close - wVWAP_L) / ts, 0) + "t away",
    if aboveWeeklyVWAP then Color.GREEN
    else Color.RED
);

# ----------------------------
# 10) Alerts
# ----------------------------
Alert(enableIBBreakoutAlert and ibBreakUp,
    "30m: IB BREAKOUT UP", Alert.BAR, Sound.Ring);
Alert(enableIBBreakoutAlert and ibBreakDown,
    "30m: IB BREAKOUT DOWN", Alert.BAR, Sound.Ring);

Alert(enableExtensionAlert and ibFormed and ibExtension >= ibExtensionAlert and ibExtension[1] < ibExtensionAlert,
    "30m: IB EXTENSION >= " + ibExtensionAlert + "R",
    Alert.BAR, Sound.Ding);

Alert(enableMigrationAlert and migShift and migrationUp,
    "30m: VALUE MIGRATING HIGHER", Alert.BAR, Sound.Chimes);
Alert(enableMigrationAlert and migShift and migrationDown,
    "30m: VALUE MIGRATING LOWER", Alert.BAR, Sound.Chimes);

# ----------------------------
# 11) Debug
# ----------------------------
AddLabel(showDebug and labelGate,
    "DBG | rthBars=" + rthBarCount +
    " | ibH=" + AsPrice(ibHigh_L) + " ibL=" + AsPrice(ibLow_L) +
    " | sessType=" + sessionType +
    " | migCode=" + migCode +
    " | threshold=" + Round(shiftThreshold / ts, 0) + "t",
    Color.WHITE
);

# ----------------------------
# 12) Exports
# ----------------------------
plot Export_SessionType    = sessionType;     Export_SessionType.SetHiding(yes);
plot Export_MigrationCode  = migCode;         Export_MigrationCode.SetHiding(yes);
plot Export_IBHigh         = ibHigh_L;        Export_IBHigh.SetHiding(yes);
plot Export_IBLow          = ibLow_L;         Export_IBLow.SetHiding(yes);
plot Export_IBExtension    = ibExtension;     Export_IBExtension.SetHiding(yes);
plot Export_WeeklyVWAP     = wVWAP_L;        Export_WeeklyVWAP.SetHiding(yes);

plot _keepAlive = na;
_keepAlive.SetHiding(yes);
