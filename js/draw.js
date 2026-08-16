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
    if (extra.ora && extra.ora.length > 1) {
      ctx.setLineDash([5, 4]);
      drawPolyline(ctx, extra.ora.map(proj), colors.ora, 2);
      ctx.setLineDash([]);
      const nasal = proj(extra.nasalPt);
      ctx.fillStyle = colors.ora;
      ctx.font = "600 11px Figtree, sans-serif";
      ctx.fillText("ora", nasal.x + 6, nasal.y - 6);
    }
    extra.vortex.forEach((v) => {
      const ring = v.ring.map(proj);
      ctx.beginPath();
      ring.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = colors.vortexFill;
      ctx.fill();
      ctx.strokeStyle = colors.vortexStroke;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      const p = proj(v.p);
      ctx.fillStyle = colors.vortexStroke;
      ctx.font = "600 10px Figtree, sans-serif";
      ctx.fillText(v.id, p.x + 7, p.y - 5);
    });
  }

  function drawTearMarker(ctx, proj, model, options = {}) {
    const br = proj(model.break);
    const fovea = proj(model.fovea);
    const fill = model.tamponaded ? "#1f6b45" : "#9b1c1c";
    const dx = br.x - fovea.x;
    const dy = br.y - fovea.y;
    const ang = Math.hypot(dx, dy) < 4 ? -Math.PI / 2 : Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(br.x, br.y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0.65, Math.PI * 2 - 0.65);
    ctx.strokeStyle = "#fbf7f0";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0.65, Math.PI * 2 - 0.65);
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
    if (!options.label) return;
    ctx.font = "600 12px Figtree, sans-serif";
    ctx.fillStyle = fill;
    const away = Math.hypot(dx, dy) < 4 ? { x: 12, y: -12 } : { x: Math.sign(dx || 1) * 12, y: dy >= 0 ? 16 : -10 };
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
    const scalePx = Math.min(w, h) * 0.36 / R;
    const cx = w * 0.5;
    const cy = h * 0.52;
    const yaw = view.yaw;
    const pitch = view.pitch;
    const proj = (p) => project(p, yaw, pitch, scalePx, cx, cy);

    const tris = sphereTriangles(R, 22, 36).map((tri) => {
      const mid = scale(add(add(tri[0], tri[1]), tri[2]), 1 / 3);
      const inGas = model.inGas(mid);
      const q = tri.map(proj);
      const z = (q[0].z + q[1].z + q[2].z) / 3;
      return { q, z, inGas, mid };
    });
    tris.sort((a, b) => a.z - b.z);

    const agentFill = model.tamponade && model.tamponade.kind === "oil"
      ? ["rgba(196, 154, 72, 0.55)", "rgba(120, 84, 28, 0.18)"]
      : ["rgba(78, 168, 164, 0.55)", "rgba(26, 95, 95, 0.16)"];
    tris.forEach((t) => {
      if (t.inGas) drawTriangle(ctx, t.q, agentFill[0], agentFill[1]);
      else drawTriangle(ctx, t.q, "rgba(232, 222, 204, 0.35)", "rgba(180, 166, 142, 0.18)");
    });

    const eq = [];
    for (let i = 0; i <= 64; i += 1) {
      const t = (2 * Math.PI * i) / 64;
      eq.push(proj(vec(R * Math.sin(t), R * Math.cos(t), 0)));
    }
    ctx.beginPath();
    eq.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = "#5c4a32";
    ctx.lineWidth = 1.8;
    ctx.stroke();

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
          const q = tri.map(proj);
          menTris.push({ q, z: (q[0].z + q[1].z + q[2].z) / 3 });
        });
      }
    }
    menTris.sort((a, b) => a.z - b.z);
    menTris.forEach((t) => drawTriangle(ctx, t.q, "rgba(255, 252, 245, 0.22)", "rgba(15, 63, 64, 0.08)"));

    const men = model.meniscus.points.map(proj);
    ctx.beginPath();
    men.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.strokeStyle = "rgba(15, 63, 64, 0.85)";
    ctx.lineWidth = 2.2;
    ctx.stroke();

    if (model.meniscus.meridian && model.meniscus.meridian.length > 1 && rings.length > 1) {
      const mer = rings.map((ring) => ring[0]).map(proj);
      ctx.beginPath();
      mer.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = "#0f3f40";
      ctx.lineWidth = 2.6;
      ctx.stroke();

      const cW = rings[rings.length - 1][0];
      const iW = rings[rings.length - 2][0];
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
    ctx.beginPath();
    ctx.arc(fovea.x, fovea.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#8d4b2b";
    ctx.fill();

    drawFundus(ctx, model, proj, { vessels: "#9b2c2c", disc: "#c4a36a", discStroke: "#6b4a24" });
    drawOraAndVortex(ctx, model, proj, {
      ora: "#6b4a8a",
      vortexFill: "rgba(92, 40, 70, 0.85)",
      vortexStroke: "#4a1838",
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
      const p = proj(BubbleModel.breakPosition(R, hour, 0));
      ctx.fillStyle = "#3d3226";
      ctx.font = "600 14px Figtree, sans-serif";
      ctx.fillText(String(hour), p.x + 6, p.y - 6);
    }

    ctx.fillStyle = "#1b2430";
    ctx.font = "600 16px Figtree, sans-serif";
    ctx.fillText(model.tamponaded ? "Break is tamponaded" : "Break is not tamponaded", 20, 32);
    ctx.fillStyle = "#5d6a78";
    ctx.font = "500 13px Figtree, sans-serif";
    ctx.fillText(`Drag to rotate  ·  ${model.eye}  ·  facing the eye  ·  12 up  ·  3 right  ·  9 left  ·  macula behind  ·  ${model.eye === "OS" ? "OS disc toward 9" : "OD disc toward 3"}`, 20, h - 18);
  }

  function drawForce(canvas, model) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f4efe5";
    ctx.fillRect(0, 0, w, h);

    const R = model.radiusMm;
    const mapH = h * 0.72;
    const scalePx = Math.min(w, mapH) * 0.42 / R;
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
      return vec(R * c * Math.sin(az), R * c * Math.cos(az), -R * Math.sin(lat));
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
    ctx.beginPath();
    ctx.arc(fovea.x, fovea.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#1b2430";
    ctx.fill();
    drawFundus(ctx, model, proj, { vessels: "#7a1f1f", disc: "#d7b56a", discStroke: "#4a3318" });
    drawOraAndVortex(ctx, model, proj, {
      ora: "#5a3a7a",
      vortexFill: "rgba(92, 40, 70, 0.9)",
      vortexStroke: "#3a1028",
    });

    const arrowScale = (R * 0.55) / maxP;
    for (let i = 2; i <= 10; i += 2) {
      const lat = (Math.PI / 2) * (i / 12);
      const count = i === 0 ? 1 : 12;
      for (let j = 0; j < count; j += 1) {
        const az = (2 * Math.PI * j) / count + 0.1;
        const c = Math.cos(lat);
        const p = vec(R * c * Math.sin(az), R * c * Math.cos(az), -R * Math.sin(lat));
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
      const p = proj(BubbleModel.breakPosition(R, hour, 0));
      ctx.fillStyle = "#3d3226";
      ctx.font = "600 13px Figtree, sans-serif";
      ctx.fillText(String(hour), p.x + 6, p.y - 6);
    }

    ctx.fillStyle = "#1b2430";
    ctx.font = "600 16px Figtree, sans-serif";
    ctx.fillText("Hydrostatic force on the posterior retina", 20, 28);
    ctx.fillStyle = "#5d6a78";
    ctx.font = "500 13px Figtree, sans-serif";
    ctx.fillText(`Macula outlined (r = ${model.maculaRadiusMm} mm)  ·  tear marked  ·  ${model.eye} disc + arcades  ·  ΔP = ρgΔh`, 20, 48);

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

  return { drawGlobe, drawForce, geodesicMm };
})();
