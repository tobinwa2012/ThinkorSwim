# =========================================================
# MNQ_30m_RTH_Refs_For_ETH v7
#
# RTH-built references carried through ETH (6pm-11:30pm):
#   - Prior RTH VAH / VAL / POC
#   - RTH-only Weekly VWAP
#   - RTH Migration
#   - 1-2 active RTH Naked POCs
#
# Designed for 30m chart.
#
# v7 changes from v6:
#   v6 removed the profile boundary, relying on dVAH alone.
#   Problem: without the boundary, TOS VP retroactively
#   recalculates rawVAH on RTH bars to include ETH volume on
#   chart reload. Since dVAH reads rawVAH during RTH, it
#   picks up the contaminated values.
#
#   Fix: BOTH boundary AND dVAH capture together.
#   (a) Profile boundary at endOfRTH isolates RTH profile.
#   (b) dVAH rec captures from the clean RTH profile — no
#       boundary-bar timing ambiguity.
# =========================================================

declare upper;

def na = Double.NaN;
def ts = TickSize();

# ----------------------------
# Inputs
# ----------------------------
input rthStart = 0930;
input rthEnd   = 1600;

input showPriorRTHValue = yes;
input showWeeklyVWAP    = yes;
input showNakedPOCs     = yes;

input useAdaptiveMigrationThreshold = yes;
input adaptiveThresholdPct = 0.15;
input fixedShiftTicks = 8;

input showLabels        = yes;
input labelsLastBarOnly = yes;

# Debug
input showDebug         = no;

# ----------------------------
# Session Logic
# ----------------------------
def newDay = GetDay() <> GetDay()[1];

def inRTH =
    SecondsFromTime(rthStart) >= 0 and
    SecondsTillTime(rthEnd) > 0;

rec seenRTHToday =
    if BarNumber() == 1 then 0
    else if newDay then 0
    else if inRTH then 1
    else seenRTHToday[1];

def newRTHSession = inRTH and seenRTHToday[1] == 0;

# Fires once: first bar AFTER RTH ends (profile is complete)
def endOfRTH = BarNumber() > 1 and inRTH[1] and !inRTH;

# Keep visible through ETH
def showNow = 1;

# Label gate
def isLastBar = !IsNaN(close) and IsNaN(close[-1]);
def labelGate = if labelsLastBarOnly then isLastBar else yes;

# ----------------------------
# RTH Volume Profile
#
# Boundary at endOfRTH puts ETH bars into a throwaway
# profile so they cannot retroactively shift rawVAH on
# RTH bars during chart reload. dVAH reads from the
# clean RTH-only profile during RTH, then carries forward.
# ----------------------------
profile vp = VolumeProfile(
    "startNewProfile" = newRTHSession or endOfRTH,
    "onExpansion"     = no
);

def rawVAH = vp.GetHighestValueArea();
def rawVAL = vp.GetLowestValueArea();
def rawPOC = vp.GetPointOfControl();

# Developing levels (update only during RTH)
rec dVAH =
    if BarNumber() == 1 then na
    else if newRTHSession then rawVAH
    else if inRTH and !IsNaN(rawVAH) then rawVAH
    else dVAH[1];

rec dVAL =
    if BarNumber() == 1 then na
    else if newRTHSession then rawVAL
    else if inRTH and !IsNaN(rawVAL) then rawVAL
    else dVAL[1];

rec dPOC =
    if BarNumber() == 1 then na
    else if newRTHSession then rawPOC
    else if inRTH and !IsNaN(rawPOC) then rawPOC
    else dPOC[1];

def dVAH_L = if !IsNaN(dVAH) then Round(dVAH / ts, 0) * ts else na;
def dVAL_L = if !IsNaN(dVAL) then Round(dVAL / ts, 0) * ts else na;
def dPOC_L = if !IsNaN(dPOC) then Round(dPOC / ts, 0) * ts else na;

# =========================================================
# Prior Completed RTH Value
#
# Uses dVAH/dVAL/dPOC recs which only update during RTH.
# At endOfRTH, dVAH = last RTH bar's rawVAH (carried fwd).
# This is immune to ETH bars shifting rawVAH because the
# rec stopped reading rawVAH when inRTH became false.
#
# Fallback: running tracker for RTH-only charts that lack
# an endOfRTH bar.
# =========================================================

# --- HARD GUARD: latch once per day only ---
rec priorLatchDay =
    if BarNumber() == 1 then 0
    else if endOfRTH then GetDay()
    else priorLatchDay[1];

def firstLatch = endOfRTH and priorLatchDay[1] <> GetDay();

# --- Fallback: running tracker, resets on newRTHSession ---
rec fallbackVAH =
    if BarNumber() == 1 then na
    else if newRTHSession then na
    else if (inRTH and !IsNaN(rawVAH)) then rawVAH
    else fallbackVAH[1];

rec fallbackVAL =
    if BarNumber() == 1 then na
    else if newRTHSession then na
    else if (inRTH and !IsNaN(rawVAL)) then rawVAL
    else fallbackVAL[1];

rec fallbackPOC =
    if BarNumber() == 1 then na
    else if newRTHSession then na
    else if (inRTH and !IsNaN(rawPOC)) then rawPOC
    else fallbackPOC[1];

# --- Latch: prefer dVAH (primary), fallback if missing ---
rec priorRTH_VAH =
    if BarNumber() == 1 then na
    else if firstLatch then
        Round((if !IsNaN(dVAH) then dVAH
         else if !IsNaN(fallbackVAH[1]) then fallbackVAH[1]
         else priorRTH_VAH[1]) / ts, 0) * ts
    else priorRTH_VAH[1];

rec priorRTH_VAL =
    if BarNumber() == 1 then na
    else if firstLatch then
        Round((if !IsNaN(dVAL) then dVAL
         else if !IsNaN(fallbackVAL[1]) then fallbackVAL[1]
         else priorRTH_VAL[1]) / ts, 0) * ts
    else priorRTH_VAL[1];

rec priorRTH_POC =
    if BarNumber() == 1 then na
    else if firstLatch then
        Round((if !IsNaN(dPOC) then dPOC
         else if !IsNaN(fallbackPOC[1]) then fallbackPOC[1]
         else priorRTH_POC[1]) / ts, 0) * ts
    else priorRTH_POC[1];

# Track which source was used (for debug)
rec priorSource =
    if BarNumber() == 1 then 0
    else if firstLatch then
        (if !IsNaN(dVAH) then 1 else 2)
    else priorSource[1];

def priorReady =
    !IsNaN(priorRTH_VAH) and
    !IsNaN(priorRTH_VAL) and
    !IsNaN(priorRTH_POC);

# ----------------------------
# RTH Naked POCs (max 2)
#
# Grace logic: on the endOfRTH bar, new values are assigned.
# npocGrace is 1 on that bar so touch detection is skipped.
# On the next bar, normal touch detection runs.
# ----------------------------
rec npocGrace =
    if BarNumber() == 1 then 0
    else if endOfRTH then 1
    else 0;

# Slot 1: newest naked POC
rec npoc1 =
    if BarNumber() == 1 then na
    else if endOfRTH then priorRTH_POC
    else if npocGrace[1] == 0 and !IsNaN(npoc1[1]) and high >= npoc1[1] and low <= npoc1[1] then na
    else npoc1[1];

# Slot 2: previous naked POC (old slot 1 shifts here)
rec npoc2 =
    if BarNumber() == 1 then na
    else if endOfRTH then npoc1[1]
    else if npocGrace[1] == 0 and !IsNaN(npoc2[1]) and high >= npoc2[1] and low <= npoc2[1] then na
    else npoc2[1];

# Prevent duplicate display
def dispNPOC1 = if !IsNaN(npoc1) then Round(npoc1 / ts, 0) * ts else na;
def dispNPOC2_raw = if !IsNaN(npoc2) then Round(npoc2 / ts, 0) * ts else na;
def dispNPOC2 =
    if !IsNaN(dispNPOC1) and !IsNaN(dispNPOC2_raw) and dispNPOC1 == dispNPOC2_raw
    then na
    else dispNPOC2_raw;

# ----------------------------
# RTH Migration
# Current developing RTH value vs prior completed RTH value
# 1 = higher | 0 = balanced | -1 = lower
# ----------------------------
def priorVARange =
    if priorReady then priorRTH_VAH - priorRTH_VAL else na;

def migrationThreshold =
    if useAdaptiveMigrationThreshold and !IsNaN(priorVARange) and priorVARange > 0
    then priorVARange * adaptiveThresholdPct
    else fixedShiftTicks * ts;

def migrationUpLive =
    inRTH and priorReady and
    !IsNaN(dPOC_L) and !IsNaN(dVAL_L) and
    dPOC_L > priorRTH_POC + migrationThreshold and
    dVAL_L > priorRTH_VAL + migrationThreshold;

def migrationDownLive =
    inRTH and priorReady and
    !IsNaN(dPOC_L) and !IsNaN(dVAH_L) and
    dPOC_L < priorRTH_POC - migrationThreshold and
    dVAH_L < priorRTH_VAH - migrationThreshold;

def migrationCodeLive =
    if migrationUpLive then 1
    else if migrationDownLive then -1
    else 0;

rec migrationCode =
    if BarNumber() == 1 then 0
    else if inRTH then migrationCodeLive
    else migrationCode[1];

# ----------------------------
# RTH-only Weekly VWAP
# ----------------------------
def dow  = GetDayOfWeek(GetYYYYMMDD());
def dow1 = GetDayOfWeek(GetYYYYMMDD()[1]);
def newWeek = dow < dow1 or BarNumber() == 1;

def tp = (high + low + close) / 3;

rec cumVolWeek =
    if newWeek then (if inRTH then volume else 0)
    else cumVolWeek[1] + (if inRTH then volume else 0);

rec cumTPVWeek =
    if newWeek then (if inRTH then tp * volume else 0)
    else cumTPVWeek[1] + (if inRTH then tp * volume else 0);

def weeklyVWAP = if cumVolWeek > 0 then cumTPVWeek / cumVolWeek else na;
def wVWAP_L = if !IsNaN(weeklyVWAP) then Round(weeklyVWAP / ts, 0) * ts else na;

# ----------------------------
# Plots
# ----------------------------
plot PriorRTH_VAH_Line =
    if showPriorRTHValue and priorReady and showNow then priorRTH_VAH else na;
PriorRTH_VAH_Line.SetDefaultColor(Color.YELLOW);
PriorRTH_VAH_Line.SetStyle(Curve.SHORT_DASH);
PriorRTH_VAH_Line.SetLineWeight(1);

plot PriorRTH_VAL_Line =
    if showPriorRTHValue and priorReady and showNow then priorRTH_VAL else na;
PriorRTH_VAL_Line.SetDefaultColor(Color.YELLOW);
PriorRTH_VAL_Line.SetStyle(Curve.SHORT_DASH);
PriorRTH_VAL_Line.SetLineWeight(1);

plot PriorRTH_POC_Line =
    if showPriorRTHValue and priorReady and showNow then priorRTH_POC else na;
PriorRTH_POC_Line.SetDefaultColor(Color.CYAN);
PriorRTH_POC_Line.SetStyle(Curve.FIRM);
PriorRTH_POC_Line.SetLineWeight(2);

plot WeeklyVWAPLine =
    if showWeeklyVWAP and !IsNaN(wVWAP_L) and showNow then wVWAP_L else na;
WeeklyVWAPLine.SetDefaultColor(Color.ORANGE);
WeeklyVWAPLine.SetStyle(Curve.FIRM);
WeeklyVWAPLine.SetLineWeight(2);

plot NakedPOC_1 =
    if showNakedPOCs and showNow and !IsNaN(dispNPOC1) then dispNPOC1 else na;
NakedPOC_1.SetDefaultColor(Color.LIGHT_GRAY);
NakedPOC_1.SetStyle(Curve.LONG_DASH);
NakedPOC_1.SetLineWeight(1);

plot NakedPOC_2 =
    if showNakedPOCs and showNow and !IsNaN(dispNPOC2) then dispNPOC2 else na;
NakedPOC_2.SetDefaultColor(Color.GRAY);
NakedPOC_2.SetStyle(Curve.LONG_DASH);
NakedPOC_2.SetLineWeight(1);

# ----------------------------
# Labels
# ----------------------------
AddLabel(showLabels and labelGate and priorReady,
    "RTH VAH/VAL/POC: " +
    AsPrice(priorRTH_VAH) + " / " +
    AsPrice(priorRTH_VAL) + " / " +
    AsPrice(priorRTH_POC),
    Color.YELLOW
);

AddLabel(showLabels and labelGate and !IsNaN(wVWAP_L),
    "RTH wkVWAP: " + AsPrice(wVWAP_L),
    Color.ORANGE
);

AddLabel(showLabels and labelGate and priorReady,
    "RTH Migration: " +
    (if migrationCode == 1 then "HIGHER"
     else if migrationCode == -1 then "LOWER"
     else "BALANCED"),
    if migrationCode == 1 then Color.GREEN
    else if migrationCode == -1 then Color.RED
    else Color.YELLOW
);

AddLabel(showLabels and labelGate and showNakedPOCs,
    "Naked POCs: " +
    (if !IsNaN(dispNPOC1) then AsPrice(dispNPOC1) else "-") +
    " | " +
    (if !IsNaN(dispNPOC2) then AsPrice(dispNPOC2) else "-"),
    Color.LIGHT_GRAY
);

# ----------------------------
# Debug
# ----------------------------
AddLabel(showDebug and labelGate,
    "Src=" + (if priorSource == 1 then "dVAH" else if priorSource == 2 then "FALL" else "NONE") +
    " | dVAH=" + (if !IsNaN(dVAH_L) then AsPrice(dVAH_L) else "na") +
    " | final=" + AsPrice(priorRTH_VAH),
    Color.WHITE
);

# ----------------------------
# Hidden Exports
# ----------------------------
plot Export_MigrationCode = migrationCode;
Export_MigrationCode.SetHiding(yes);

plot Export_PriorRTH_VAH = priorRTH_VAH;
Export_PriorRTH_VAH.SetHiding(yes);

plot Export_PriorRTH_VAL = priorRTH_VAL;
Export_PriorRTH_VAL.SetHiding(yes);

plot Export_PriorRTH_POC = priorRTH_POC;
Export_PriorRTH_POC.SetHiding(yes);

plot Export_RTH_WeeklyVWAP = wVWAP_L;
Export_RTH_WeeklyVWAP.SetHiding(yes);

plot Export_NakedPOC1 = dispNPOC1;
Export_NakedPOC1.SetHiding(yes);

plot Export_NakedPOC2 = dispNPOC2;
Export_NakedPOC2.SetHiding(yes);

plot _keepAlive = na;
_keepAlive.SetHiding(yes);
