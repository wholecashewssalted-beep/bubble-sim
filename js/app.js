const form = document.getElementById("params");
const globeCanvas = document.getElementById("globe");
const forceCanvas = document.getElementById("force");

const DEFAULTS = {
  sizeMode: "volume",
  cavity: "4.5",
  axial: "24",
  tamponadeVol: "2.25",
  clockHour: "12",
  equatorMm: "3",
  faceDown: "90",
  tiltLR: "0",
  tamponade: "sf6",
  cavityFluid: "vitreous",
  eye: "OD",
};

const view = { yaw: 0, pitch: 0 };

function readParams() {
  const data = new FormData(form);
  let clock = Number(data.get("clockHour"));
  if (clock === 0) clock = 12;
  const sizeMode = data.get("sizeMode") || "volume";
  const axial = Number(data.get("axial")) || 24;
  let cavityMl = Number(data.get("cavity")) || 4.5;
  if (sizeMode === "axial") {
    cavityMl = BubbleModel.vitreousVolumeFromAxialLength(axial);
    form.elements.cavity.value = cavityMl.toFixed(1);
  }
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
  const R = BubbleModel.radiusMmFromVolumeMl(cavityMl);
  const foveaArcMm = (Math.PI / 2) * R;
  const eqSlider = form.elements.equatorMm;
  eqSlider.min = "0";
  eqSlider.max = foveaArcMm.toFixed(2);
  const equatorMm = BubbleModel.clamp(Number(data.get("equatorMm")) || 0, 0, foveaArcMm);
  eqSlider.value = equatorMm.toFixed(2);
  return {
    sizeMode,
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
    eye: data.get("eye") === "OS" ? "OS" : "OD",
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

function syncSizeMode(sizeMode) {
  document.getElementById("volumeRow").hidden = sizeMode === "axial";
  document.getElementById("axialRow").hidden = sizeMode !== "axial";
}

function renderHints(model) {
  const R = model.radiusMm;
  const axial = model.params.axialMm || Number(form.elements.axial.value) || 24;
  document.getElementById("cavityHint").textContent = `· ${formatNumber(model.params.cavityMl, 1)} mL · R = ${formatNumber(R, 1)} mm`;
  document.getElementById("axialHint").textContent = `· ${formatNumber(axial, 1)} mm → ${formatNumber(model.params.cavityMl, 2)} mL`;
  document.getElementById("fillHint").textContent = `· ${formatNumber(model.params.tamponadeMl, 2)} mL · ${formatNumber(model.params.fillPct, 0)}% of ${formatNumber(model.params.cavityMl, 1)} mL · Bo = ${formatNumber(model.meniscus.bond, 1)}`;
  document.getElementById("clockHint").textContent = `· ${formatClock(model.params.clockHour)}`;
  const equatorMm = model.params.equatorMm;
  const foveaArcMm = (Math.PI / 2) * R;
  document.getElementById("equatorHint").textContent = equatorMm < 0.05
    ? "· equator"
    : equatorMm >= foveaArcMm - 0.2
      ? "· fovea"
      : `· ${formatNumber(equatorMm, 2)} mm posterior, toward fovea`;
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
  syncSizeMode(model.params.sizeMode || "volume");

  const t = model.tamponade;
  const lambda = t.capillaryMm;
  const mlAtBo1 = ((4 / 3) * Math.PI * lambda ** 3) / 1000;
  const bo = model.meniscus.bond || 0;
  const fluidName = (t.cavityFluid && t.cavityFluid.name) || "Vitreous";
  const sigmaMN = t.sigmaNM * 1000;
  document.getElementById("cavityFluidHint").textContent = `· σ = ${formatNumber(sigmaMN, 0)} mN/m · θ = ${formatNumber(t.thetaDeg, 0)}° through ${fluidName.toLowerCase()}`;
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
    metric("Break", formatClock(model.breakLoc.clockHour), `${formatNumber(model.breakLoc.equatorMm, 1)} mm posterior of equator`),
    metric("Zenith", formatClock(model.zenithLoc.clockHour), `${formatNumber(model.zenithLoc.equatorMm, 1)} mm from equator`),
    metric(
      "Contact arc",
      `${formatNumber(model.contactArcDeg, 0)}°`,
      `Young–Laplace + gravity · θ = ${formatNumber(model.meniscus.thetaDeg, 0)}° · Bo = ${formatNumber(model.meniscus.bond, 1)} · flatten ${formatNumber(model.meniscus.flatten * 100, 0)}%`
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
    sizeMode: params.sizeMode,
    cavity: String(params.cavityMl),
    axial: String(params.axialMm),
    tamponadeVol: String(params.tamponadeMl),
    clockHour: String(params.clockHour),
    equatorMm: String(params.equatorMm),
    faceDown: String(params.faceDownDeg),
    tiltLR: String(params.tiltLRDeg),
    tamponade: params.tamponade,
    cavityFluid: params.cavityFluid,
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
    if (key === "fillPct") continue;
    setField(key, value);
  }
  if (q.has("tamponadeVol")) {
    setField("tamponadeVol", q.get("tamponadeVol"));
  } else if (q.has("fillPct")) {
    const cavity = Number(q.get("cavity")) || Number(form.elements.cavity.value) || 4.5;
    setField("tamponadeVol", ((Number(q.get("fillPct")) / 100) * cavity).toFixed(2));
  }
}

function resetForm() {
  Object.entries(DEFAULTS).forEach(([key, value]) => setField(key, value));
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
render();
