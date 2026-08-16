const MACULA_RADIUS_MM = 2.75;
const DISC_FOVEA_MM = 4.5;
const ARCADE_FOVEA_MM = 4.0;
const DISC_RADIUS_MM = 0.75;

/**
 * Optional ora serrata + vortex ampullae. Set false to omit them from the
 * model and both drawings. To remove the feature, delete this flag,
 * extraLandmarks(), and drawOraAndVortex() in draw.js.
 */
const SHOW_ORA_AND_VORTEX = true;
const ORA_NASAL_MM_AT_24 = 17.5;
const ORA_TEMPORAL_MM_AT_24 = 18.75;
const ORA_MM_PER_AL = 0.16;
const VORTEX_MM_AT_24 = 25;
const VORTEX_MM_PER_AL = 0.35;
const VORTEX_DISPLACE_CAP_MM = 1.3;
const RHO_AQUEOUS = 1000;
const G_M_S2 = 9.81;
const PA_PER_MMHG = 133.322;
const RHO_KG_M3 = RHO_AQUEOUS;
const MMHG_PER_MM_HEIGHT = (RHO_AQUEOUS * G_M_S2 * 0.001) / PA_PER_MMHG;

/**
 * Shared static gas interface. Air, SF₆, and C₃F₈ use the same σ and θ.
 * Each gas keeps its own density, so Δρ = 1000 − ρ_gas differs slightly.
 * They also differ clinically in expansion and duration, which this snapshot omits.
 *
 * 1. Cavity is a sphere; occupying volume is the given mL (no Boyle / IOP).
 * 2. Static, axisymmetric about gravity; bubble sits at the zenith.
 * 3. One gas–aqueous interface: σ κ = ΔP₀ + Δρ g z.
 * 4. Apex is horizontal and is the lowest point of the interface.
 * 5. Young angle through the cavity liquid at the retina (depends on fluid).
 * 6. Gas–liquid σ from the cavity fluid (vitreous ~61, aqueous ~65, BSS ~72 mN/m).
 *    Gases are isoexpansile mixes (air 100%, SF₆ 20%, C₃F₈ 14%).
 *    Mixture density is ρ = f ρ_pure + (1−f) ρ_air; Δρ = 1000 − ρ.
 * 7. One gravity Young–Laplace solve at every fill: σ κ = ΔP₀ + Δρ g z
 *    with Young angle at the wall. Small Bond number stays round; large
 *    Bond number flattens. No separate Laplace-vs-capillary cutoff.
 * 8. Tamponade if the break’s polar angle from zenith ≤ contact β.
 * 9. On gas-contact retina, ΔP = σ κ₀ + Δρ g (z − z_apex); else 0.
 */
const GAS_MODEL = {
  kind: "gas",
  sigmaNM: 0.061,
  thetaDeg: 39,
};

/**
 * Hydrophilic phase in the vitreous cavity. Sets gas–liquid σ and Young θ.
 * Vitreous ~61 mN/m (Ross 2010; PLOS 2020). Aqueous ~65 mN/m. BSS ~72 mN/m.
 * Air–retina–fluid contact angle ~39° (through the liquid) from gas-coverage CFD.
 */
const CAVITY_FLUIDS = {
  vitreous: {
    id: "vitreous",
    name: "Vitreous",
    sigmaGasNM: 0.061,
    thetaGasDeg: 39,
    sigmaOilNM: 0.032,
    thetaOilDeg: 25,
  },
  aqueous: {
    id: "aqueous",
    name: "Aqueous",
    sigmaGasNM: 0.065,
    thetaGasDeg: 30,
    sigmaOilNM: 0.035,
    thetaOilDeg: 25,
  },
  bss: {
    id: "bss",
    name: "BSS",
    sigmaGasNM: 0.072,
    thetaGasDeg: 30,
    sigmaOilNM: 0.04,
    thetaOilDeg: 25,
  },
};
const AIR_DENSITY_KG_M3 = 1.2;

const SIGMA_N_M = GAS_MODEL.sigmaNM;
const THETA_AQUEOUS_RAD = (GAS_MODEL.thetaDeg * Math.PI) / 180;
const RHO_G_OVER_SIGMA_PER_MM2 = (RHO_AQUEOUS * G_M_S2 / SIGMA_N_M) / 1e6;
const CAPILLARY_MM = Math.sqrt(SIGMA_N_M / (RHO_AQUEOUS * G_M_S2)) * 1000;
const LAPLACE_MMHG_PER_KAPPA = (SIGMA_N_M * 1000) / PA_PER_MMHG;

const TAMPONADES = {
  sf6: {
    id: "sf6",
    name: "SF₆",
    pureDensityKgM3: 6.2,
    isoexpansilePct: 20,
    ...GAS_MODEL,
  },
  c3f8: {
    id: "c3f8",
    name: "C₃F₈",
    pureDensityKgM3: 8.2,
    isoexpansilePct: 14,
    ...GAS_MODEL,
  },
  air: {
    id: "air",
    name: "Air",
    pureDensityKgM3: AIR_DENSITY_KG_M3,
    isoexpansilePct: 100,
    ...GAS_MODEL,
  },
  so1000: {
    id: "so1000",
    name: "Silicone oil 1000",
    kind: "oil",
    densityKgM3: 970,
    sigmaNM: 0.035,
    thetaDeg: 25,
  },
  so5000: {
    id: "so5000",
    name: "Silicone oil 5000",
    kind: "oil",
    densityKgM3: 973,
    sigmaNM: 0.036,
    thetaDeg: 25,
  },
};

function mixtureDensityKgM3(listed) {
  if (listed.kind !== "gas") return listed.densityKgM3;
  const frac = clamp((listed.isoexpansilePct ?? 100) / 100, 0, 1);
  const pure = listed.pureDensityKgM3 ?? AIR_DENSITY_KG_M3;
  return frac * pure + (1 - frac) * AIR_DENSITY_KG_M3;
}

function tamponadeProps(id, cavityFluidId) {
  const listed = TAMPONADES[id] || TAMPONADES.sf6;
  const cavity = CAVITY_FLUIDS[cavityFluidId] || CAVITY_FLUIDS.vitreous;
  const densityKgM3 = listed.kind === "gas" ? mixtureDensityKgM3(listed) : listed.densityKgM3;
  const sigmaNM = listed.kind === "gas" ? cavity.sigmaGasNM : cavity.sigmaOilNM;
  const thetaDeg = listed.kind === "gas" ? cavity.thetaGasDeg : cavity.thetaOilDeg;
  const raw = listed.kind === "gas"
    ? { ...listed, ...GAS_MODEL, id: listed.id, name: listed.name, densityKgM3, sigmaNM, thetaDeg }
    : { ...listed, densityKgM3, sigmaNM, thetaDeg };
  const deltaRho = Math.max(RHO_AQUEOUS - raw.densityKgM3, 1);
  const sigma = raw.sigmaNM;
  return {
    ...raw,
    cavityFluid: cavity,
    deltaRho,
    thetaAqueousRad: (raw.thetaDeg * Math.PI) / 180,
    rhoGOverSigmaPerMm2: (deltaRho * G_M_S2 / sigma) / 1e6,
    capillaryMm: Math.sqrt(sigma / (deltaRho * G_M_S2)) * 1000,
    laplaceMmHgPerKappa: (sigma * 1000) / PA_PER_MMHG,
    mmHgPerMmHeight: (deltaRho * G_M_S2 * 0.001) / PA_PER_MMHG,
  };
}

function vitreousVolumeFromAxialLength(alMm) {
  const al = clamp(alMm, 16, 38);
  const mm3 = ((al ** 3 * Math.PI) / 6) * (0.76 + 0.012 * (al - 24));
  return mm3 / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function vec(x, y, z) {
  return { x, y, z };
}

function add(a, b) {
  return vec(a.x + b.x, a.y + b.y, a.z + b.z);
}

function sub(a, b) {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z);
}

function scale(a, s) {
  return vec(a.x * s, a.y * s, a.z * s);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

function len(a) {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a) {
  const n = len(a) || 1;
  return scale(a, 1 / n);
}

function radiusMmFromVolumeMl(volumeMl) {
  const volumeMm3 = Math.max(volumeMl, 0.2) * 1000;
  return Math.cbrt((3 * volumeMm3) / (4 * Math.PI));
}

function capHeightFraction(fillFraction) {
  const f = clamp(fillFraction, 0, 1);
  if (f <= 0) return 0;
  if (f >= 1) return 2;
  let k = Math.sqrt((4 * f) / 3);
  for (let i = 0; i < 14; i += 1) {
    const value = (k * k * (3 - k)) / 4 - f;
    const deriv = (3 * k * (2 - k)) / 4;
    if (Math.abs(deriv) < 1e-12) break;
    k = clamp(k - value / deriv, 0, 2);
  }
  return k;
}

/**
 * Anatomical frame (mm): +X patient left, +Y superior, +Z anterior.
 * Fovea is the posterior pole (0, 0, −R).
 * Clock hours are as you face the eye: 12 up, 3 right, 6 down, 9 left
 * (3 = patient-left, 9 = patient-right). The macula is behind the globe.
 * Distance from the equator is along the retina, toward the fovea only (0 = equator, πR/2 = fovea).
 */
function breakPosition(radiusMm, clockHour, equatorMm) {
  const lat = clamp(equatorMm / radiusMm, 0, Math.PI / 2);
  const az = ((clockHour % 12) / 12) * Math.PI * 2;
  const c = Math.cos(lat);
  return vec(
    radiusMm * c * Math.sin(az),
    radiusMm * c * Math.cos(az),
    -radiusMm * Math.sin(lat)
  );
}

function clockAndLatitude(point, radiusMm) {
  const lat = Math.asin(clamp(-point.z / radiusMm, -1, 1));
  let az = Math.atan2(point.x, point.y);
  if (az < 0) az += Math.PI * 2;
  const hour = (az / (Math.PI * 2)) * 12;
  return {
    clockHour: hour === 0 ? 12 : hour,
    equatorMm: lat * radiusMm,
    latitudeDeg: (lat * 180) / Math.PI,
  };
}

/**
 * 0° face-down keeps the fovea at the zenith.
 * 90° is sitting (12 o’clock up). 180° is supine (cornea at the zenith).
 * Left/right tilt: ±90°; positive = left ear down, zenith toward the patient’s right retina.
 */
function zenithVector(faceDownDeg, tiltLRDeg) {
  const a = (faceDownDeg * Math.PI) / 180;
  const b = (tiltLRDeg * Math.PI) / 180;
  return normalize(
    vec(-Math.sin(b), Math.cos(b) * Math.sin(a), -Math.cos(b) * Math.cos(a))
  );
}

function geodesicMm(a, b, radiusMm) {
  const na = normalize(a);
  const nb = normalize(b);
  return radiusMm * Math.acos(clamp(dot(na, nb), -1, 1));
}

function inMacula(point, radiusMm) {
  return geodesicMm(point, vec(0, 0, -radiusMm), radiusMm) <= MACULA_RADIUS_MM;
}

function hydrostaticMmHg(point, zenith, meniscusMm) {
  const heightMm = dot(point, zenith) - meniscusMm;
  if (heightMm <= 0) return 0;
  return MMHG_PER_MM_HEIGHT * heightMm;
}

function liquidContactAngle(r, z, phi) {
  const beta = Math.atan2(r, z);
  return Math.PI - (beta + phi);
}

function rk4Step(r, z, phi, ds, pressureK, gravityK, inward) {
  const sign = inward ? -1 : 1;
  const deriv = (rr, zz, pp) => {
    const kappa = pressureK + gravityK * zz;
    const dphiOut = rr < 1e-7 ? kappa / 2 : kappa - Math.sin(pp) / Math.max(rr, 1e-7);
    return [sign * Math.cos(pp), sign * Math.sin(pp), sign * dphiOut];
  };
  const k1 = deriv(r, z, phi);
  const k2 = deriv(r + 0.5 * ds * k1[0], z + 0.5 * ds * k1[1], phi + 0.5 * ds * k1[2]);
  const k3 = deriv(r + 0.5 * ds * k2[0], z + 0.5 * ds * k2[1], phi + 0.5 * ds * k2[2]);
  const k4 = deriv(r + ds * k3[0], z + ds * k3[1], phi + ds * k3[2]);
  return {
    r: r + (ds / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    z: z + (ds / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    phi: phi + (ds / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
  };
}

function integrateInward(radiusMm, beta, phiWall, pressureK, fluid) {
  const ds = Math.min(radiusMm, fluid.capillaryMm) / 70;
  let r = radiusMm * Math.sin(beta);
  let z = radiusMm * Math.cos(beta);
  let phi = phiWall;
  const pts = [{ r, z, phi }];
  const sMax = Math.PI * radiusMm;
  let s = 0;
  while (s < sMax && pts.length < 700 && r > 0.04) {
    const next = rk4Step(r, z, phi, ds, pressureK, fluid.rhoGOverSigmaPerMm2, true);
    r = next.r;
    z = next.z;
    phi = next.phi;
    s += ds;
    if (!Number.isFinite(r) || !Number.isFinite(z) || !Number.isFinite(phi)) break;
    if (r < 0) {
      pts.push({ r: 0, z, phi });
      break;
    }
    if (Math.abs(phi) > Math.PI) break;
    pts.push({ r, z, phi });
  }
  return pts;
}

function intersectSphere(pts, radiusMm) {
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const da = a.r * a.r + a.z * a.z - radiusMm * radiusMm;
    const db = b.r * b.r + b.z * b.z - radiusMm * radiusMm;
    if (da > 0 || db < 0) continue;
    let lo = 0;
    let hi = 1;
    for (let n = 0; n < 18; n += 1) {
      const t = 0.5 * (lo + hi);
      const r = a.r + t * (b.r - a.r);
      const z = a.z + t * (b.z - a.z);
      if (r * r + z * z < radiusMm * radiusMm) lo = t;
      else hi = t;
    }
    const t = 0.5 * (lo + hi);
    const r0 = a.r + t * (b.r - a.r);
    const z0 = a.z + t * (b.z - a.z);
    const n = Math.hypot(r0, z0) || 1;
    const r = (r0 / n) * radiusMm;
    const z = (z0 / n) * radiusMm;
    const phi = a.phi + t * (b.phi - a.phi);
    const clipped = pts.slice(0, i);
    clipped.push({ r, z, phi });
    return {
      path: clipped,
      r,
      z,
      phi,
      beta: Math.acos(clamp(z / radiusMm, -1, 1)),
      theta: liquidContactAngle(r, z, phi),
    };
  }
  return null;
}

function gasVolumeMm3(radiusMm, hit) {
  const h = radiusMm - hit.z;
  if (h <= 0) return 0;
  if (h >= 2 * radiusMm) return (4 / 3) * Math.PI * radiusMm ** 3;
  const cap = (Math.PI * h * h * (3 * radiusMm - h)) / 3;
  let men = 0;
  const path = hit.path;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    men += Math.PI * 0.5 * (a.r * a.r + b.r * b.r) * (b.z - a.z);
  }
  return cap + men;
}

const ylCache = new Map();

function measuredLiquidContactAngle(radiusMm, path) {
  if (!path || path.length < 2) return null;
  const contact = path[path.length - 1];
  const prev = path[path.length - 2];
  const beta = Math.acos(clamp(contact.z / radiusMm, -1, 1));
  const phi = Math.atan2(contact.z - prev.z, contact.r - prev.r);
  return Math.PI - (beta + phi);
}

function pathRisesAtCenter(path, zA) {
  if (!path || path.length < 3) return true;
  let minZ = path[0].z;
  for (let i = 1; i < path.length; i += 1) {
    if (path[i].z < minZ) minZ = path[i].z;
  }
  return path[0].z > minZ + 0.12 || minZ < zA - 0.12;
}

function resamplePath(path, n = 56) {
  if (!path || path.length <= n) return path;
  const out = [path[0]];
  for (let i = 1; i < n - 1; i += 1) {
    const idx = (i / (n - 1)) * (path.length - 1);
    const j = Math.min(Math.floor(idx), path.length - 2);
    const f = idx - j;
    const a = path[j];
    const b = path[j + 1];
    out.push({
      r: a.r + f * (b.r - a.r),
      z: a.z + f * (b.z - a.z),
      phi: a.phi + f * (b.phi - a.phi),
    });
  }
  out.push(path[path.length - 1]);
  return out;
}

function sphericalYoungMeniscus(radiusMm, beta, theta) {
  const rC = radiusMm * Math.sin(beta);
  const zC = radiusMm * Math.cos(beta);
  const phiW = Math.PI - theta - beta;
  const s = Math.sin(phiW);
  const Rm = Math.abs(s) < 1e-4 ? 40 * radiusMm : rC / s;
  const zI = zC + Rm * Math.cos(phiW);
  const n = 48;
  const path = [];
  for (let i = 0; i <= n; i += 1) {
    const phi = phiW * (i / n);
    path.push({ r: Rm * Math.sin(phi), z: zI - Rm * Math.cos(phi), phi });
  }
  path[0] = { r: 0, z: zI - Rm, phi: 0 };
  path[n] = { r: rC, z: zC, phi: phiW };
  return {
    path,
    r: rC,
    z: zC,
    phi: phiW,
    beta,
    theta,
    zA: path[0].z,
    kappa0: 2 / Math.max(Math.abs(Rm), 0.2),
    fallback: true,
    measuredTheta: measuredLiquidContactAngle(radiusMm, path),
  };
}

function buildCapPath(wallFirst) {
  const join = wallFirst[wallFirst.length - 1];
  const rJ = Math.max(join.r, 0.05);
  const phiJ = clamp(join.phi, 0.02, Math.PI / 2 - 0.05);
  const Rm = rJ / Math.sin(phiJ);
  const zI = join.z + Rm * Math.cos(phiJ);
  const zA = zI - Rm;
  const n = Math.max(18, Math.round(rJ * 3));
  const cap = [];
  for (let i = 0; i <= n; i += 1) {
    const phi = phiJ * (i / n);
    cap.push({
      r: Rm * Math.sin(phi),
      z: zI - Rm * Math.cos(phi),
      phi,
    });
  }
  cap[0] = { r: 0, z: zA, phi: 0 };
  const wall = wallFirst.slice().reverse();
  return {
    path: cap.concat(wall.slice(1)),
    zA,
    kappa0: 2 / Math.max(Rm, 0.2),
    Rm,
  };
}

function integrateInwardToAxis(radiusMm, beta, theta, pressureK, gravityK, ds) {
  const phiW = Math.PI - theta - beta;
  if (phiW < 0.01 || phiW > Math.PI - 0.05) return null;
  const rWall = radiusMm * Math.sin(beta);
  const step = Math.min(ds || radiusMm / 180, 0.02);
  let r = rWall;
  let z = radiusMm * Math.cos(beta);
  let phi = phiW;
  const wallFirst = [{ r, z, phi }];
  let s = 0;
  const sMax = Math.PI * radiusMm * 1.2;
  while (s < sMax && wallFirst.length < 1600 && r > 0.025 && phi > -0.15) {
    const prevZ = z;
    const next = rk4Step(r, z, phi, step, pressureK, gravityK, true);
    if (!Number.isFinite(next.r) || !Number.isFinite(next.z) || !Number.isFinite(next.phi)) return null;
    r = next.r;
    z = next.z;
    phi = next.phi;
    s += step;
    if (r < 0) {
      wallFirst.push({ r: 0, z, phi });
      break;
    }
    wallFirst.push({ r, z, phi });
    const wide = r > Math.max(0.45 * rWall, 0.85);
    if (phi < 0.12 && wide) break;
    if (phi < 0.2 && z > prevZ + 0.002 && wide) break;
    if (Math.abs(phi) > Math.PI - 0.08) return null;
  }
  const join = wallFirst[wallFirst.length - 1];
  const joinedFlat = join.phi <= 0.14 && join.r > Math.max(0.45 * rWall, 0.85);
  let path;
  let zA;
  let kappa0;
  let residual;
  if (joinedFlat) {
    const cap = buildCapPath(wallFirst);
    path = cap.path;
    zA = cap.zA;
    kappa0 = cap.kappa0;
    residual = (pressureK + gravityK * join.z) - kappa0;
  } else {
    path = wallFirst.slice().reverse();
    zA = path[0].z;
    kappa0 = Math.max(pressureK + gravityK * zA, 1e-5);
    residual = path[0].phi + path[0].r;
  }
  if (pathRisesAtCenter(path, zA)) return null;
  return {
    path,
    r: rWall,
    z: radiusMm * Math.cos(beta),
    phi: phiW,
    beta,
    zA,
    phiAxis: path[0].phi,
    rAxis: path[0].r,
    pressureK,
    kappa0,
    flatJoin: joinedFlat,
    residual,
  };
}

function shootPressureForAxis(radiusMm, beta, theta, gravityK, ds) {
  const zC = radiusMm * Math.cos(beta);
  const rWall = radiusMm * Math.sin(beta);
  const pGuess = -gravityK * (zC - 1.1 * Math.sqrt(1 / Math.max(gravityK, 1e-6)));
  const pMin = Math.min(-0.2, pGuess - 0.4);
  const pMax = Math.max(1.6, pGuess + 0.7) + 0.15 * gravityK * radiusMm + 0.35 / Math.max(rWall, 0.4);
  const samples = [];
  for (let i = 0; i <= 36; i += 1) {
    const pressureK = pMin + ((pMax - pMin) * i) / 36;
    const hit = integrateInwardToAxis(radiusMm, beta, theta, pressureK, gravityK, ds);
    if (hit) samples.push(hit);
  }
  if (!samples.length) return null;
  let best = samples.reduce((a, b) => (Math.abs(a.residual) < Math.abs(b.residual) ? a : b));
  const lo = best.pressureK - 0.06;
  const hi = best.pressureK + 0.06;
  for (let n = 0; n < 18; n += 1) {
    const pressureK = lo + ((hi - lo) * (n + 1)) / 20;
    const hit = integrateInwardToAxis(radiusMm, beta, theta, pressureK, gravityK, ds);
    if (hit && Math.abs(hit.residual) < Math.abs(best.residual)) best = hit;
  }
  if (Math.abs(best.residual) > 0.35 && !best.flatJoin) return null;
  return best;
}

function equivalentRadiusMm(volumeMm3) {
  return Math.cbrt((3 * Math.max(volumeMm3, 0)) / (4 * Math.PI));
}

function shapeFromHit(radiusMm, hit, fluid) {
  const full = hit.path;
  const path = resamplePath(full);
  const rC = hit.r;
  const volume = gasVolumeMm3(radiusMm, { path: full, z: hit.z });
  const rb = equivalentRadiusMm(volume);
  let rMax = 0;
  for (let i = 0; i < full.length; i += 1) {
    if (full[i].r > rMax) rMax = full[i].r;
  }
  const height = Math.max(radiusMm - hit.zA, 0.1);
  const aspect = height / Math.max(2 * rMax, 0.1);
  return {
    path,
    r: hit.r,
    z: hit.z,
    phi: hit.phi,
    beta: hit.beta,
    theta: fluid.thetaAqueousRad,
    zA: hit.zA,
    kappa0: Math.max(hit.kappa0, 1e-5),
    bond: (rb / Math.max(fluid.capillaryMm, 0.4)) ** 2,
    flatten: clamp(1 - aspect, 0, 1),
    measuredTheta: Math.PI - (hit.beta + hit.phi),
    volume,
  };
}

function solveYoungLaplace(radiusMm, fill, fluid) {
  const props = fluid || tamponadeProps("sf6");
  const key = `${props.id}:${props.sigmaNM}:${props.thetaDeg}:${radiusMm.toFixed(3)}:${fill.toFixed(4)}`;
  if (ylCache.has(key)) return ylCache.get(key);
  const volumeTarget = fill * (4 / 3) * Math.PI * radiusMm ** 3;
  const theta = props.thetaAqueousRad;
  if (fill >= 0.995) {
    const full = {
      zA: -radiusMm,
      kappa0: 0,
      beta: Math.PI,
      theta,
      measuredTheta: theta,
      path: [{ r: 0, z: -radiusMm, phi: 0 }],
      r: 0,
      z: -radiusMm,
      phi: 0,
      volume: volumeTarget,
      full: true,
    };
    ylCache.set(key, full);
    return full;
  }

  const gravityK = props.rhoGOverSigmaPerMm2;
  const ds = Math.min(radiusMm / 170, Math.max(props.capillaryMm, 0.8) / 60);
  const kFlat = capHeightFraction(fill);
  const betaFlat = Math.acos(clamp(1 - kFlat, -1, 1));
  let bLo = 0.05;
  let bHi = Math.min(Math.PI - 0.1, Math.max(betaFlat + 0.5, 0.9));

  const volumeAtBeta = (beta) => {
    const hit = shootPressureForAxis(radiusMm, beta, theta, gravityK, ds);
    if (!hit) return null;
    return shapeFromHit(radiusMm, hit, props);
  };

  const gather = (lo, hi, n) => {
    const out = [];
    for (let i = 0; i <= n; i += 1) {
      const ev = volumeAtBeta(lo + ((hi - lo) * i) / n);
      if (ev) out.push(ev);
    }
    return out;
  };

  let samples = gather(bLo, bHi, 22);
  if (samples.length) {
    const vmin = Math.min(...samples.map((s) => s.volume));
    const vmax = Math.max(...samples.map((s) => s.volume));
    if (vmax < volumeTarget) {
      bHi = Math.min(Math.PI - 0.07, bHi + 0.45);
      samples = samples.concat(gather(samples[samples.length - 1].beta, bHi, 8));
    }
    if (vmin > volumeTarget) {
      bLo = Math.max(0.04, bLo - 0.35);
      samples = samples.concat(gather(bLo, samples[0].beta, 8));
    }
    samples.sort((a, b) => a.beta - b.beta);
  }

  let best = null;
  if (samples.length) {
    best = samples.reduce((a, b) => (
      Math.abs(a.volume - volumeTarget) < Math.abs(b.volume - volumeTarget) ? a : b
    ));
    let a = null;
    let b = null;
    for (let i = 1; i < samples.length; i += 1) {
      if ((samples[i - 1].volume - volumeTarget) * (samples[i].volume - volumeTarget) <= 0) {
        a = samples[i - 1].beta;
        b = samples[i].beta;
        break;
      }
    }
    if (a != null) {
      for (let n = 0; n < 14; n += 1) {
        const mid = 0.5 * (a + b);
        const ev = volumeAtBeta(mid);
        if (!ev) break;
        if (Math.abs(ev.volume - volumeTarget) < Math.abs(best.volume - volumeTarget)) best = ev;
        if (ev.volume < volumeTarget) a = mid;
        else b = mid;
      }
    }
  }

  if (!best) {
    let lo = Math.max(0.04, betaFlat - 0.35);
    let hi = Math.min(Math.PI - 0.08, betaFlat + 0.2);
    const volumeAtBeta = (beta) => {
      const shape = sphericalYoungMeniscus(radiusMm, beta, theta);
      return { ...shape, volume: gasVolumeMm3(radiusMm, shape) };
    };
    let evLo = volumeAtBeta(lo);
    let evHi = volumeAtBeta(hi);
    best = Math.abs(evLo.volume - volumeTarget) < Math.abs(evHi.volume - volumeTarget) ? evLo : evHi;
    if (evLo.volume <= volumeTarget && evHi.volume >= volumeTarget) {
      let a = lo;
      let b = hi;
      for (let n = 0; n < 14; n += 1) {
        const mid = 0.5 * (a + b);
        best = volumeAtBeta(mid);
        if (best.volume < volumeTarget) a = mid;
        else b = mid;
      }
    }
  }

  ylCache.set(key, best);
  return best;
}

function meridianToWorld(meridian, zenith, nTheta = 48) {
  const ref = Math.abs(zenith.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0);
  const u = normalize(cross(zenith, ref));
  const v = normalize(cross(zenith, u));
  return meridian.map((p) => {
    const ring = [];
    for (let i = 0; i < nTheta; i += 1) {
      const t = (2 * Math.PI * i) / nTheta;
      ring.push(add(scale(zenith, p.z), add(scale(u, p.r * Math.cos(t)), scale(v, p.r * Math.sin(t)))));
    }
    return ring;
  });
}

function sampleSphere(radiusMm, nLat, nLon) {
  const points = [];
  for (let i = 0; i <= nLat; i += 1) {
    const lat = -Math.PI / 2 + (Math.PI * i) / nLat;
    const rings = i === 0 || i === nLat ? 1 : nLon;
    for (let j = 0; j < rings; j += 1) {
      const lon = (2 * Math.PI * j) / rings;
      const c = Math.cos(lat);
      points.push(
        vec(radiusMm * c * Math.sin(lon), radiusMm * Math.sin(lat), radiusMm * c * Math.cos(lon))
      );
    }
  }
  return points;
}

function sampleRetina(radiusMm, nLat, nLon) {
  const points = [];
  for (let i = 0; i <= nLat; i += 1) {
    const lat = -Math.PI / 2 + (Math.PI * i) / nLat;
    const c = Math.cos(lat);
    const rings = i === 0 || i === nLat ? 1 : nLon;
    for (let j = 0; j < rings; j += 1) {
      const az = (2 * Math.PI * j) / rings;
      points.push(
        vec(radiusMm * c * Math.sin(az), radiusMm * c * Math.cos(az), -radiusMm * Math.sin(lat))
      );
    }
  }
  return points;
}

function meniscusCircle(radiusMm, zenith, meniscusMm, n = 64) {
  const r = Math.sqrt(Math.max(radiusMm * radiusMm - meniscusMm * meniscusMm, 0));
  const center = scale(zenith, meniscusMm);
  const ref = Math.abs(zenith.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0);
  const u = normalize(cross(zenith, ref));
  const v = normalize(cross(zenith, u));
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const t = (2 * Math.PI * i) / n;
    pts.push(add(center, add(scale(u, r * Math.cos(t)), scale(v, r * Math.sin(t)))));
  }
  return { center, radius: r, points: pts };
}

function maculaRing(radiusMm, n = 64) {
  const ang = MACULA_RADIUS_MM / radiusMm;
  const z = -radiusMm * Math.cos(ang);
  const r = radiusMm * Math.sin(ang);
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const t = (2 * Math.PI * i) / n;
    pts.push(vec(r * Math.sin(t), r * Math.cos(t), z));
  }
  return pts;
}

function nasalHat(eye) {
  return eye === "OS" ? vec(-1, 0, 0) : vec(1, 0, 0);
}

function pointFromFovea(radiusMm, eye, azFromNasal, geodesicMm) {
  const foveaHat = vec(0, 0, -1);
  const dir = normalize(add(
    scale(nasalHat(eye), Math.cos(azFromNasal)),
    scale(vec(0, 1, 0), Math.sin(azFromNasal))
  ));
  const ang = geodesicMm / radiusMm;
  return scale(normalize(add(scale(foveaHat, Math.cos(ang)), scale(dir, Math.sin(ang)))), radiusMm);
}

function ringAround(center, radiusMm, ringMm, n = 28) {
  const nHat = normalize(center);
  const ref = Math.abs(nHat.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0);
  const u = normalize(cross(nHat, ref));
  const v = normalize(cross(nHat, u));
  const ang = ringMm / radiusMm;
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const t = (2 * Math.PI * i) / n;
    const dir = add(scale(u, Math.cos(t)), scale(v, Math.sin(t)));
    pts.push(scale(normalize(add(scale(nHat, Math.cos(ang)), scale(dir, Math.sin(ang)))), radiusMm));
  }
  return pts;
}

function arcadeCurve(radiusMm, eye, sign, n = 32) {
  const azEnd = sign * 2.15;
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const az = azEnd * (i / n);
    const w = Math.min(1, Math.abs(az) / (Math.PI / 2));
    const geo = DISC_FOVEA_MM + (ARCADE_FOVEA_MM - DISC_FOVEA_MM) * w;
    pts.push(pointFromFovea(radiusMm, eye, az, geo));
  }
  return pts;
}

function fundusLandmarks(radiusMm, eye) {
  const side = eye === "OS" ? "OS" : "OD";
  const disc = pointFromFovea(radiusMm, side, 0, DISC_FOVEA_MM);
  return {
    eye: side,
    disc,
    discRing: ringAround(disc, radiusMm, DISC_RADIUS_MM),
    superiorArcade: arcadeCurve(radiusMm, side, 1),
    inferiorArcade: arcadeCurve(radiusMm, side, -1),
  };
}

function pointFromAnterior(radiusMm, dirHat, geodesicMm) {
  const dir = normalize(vec(dirHat.x, dirHat.y, 0)) || vec(1, 0, 0);
  const ang = clamp(geodesicMm / radiusMm, 1e-4, Math.PI - 1e-4);
  return scale(
    add(vec(0, 0, Math.cos(ang)), scale(dir, Math.sin(ang))),
    radiusMm
  );
}

function circleThroughPointsTiltedWithNerve(radiusMm, nasalPt, temporalPt, n = 96) {
  const chord = sub(temporalPt, nasalPt);
  const nHat = normalize(cross(chord, vec(0, 1, 0)));
  if (!nHat) return [];
  const p = dot(nHat, nasalPt);
  const center = scale(nHat, p);
  const r = Math.sqrt(Math.max(radiusMm * radiusMm - p * p, 0));
  const u = normalize(cross(nHat, vec(0, 1, 0))) || vec(1, 0, 0);
  const v = normalize(cross(nHat, u));
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const t = (2 * Math.PI * i) / n;
    pts.push(add(center, add(scale(u, r * Math.cos(t)), scale(v, r * Math.sin(t)))));
  }
  return pts;
}

function extraLandmarks(radiusMm, eye, axialMm) {
  if (!SHOW_ORA_AND_VORTEX) return null;
  const side = eye === "OS" ? "OS" : "OD";
  const al = clamp(Number(axialMm) || 24, 16, 38);
  const dAl = al - 24;
  const nasal = nasalHat(side);
  const temporal = scale(nasal, -1);
  const nasalMm = ORA_NASAL_MM_AT_24 + ORA_MM_PER_AL * dAl;
  const temporalMm = ORA_TEMPORAL_MM_AT_24 + ORA_MM_PER_AL * dAl;
  const vortexMm = VORTEX_MM_AT_24 + clamp(VORTEX_MM_PER_AL * dAl, -VORTEX_DISPLACE_CAP_MM, VORTEX_DISPLACE_CAP_MM);
  const nasalPt = pointFromAnterior(radiusMm, nasal, nasalMm);
  const temporalPt = pointFromAnterior(radiusMm, temporal, temporalMm);
  const superior = vec(0, 1, 0);
  const inferior = vec(0, -1, 0);
  const quad = (a, b) => normalize(add(a, b));
  const vortex = [
    { id: "ST", name: "ST vortex", p: pointFromAnterior(radiusMm, quad(superior, temporal), vortexMm) },
    { id: "SN", name: "SN vortex", p: pointFromAnterior(radiusMm, quad(superior, nasal), vortexMm) },
    { id: "IT", name: "IT vortex", p: pointFromAnterior(radiusMm, quad(inferior, temporal), vortexMm) },
    { id: "IN", name: "IN vortex", p: pointFromAnterior(radiusMm, quad(inferior, nasal), vortexMm) },
  ].map((v) => ({ ...v, ring: ringAround(v.p, radiusMm, 1.15) }));
  return {
    axialMm: al,
    nasalMm,
    temporalMm,
    vortexMm,
    nasalPt,
    temporalPt,
    ora: circleThroughPointsTiltedWithNerve(radiusMm, nasalPt, temporalPt),
    vortex,
  };
}

function polarFromZenith(point, zenith, radiusMm) {
  return Math.acos(clamp(dot(point, zenith) / radiusMm, -1, 1));
}

function simulate(params) {
  const fluid = tamponadeProps(params.tamponade, params.cavityFluid);
  const cavityMl = clamp(params.cavityMl, 0.5, 16);
  const fill = clamp(params.fillPct / 100, 0, 1);
  const radiusMm = radiusMmFromVolumeMl(cavityMl);
  const kFlat = capHeightFraction(fill);
  const yl = solveYoungLaplace(radiusMm, fill, fluid);
  const betaContact = yl.beta;
  const zenith = zenithVector(params.faceDownDeg, params.tiltLRDeg);
  const brk = breakPosition(radiusMm, params.clockHour, params.equatorMm);
  const breakBeta = polarFromZenith(brk, zenith, radiusMm);
  const tamponaded = fill > 0 && breakBeta <= betaContact + 1e-4;
  const fovea = vec(0, 0, -radiusMm);
  const zenithPoint = scale(zenith, radiusMm);
  const breakLoc = clockAndLatitude(brk, radiusMm);
  const zenithLoc = clockAndLatitude(zenithPoint, radiusMm);
  const laplaceMmHg = fluid.laplaceMmHgPerKappa * yl.kappa0;
  const inGas = (p) => {
    const onSphere = scale(normalize(p) || p, radiusMm);
    return polarFromZenith(onSphere, zenith, radiusMm) <= betaContact + 1e-4;
  };
  const pressureAt = (p) => {
    const onSphere = scale(normalize(p), radiusMm);
    if (!inGas(onSphere)) return 0;
    const z = dot(onSphere, zenith);
    return Math.max(0, laplaceMmHg + fluid.mmHgPerMmHeight * (z - yl.zA));
  };

  const retina = sampleRetina(radiusMm, 28, 48);
  const field = retina.map((p) => ({
    p,
    pressure: pressureAt(p),
    macular: inMacula(p, radiusMm),
    posterior: p.z <= 0.15 * radiusMm,
  }));

  const maculaPts = field.filter((s) => s.macular);
  const meanMacula = maculaPts.length
    ? maculaPts.reduce((sum, s) => sum + s.pressure, 0) / maculaPts.length
    : 0;
  const pFovea = pressureAt(fovea);
  const pBreak = tamponaded ? pressureAt(brk) : 0;
  const pZenith = pressureAt(zenithPoint);

  const foveaHat = vec(0, 0, -1);
  const aligned = Math.abs(dot(foveaHat, zenith));
  const toward = aligned > 0.995
    ? vec(0, 1, 0)
    : normalize(sub(zenith, scale(foveaHat, dot(zenith, foveaHat))));
  const zenithS = radiusMm * Math.acos(clamp(dot(foveaHat, zenith), -1, 1));
  const profile = [];
  for (let i = -40; i <= 40; i += 1) {
    const s = (i / 40) * radiusMm * (Math.PI / 2);
    const ang = s / radiusMm;
    const p = scale(
      normalize(add(scale(foveaHat, Math.cos(ang)), scale(toward, Math.sin(ang)))),
      radiusMm
    );
    profile.push({
      s,
      pressure: pressureAt(p),
      fovea: Math.abs(s) < 0.35,
      zenith: Math.abs(s - zenithS) < 0.45,
    });
  }

  const contactCircle = [];
  const ref = Math.abs(zenith.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0);
  const u = normalize(cross(zenith, ref));
  const v = normalize(cross(zenith, u));
  for (let i = 0; i < 64; i += 1) {
    const t = (2 * Math.PI * i) / 64;
    contactCircle.push(add(scale(zenith, yl.z), add(scale(u, yl.r * Math.cos(t)), scale(v, yl.r * Math.sin(t)))));
  }

  const marginMm = (betaContact - breakBeta) * radiusMm;

  return {
    params: { ...params, cavityMl, fillPct: fill * 100 },
    radiusMm,
    fill,
    k: kFlat,
    capHeightMm: radiusMm - yl.zA,
    meniscusMm: yl.zA,
    zenith,
    break: brk,
    fovea,
    zenithPoint,
    tamponaded,
    heightAboveMeniscus: marginMm,
    breakLoc,
    zenithLoc,
    inGas,
    pressureAt,
    meniscus: {
      points: contactCircle,
      rings: meridianToWorld(yl.path, zenith),
      meridian: yl.path,
      zApex: yl.zA,
      kappa0: yl.kappa0,
      betaContact,
      thetaDeg: (yl.theta * 180) / Math.PI,
      measuredThetaDeg: ((yl.measuredTheta ?? yl.theta) * 180) / Math.PI,
      bond: yl.bond || 0,
      flatten: yl.flatten || 0,
      fallback: Boolean(yl.fallback),
    },
    eye: (params.eye === "OS" ? "OS" : "OD"),
    fundus: fundusLandmarks(radiusMm, params.eye === "OS" ? "OS" : "OD"),
    extraLandmarks: extraLandmarks(radiusMm, params.eye, params.axialMm),
    maculaRing: maculaRing(radiusMm),
    field,
    profile,
    pressure: {
      fovea: pFovea,
      maculaMean: meanMacula,
      break: pBreak,
      zenith: pZenith,
      max: Math.max(pZenith, laplaceMmHg),
      laplace: laplaceMmHg,
    },
    contactArcDeg: (2 * betaContact * 180) / Math.PI,
    maculaRadiusMm: MACULA_RADIUS_MM,
    mmHgPerMm: fluid.mmHgPerMmHeight,
    tamponade: fluid,
    youngLaplace: {
      sigmaMN_M: fluid.sigmaNM * 1000,
      thetaAqueousDeg: fluid.thetaDeg,
      measuredThetaDeg: ((yl.measuredTheta ?? yl.theta) * 180) / Math.PI,
      capillaryMm: fluid.capillaryMm,
      bond: yl.bond || 0,
      flatten: yl.flatten || 0,
      kappa0: yl.kappa0,
      zApex: yl.zA,
      betaContactDeg: (betaContact * 180) / Math.PI,
      flatBetaDeg: (Math.acos(clamp((1 - kFlat), -1, 1)) * 180) / Math.PI,
      deltaRho: fluid.deltaRho,
    },
  };
}

window.BubbleModel = {
  MACULA_RADIUS_MM,
  SHOW_ORA_AND_VORTEX,
  DISC_FOVEA_MM,
  ARCADE_FOVEA_MM,
  DISC_RADIUS_MM,
  MMHG_PER_MM_HEIGHT,
  clamp,
  vec,
  add,
  sub,
  scale,
  dot,
  cross,
  len,
  normalize,
  radiusMmFromVolumeMl,
  capHeightFraction,
  breakPosition,
  clockAndLatitude,
  zenithVector,
  geodesicMm,
  inMacula,
  hydrostaticMmHg,
  sampleRetina,
  solveYoungLaplace,
  simulate,
  TAMPONADES,
  GAS_MODEL,
  CAVITY_FLUIDS,
  tamponadeProps,
  vitreousVolumeFromAxialLength,
  SIGMA_N_M,
  THETA_AQUEOUS_RAD,
  CAPILLARY_MM,
};
