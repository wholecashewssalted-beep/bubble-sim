const form = document.getElementById("params");
const globeCanvas = document.getElementById("globe");
const forceCanvas = document.getElementById("force");
const plannerGlobeCanvas = document.getElementById("plannerGlobe");
const plannerChartCanvas = document.getElementById("plannerChart");
const plannerDaysInput = document.getElementById("plannerDays");

const DEFAULTS = {
  axial: "24",
  tamponadeVol: "2.25",
  clockHour: "12",
  equatorMm: "3.1",
  faceDown: "90",
  tiltLR: "0",
  tamponade: "sf6",
  gasPct: "20",
  cavityFluid: "vitreous",
  lens: "phakic",
  eye: "OD",
  buckle: "none",
  buckleCenter: "vb",
  macularHole: "off",
  plannerDays: "0",
};

const view = { yaw: 0, pitch: 0 };
const plannerView = { yaw: 0, pitch: 0 };
let lastGlobeModel = null;
let lastPlannerModel = null;
let lastTamponadeId = "sf6";

function isStaleBreakDefault(value) {
  const n = Number(value);
  return !Number.isFinite(n) || Math.abs(n - 3) < 0.001 || Math.abs(n - 3.1) < 0.001;
}

function defaultBreakEquatorMm() {
  const data = new FormData(form);
  const lens = data.get("lens") === "pseudo" ? "pseudo" : "phakic";
  const eye = data.get("eye") === "OS" ? "OS" : "OD";
  const axial = BubbleModel.clamp(Number(data.get("axial")) || 24, BubbleModel.AL_MIN_MM, BubbleModel.AL_MAX_MM);
  let clock = Number(data.get("clockHour"));
  if (clock === 0) clock = 12;
  const cavity = BubbleModel.buildCavity(axial, lens, eye);
  return BubbleModel.vitreousBasePostEquatorMm(cavity, eye, clock);
}

function readParams() {
  const data = new FormData(form);
  let clock = Number(data.get("clockHour"));
  if (clock === 0) clock = 12;
  const lens = data.get("lens") === "pseudo" ? "pseudo" : "phakic";
  const eye = data.get("eye") === "OS" ? "OS" : "OD";
  const axialSlider = form.elements.axial;
  axialSlider.min = String(BubbleModel.AL_MIN_MM);
  axialSlider.max = String(BubbleModel.AL_MAX_MM);
  const axial = BubbleModel.clamp(Number(data.get("axial")) || 24, BubbleModel.AL_MIN_MM, BubbleModel.AL_MAX_MM);
  axialSlider.value = axial.toFixed(1);
  const buckle = {
    style: data.get("buckle") || "none",
    center: data.get("buckleCenter") === "parsPlana" ? "vb" : (data.get("buckleCenter") || "vb"),
    equatorMm: Number(data.get("equatorMm")),
    clockHour: clock,
  };
  let cavityShape = BubbleModel.buildCavity(axial, lens, eye, buckle);
  const { anteriorMm, posteriorMm } = BubbleModel.breakArcRange(cavityShape);
  const eqSlider = form.elements.equatorMm;
  eqSlider.min = (-anteriorMm).toFixed(2);
  eqSlider.max = posteriorMm.toFixed(2);
  const requestedEq = Number(data.get("equatorMm"));
  const equatorMm = BubbleModel.clamp(
    Number.isFinite(requestedEq) ? requestedEq : 0,
    -anteriorMm,
    posteriorMm
  );
  eqSlider.value = equatorMm.toFixed(2);
  buckle.equatorMm = equatorMm;
  buckle.clockHour = clock;
  if (
    buckle.center === "break"
    && cavityShape.buckle
    && Math.abs((cavityShape.buckle.breakEquatorMm ?? 0) - equatorMm) > 0.02
  ) {
    cavityShape = BubbleModel.buildCavity(axial, lens, eye, buckle);
  }
  const cavityMl = cavityShape.volumeMl;
  const volSlider = form.elements.tamponadeVol;
  const requestedVol = Number(volSlider.value);
  volSlider.max = cavityMl.toFixed(2);
  const tamponadeMl = BubbleModel.clamp(
    Number.isFinite(requestedVol) ? requestedVol : cavityMl * 0.5,
    0.02,
    cavityMl
  );
  volSlider.value = tamponadeMl.toFixed(2);
  const fillPct = (tamponadeMl / cavityMl) * 100;
  const tamponade = data.get("tamponade") || "sf6";
  const listed = BubbleModel.TAMPONADES[tamponade] || BubbleModel.TAMPONADES.sf6;
  const gasMix = listed.kind !== "oil" && listed.id !== "air";
  const gasPctRow = document.getElementById("gasPctRow");
  if (gasPctRow) gasPctRow.hidden = !gasMix;
  const gasSlider = form.elements.gasPct;
  if (gasMix && lastTamponadeId !== tamponade) {
    const prev = BubbleModel.TAMPONADES[lastTamponadeId];
    const cur = Number(gasSlider.value);
    const wasIso = prev && Math.abs(cur - (prev.isoexpansilePct || 0)) < 0.6;
    const fromNonMix = !prev || prev.kind === "oil" || prev.id === "air";
    if (fromNonMix || wasIso) gasSlider.value = String(listed.isoexpansilePct);
  }
  lastTamponadeId = tamponade;
  const gasPct = gasMix
    ? BubbleModel.clamp(Number(gasSlider.value) || listed.isoexpansilePct, 10, 100)
    : 100;
  if (gasMix) gasSlider.value = String(Math.round(gasPct));
  const plannerDays = BubbleModel.clamp(
    Number(plannerDaysInput && plannerDaysInput.value) || 0,
    0,
    BubbleModel.PLANNER_MAX_DAYS
  );
  if (plannerDaysInput) plannerDaysInput.value = String(plannerDays);
  return {
    axialMm: axial,
    cavityMl,
    tamponadeMl,
    fillPct,
    clockHour: clock,
    equatorMm,
    faceDownDeg: data.get("faceDown") === null || data.get("faceDown") === "" ? 90 : Number(data.get("faceDown")),
    tiltLRDeg: Number(data.get("tiltLR")) || 0,
    tamponade,
    gasPct,
    cavityFluid: data.get("cavityFluid") || "vitreous",
    lens,
    cavity: cavityShape,
    eye,
    buckle,
    macularHole: data.get("macularHole") === "on",
    plannerDays,
  };
}

function formatClock(hour) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h.toFixed(2).replace(/\.00$/, "")} o’clock`;
}

function formatNumber(value, digits) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function renderHints(model) {
  const axial = model.params.axialMm || Number(form.elements.axial.value) || 24;
  const c = model.cavity;
  document.getElementById("axialHint").textContent = `· ${formatNumber(axial, 1)} mm · SR ${formatNumber(c ? c.sr : 0, 1)} D → ${formatNumber(model.params.cavityMl, 2)} mL`;
  document.getElementById("fillHint").textContent = `· ${formatNumber(model.params.tamponadeMl, 2)} mL · ${formatNumber(model.params.fillPct, 0)}% of ${formatNumber(model.params.cavityMl, 1)} mL · Bo = ${formatNumber(model.meniscus.bond, 1)}`;
  document.getElementById("clockHint").textContent = `· ${formatClock(model.params.clockHour)}`;
  const equatorMm = model.params.equatorMm;
  const { anteriorMm, posteriorMm } = BubbleModel.breakArcRange(c);
  const vbPost = c ? BubbleModel.vitreousBasePostEquatorMm(c, model.eye, model.params.clockHour) : null;
  document.getElementById("equatorHint").textContent = vbPost != null && Math.abs(equatorMm - vbPost) < 0.3
    ? "· posterior vitreous base"
    : Math.abs(equatorMm) < 0.05
    ? "· equator"
    : equatorMm >= posteriorMm - 0.2
      ? "· fovea"
      : equatorMm <= -anteriorMm + 0.2
        ? "· anterior, at the lens plane"
        : equatorMm > 0
          ? `· ${formatNumber(equatorMm, 2)} mm posterior, toward fovea`
          : `· ${formatNumber(-equatorMm, 2)} mm anterior of equator`;
  const mhHint = document.getElementById("macularHoleHint");
  if (mhHint) mhHint.textContent = model.macularHole ? "· at the fovea" : "· off";
  const pitch = model.params.faceDownDeg;
  const pose = pitch <= 0
    ? "true face-down, fovea at zenith"
    : pitch === 90
      ? "sitting, 12 o’clock at zenith"
      : pitch >= 180
        ? "supine, cornea at zenith"
        : pitch < 90
          ? `${formatNumber(pitch, 0)}° from face-down toward sitting`
          : `${formatNumber(pitch - 90, 0)}° from sitting toward supine`;
  document.getElementById("faceHint").textContent = `· ${pose}`;
  const tilt = model.params.tiltLRDeg;
  const tiltTxt = tilt === 0
    ? "no roll"
    : Math.abs(tilt) >= 90
      ? (tilt > 0 ? "90° left ear down" : "90° right ear down")
      : tilt > 0
        ? `${tilt}° left ear down`
        : `${Math.abs(tilt)}° right ear down`;
  document.getElementById("tiltHint").textContent = `· ${tiltTxt}`;

  const buckleRow = document.getElementById("buckleCenterRow");
  const buckleOn = Boolean(c && c.buckle);
  if (buckleRow) buckleRow.hidden = !buckleOn;
  const buckleHint = document.getElementById("buckleHint");
  if (buckleHint) {
    if (!buckleOn) {
      buckleHint.textContent = "· no indent";
    } else {
      const b = c.buckle;
      const where = b.center === "equator"
        ? "geometric equator"
        : b.center === "break"
          ? "retinal break"
          : "posterior vitreous base";
      buckleHint.textContent = `· ${b.widthMm.toFixed(1)} × ${b.heightMm.toFixed(2)} mm rectangular trough · ${where}`;
    }
  }

  const t = model.tamponade;
  const lambda = t.capillaryMm;
  const mlAtBo1 = ((4 / 3) * Math.PI * lambda ** 3) / 1000;
  const bo = model.meniscus.bond || 0;
  const fluidName = (t.cavityFluid && t.cavityFluid.name) || "Vitreous";
  const sigmaMN = t.sigmaNM * 1000;
  document.getElementById("cavityFluidHint").textContent = `· σ = ${formatNumber(sigmaMN, 0)} mN/m · θ = ${formatNumber(t.thetaDeg, 0)}° through ${fluidName.toLowerCase()} (retina, capsule, and IOL)`;
  document.getElementById("bondNote").textContent = `Bond number Bo = (rb / λ)². Bo < 1: Laplace (surface tension) keeps the bubble round. Bo > 1: gravity and wall capillary flatten the underside. For this agent Bo = 1 at ${formatNumber(mlAtBo1, 2)} mL (λ ≈ ${formatNumber(lambda, 1)} mm). This fill is Bo = ${formatNumber(bo, 1)}.`;
  const gasPctHint = document.getElementById("gasPctHint");
  if (gasPctHint && t.kind !== "oil" && t.id !== "air") {
    const iso = t.isoexpansilePct;
    const pct = t.concPct || iso;
    const over = pct > iso + 0.5;
    gasPctHint.textContent = over
      ? `· ${formatNumber(pct, 0)}% · above isoexpansile ${iso}% · expands then absorbs`
      : Math.abs(pct - iso) < 0.5
        ? `· ${formatNumber(pct, 0)}% isoexpansile · no net expansion`
        : `· ${formatNumber(pct, 0)}% · below isoexpansile ${iso}% · no net expansion`;
  }
}

function metric(label, value, sub, tone) {
  const toneCls = tone === "ok" || tone === "danger" ? ` ${tone}` : "";
  const long = String(value).length > 22;
  return `<div class="metric${toneCls}"><span class="label">${label}</span><span class="value${long ? " long" : ""}">${value}</span><span class="sub">${sub}</span></div>`;
}

function plannerPointAtDay(curve, day) {
  return curve.reduce(
    (best, p) => (Math.abs(p.day - day) < Math.abs(best.day - day) ? p : best),
    curve[0]
  );
}

function formatPlannerDay(day) {
  const n = Number(day);
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
  return formatNumber(n, 1);
}

function tamponadeWindow(params, curve, which, cache) {
  const step = 0.5;
  const tEnd = curve[curve.length - 1].day;
  const covered = (day) => {
    const pt = plannerPointAtDay(curve, day);
    const key = pt.phase === "gone" ? "gone" : pt.ml.toFixed(3);
    let hit = cache.get(key);
    if (!hit) {
      const m = BubbleModel.simulate({
        ...params,
        tamponadeMl: pt.phase === "gone" ? 0 : pt.ml,
        fillPct: pt.phase === "gone" ? 0 : pt.fillPct,
      }, { coverageOnly: true });
      hit = { brk: m.tamponaded, mh: m.macularHoleTamponaded };
      cache.set(key, hit);
    }
    return which === "mh" ? hit.mh : hit.brk;
  };
  const peak = curve.reduce((a, b) => (a.ml >= b.ml ? a : b));
  if (!covered(peak.day)) return { never: true, from: 0, until: 0, through: false };
  let from = 0;
  if (!covered(0)) {
    let lo = 0;
    let hi = Math.max(1, Math.round(peak.day / step));
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (covered(mid * step)) hi = mid;
      else lo = mid;
    }
    from = hi * step;
  }
  let until = tEnd;
  if (!covered(tEnd)) {
    let lo = Math.round(peak.day / step);
    let hi = Math.round(tEnd / step);
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (covered(mid * step)) lo = mid;
      else hi = mid;
    }
    until = lo * step;
  }
  return {
    never: false,
    from,
    until,
    through: from <= 0.25 && until >= tEnd - 0.25,
  };
}

function tamponadeUntilSentence(label, span, oil) {
  if (span.never) return `${label} is not tamponaded with this fill and pose.`;
  if (span.through) {
    return oil
      ? `${label} is tamponaded through 8 weeks.`
      : `${label} is tamponaded until day ${formatPlannerDay(span.until)}.`;
  }
  if (span.from > 0.25) {
    return `${label} is tamponaded from day ${formatPlannerDay(span.from)} until day ${formatPlannerDay(span.until)}.`;
  }
  return `${label} is tamponaded until day ${formatPlannerDay(span.until)}.`;
}

function render() {
  const params = readParams();
  const model = BubbleModel.simulate(params);
  lastGlobeModel = model;
  renderHints(model);
  Draw3D.drawGlobe(globeCanvas, model, view);
  Draw3D.drawForce(forceCanvas, model);

  const curve = BubbleModel.plannerCurve(
    params.tamponadeMl,
    params.cavityMl,
    params.tamponade,
    params.gasPct,
    params.lens,
    BubbleModel.PLANNER_MAX_DAYS,
    0.5
  );
  const at = plannerPointAtDay(curve, params.plannerDays);
  const plannerModel = BubbleModel.simulate({
    ...params,
    tamponadeMl: at.phase === "gone" ? 0 : at.ml,
    fillPct: at.phase === "gone" ? 0 : at.fillPct,
  });
  lastPlannerModel = plannerModel;
  Draw3D.drawGlobe(plannerGlobeCanvas, plannerModel, plannerView);
  Draw3D.drawPlannerChart(plannerChartCanvas, curve, params.plannerDays, params.cavityMl);

  const coverageCache = new Map();
  const breakSpan = tamponadeWindow(params, curve, "break", coverageCache);
  const mhSpan = tamponadeWindow(params, curve, "mh", coverageCache);
  const oil = at.kind === "oil";

  const weeks = params.plannerDays / 7;
  document.getElementById("plannerTimeHint").textContent = params.plannerDays < 0.25
    ? "· day 0 · surgery"
    : `· day ${formatNumber(params.plannerDays, 1)} · ${formatNumber(weeks, 1)} week${weeks === 1 ? "" : "s"}`;

  const phaseLabel = oil
    ? "oil, no absorption on this timescale"
    : at.phase === "expanding"
      ? `expanding toward ${formatNumber(at.expansion, 2)}×`
      : at.phase === "absorbing"
        ? `power-law fade · gone ~day ${formatNumber(at.durationDays, 0)} from this fill`
        : at.phase === "gone"
          ? "bubble gone"
          : "stable";
  document.getElementById("plannerMetrics").innerHTML = [
    metric("Day", formatNumber(params.plannerDays, 1), phaseLabel),
    metric(
      "Occupying",
      at.phase === "gone" ? "0 mL" : `${formatNumber(at.ml, 2)} mL`,
      `${formatNumber(at.fillPct, 0)}% of ${formatNumber(params.cavityMl, 1)} mL cavity`
    ),
    metric(
      "Break tamponade",
      breakSpan.never ? "None" : `until day ${formatPlannerDay(breakSpan.until)}`,
      breakSpan.never
        ? "not covered with this fill and pose"
        : breakSpan.from > 0.25
          ? `from day ${formatPlannerDay(breakSpan.from)}`
          : "from surgery"
    ),
    metric(
      "MH closure",
      mhSpan.never ? "None" : `until day ${formatPlannerDay(mhSpan.until)}`,
      mhSpan.never
        ? "fovea not covered with this fill and pose"
        : mhSpan.from > 0.25
          ? `from day ${formatPlannerDay(mhSpan.from)}`
          : "from surgery"
    ),
  ].filter(Boolean).join("");

  const breakLine = tamponadeUntilSentence("Break", breakSpan, oil);
  const mhLine = tamponadeUntilSentence("MH", mhSpan, oil);
  let plannerAlert = "";
  if (at.clipped) {
    plannerAlert += `<div class="alert warn">Expansion would be ${formatNumber(at.rawMl, 2)} mL; the cavity clips it at ${formatNumber(params.cavityMl, 2)} mL. IOP rise is not modeled.</div>`;
  }
  plannerAlert += `<div class="alert ${breakSpan.never ? "danger" : "ok"}">${breakLine}</div>`;
  plannerAlert += `<div class="alert ${mhSpan.never ? "danger" : "ok"}">${mhLine}</div>`;
  if (oil) {
    plannerAlert += `<div class="alert ok">Silicone oil volume stays at the day-0 fill on this 8-week scale.</div>`;
  }
  document.getElementById("plannerAlert").innerHTML = plannerAlert;

  const margin = model.heightAboveMeniscus;
  document.getElementById("tamponadeMetrics").innerHTML = [
    metric(
      "Tamponade",
      model.tamponaded ? "Yes" : "No",
      model.tamponaded
        ? `${formatNumber(margin, 1)} mm inside the contact cap`
        : `${formatNumber(-margin, 1)} mm outside the contact cap`
    ),
    metric(
      "Break",
      formatClock(model.breakLoc.clockHour),
      model.breakLoc.equatorMm >= -0.05
        ? `${formatNumber(model.breakLoc.equatorMm, 1)} mm posterior of equator`
        : `${formatNumber(-model.breakLoc.equatorMm, 1)} mm anterior of equator`
    ),
    metric("Zenith", formatClock(model.zenithLoc.clockHour), `${formatNumber(model.zenithLoc.equatorMm, 1)} mm from equator`),
    model.macularHole
      ? metric(
        "Macular hole",
        model.macularHoleTamponaded ? "Yes" : "No",
        model.macularHoleTamponaded
          ? `${formatNumber(model.macularHoleHeight, 1)} mm inside the contact cap`
          : `${formatNumber(-model.macularHoleHeight, 1)} mm outside the contact cap`
      )
      : "",
    metric(
      "Contact arc",
      `${formatNumber(model.contactArcDeg, 0)}°`,
      `Wall YL · θ = ${formatNumber(model.meniscus.thetaDeg, 0)}° · Bo = ${formatNumber(model.meniscus.bond, 1)} · flatten ${formatNumber(model.meniscus.flatten * 100, 0)}%`
    ),
  ].filter(Boolean).join("");

  const fluidName = model.tamponade.kind === "oil" ? "oil" : "gas";
  const breakAlert = model.tamponaded
    ? `<div class="alert ok">The break lies on the ${fluidName} side of the meniscus, so this fill and head pose tamponade it.</div>`
    : `<div class="alert danger">The break is on the fluid side of the meniscus. Increase fill, or tilt the zenith toward the break.</div>`;
  const mhAlert = !model.macularHole
    ? ""
    : model.macularHoleTamponaded
      ? `<div class="alert ok">The macular hole at the fovea is on the ${fluidName} side of the meniscus.</div>`
      : `<div class="alert danger">The macular hole is on the fluid side. Face-down (0°) places the fovea at the zenith.</div>`;
  document.getElementById("tamponadeAlert").innerHTML = breakAlert + mhAlert;

  const maculaProtected = Boolean(model.maculaProtected);
  const breakProtected = Boolean(model.tamponaded);
  const downward = Boolean(model.pressure.downwardOnMacula);
  const steamroll = maculaProtected && !breakProtected;
  const si = model.pressure.maculaSI || 0;
  const nt = model.pressure.maculaNT || 0;
  document.getElementById("forceMetrics").innerHTML = [
    metric(
      "Superior/Inferior pressure difference",
      downward ? `${formatNumber(si, 2)} mmHg down` : "None",
      downward
        ? "higher force on the superior macula"
        : Math.abs(nt) > 0.02
          ? "nasal/temporal only, or no macular force"
          : "no inferior-directed force on the macula",
      downward ? "danger" : "ok"
    ),
    metric(
      "Macula protected",
      maculaProtected ? "Yes" : "No",
      maculaProtected
        ? "fovea on the gas side of the meniscus"
        : "fovea on the fluid side",
      maculaProtected ? "ok" : "danger"
    ),
    metric(
      "Break protected",
      breakProtected ? "Yes" : "No",
      breakProtected
        ? "break on the gas side of the meniscus"
        : "break on the fluid side",
      breakProtected ? "ok" : "danger"
    ),
    metric(
      "Steamroll fluid egress",
      steamroll ? "Fluid can flow out from the break" : "No",
      steamroll
        ? "macula covered, break uncovered"
        : "needs macula covered and break uncovered",
      steamroll ? "ok" : "danger"
    ),
  ].join("");

  const macCovered = maculaProtected;
  let forceAlert = macCovered
    ? `<div class="alert ok">The macula is under the bubble.</div>`
    : `<div class="alert warn">The macula is not under the bubble. Face-down (0°) places the fovea at the zenith.</div>`;
  if (downward) {
    forceAlert += `<div class="alert danger">Superior macular force is higher than inferior, so the bubble presses downward across the macula.</div>`;
  }
  if (steamroll) {
    forceAlert += `<div class="alert ok">Macula covered and break uncovered: subretinal fluid can leave through the break.</div>`;
  }
  if (model.macularHole) {
    forceAlert += model.macularHoleTamponaded
      ? `<div class="alert ok">The macular hole is under gas, so the foveal defect is tamponaded.</div>`
      : `<div class="alert danger">The macular hole is not under gas in this pose.</div>`;
  }
  document.getElementById("forceAlert").innerHTML = forceAlert;

  writeQuery(params);
  requestGlobePinSync();
}

function writeQuery(params) {
  const q = new URLSearchParams({
    axial: String(params.axialMm),
    tamponadeVol: String(params.tamponadeMl),
    clockHour: String(params.clockHour),
    equatorMm: String(params.equatorMm),
    faceDown: String(params.faceDownDeg),
    tiltLR: String(params.tiltLRDeg),
    tamponade: params.tamponade,
    gasPct: String(params.gasPct),
    cavityFluid: params.cavityFluid,
    lens: params.lens,
    eye: params.eye,
    buckle: (params.buckle && params.buckle.style) || "none",
    buckleCenter: (params.buckle && params.buckle.center) || "vb",
    plannerDays: String(params.plannerDays),
    macularHole: params.macularHole ? "on" : "off",
  });
  history.replaceState(null, "", `?${q.toString()}`);
}

function setField(name, value) {
  const field = form.elements[name];
  if (!field) return;
  if (field.type === "checkbox") {
    field.checked = value === "on" || value === "1" || value === "true";
    return;
  }
  if (field instanceof RadioNodeList) {
    const match = form.querySelector(`[name="${name}"][value="${value}"]`);
    if (match) match.checked = true;
    return;
  }
  field.value = value;
}

function loadQuery() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return;
  for (const [key, value] of q.entries()) {
    if (key === "fillPct" || key === "bubbleCount" || key.startsWith("bubbleVol") || key === "plannerDays") continue;
    setField(key, value);
  }
  if (q.has("tamponadeVol")) {
    setField("tamponadeVol", q.get("tamponadeVol"));
  } else if (q.has("fillPct")) {
    const cavity = Number(q.get("cavity")) || 4.5;
    setField("tamponadeVol", ((Number(q.get("fillPct")) / 100) * cavity).toFixed(2));
  }
  if (q.has("plannerDays") && plannerDaysInput) {
    plannerDaysInput.value = q.get("plannerDays");
  }
  if (q.has("tamponade")) lastTamponadeId = q.get("tamponade");
  if (q.get("buckleCenter") === "parsPlana") setField("buckleCenter", "vb");
}

function resetForm() {
  Object.entries(DEFAULTS).forEach(([key, value]) => setField(key, value));
  setField("equatorMm", defaultBreakEquatorMm().toFixed(2));
  lastTamponadeId = DEFAULTS.tamponade;
  if (plannerDaysInput) plannerDaysInput.value = DEFAULTS.plannerDays;
  view.yaw = 0;
  view.pitch = 0;
  plannerView.yaw = 0;
  plannerView.pitch = 0;
  render();
}

form.addEventListener("input", render);
if (plannerDaysInput) plannerDaysInput.addEventListener("input", render);
document.getElementById("reset").addEventListener("click", resetForm);
document.getElementById("copyLink").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    document.getElementById("copyLink").textContent = "Link copied";
    setTimeout(() => {
      document.getElementById("copyLink").textContent = "Copy link to these settings";
    }, 1600);
  } catch {
    prompt("Copy this link", location.href);
  }
});

function bindOrbit(canvas, viewState, draw) {
  if (!canvas) return;
  let dragging = null;
  let pointerId = null;
  let raf = 0;

  const paint = () => {
    raf = 0;
    draw();
  };

  const onMove = (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    event.preventDefault();
    const k = event.pointerType === "touch" ? 0.006 : 0.01;
    viewState.yaw = dragging.yaw + (event.clientX - dragging.x) * k;
    viewState.pitch = BubbleModel.clamp(
      dragging.pitch + (event.clientY - dragging.y) * k,
      -1.2,
      1.2
    );
    if (!raf) raf = requestAnimationFrame(paint);
  };

  const endDrag = (event) => {
    if (pointerId != null && event.pointerId !== pointerId) return;
    dragging = null;
    pointerId = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    pointerId = event.pointerId;
    dragging = {
      x: event.clientX,
      y: event.clientY,
      yaw: viewState.yaw,
      pitch: viewState.pitch,
    };
    if (event.pointerType === "touch") {
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    } else {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (_) {
        /* older Safari */
      }
    }
  }, { passive: false });

  canvas.addEventListener("pointermove", onMove, { passive: false });
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", endDrag);
}

bindOrbit(globeCanvas, view, () => {
  if (lastGlobeModel) Draw3D.drawGlobe(globeCanvas, lastGlobeModel, view);
});
bindOrbit(plannerGlobeCanvas, plannerView, () => {
  if (lastPlannerModel) Draw3D.drawGlobe(plannerGlobeCanvas, lastPlannerModel, plannerView);
});

const globeDock = document.getElementById("globeDock");
const globeWrap = document.getElementById("globeWrap");
const pinMq = window.matchMedia("(max-width: 720px)");
let globePinned = false;
let pinHeight = 0;
let pinRaf = 0;

function unpinGlobe() {
  globePinned = false;
  pinHeight = 0;
  if (globeWrap) globeWrap.classList.remove("is-pinned");
  document.body.classList.remove("has-globe-pin");
  if (globeDock) globeDock.style.minHeight = "";
  document.documentElement.style.setProperty("--globe-pin-h", "0px");
}

function syncGlobePin() {
  if (!globeDock || !globeWrap || !pinMq.matches) {
    if (globePinned) unpinGlobe();
    return;
  }
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const h = (globePinned && pinHeight) || globeWrap.getBoundingClientRect().height;
  const dockTop = globeDock.getBoundingClientRect().top;
  const slack = 10;
  const shouldPin = globePinned
    ? dockTop > vh - h - slack
    : dockTop > vh - h + slack;
  if (shouldPin) {
    globePinned = true;
    globeWrap.classList.add("is-pinned");
    document.body.classList.add("has-globe-pin");
    pinHeight = globeWrap.getBoundingClientRect().height;
    globeDock.style.minHeight = `${pinHeight}px`;
    document.documentElement.style.setProperty("--globe-pin-h", `${pinHeight}px`);
  } else {
    unpinGlobe();
  }
}

function requestGlobePinSync() {
  if (pinRaf) return;
  pinRaf = requestAnimationFrame(() => {
    pinRaf = 0;
    syncGlobePin();
  });
}

window.addEventListener("scroll", requestGlobePinSync, { passive: true });
window.addEventListener("resize", requestGlobePinSync);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", requestGlobePinSync);
  window.visualViewport.addEventListener("scroll", requestGlobePinSync);
}
pinMq.addEventListener("change", requestGlobePinSync);

loadQuery();
{
  const q = new URLSearchParams(location.search);
  if (!q.has("equatorMm") || isStaleBreakDefault(q.get("equatorMm"))) {
    setField("equatorMm", defaultBreakEquatorMm().toFixed(2));
  }
}
render();
requestGlobePinSync();
