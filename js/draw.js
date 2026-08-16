const Draw3D = (() => {
  const { vec, add, sub, scale, normalize, geodesicMm, dot } = window.BubbleModel;

  function rotatePoint(p, yaw, pitch) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const x1 = p.x * cy + p.z * sy;
    const z1 = -p.x * sy + p.z * cy;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const y2 = p.y * cp - z1 * sp;
    const z2 = p.y * sp + z1 * cp;
    return vec(x1, y2, z2);
  }

  function project(p, yaw, pitch, scalePx, cx, cy) {
    const r = rotatePoint(p, yaw, pitch);
    return { x: cx + r.x * scalePx, y: cy - r.y * scalePx, z: r.z, world: p };
  }

  function sphereTriangles(radius, nLat, nLon) {
    const tris = [];
    const pt = (i, j) => {
      const lat = -Math.PI / 2 + (Math.PI * i) / nLat;
      const lon = (2 * Math.PI * j) / nLon;
      const c = Math.cos(lat);
      return vec(radius * c * Math.sin(lon), radius * Math.sin(lat), radius * c * Math.cos(lon));
    };
    for (let i = 0; i < nLat; i += 1) {
      for (let j = 0; j < nLon; j += 1) {
        const j2 = (j + 1) % nLon;
        const a = pt(i, j);
        const b = pt(i + 1, j);
        const c = pt(i + 1, j2);
        const d = pt(i, j2);
        if (i !== 0) tris.push([a, b, d]);
        if (i !== nLat - 1) tris.push([b, c, d]);
      }
    }
    return tris;
  }

  function pressureColor(p, maxP) {
    if (p <= 0) return { fill: "rgba(214, 204, 186, 0.22)", stroke: "rgba(160, 148, 128, 0.12)" };
    const t = Math.min(p / Math.max(maxP, 1e-6), 1);
    const r = Math.round(40 + 180 * t);
    const g = Math.round(90 + 40 * (1 - t));
    const b = Math.round(140 - 80 * t);
    return { fill: `rgba(${r},${g},${b},0.78)`, stroke: `rgba(${r},${g},${b},0.95)` };
  }

  function drawTriangle(ctx, pts, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }

  function drawPolyline(ctx, pts, stroke, width) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function drawFundus(ctx, model, proj, colors) {
    const fund = model.fundus;
    if (!fund) return;
    drawPolyline(ctx, fund.superiorArcade.map(proj), colors.vessels, 2.2);
    drawPolyline(ctx, fund.inferiorArcade.map(proj), colors.vessels, 2.2);
    const disc = fund.discRing.map(proj);
    ctx.beginPath();
    disc.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = colors.disc;
    ctx.fill();
    ctx.strokeStyle = colors.discStroke;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const d0 = proj(fund.disc);
    ctx.fillStyle = colors.discStroke;
    ctx.font = "600 11px Figtree, sans-serif";
    ctx.fillText(model.eye === "OS" ? "ONH OS" : "ONH OD", d0.x + 6, d0.y - 6);
  }

  function drawOraAndVortex(ctx, model, proj, colors) {
    const extra = model.extraLandmarks;
    if (!extra) return;
    if (extra.ciliary && extra.ciliary.length > 1) {
      drawPolyline(ctx, extra.ciliary.map(proj), colors.ciliary || "#8a5a2a", 2.2);
    }
    if (extra.vitreousBasePost && extra.vitreousBasePost.length > 1) {
      ctx.setLineDash([3, 3]);
      drawPolyline(ctx, extra.vitreousBasePost.map(proj), colors.base || "#6a7a3a", 1.8);
      ctx.setLineDash([]);
    }
    if (extra.equator && extra.equator.length > 1) {
      ctx.setLineDash([5, 4]);
      drawPolyline(ctx, extra.equator.map(proj), colors.ora, 2);
      ctx.setLineDash([]);
      if (extra.nasalPt) {
        const nasal = proj(extra.nasalPt);
        ctx.fillStyle = colors.ora;
        ctx.font = "600 11px Figtree, sans-serif";
        ctx.fillText("equator", nasal.x + 6, nasal.y - 6);
      }
    }
    if (extra.vitreousBasePost && extra.vitreousBasePost.length) {
      const vb = proj(extra.vitreousBasePost[Math.floor(extra.vitreousBasePost.length * 0.28)]);
      ctx.fillStyle = colors.base || "#6a7a3a";
      ctx.font = "600 11px Figtree, sans-serif";
      ctx.fillText("vitreous base", vb.x + 6, vb.y + 12);
    }
    if (extra.ciliary && extra.ciliary.length) {
      const cb = proj(extra.ciliary[Math.floor(extra.ciliary.length * 0.12)]);
      ctx.fillStyle = colors.ciliary || "#8a5a2a";
      ctx.font = "600 11px Figtree, sans-serif";
      ctx.fillText("pars plana", cb.x + 6, cb.y - 6);
    }
    if (extra.buckleCenter && extra.buckleCenter.length > 1) {
      const buckleColor = colors.buckle || "#3d5a73";
      if (extra.buckleAnt && extra.buckleAnt.length > 1) {
        drawPolyline(ctx, extra.buckleAnt.map(proj), buckleColor, 1.3);
      }
      if (extra.bucklePost && extra.bucklePost.length > 1) {
        drawPolyline(ctx, extra.bucklePost.map(proj), buckleColor, 1.3);
      }
      drawPolyline(ctx, extra.buckleCenter.map(proj), buckleColor, 2.6);
      const labelPt = extra.buckleLabelPt || extra.buckleCenter[0];
      const bp = proj(labelPt);
      ctx.fillStyle = buckleColor;
      ctx.font = "600 11px Figtree, sans-serif";
      ctx.fillText(extra.buckleName || "buckle", bp.x + 6, bp.y - 6);
    }
  }

  function clockLabelPoint(model, hour) {
    const cavity = model.cavity;
    if (cavity && BubbleModel.equatorPointAtClock) {
      return BubbleModel.equatorPointAtClock(cavity, hour);
    }
    return BubbleModel.breakPosition(cavity || model.radiusMm, hour, 0);
  }

  function drawFoveaX(ctx, p, color, size = 5) {
    ctx.beginPath();
    ctx.moveTo(p.x - size, p.y - size);
    ctx.lineTo(p.x + size, p.y + size);
    ctx.moveTo(p.x + size, p.y - size);
    ctx.lineTo(p.x - size, p.y + size);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function drawMacularHole(ctx, proj, model, options = {}) {
    if (!model.macularHole || !(model.macularHoleRing && model.macularHoleRing.length)) return;
    const ring = model.macularHoleRing.map(proj);
    const fill = model.macularHoleTamponaded ? "#1f6b45" : "#9b1c1c";
    ctx.beginPath();
    ring.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = model.macularHoleTamponaded ? "rgba(31, 107, 69, 0.28)" : "rgba(155, 28, 28, 0.28)";
    ctx.fill();
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    if (!options.label) return;
    const fovea = proj(model.fovea);
    ctx.font = "600 12px Figtree, sans-serif";
    ctx.fillStyle = fill;
    ctx.fillText(model.macularHoleTamponaded ? "MH · tamponaded" : "MH", fovea.x + 10, fovea.y + 16);
  }

  function tamponadeHeadline(model) {
    const br = model.tamponaded ? "Break is tamponaded" : "Break is not tamponaded";
    if (!model.macularHole) return br;
    const mh = model.macularHoleTamponaded ? "MH is tamponaded" : "MH is not tamponaded";
    return `${br}  ·  ${mh}`;
  }

  function drawTearMarker(ctx, proj, model, options = {}) {
    const br = proj(model.break);
    const fovea = proj(model.fovea);
    const fill = model.tamponaded ? "#1f6b45" : "#9b1c1c";
    const dx = br.x - fovea.x;
    const dy = br.y - fovea.y;
    const ang = Math.hypot(dx, dy) < 6 ? -Math.PI / 2 : Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(br.x, br.y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0.65, Math.PI * 2 - 0.65);
    ctx.strokeStyle = "#fbf7f0";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0.65, Math.PI * 2 - 0.65);
    ctx.strokeStyle = fill;
    ctx.lineWidth = 3.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 4.8, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
    if (!options.label) return;
    ctx.font = "600 12px Figtree, sans-serif";
    ctx.fillStyle = fill;
    const away = Math.hypot(dx, dy) < 6 ? { x: 16, y: -16 } : { x: Math.sign(dx || 1) * 16, y: dy >= 0 ? 20 : -12 };
    const lx = Math.min(Math.max(br.x + away.x, 12), ctx.canvas.width - 90);
    const ly = Math.min(Math.max(br.y + away.y, 68), ctx.canvas.height - 24);
    ctx.fillText(model.tamponaded ? "Tear · tamponaded" : "Tear", lx, ly);
  }

  function drawGlobe(canvas, model, view) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f4efe5";
    ctx.fillRect(0, 0, w, h);

    const R = model.radiusMm;
    const cavity = model.cavity;
    const Rx = cavity ? cavity.Rx : R;
    const Ry = cavity ? cavity.Ry : R;
    const Rz = cavity ? cavity.Rz : R;
    const scalePx = Math.min(w, h) * 0.34 / Math.max(Rx, Ry, Rz);
    const cx = w * 0.5;
    const cy = h * 0.52;
    const yaw = view.yaw;
    const pitch = view.pitch;
    const proj = (p) => project(p, yaw, pitch, scalePx, cx, cy);
    const nLat = cavity && cavity.buckle ? 48 : 22;
    const nLon = cavity && cavity.buckle ? 56 : 36;
    const inside = (p) => !cavity || BubbleModel.inCavity(p, cavity);
    const toWall = (p) => {
      const local = vec(p.x * Rx, p.y * Ry, p.z * Rz);
      const world = cavity ? BubbleModel.worldFromLocal(local, cavity) : local;
      return cavity && BubbleModel.applyBuckleToWallPoint
        ? BubbleModel.applyBuckleToWallPoint(world, cavity)
        : world;
    };

    const tris = sphereTriangles(1, nLat, nLon).map((tri) => {
      const mapped = tri.map(toWall);
      const mid = scale(add(add(mapped[0], mapped[1]), mapped[2]), 1 / 3);
      const inGas = inside(mid) && model.inGas(mid);
      const q = mapped.map(proj);
      const z = (q[0].z + q[1].z + q[2].z) / 3;
      return { q, z, inGas, mid, keep: inside(mid) };
    }).filter((t) => t.keep);
    tris.sort((a, b) => a.z - b.z);

    const agentFill = model.tamponade && model.tamponade.kind === "oil"
      ? ["rgba(196, 154, 72, 0.55)", "rgba(120, 84, 28, 0.18)"]
      : ["rgba(78, 168, 164, 0.55)", "rgba(26, 95, 95, 0.16)"];
    tris.forEach((t) => {
      if (t.inGas) drawTriangle(ctx, t.q, agentFill[0], agentFill[1]);
      else drawTriangle(ctx, t.q, "rgba(232, 222, 204, 0.35)", "rgba(180, 166, 142, 0.18)");
    });

    const rings = model.meniscus.rings || [];
    const menTris = [];
    for (let i = 0; i < rings.length - 1; i += 1) {
      const a = rings[i];
      const b = rings[i + 1];
      for (let j = 0; j < a.length; j += 1) {
        const j2 = (j + 1) % a.length;
        const triA = [a[j], b[j], a[j2]];
        const triB = [b[j], b[j2], a[j2]];
        [triA, triB].forEach((tri) => {
          const mid = scale(add(add(tri[0], tri[1]), tri[2]), 1 / 3);
          if (cavity && !(BubbleModel.inCavitySmooth || BubbleModel.inCavity)(mid, cavity)) return;
          const q = tri.map(proj);
          menTris.push({ q, z: (q[0].z + q[1].z + q[2].z) / 3 });
        });
      }
    }
    menTris.sort((a, b) => a.z - b.z);
    menTris.forEach((t) => drawTriangle(ctx, t.q, "rgba(255, 252, 245, 0.22)", "rgba(15, 63, 64, 0.08)"));

    if (cavity && cavity.lensRings) {
      const lensTris = [];
      const rings = cavity.lensRings;
      for (let i = 0; i < rings.length - 1; i += 1) {
        const a = rings[i];
        const b = rings[i + 1];
        for (let j = 0; j < a.length; j += 1) {
          const j2 = (j + 1) % a.length;
          [ [a[j], b[j], a[j2]], [b[j], b[j2], a[j2]] ].forEach((tri) => {
            const mid = scale(add(add(tri[0], tri[1]), tri[2]), 1 / 3);
            const q = tri.map(proj);
            lensTris.push({ q, z: (q[0].z + q[1].z + q[2].z) / 3, inGas: model.inGas(mid) });
          });
        }
      }
      lensTris.sort((a, b) => a.z - b.z);
      const lensFill = cavity.lens === "pseudo"
        ? ["rgba(210, 220, 230, 0.45)", "rgba(80, 100, 120, 0.25)"]
        : ["rgba(230, 220, 190, 0.5)", "rgba(120, 100, 60, 0.28)"];
      const lensGas = model.tamponade && model.tamponade.kind === "oil"
        ? ["rgba(196, 154, 72, 0.42)", "rgba(120, 84, 28, 0.22)"]
        : ["rgba(78, 168, 164, 0.42)", "rgba(26, 95, 95, 0.2)"];
      lensTris.forEach((t) => drawTriangle(ctx, t.q, t.inGas ? lensGas[0] : lensFill[0], t.inGas ? lensGas[1] : lensFill[1]));
      if (cavity.clipRing) drawPolyline(ctx, cavity.clipRing.map(proj), "#5c4a32", 2);
    }

    const men = model.meniscus.points.map(proj);
    if (men.length > 2) {
      ctx.beginPath();
      men.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.strokeStyle = "rgba(15, 63, 64, 0.85)";
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }

    if (model.meniscus.meridianSpoke && model.meniscus.meridianSpoke.length > 1) {
      const mer = model.meniscus.meridianSpoke.map(proj);
      ctx.beginPath();
      mer.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = "#0f3f40";
      ctx.lineWidth = 2.6;
      ctx.stroke();

      const spoke = model.meniscus.meridianSpoke;
      const cW = spoke[spoke.length - 1];
      const iW = spoke[Math.max(spoke.length - 2, 0)];
      const n = normalize(cW);
      const iface = normalize(sub(iW, cW));
      const wall = normalize(sub(scale(n, dot(n, model.zenith)), model.zenith));
      const tick = model.radiusMm * 0.22;
      const a = proj(cW);
      const b = proj(add(cW, scale(iface, tick)));
      const c = proj(add(cW, scale(wall, tick)));
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
      ctx.strokeStyle = "#8d4b2b";
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.fillStyle = "#8d4b2b";
      ctx.font = "600 12px Figtree, sans-serif";
      ctx.fillText(`θ = ${model.meniscus.thetaDeg.toFixed(0)}°`, (b.x + c.x) / 2 + 6, (b.y + c.y) / 2);
    }

    const fovea = proj(model.fovea);
    drawFoveaX(ctx, fovea, "#8d4b2b", 5);
    ctx.fillStyle = "#8d4b2b";
    ctx.font = "600 11px Figtree, sans-serif";
    ctx.fillText("fovea", fovea.x + 8, fovea.y - 8);

    drawFundus(ctx, model, proj, { vessels: "#9b2c2c", disc: "#c4a36a", discStroke: "#6b4a24" });
    drawOraAndVortex(ctx, model, proj, {
      ora: "#6b4a8a",
      base: "#6a7a3a",
      ciliary: "#8a5a2a",
      buckle: "#3d5a73",
    });

    const mac = model.maculaRing.map(proj);
    ctx.beginPath();
    mac.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.strokeStyle = "#8d4b2b";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.setLineDash([]);

    drawMacularHole(ctx, proj, model);

    const z0 = proj(vec(0, 0, 0));
    const z1 = proj(scale(model.zenith, R * 1.35));
    ctx.beginPath();
    ctx.moveTo(z0.x, z0.y);
    ctx.lineTo(z1.x, z1.y);
    ctx.strokeStyle = "#1a5f5f";
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(z1.x, z1.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#1a5f5f";
    ctx.fill();

    drawTearMarker(ctx, proj, model);

    for (const hour of [12, 3, 6, 9]) {
      const p = proj(clockLabelPoint(model, hour));
      ctx.fillStyle = "#3d3226";
      ctx.font = "600 14px Figtree, sans-serif";
      ctx.fillText(String(hour), p.x + 6, p.y - 6);
    }

    ctx.fillStyle = "#1b2430";
    ctx.font = "600 16px Figtree, sans-serif";
    ctx.fillText(tamponadeHeadline(model), 20, 32);
    ctx.fillStyle = "#5d6a78";
    ctx.font = "500 13px Figtree, sans-serif";
    ctx.fillText(`Drag to rotate  ·  ${model.eye}  ·  ${cavity && cavity.lens === "pseudo" ? "pseudophakic plane" : "phakic Navarro lens"}  ·  anatomy fixed · bubble follows pose`, 20, h - 18);
  }

  function drawForce(canvas, model) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f4efe5";
    ctx.fillRect(0, 0, w, h);

    const R = model.radiusMm;
    const cavity = model.cavity;
    const Rx = cavity ? cavity.Rx : R;
    const Ry = cavity ? cavity.Ry : R;
    const Rz = cavity ? cavity.Rz : R;
    const mapH = h * 0.72;
    const scalePx = Math.min(w, mapH) * 0.42 / Math.max(Rx, Ry);
    const cx = w * 0.5;
    const cy = mapH * 0.52;
    const yaw = 0;
    const pitch = 0;
    const proj = (p) => project(p, yaw, pitch, scalePx, cx, cy);
    const maxP = Math.max(model.pressure.max, 0.05);

    const nLat = 20;
    const nLon = 36;
    const tris = [];
    const latPt = (i, j) => {
      const lat = (Math.PI / 2) * (i / nLat);
      const az = (2 * Math.PI * j) / nLon;
      const c = Math.cos(lat);
      const dir = vec(c * Math.sin(az), c * Math.cos(az), -Math.sin(lat));
      if (!cavity) return vec(R * dir.x, R * dir.y, R * dir.z);
      return BubbleModel.ellipsoidPointFromDirection
        ? BubbleModel.ellipsoidPointFromDirection(cavity, dir)
        : (() => {
          const q = (dir.x * dir.x) / (Rx * Rx) + (dir.y * dir.y) / (Ry * Ry) + (dir.z * dir.z) / (Rz * Rz);
          return scale(dir, 1 / Math.sqrt(Math.max(q, 1e-12)));
        })();
    };
    for (let i = 0; i < nLat; i += 1) {
      for (let j = 0; j < nLon; j += 1) {
        const j2 = (j + 1) % nLon;
        const a = latPt(i, j);
        const b = latPt(i + 1, j);
        const c = latPt(i + 1, j2);
        const d = latPt(i, j2);
        tris.push([a, b, d], [b, c, d]);
      }
    }

    const drawn = tris.map((tri) => {
      const mid = scale(add(add(tri[0], tri[1]), tri[2]), 1 / 3);
      const pressure = model.pressureAt(mid);
      const q = tri.map(proj);
      const z = (q[0].z + q[1].z + q[2].z) / 3;
      return { q, z, pressure };
    });
    drawn.sort((a, b) => a.z - b.z);
    drawn.forEach((t) => {
      const col = pressureColor(t.pressure, maxP);
      drawTriangle(ctx, t.q, col.fill, col.stroke);
    });

    const mac = model.maculaRing.map(proj);
    ctx.beginPath();
    mac.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.strokeStyle = "#1b2430";
    ctx.lineWidth = 2.2;
    ctx.stroke();
    const fovea = proj(model.fovea);
    drawFoveaX(ctx, fovea, "#1b2430", 5);
    ctx.fillStyle = "#1b2430";
    ctx.font = "600 11px Figtree, sans-serif";
    ctx.fillText("fovea", fovea.x + 8, fovea.y - 8);
    drawMacularHole(ctx, proj, model, { label: true });
    drawFundus(ctx, model, proj, { vessels: "#7a1f1f", disc: "#d7b56a", discStroke: "#4a3318" });
    drawOraAndVortex(ctx, model, proj, {
      ora: "#5a3a7a",
      base: "#6a7a3a",
      ciliary: "#8a5a2a",
      buckle: "#2c4a63",
    });

    const arrowScale = (R * 0.55) / maxP;
    for (let i = 2; i <= 10; i += 2) {
      const lat = (Math.PI / 2) * (i / 12);
      const count = i === 0 ? 1 : 12;
      for (let j = 0; j < count; j += 1) {
        const az = (2 * Math.PI * j) / count + 0.1;
        const c = Math.cos(lat);
        const dir = vec(c * Math.sin(az), c * Math.cos(az), -Math.sin(lat));
        const p = cavity
          ? BubbleModel.ellipsoidPointFromDirection(cavity, dir)
          : scale(dir, R);
        const pressure = model.pressureAt(p);
        if (pressure <= 0.01) continue;
        const n = normalize(p);
        const tip = add(p, scale(n, pressure * arrowScale));
        const a = proj(p);
        const b = proj(tip);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = "rgba(20, 30, 40, 0.85)";
        ctx.lineWidth = 1.6;
        ctx.stroke();
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - 7 * Math.cos(ang - 0.4), b.y - 7 * Math.sin(ang - 0.4));
        ctx.lineTo(b.x - 7 * Math.cos(ang + 0.4), b.y - 7 * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fillStyle = "rgba(20, 30, 40, 0.85)";
        ctx.fill();
      }
    }

    drawTearMarker(ctx, proj, model, { label: true });

    for (const hour of [12, 3, 6, 9]) {
      const p = proj(clockLabelPoint(model, hour));
      ctx.fillStyle = "#3d3226";
      ctx.font = "600 13px Figtree, sans-serif";
      ctx.fillText(String(hour), p.x + 6, p.y - 6);
    }

    ctx.fillStyle = "#1b2430";
    ctx.font = "600 16px Figtree, sans-serif";
    ctx.fillText("Hydrostatic force on the posterior retina", 20, 28);
    ctx.fillStyle = "#5d6a78";
    ctx.font = "500 13px Figtree, sans-serif";
    ctx.fillText(`Macula outlined (r = ${model.maculaRadiusMm} mm)  ·  tear marked${model.macularHole ? "  ·  MH at fovea" : ""}  ·  ${model.eye} disc + arcades  ·  ΔP = ρgΔh`, 20, 48);

    drawProfile(ctx, model, 16, mapH + 8, w - 32, h - mapH - 20);
    drawColorBar(ctx, w - 36, 70, 10, mapH * 0.45, maxP);
  }

  function drawProfile(ctx, model, x, y, w, h) {
    ctx.fillStyle = "#fffdf8";
    ctx.strokeStyle = "#d7cbb8";
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    const series = model.profile;
    const maxP = Math.max(model.pressure.max, 0.05);
    const maxS = Math.max(...series.map((p) => Math.abs(p.s)), 1);
    const px = (s) => x + 36 + ((s + maxS) / (2 * maxS)) * (w - 48);
    const py = (p) => y + 12 + (1 - p / maxP) * (h - 28);

    ctx.beginPath();
    series.forEach((pt, i) => {
      const X = px(pt.s);
      const Y = py(pt.pressure);
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.strokeStyle = "#1a5f5f";
    ctx.lineWidth = 2;
    ctx.stroke();

    const foveaS = 0;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px(foveaS), y + 8);
    ctx.lineTo(px(foveaS), y + h - 8);
    ctx.strokeStyle = "#8d4b2b";
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#5d6a78";
    ctx.font = "500 11px Figtree, sans-serif";
    ctx.fillText("Hydrostatic profile through zenith and fovea (mmHg vs mm along retina)", x + 8, y + 14);
    ctx.fillText("fovea", px(0) + 4, y + h - 8);
    const zenithPt = series.find((pt) => pt.zenith);
    if (zenithPt) ctx.fillText("zenith", px(zenithPt.s) + 4, y + 26);
  }

  function drawPlannerChart(canvas, curve, currentDay, cavityMl) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f4efe5";
    ctx.fillRect(0, 0, w, h);
    const pad = { l: 52, r: 18, t: 36, b: 42 };
    const x0 = pad.l;
    const y0 = pad.t;
    const cw = w - pad.l - pad.r;
    const ch = h - pad.t - pad.b;
    const maxDays = BubbleModel.PLANNER_MAX_DAYS || 56;
    const yMax = Math.max(cavityMl || 1, ...curve.map((p) => p.rawMl || p.ml), 0.5);
    const xOf = (d) => x0 + (d / maxDays) * cw;
    const yOf = (ml) => y0 + ch - (ml / yMax) * ch;

    ctx.strokeStyle = "#d7cbb8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y0 + ch);
    ctx.lineTo(x0 + cw, y0 + ch);
    ctx.stroke();

    ctx.fillStyle = "#5d6a78";
    ctx.font = "500 11px Figtree, sans-serif";
    for (let week = 0; week <= 8; week += 1) {
      const x = xOf(week * 7);
      ctx.strokeStyle = "rgba(215, 203, 184, 0.7)";
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + ch);
      ctx.stroke();
      ctx.fillStyle = "#5d6a78";
      ctx.fillText(`${week}w`, x - 8, y0 + ch + 18);
    }
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i += 1) {
      const ml = (yMax * i) / yTicks;
      const y = yOf(ml);
      ctx.fillStyle = "#5d6a78";
      ctx.fillText(ml.toFixed(1), 8, y + 4);
    }

    ctx.strokeStyle = "rgba(26, 95, 95, 0.35)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, yOf(cavityMl));
    ctx.lineTo(x0 + cw, yOf(cavityMl));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#1a5f5f";
    ctx.fillText("cavity", x0 + cw - 44, yOf(cavityMl) - 6);

    if (curve.length > 1) {
      ctx.beginPath();
      curve.forEach((p, i) => (i ? ctx.lineTo(xOf(p.day), yOf(p.ml)) : ctx.moveTo(xOf(p.day), yOf(p.ml))));
      ctx.lineTo(xOf(curve[curve.length - 1].day), yOf(0));
      ctx.lineTo(xOf(curve[0].day), yOf(0));
      ctx.closePath();
      ctx.fillStyle = "rgba(78, 168, 164, 0.22)";
      ctx.fill();
      ctx.beginPath();
      curve.forEach((p, i) => (i ? ctx.lineTo(xOf(p.day), yOf(p.ml)) : ctx.moveTo(xOf(p.day), yOf(p.ml))));
      ctx.strokeStyle = "#1a5f5f";
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }

    const tPeak = curve[0] && curve[0].tPeakDays;
    if (tPeak > 0.2) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "#8d4b2b";
      ctx.beginPath();
      ctx.moveTo(xOf(tPeak), y0);
      ctx.lineTo(xOf(tPeak), y0 + ch);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#8d4b2b";
      ctx.fillText("peak", xOf(tPeak) + 4, y0 + 14);
    }

    const now = BubbleModel.clamp(currentDay, 0, maxDays);
    ctx.strokeStyle = "#1b2430";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(xOf(now), y0);
    ctx.lineTo(xOf(now), y0 + ch);
    ctx.stroke();
    const here = curve.reduce((best, p) => (Math.abs(p.day - now) < Math.abs(best.day - now) ? p : best), curve[0] || { day: 0, ml: 0 });
    if (here) {
      ctx.beginPath();
      ctx.arc(xOf(now), yOf(here.ml), 5.5, 0, Math.PI * 2);
      ctx.fillStyle = "#0f3f40";
      ctx.fill();
    }

    ctx.fillStyle = "#1b2430";
    ctx.font = "600 16px Figtree, sans-serif";
    ctx.fillText("Occupying volume (mL)", 20, 24);
    ctx.fillStyle = "#5d6a78";
    ctx.font = "500 12px Figtree, sans-serif";
    ctx.fillText("0 to 8 weeks  ·  power-law fade  ·  gone 6–7 weeks", 20, 44);
  }

  function drawColorBar(ctx, x, y, w, h, maxP) {
    const g = ctx.createLinearGradient(0, y + h, 0, y);
    g.addColorStop(0, "rgb(40, 130, 140)");
    g.addColorStop(1, "rgb(220, 90, 60)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#5c4a32";
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#1b2430";
    ctx.font = "600 11px Figtree, sans-serif";
    ctx.fillText(`${maxP.toFixed(2)}`, x - 34, y + 10);
    ctx.fillText("0", x - 18, y + h);
    ctx.save();
    ctx.translate(x + 22, y + h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("mmHg", 0, 0);
    ctx.restore();
  }

  return { drawGlobe, drawForce, drawPlannerChart, geodesicMm };
})();
