const MACULA_RADIUS_MM = 2.75;
const DISC_FOVEA_MM = 4.5;
const ARCADE_FOVEA_MM = 4.0;
const DISC_RADIUS_MM = 0.75;

/**
 * Optional ora serrata, vitreous base, and ciliary ring.
 */
const SHOW_ORA = true;
const ORA_NASAL_MM_AT_24 = 17.5;
const ORA_TEMPORAL_MM_AT_24 = 18.75;
const ORA_MM_PER_AL = 0.16;
const AL_MIN_MM = 22.3;
const AL_MAX_MM = 28.5;
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
 * 1. Cavity is an Atchison retinal ellipsoid clipped by a Navarro posterior
 *    lens (phakic) or a planar cap (pseudophakic). Occupying volume is the
 *    given mL (no Boyle / IOP).
 * 2. Static, axisymmetric about gravity; bubble sits at the zenith.
 * 3. One gas–aqueous interface: σ κ = ΔP₀ + Δρ g z.
 * 4. Apex is horizontal and is the lowest point of the interface.
 * 5. Young angle through the cavity liquid at the retina (depends on fluid).
 * 6. Gas–liquid σ from the cavity fluid (vitreous ~61, aqueous ~65, BSS ~72 mN/m).
 *    Gases are isoexpansile mixes (air 100%, SF₆ 20%, C₃F₈ 14%).
 *    Mixture density is ρ = f ρ_pure + (1−f) ρ_air; Δρ = 1000 − ρ.
 * 7. One gravity Young–Laplace solve at every fill: σ κ = ΔP₀ + Δρ g z
 *    with Young angle at the retina, and a second solve for lens/IOL θ
 *    where the interface meets the capsule. The meridian is traced to the
 *    real cavity wall (not a sphere then clamped).
 * 8. The YL meridian is shifted so voxel volume inside the clipped cavity
 *    matches the occupying mL.
 * 9. Tamponade if the break is in the cavity and on the gas side of that meniscus.
 * 10. On gas-contact retina, ΔP = σ κ₀ + Δρ g (z − z_apex); else 0.
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
    thetaLensDeg: raw.kind === "oil" ? 30 : THETA_LENS_PHAKIC_DEG,
    thetaLensRad: ((raw.kind === "oil" ? 30 : THETA_LENS_PHAKIC_DEG) * Math.PI) / 180,
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

/** Atchison 2006 Model 1 sizes + Model 2 retina tilt/decentration. */
const ATCHISON = {
  al0: 23.58,
  alPerSr: -0.299,
  rx0: 11.455,
  rxPerSr: -0.043,
  ry0: 11.365,
  ryPerSr: -0.090,
  rz0: 10.148,
  rzPerSr: -0.163,
  dV0: 16.28,
  dVPerSr: -0.299,
  tiltYDeg: 11.5,
  tiltXDeg: 3.6,
  decenterNasalMm: 0.5,
  decenterInferiorMm: 0.2,
};

const THETA_LENS_PHAKIC_DEG = 50;
const THETA_LENS_IOL_DEG = 55;

const CB_FROM_CAP_NASAL_MM_AT_24 = 4.3;
const CB_FROM_CAP_TEMPORAL_MM_AT_24 = 5.9;
const CB_MM_PER_AL = 0.7;
const VB_POST_FROM_CB_MM = 2.5;

/** Navarro 1985 posterior lens, vitreous side. Q = −1 → sag = ρ² / (2R). */
const NAVARRO_LENS = {
  radiusMm: 6,
  q: -1,
  apertureRadiusMm: 5,
};

const cavityVolumeCache = new Map();

function spectacleRefractionFromAl(alMm) {
  return (alMm - ATCHISON.al0) / ATCHISON.alPerSr;
}

function rotateByAxes(p, tiltX, tiltY) {
  const cx = Math.cos(tiltX);
  const sx = Math.sin(tiltX);
  const y1 = p.y * cx - p.z * sx;
  const z1 = p.y * sx + p.z * cx;
  const cy = Math.cos(tiltY);
  const sy = Math.sin(tiltY);
  return vec(p.x * cy + z1 * sy, y1, -p.x * sy + z1 * cy);
}

function rotateByAxesInv(p, tiltX, tiltY) {
  const cy = Math.cos(tiltY);
  const sy = Math.sin(tiltY);
  const x1 = p.x * cy - p.z * sy;
  const z1 = p.x * sy + p.z * cy;
  const cx = Math.cos(tiltX);
  const sx = Math.sin(tiltX);
  return vec(x1, p.y * cx + z1 * sx, -p.y * sx + z1 * cx);
}

function localFromWorld(p, cavity) {
  const c = cavity.center || vec(0, 0, 0);
  return rotateByAxesInv(sub(p, c), cavity.tiltX || 0, cavity.tiltY || 0);
}

function worldFromLocal(p, cavity) {
  const c = cavity.center || vec(0, 0, 0);
  return add(rotateByAxes(p, cavity.tiltX || 0, cavity.tiltY || 0), c);
}

function ellipsoidPointFromCenter(cavity, dir) {
  const u = normalize(dir);
  const localDir = rotateByAxesInv(u, cavity.tiltX || 0, cavity.tiltY || 0);
  const q = (localDir.x * localDir.x) / (cavity.Rx * cavity.Rx)
    + (localDir.y * localDir.y) / (cavity.Ry * cavity.Ry)
    + (localDir.z * localDir.z) / (cavity.Rz * cavity.Rz);
  return worldFromLocal(scale(localDir, 1 / Math.sqrt(Math.max(q, 1e-12))), cavity);
}

/** Hit the retinal ellipsoid along a ray from the visual-axis origin (0,0,0). */
function ellipsoidPointFromDirection(cavity, dir) {
  const u = normalize(dir);
  const center = cavity.center || vec(0, 0, 0);
  const a = rotateByAxesInv(u, cavity.tiltX || 0, cavity.tiltY || 0);
  const b = rotateByAxesInv(center, cavity.tiltX || 0, cavity.tiltY || 0);
  const invRx2 = 1 / (cavity.Rx * cavity.Rx);
  const invRy2 = 1 / (cavity.Ry * cavity.Ry);
  const invRz2 = 1 / (cavity.Rz * cavity.Rz);
  const A = a.x * a.x * invRx2 + a.y * a.y * invRy2 + a.z * a.z * invRz2;
  const B = -2 * (a.x * b.x * invRx2 + a.y * b.y * invRy2 + a.z * b.z * invRz2);
  const C = b.x * b.x * invRx2 + b.y * b.y * invRy2 + b.z * b.z * invRz2 - 1;
  const disc = B * B - 4 * A * C;
  if (!(A > 1e-18) || disc < 0) return ellipsoidPointFromCenter(cavity, u);
  const s = Math.sqrt(disc);
  const t1 = (-B - s) / (2 * A);
  const t2 = (-B + s) / (2 * A);
  const t = t1 > 1e-8 && t2 > 1e-8 ? Math.min(t1, t2) : Math.max(t1, t2);
  if (!(t > 1e-8)) return ellipsoidPointFromCenter(cavity, u);
  return scale(u, t);
}

function inEllipsoid(p, cavity) {
  const l = localFromWorld(p, cavity);
  return (l.x * l.x) / (cavity.Rx * cavity.Rx)
    + (l.y * l.y) / (cavity.Ry * cavity.Ry)
    + (l.z * l.z) / (cavity.Rz * cavity.Rz) <= 1.0008;
}

function visualAxisHit(cavity, sign) {
  return ellipsoidPointFromDirection(cavity, vec(0, 0, sign));
}

function lensSagMaxMm(cavity) {
  const rho = NAVARRO_LENS.apertureRadiusMm;
  const r = (cavity && cavity.lensR) || NAVARRO_LENS.radiusMm;
  return (rho * rho) / (2 * r);
}

function lensOpeningZ(cavity) {
  return cavity.zOpen != null ? cavity.zOpen : cavity.zLens + lensSagMaxMm(cavity);
}

function lensZ(cavity, x, y) {
  const zOpen = lensOpeningZ(cavity);
  if (cavity.lens === "pseudo") return zOpen;
  const cap = cavity.lensRhoMax || NAVARRO_LENS.apertureRadiusMm;
  const rho2 = Math.min(x * x + y * y, cap * cap);
  // Opening / IOL plane is the lens equator (~2 mm anterior of Atchison vertex).
  // Phakic pole stays at zLens, so the capsule dents into the vitreous.
  return cavity.zLens + rho2 / (2 * cavity.lensR);
}

function posteriorToLens(p, cavity) {
  return p.z <= lensZ(cavity, p.x, p.y) + 0.02;
}

function inCavity(p, cavity) {
  return inEllipsoid(p, cavity) && posteriorToLens(p, cavity);
}

function integrateCavityVolumeMl(cavity) {
  const key = `${cavity.Rx.toFixed(3)}:${cavity.Ry.toFixed(3)}:${cavity.Rz.toFixed(3)}:${cavity.zLens.toFixed(3)}:${cavity.lens}:${(cavity.tiltX || 0).toFixed(3)}:${(cavity.tiltY || 0).toFixed(3)}:${(cavity.center && cavity.center.x) || 0}:${(cavity.center && cavity.center.y) || 0}`;
  if (cavityVolumeCache.has(key)) return cavityVolumeCache.get(key);
  const nx = 36;
  const ny = 36;
  const nz = 48;
  const pad = 1.6;
  const cx = (cavity.center && cavity.center.x) || 0;
  const cy = (cavity.center && cavity.center.y) || 0;
  const x0 = -cavity.Rx - pad + cx;
  const y0 = -cavity.Ry - pad + cy;
  const z0 = -cavity.Rz - pad;
  const dx = (2 * cavity.Rx + 2 * pad) / nx;
  const dy = (2 * cavity.Ry + 2 * pad) / ny;
  const dz = (2 * cavity.Rz + 2 * pad) / nz;
  let acc = 0;
  for (let ix = 0; ix < nx; ix += 1) {
    const x = x0 + (ix + 0.5) * dx;
    for (let iy = 0; iy < ny; iy += 1) {
      const y = y0 + (iy + 0.5) * dy;
      for (let iz = 0; iz < nz; iz += 1) {
        const z = z0 + (iz + 0.5) * dz;
        if (inCavity(vec(x, y, z), cavity)) acc += dx * dy * dz;
      }
    }
  }
  const ml = acc / 1000;
  cavityVolumeCache.set(key, ml);
  return ml;
}

function ellipsoidSlice(cavity, z, n) {
  const pts = [];
  const rMax = Math.max(cavity.Rx, cavity.Ry) + 3;
  for (let i = 0; i < n; i += 1) {
    const t = (2 * Math.PI * i) / n;
    const hx = Math.sin(t);
    const hy = Math.cos(t);
    let lo = 0;
    let hi = rMax;
    for (let k = 0; k < 18; k += 1) {
      const mid = 0.5 * (lo + hi);
      if (inEllipsoid(vec(hx * mid, hy * mid, z), cavity)) lo = mid;
      else hi = mid;
    }
    pts.push(vec(hx * lo, hy * lo, z));
  }
  return pts;
}

function lensClipRing(cavity, n = 64) {
  const ring = ellipsoidSlice(cavity, lensOpeningZ(cavity), n);
  return ring.concat([ring[0]]);
}

function lensSurfaceRings(cavity, nRho = 12, nPhi = 36) {
  const zRim = lensOpeningZ(cavity);
  const outer = ellipsoidSlice(cavity, zRim, nPhi);
  const rings = [];
  if (cavity.lens === "pseudo") {
    for (let i = 0; i <= nRho; i += 1) {
      const s = i / nRho;
      rings.push(outer.map((p) => vec(p.x * s, p.y * s, zRim)));
    }
    return rings;
  }
  const rho = cavity.lensRhoMax || NAVARRO_LENS.apertureRadiusMm;
  const nInner = Math.max(6, Math.round(nRho * 0.7));
  for (let i = 0; i <= nInner; i += 1) {
    const s = i / nInner;
    const ring = [];
    for (let j = 0; j < nPhi; j += 1) {
      const t = (2 * Math.PI * j) / nPhi;
      const x = rho * s * Math.sin(t);
      const y = rho * s * Math.cos(t);
      ring.push(vec(x, y, lensZ(cavity, x, y)));
    }
    rings.push(ring);
  }
  const inner = rings[rings.length - 1];
  const nOuter = Math.max(3, nRho - nInner);
  for (let i = 1; i <= nOuter; i += 1) {
    const s = i / nOuter;
    rings.push(inner.map((p, j) => vec(
      p.x + (outer[j].x - p.x) * s,
      p.y + (outer[j].y - p.y) * s,
      zRim
    )));
  }
  return rings;
}

function buildCavity(axialMm, lensType, eye) {
  const al = clamp(axialMm, AL_MIN_MM, AL_MAX_MM);
  const sr = spectacleRefractionFromAl(al);
  const Rx = Math.max(ATCHISON.rx0 + ATCHISON.rxPerSr * sr, 8);
  const Ry = Math.max(ATCHISON.ry0 + ATCHISON.ryPerSr * sr, 8);
  const Rz = Math.max(ATCHISON.rz0 + ATCHISON.rzPerSr * sr, 8);
  const dV = ATCHISON.dV0 + ATCHISON.dVPerSr * sr;
  const zLens = -Rz + dV;
  const zOpen = zLens + (NAVARRO_LENS.apertureRadiusMm ** 2) / (2 * NAVARRO_LENS.radiusMm);
  const lens = lensType === "pseudo" ? "pseudo" : "phakic";
  const side = eye === "OS" ? "OS" : "OD";
  const nasal = side === "OS" ? -1 : 1;
  const cavity = {
    al,
    sr,
    eye: side,
    Rx,
    Ry,
    Rz,
    dV,
    zLens,
    zOpen,
    center: vec(ATCHISON.decenterNasalMm * nasal, -ATCHISON.decenterInferiorMm, 0),
    // IOVS 2005: +θy puts the vertex nasal of the center; +θx puts it above the center.
    tiltX: (ATCHISON.tiltXDeg * Math.PI) / 180,
    tiltY: (-nasal * ATCHISON.tiltYDeg * Math.PI) / 180,
    lens,
    lensR: NAVARRO_LENS.radiusMm,
    lensRhoMax: lens === "phakic" ? NAVARRO_LENS.apertureRadiusMm : null,
    Rmean: (Rx + Ry + Rz) / 3,
    fovea: vec(0, 0, -Rz),
    anterior: vec(0, 0, Rz),
  };
  cavity.fovea = visualAxisHit(cavity, -1);
  cavity.anterior = visualAxisHit(cavity, 1);
  cavity.clipRing = lensClipRing(cavity);
  cavity.lensRings = lensSurfaceRings(cavity);
  cavity.volumeMl = integrateCavityVolumeMl(cavity);
  return cavity;
}

function axialLengthFromVolume(targetMl, lensType) {
  let lo = AL_MIN_MM;
  let hi = AL_MAX_MM;
  for (let i = 0; i < 16; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (buildCavity(mid, lensType, "OD").volumeMl < targetMl) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
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
 * Distance from the equator is along the retina: positive toward the fovea,
 * negative anterior toward the lens plane.
 */
function breakArcRange(cavity) {
  const R = cavity.Rmean || cavity;
  const posteriorMm = (Math.PI / 2) * R;
  const zOpen = lensOpeningZ(cavity);
  const Rz = cavity.Rz || R;
  const anteriorMm = zOpen != null
    ? Math.asin(clamp(zOpen / Rz, 0, 1)) * R
    : posteriorMm * 0.35;
  return { anteriorMm, posteriorMm };
}

function breakPosition(cavity, clockHour, equatorMm) {
  const R = cavity.Rmean || cavity;
  const { anteriorMm, posteriorMm } = breakArcRange(cavity);
  const lat = clamp(equatorMm, -anteriorMm, posteriorMm) / R;
  const az = ((clockHour % 12) / 12) * Math.PI * 2;
  const dir = vec(
    Math.cos(lat) * Math.sin(az),
    Math.cos(lat) * Math.cos(az),
    -Math.sin(lat)
  );
  if (cavity.Rx) return ellipsoidPointFromDirection(cavity, dir);
  return scale(dir, R);
}

function clockAndLatitude(point, cavity) {
  const R = cavity.Rmean || cavity;
  const lat = Math.asin(clamp(-point.z / (cavity.Rz || R), -1, 1));
  let az = Math.atan2(point.x, point.y);
  if (az < 0) az += Math.PI * 2;
  const hour = (az / (Math.PI * 2)) * 12;
  return {
    clockHour: hour === 0 ? 12 : hour,
    equatorMm: lat * R,
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

function geodesicMm(a, b, cavity) {
  const na = normalize(a);
  const nb = normalize(b);
  const R = (cavity && cavity.Rmean) || cavity || 1;
  return R * Math.acos(clamp(dot(na, nb), -1, 1));
}

function inMacula(point, cavity) {
  const fovea = cavity.fovea || vec(0, 0, -(cavity.Rz || cavity));
  return geodesicMm(point, fovea, cavity) <= MACULA_RADIUS_MM;
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

function solveYoungLaplace(radiusMm, fill, fluid, volumeMm3) {
  const props = fluid || tamponadeProps("sf6");
  const volumeTarget = volumeMm3 != null
    ? volumeMm3
    : fill * (4 / 3) * Math.PI * radiusMm ** 3;
  const key = `${props.id}:${props.sigmaNM}:${props.thetaDeg}:${radiusMm.toFixed(3)}:${volumeTarget.toFixed(1)}`;
  if (ylCache.has(key)) return ylCache.get(key);
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

function sampleRetina(cavity, nLat, nLon) {
  const points = [];
  for (let i = 0; i <= nLat; i += 1) {
    const lat = -Math.PI / 2 + (Math.PI * i) / nLat;
    const c = Math.cos(lat);
    const rings = i === 0 || i === nLat ? 1 : nLon;
    for (let j = 0; j < rings; j += 1) {
      const az = (2 * Math.PI * j) / rings;
      const dir = vec(c * Math.sin(az), c * Math.cos(az), -Math.sin(lat));
      const p = ellipsoidPointFromDirection(cavity, dir);
      if (posteriorToLens(p, cavity)) points.push(p);
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

function maculaRing(cavity, n = 64) {
  const ang = MACULA_RADIUS_MM / cavity.Rmean;
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const t = (2 * Math.PI * i) / n;
    const dir = vec(Math.sin(ang) * Math.sin(t), Math.sin(ang) * Math.cos(t), -Math.cos(ang));
    pts.push(ellipsoidPointFromDirection(cavity, dir));
  }
  return pts;
}

function nasalHat(eye) {
  return eye === "OS" ? vec(-1, 0, 0) : vec(1, 0, 0);
}

function pointFromFovea(cavity, eye, azFromNasal, geodesicMm) {
  const foveaHat = vec(0, 0, -1);
  const dir = normalize(add(
    scale(nasalHat(eye), Math.cos(azFromNasal)),
    scale(vec(0, 1, 0), Math.sin(azFromNasal))
  ));
  const ang = geodesicMm / cavity.Rmean;
  return ellipsoidPointFromDirection(
    cavity,
    add(scale(foveaHat, Math.cos(ang)), scale(dir, Math.sin(ang)))
  );
}

function ringAround(center, cavity, ringMm, n = 28) {
  const nHat = normalize(center);
  const ref = Math.abs(nHat.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0);
  const u = normalize(cross(nHat, ref));
  const v = normalize(cross(nHat, u));
  const ang = ringMm / cavity.Rmean;
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const t = (2 * Math.PI * i) / n;
    const dir = add(scale(u, Math.cos(t)), scale(v, Math.sin(t)));
    pts.push(ellipsoidPointFromDirection(
      cavity,
      add(scale(nHat, Math.cos(ang)), scale(dir, Math.sin(ang)))
    ));
  }
  return pts;
}

function arcadeCurve(cavity, eye, sign, n = 32) {
  const azEnd = sign * 2.15;
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const az = azEnd * (i / n);
    const w = Math.min(1, Math.abs(az) / (Math.PI / 2));
    const geo = DISC_FOVEA_MM + (ARCADE_FOVEA_MM - DISC_FOVEA_MM) * w;
    pts.push(pointFromFovea(cavity, eye, az, geo));
  }
  return pts;
}

function fundusLandmarks(cavity, eye) {
  const side = eye === "OS" ? "OS" : "OD";
  const disc = pointFromFovea(cavity, side, 0, DISC_FOVEA_MM);
  return {
    eye: side,
    disc,
    discRing: ringAround(disc, cavity, DISC_RADIUS_MM),
    superiorArcade: arcadeCurve(cavity, side, 1),
    inferiorArcade: arcadeCurve(cavity, side, -1),
  };
}

function pointAlongSurface(cavity, origin, toward, geodesicMm) {
  const nHat = normalize(origin);
  let dir = sub(toward, scale(nHat, dot(toward, nHat)));
  if (len(dir) < 1e-8) dir = vec(0, 1, 0);
  dir = normalize(dir);
  const ang = geodesicMm / cavity.Rmean;
  return ellipsoidPointFromDirection(
    cavity,
    add(scale(nHat, Math.cos(ang)), scale(dir, Math.sin(ang)))
  );
}

function pointFromAnterior(cavity, dirHat, geodesicMm) {
  const dir = normalize(vec(dirHat.x, dirHat.y, 0)) || vec(1, 0, 0);
  const ang = clamp(geodesicMm / cavity.Rmean, 1e-4, Math.PI - 1e-4);
  return ellipsoidPointFromDirection(
    cavity,
    add(vec(0, 0, Math.cos(ang)), scale(dir, Math.sin(ang)))
  );
}

function oraOnCavity(cavity, nasal, temporal, nasalMm, temporalMm, n = 96) {
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const t = (2 * Math.PI * i) / n;
    const w = (1 + Math.cos(t)) / 2;
    const d = nasalMm * w + temporalMm * (1 - w);
    const dir = normalize(add(scale(nasal, Math.cos(t)), scale(vec(0, 1, 0), Math.sin(t))));
    pts.push(pointFromAnterior(cavity, dir, d));
  }
  return pts;
}

function clockDir(clockHour) {
  const az = ((clockHour % 12) / 12) * Math.PI * 2;
  return vec(Math.sin(az), Math.cos(az), 0);
}

function oraDistancesMm(cavity) {
  const dAl = (cavity.al || 24) - 24;
  return {
    nasalMm: ORA_NASAL_MM_AT_24 + ORA_MM_PER_AL * dAl,
    temporalMm: ORA_TEMPORAL_MM_AT_24 + ORA_MM_PER_AL * dAl,
  };
}

function interpolateNasalTemporal(cavity, eye, clockHour, nasalMm, temporalMm) {
  const nasalness = (1 + dot(normalize(clockDir(clockHour)), nasalHat(eye))) / 2;
  return nasalMm * nasalness + temporalMm * (1 - nasalness);
}

function pointAtClockFromAnterior(cavity, eye, clockHour, nasalMm, temporalMm) {
  const d = interpolateNasalTemporal(cavity, eye, clockHour, nasalMm, temporalMm);
  return pointFromAnterior(cavity, clockDir(clockHour), d);
}

function equatorMmFromAnteriorGeodesic(cavity, geodesicMm) {
  return geodesicMm - (cavity.Rmean || 11) * (Math.PI / 2);
}

function capPointNasalTemporal(cavity, eye) {
  const nasal = nasalHat(eye);
  const ring = cavity.clipRing && cavity.clipRing.length
    ? cavity.clipRing
    : ellipsoidSlice(cavity, lensOpeningZ(cavity), 64);
  let nasalCap = ring[0];
  let temporalCap = ring[0];
  let nasalDot = -1e9;
  let temporalDot = -1e9;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const dn = dot(p, nasal);
    if (dn > nasalDot) {
      nasalDot = dn;
      nasalCap = p;
    }
    if (-dn > temporalDot) {
      temporalDot = -dn;
      temporalCap = p;
    }
  }
  return { nasalCap, temporalCap };
}

function ciliaryDistancesMm(cavity, eye) {
  const dAl = (cavity.al || 24) - 24;
  const fromCapN = Math.max(0.5, CB_FROM_CAP_NASAL_MM_AT_24 + CB_MM_PER_AL * dAl);
  const fromCapT = Math.max(0.5, CB_FROM_CAP_TEMPORAL_MM_AT_24 + CB_MM_PER_AL * dAl);
  const { nasalCap, temporalCap } = capPointNasalTemporal(cavity, eye);
  const ant = cavity.anterior || vec(0, 0, cavity.Rz);
  return {
    nasalMm: geodesicMm(ant, nasalCap, cavity) + fromCapN,
    temporalMm: geodesicMm(ant, temporalCap, cavity) + fromCapT,
    fromCapN,
    fromCapT,
  };
}

function oraPointAtClock(cavity, eye, clockHour) {
  const { nasalMm, temporalMm } = oraDistancesMm(cavity);
  return pointAtClockFromAnterior(cavity, eye, clockHour, nasalMm, temporalMm);
}

function vitreousBasePostPointAtClock(cavity, eye, clockHour) {
  const cb = ciliaryDistancesMm(cavity, eye);
  return pointAtClockFromAnterior(
    cavity,
    eye,
    clockHour,
    cb.nasalMm + VB_POST_FROM_CB_MM,
    cb.temporalMm + VB_POST_FROM_CB_MM
  );
}

function vitreousBasePostEquatorMm(cavity, eye, clockHour) {
  const cb = ciliaryDistancesMm(cavity, eye);
  const d = interpolateNasalTemporal(
    cavity,
    eye,
    clockHour,
    cb.nasalMm + VB_POST_FROM_CB_MM,
    cb.temporalMm + VB_POST_FROM_CB_MM
  );
  return equatorMmFromAnteriorGeodesic(cavity, d);
}

function extraLandmarks(cavity, eye) {
  if (!SHOW_ORA) return null;
  const side = eye === "OS" ? "OS" : "OD";
  const nasal = nasalHat(side);
  const temporal = scale(nasal, -1);
  const { nasalMm, temporalMm } = oraDistancesMm(cavity);
  const cb = ciliaryDistancesMm(cavity, side);
  const nasalPt = pointFromAnterior(cavity, nasal, nasalMm);
  const temporalPt = pointFromAnterior(cavity, temporal, temporalMm);
  return {
    axialMm: cavity.al,
    nasalMm,
    temporalMm,
    cbNasalMm: cb.nasalMm,
    cbTemporalMm: cb.temporalMm,
    cbFromCapN: cb.fromCapN,
    cbFromCapT: cb.fromCapT,
    nasalPt,
    temporalPt,
    ora: oraOnCavity(cavity, nasal, temporal, nasalMm, temporalMm),
    vitreousBasePost: oraOnCavity(
      cavity,
      nasal,
      temporal,
      cb.nasalMm + VB_POST_FROM_CB_MM,
      cb.temporalMm + VB_POST_FROM_CB_MM
    ),
    ciliary: oraOnCavity(cavity, nasal, temporal, cb.nasalMm, cb.temporalMm),
  };
}

function meniscusZAtR(yl, r) {
  const path = yl.path || [];
  if (!path.length) return yl.zA;
  if (r >= yl.r) return yl.z;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const r0 = a.r;
    const r1 = b.r;
    const lo = Math.min(r0, r1);
    const hi = Math.max(r0, r1);
    if (r < lo || r > hi) continue;
    if (Math.abs(r1 - r0) < 1e-9) return b.z;
    const t = (r - r0) / (r1 - r0);
    return a.z + t * (b.z - a.z);
  }
  return r < 0.5 * yl.r ? yl.zA : yl.z;
}

function meniscusZFn(yl) {
  const rMax = Math.max(yl.r || 0, 1e-3);
  const n = 64;
  const zAt = new Array(n + 1);
  for (let i = 0; i <= n; i += 1) zAt[i] = meniscusZAtR(yl, (i / n) * rMax);
  return (r) => {
    if (r >= rMax) return yl.z;
    const t = (r / rMax) * n;
    const i = Math.min(Math.floor(t), n - 1);
    const f = t - i;
    return zAt[i] * (1 - f) + zAt[i + 1] * f;
  };
}

function clampToCavity(p, cavity) {
  if (inCavity(p, cavity)) return p;
  // Keep the same direction from the origin. Snapping |z| ≥ Rz to the
  // posterior pole made the meniscus look like it was dragging on the fovea.
  let q = inEllipsoid(p, cavity) ? p : ellipsoidPointFromDirection(cavity, p);
  const zCap = lensZ(cavity, q.x, q.y);
  if (q.z > zCap) q = vec(q.x, q.y, zCap);
  if (!inEllipsoid(q, cavity)) q = ellipsoidPointFromDirection(cavity, q);
  return q;
}

function cavitySamples(cavity, nx = 24, ny = 24, nz = 32) {
  if (cavity._samples) return cavity._samples;
  const pts = [];
  const pad = 1.6;
  const cx = (cavity.center && cavity.center.x) || 0;
  const cy = (cavity.center && cavity.center.y) || 0;
  const dx = (2 * cavity.Rx + 2 * pad) / nx;
  const dy = (2 * cavity.Ry + 2 * pad) / ny;
  const dz = (2 * cavity.Rz + 2 * pad) / nz;
  const x0 = -cavity.Rx - pad + cx;
  const y0 = -cavity.Ry - pad + cy;
  const z0 = -cavity.Rz - pad;
  for (let ix = 0; ix < nx; ix += 1) {
    const x = x0 + (ix + 0.5) * dx;
    for (let iy = 0; iy < ny; iy += 1) {
      const y = y0 + (iy + 0.5) * dy;
      for (let iz = 0; iz < nz; iz += 1) {
        const z = z0 + (iz + 0.5) * dz;
        const p = vec(x, y, z);
        if (inCavity(p, cavity)) pts.push(p);
      }
    }
  }
  cavity._samples = { pts, voxelMl: (dx * dy * dz) / 1000 };
  return cavity._samples;
}

function shiftMeniscusToVolume(cavity, zenith, yl, targetMl, samples) {
  const R = Math.max(cavity.Rx, cavity.Ry, cavity.Rz);
  const zOfR = meniscusZFn(yl);
  const coords = samples.pts.map((p) => {
    const z = dot(p, zenith);
    return { z, r: len(sub(p, scale(zenith, z))) };
  });
  const volumeAt = (zShift) => {
    let n = 0;
    for (let i = 0; i < coords.length; i += 1) {
      if (coords[i].z >= zOfR(coords[i].r) + zShift) n += 1;
    }
    return n * samples.voxelMl;
  };
  const target = clamp(targetMl, 0, cavity.volumeMl);
  if (target <= 0) return R - (yl.z || 0);
  if (target >= cavity.volumeMl * 0.995) return -R - (yl.zA || 0);
  let lo = -2 * R;
  let hi = 2 * R;
  for (let i = 0; i < 16; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (volumeAt(mid) > target) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

function frameAroundZenith(zenith) {
  const ref = Math.abs(zenith.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0);
  const u0 = normalize(cross(zenith, ref));
  const v0 = normalize(cross(zenith, u0));
  return { u0, v0 };
}

function wallAwareSpoke(path, zShift, cavity, zenith, uHat) {
  const world = path.map((p) => add(scale(zenith, p.z + zShift), scale(uHat, p.r)));
  let hit = world.length;
  for (let i = 0; i < world.length; i += 1) {
    if (!inCavity(world[i], cavity)) {
      hit = i;
      break;
    }
  }
  if (hit >= world.length) {
    return { world: world.map((p) => clampToCavity(p, cavity)), onLens: false };
  }
  if (hit === 0) {
    return { world: [clampToCavity(world[0], cavity)], onLens: true };
  }
  const a = world[hit - 1];
  const b = world[hit];
  let lo = 0;
  let hi = 1;
  for (let n = 0; n < 14; n += 1) {
    const t = 0.5 * (lo + hi);
    const mid = add(a, scale(sub(b, a), t));
    if (inCavity(mid, cavity)) lo = t;
    else hi = t;
  }
  const contact = add(a, scale(sub(b, a), 0.5 * (lo + hi)));
  const onLens = Math.abs(contact.z - lensZ(cavity, contact.x, contact.y)) < 0.25;
  return { world: world.slice(0, hit).concat([contact]), onLens };
}

function ringsFromSpokes(spokes) {
  const nOut = Math.max(1, ...spokes.map((s) => s.length));
  const rings = [];
  for (let i = 0; i < nOut; i += 1) {
    rings.push(spokes.map((s) => s[Math.min(i, s.length - 1)]));
  }
  return rings;
}

function buildWallAwareRings(pathRetina, pathLens, zShift, cavity, zenith, nTheta = 32) {
  const { u0, v0 } = frameAroundZenith(zenith);
  const spokes = [];
  let lensHits = 0;
  for (let j = 0; j < nTheta; j += 1) {
    const t = (2 * Math.PI * j) / nTheta;
    const u = add(scale(u0, Math.cos(t)), scale(v0, Math.sin(t)));
    let spoke = wallAwareSpoke(pathRetina, zShift, cavity, zenith, u);
    if (spoke.onLens && pathLens) {
      spoke = wallAwareSpoke(pathLens, zShift, cavity, zenith, u);
      lensHits += 1;
    }
    spokes.push(spoke.world);
  }
  return { rings: ringsFromSpokes(spokes), lensHits };
}

function simulate(params) {
  const fluid = tamponadeProps(params.tamponade, params.cavityFluid);
  const lens = params.lens === "pseudo" ? "pseudo" : "phakic";
  const eye = params.eye === "OS" ? "OS" : "OD";
  const cavity = params.cavity || buildCavity(params.axialMm || 24, lens, eye);
  const cavityMl = cavity.volumeMl;
  const thetaLensDeg = lens === "pseudo" ? THETA_LENS_IOL_DEG : THETA_LENS_PHAKIC_DEG;
  fluid.thetaLensDeg = fluid.kind === "oil" ? 30 : thetaLensDeg;
  fluid.thetaLensRad = (fluid.thetaLensDeg * Math.PI) / 180;
  const tamponadeMl = clamp(params.tamponadeMl || params.fillPct / 100 * cavityMl, 0, cavityMl);
  const fill = clamp(tamponadeMl / cavityMl, 0, 1);
  const radiusMm = cavity.Rmean;
  const kFlat = capHeightFraction(fill);
  const zenith = zenithVector(params.faceDownDeg, params.tiltLRDeg);
  const samples = cavitySamples(cavity);
  const fluidLens = { ...fluid, thetaAqueousRad: fluid.thetaLensRad, thetaDeg: fluid.thetaLensDeg };
  const yl = solveYoungLaplace(radiusMm, fill, fluid, tamponadeMl * 1000);
  const ylLens = solveYoungLaplace(radiusMm, fill, fluidLens, tamponadeMl * 1000);
  const zOfR = meniscusZFn(yl);
  const zShift = yl.full ? 0 : shiftMeniscusToVolume(cavity, zenith, yl, tamponadeMl, samples);
  const path = (yl.path || []).map((p) => ({ ...p, z: p.z + zShift }));
  const mesh = buildWallAwareRings(yl.path || [], ylLens.path || [], zShift, cavity, zenith);
  const rings = mesh.rings;
  const zApex = (yl.zA || 0) + zShift;
  const betaContact = yl.beta;
  const vbEq = vitreousBasePostEquatorMm(cavity, eye, params.clockHour);
  const brk = Math.abs((params.equatorMm ?? vbEq) - vbEq) <= 0.2
    ? vitreousBasePostPointAtClock(cavity, eye, params.clockHour)
    : breakPosition(cavity, params.clockHour, params.equatorMm);
  const inGas = (p) => {
    if (!inCavity(p, cavity)) return false;
    if (fill >= 0.995 || yl.full) return true;
    const z = dot(p, zenith);
    const r = len(sub(p, scale(zenith, z)));
    return z >= zOfR(r) + zShift - 0.05;
  };
  const fovea = cavity.fovea;
  const zenithPoint = ellipsoidPointFromDirection(cavity, zenith);
  const breakLoc = clockAndLatitude(brk, cavity);
  const zenithLoc = clockAndLatitude(zenithPoint, cavity);
  const laplaceMmHg = fluid.laplaceMmHgPerKappa * yl.kappa0;
  const tamponaded = fill > 0 && inGas(brk);
  const pressureAt = (p) => {
    const wall = ellipsoidPointFromDirection(cavity, p);
    if (!inGas(wall)) return 0;
    const z = dot(wall, zenith);
    return Math.max(0, fluid.laplaceMmHgPerKappa * yl.kappa0 + fluid.mmHgPerMmHeight * (z - zApex));
  };

  const retina = sampleRetina(cavity, 28, 48);
  const field = retina.map((p) => ({
    p,
    pressure: pressureAt(p),
    macular: inMacula(p, cavity),
    posterior: p.z <= 0.15 * cavity.Rz,
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
  const zenithS = cavity.Rmean * Math.acos(clamp(dot(foveaHat, zenith), -1, 1));
  const profile = [];
  for (let i = -40; i <= 40; i += 1) {
    const s = (i / 40) * cavity.Rmean * (Math.PI / 2);
    const ang = s / cavity.Rmean;
    const p = ellipsoidPointFromDirection(
      cavity,
      add(scale(foveaHat, Math.cos(ang)), scale(toward, Math.sin(ang)))
    );
    profile.push({
      s,
      pressure: posteriorToLens(p, cavity) ? pressureAt(p) : 0,
      fovea: Math.abs(s) < 0.35,
      zenith: Math.abs(s - zenithS) < 0.45,
    });
  }

  const contactCircle = rings.length ? rings[rings.length - 1].slice() : [];
  const breakR = len(sub(brk, scale(zenith, dot(brk, zenith))));
  const marginMm = dot(brk, zenith) - (zOfR(breakR) + zShift);

  return {
    params: {
      ...params,
      cavityMl,
      fillPct: fill * 100,
      axialMm: cavity.al,
      lens,
      tamponadeMl,
    },
    radiusMm,
    cavity,
    fill,
    k: kFlat,
    capHeightMm: radiusMm - zApex,
    meniscusMm: zApex,
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
      rings,
      meridian: path,
      zApex,
      kappa0: yl.kappa0,
      betaContact,
      thetaDeg: (yl.theta * 180) / Math.PI,
      measuredThetaDeg: ((yl.measuredTheta ?? yl.theta) * 180) / Math.PI,
      bond: yl.bond || 0,
      flatten: yl.flatten || 0,
      fallback: Boolean(yl.fallback),
      thetaLensDeg: fluid.thetaLensDeg,
    },
    eye: (params.eye === "OS" ? "OS" : "OD"),
    fundus: fundusLandmarks(cavity, params.eye === "OS" ? "OS" : "OD"),
    extraLandmarks: extraLandmarks(cavity, params.eye),
    maculaRing: maculaRing(cavity),
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
      thetaLensDeg: fluid.thetaLensDeg,
      measuredThetaDeg: ((yl.measuredTheta ?? yl.theta) * 180) / Math.PI,
      capillaryMm: fluid.capillaryMm,
      bond: yl.bond || 0,
      flatten: yl.flatten || 0,
      kappa0: yl.kappa0,
      zApex,
      betaContactDeg: (betaContact * 180) / Math.PI,
      flatBetaDeg: (Math.acos(clamp((1 - kFlat), -1, 1)) * 180) / Math.PI,
      deltaRho: fluid.deltaRho,
    },
  };
}

window.BubbleModel = {
  MACULA_RADIUS_MM,
  SHOW_ORA,
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
  AL_MIN_MM,
  AL_MAX_MM,
  worldFromLocal,
  localFromWorld,
  breakPosition,
  breakArcRange,
  clockAndLatitude,
  oraPointAtClock,
  vitreousBasePostEquatorMm,
  vitreousBasePostPointAtClock,
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
  buildCavity,
  axialLengthFromVolume,
  ellipsoidPointFromDirection,
  posteriorToLens,
  inCavity,
  lensZ,
  clampToCavity,
  SIGMA_N_M,
  THETA_AQUEOUS_RAD,
  CAPILLARY_MM,
};
