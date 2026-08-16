const form = document.getElementById("params");
const globeCanvas = document.getElementById("globe");
const forceCanvas = document.getElementById("force");

const DEFAULTS = {
  axial: "24",
  tamponadeVol: "2.25",
  clockHour: "12",
  equatorMm: "3.1",
  faceDown: "90",
  tiltLR: "0",
  tamponade: "sf6",
  cavityFluid: "vitreous",
  lens: "phakic",
  eye: "OD",
};

const view = { yaw: 0, pitch: 0 };

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
  const cavityShape = BubbleModel.buildCavity(axial, lens, eye);
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
  return {
    axialMm: axial,
    cavityMl,
    tamponadeMl,
    fillPct,
    clockHour: clock,
    equatorMm,
    faceDownDeg: data.get("faceDown") === null || data.get("faceDown") === "" ? 90 : Number(data.get("faceDown")),
    tiltLRDeg: Number(data.get("tiltLR")) || 0,
    tamponade: data.get("tamponade") || "sf6",
    cavityFluid: data.get("cavityFluid") || "vitreous",
    lens,
    cavity: cavityShape,
    eye,
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
  document.getElementById("lensHint").textContent = model.params.lens === "pseudo"
    ? "Planar cap at the lens equator, ~2 mm anterior of the Atchison vertex. IOL contact angle 55° (oil 30°)."
    : "Same equator opening; Navarro capsule (R = 6 mm, Q = −1) dents ~2 mm into the vitreous. Capsule contact angle 50° (oil 30°).";
  const tiltHint = document.getElementById("tiltAnatomyHint");
  if (tiltHint) {
    tiltHint.textContent = "Atchison Model 2 retina: 11.5° temporal tilt, 3.6° down, 0.5 mm nasal and 0.2 mm inferior decentration. The lens stays on the visual axis.";
  }
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
  document.getElementById("eyeHint").textContent = model.eye === "OS"
    ? "Left eye. Disc is 4.5 mm nasal, drawn toward 9 o’clock. Arcades pass 4 mm above and below the fovea."
    : "Right eye. Disc is 4.5 mm nasal, drawn toward 3 o’clock. Arcades pass 4 mm above and below the fovea.";

  const t = model.tamponade;
  const lambda = t.capillaryMm;
  const mlAtBo1 = ((4 / 3) * Math.PI * lambda ** 3) / 1000;
  const bo = model.meniscus.bond || 0;
  const fluidName = (t.cavityFluid && t.cavityFluid.name) || "Vitreous";
  const sigmaMN = t.sigmaNM * 1000;
  document.getElementById("cavityFluidHint").textContent = `· σ = ${formatNumber(sigmaMN, 0)} mN/m · retina θ = ${formatNumber(t.thetaDeg, 0)}° · lens θ = ${formatNumber(t.thetaLensDeg || 50, 0)}° through ${fluidName.toLowerCase()}`;
  document.getElementById("bondNote").textContent = `Bond number Bo = (rb / λ)². Bo < 1: Laplace (surface tension) keeps the bubble round. Bo > 1: gravity and wall capillary flatten the underside. For this agent Bo = 1 at ${formatNumber(mlAtBo1, 2)} mL (λ ≈ ${formatNumber(lambda, 1)} mm). This fill is Bo = ${formatNumber(bo, 1)}.`;
  document.getElementById("tamponadeNote").textContent = t.kind === "oil"
    ? `Oil is only ~3% less dense than aqueous (Δρ ≈ ${Math.round(t.deltaRho)} kg/m³), so the Young–Laplace surface stays rounded. On ${fluidName.toLowerCase()}, σ ≈ ${formatNumber(sigmaMN, 0)} mN/m and θ = ${formatNumber(t.thetaDeg, 0)}°. 1000 vs 5000 cs changes viscosity, not the static shape.`
    : t.id === "air"
      ? `Air is non-expansile (σ = ${formatNumber(sigmaMN, 0)} mN/m on ${fluidName.toLowerCase()}, θ = ${formatNumber(t.thetaDeg, 0)}°, ρ = ${formatNumber(t.densityKgM3, 1)} kg/m³, Δρ = ${Math.round(t.deltaRho)} kg/m³, λ ≈ ${formatNumber(t.capillaryMm, 1)} mm). Volume is the occupying fill.`
      : `${t.name} ${t.isoexpansilePct}% is isoexpansile (σ = ${formatNumber(sigmaMN, 0)} mN/m on ${fluidName.toLowerCase()}, θ = ${formatNumber(t.thetaDeg, 0)}°). Mix ρ = ${formatNumber(t.densityKgM3, 1)} kg/m³, so Δρ = ${Math.round(t.deltaRho)} kg/m³ and λ ≈ ${formatNumber(t.capillaryMm, 1)} mm. Volume is the occupying fill; later expansion is not modeled.`;
}

function metric(label, value, sub) {
  return `<div class="metric"><span class="label">${label}</span><span class="value">${value}</span><span class="sub">${sub}</span></div>`;
}

function render() {
  const model = BubbleModel.simulate(readParams());
  renderHints(model);
  Draw3D.drawGlobe(globeCanvas, model, view);
  Draw3D.drawForce(forceCanvas, model);

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
    metric(
      "Contact arc",
      `${formatNumber(model.contactArcDeg, 0)}°`,
      `Wall YL · retina θ = ${formatNumber(model.meniscus.thetaDeg, 0)}° · lens θ = ${formatNumber(model.meniscus.thetaLensDeg || 50, 0)}° · Bo = ${formatNumber(model.meniscus.bond, 1)} · flatten ${formatNumber(model.meniscus.flatten * 100, 0)}%`
    ),
  ].join("");

  document.getElementById("tamponadeAlert").innerHTML = model.tamponaded
    ? `<div class="alert ok">The break lies on the ${model.tamponade.kind === "oil" ? "oil" : "gas"} side of the meniscus, so this fill and head pose tamponade it.</div>`
    : `<div class="alert danger">The break is on the fluid side of the meniscus. Increase fill, or tilt the zenith toward the break.</div>`;

  document.getElementById("forceMetrics").innerHTML = [
    metric("Fovea ΔP", `${formatNumber(model.pressure.fovea, 2)} mmHg`, "true face-down puts the peak here"),
    metric("Macula mean ΔP", `${formatNumber(model.pressure.maculaMean, 2)} mmHg`, `disk r = ${model.maculaRadiusMm} mm`),
    metric("Break ΔP", `${formatNumber(model.pressure.break, 2)} mmHg`, model.tamponaded ? "at the break" : "no gas contact"),
    metric("Apex ΔP", `${formatNumber(model.pressure.zenith, 2)} mmHg`, `Δρ = ${Math.round(model.tamponade.deltaRho)} kg/m³ · σκ₀ = ${formatNumber(model.pressure.laplace, 2)} mmHg`),
  ].join("");

  const macCovered = model.pressure.maculaMean > Math.max(0.004, model.pressure.max * 0.08);
  document.getElementById("forceAlert").innerHTML = macCovered
    ? `<div class="alert ok">The macular disk is under the bubble. Force is highest at the zenith and falls to zero at the meniscus.</div>`
    : `<div class="alert warn">Little or no hydrostatic force on the macula in this pose. Face-down (0°) places the fovea at the zenith.</div>`;

  writeQuery(readParams());
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
    cavityFluid: params.cavityFluid,
    lens: params.lens,
    eye: params.eye,
  });
  history.replaceState(null, "", `?${q.toString()}`);
}

function setField(name, value) {
  const field = form.elements[name];
  if (!field) return;
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
    if (key === "fillPct" || key === "bubbleCount" || key.startsWith("bubbleVol")) continue;
    setField(key, value);
  }
  if (q.has("tamponadeVol")) {
    setField("tamponadeVol", q.get("tamponadeVol"));
  } else if (q.has("fillPct")) {
    const cavity = Number(q.get("cavity")) || 4.5;
    setField("tamponadeVol", ((Number(q.get("fillPct")) / 100) * cavity).toFixed(2));
  }
}

function resetForm() {
  Object.entries(DEFAULTS).forEach(([key, value]) => setField(key, value));
  setField("equatorMm", defaultBreakEquatorMm().toFixed(2));
  view.yaw = 0;
  view.pitch = 0;
  render();
}

form.addEventListener("input", render);
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

let drag = null;
globeCanvas.addEventListener("pointerdown", (event) => {
  drag = { x: event.clientX, y: event.clientY, yaw: view.yaw, pitch: view.pitch };
  globeCanvas.setPointerCapture(event.pointerId);
});
globeCanvas.addEventListener("pointerup", () => {
  drag = null;
});
globeCanvas.addEventListener("pointermove", (event) => {
  if (!drag) return;
  view.yaw = drag.yaw + (event.clientX - drag.x) * 0.01;
  view.pitch = BubbleModel.clamp(drag.pitch + (event.clientY - drag.y) * 0.01, -1.2, 1.2);
  render();
});

loadQuery();
{
  const q = new URLSearchParams(location.search);
  if (!q.has("equatorMm") || isStaleBreakDefault(q.get("equatorMm"))) {
    setField("equatorMm", defaultBreakEquatorMm().toFixed(2));
  }
}
render();
