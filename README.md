# Bubble Sim

A webpage that models an **intraocular gas bubble** in a spherical vitreous cavity.

There are two outputs:

1. **Break tamponade** — a 3D sphere with the bubble and a retinal break (clock hour + distance from the equator). The break is marked covered or not, using the 3D meniscus plane and head tilt.
2. **Retinal force** — hydrostatic tamponade pressure ΔP = ρgΔh on the posterior retina, with force vectors and the macula (2.75 mm radius) always shown. True face-down puts the fovea at the zenith.

This is an **educational** model, not a medical device.

## Open the page

Double-click `index.html`, or drag it into Chrome, Edge, or Firefox.

## Parameters

**Anatomy** — vitreous volume, or axial length using V = (AL³ π / 6) · (0.76 + 0.012 (AL − 24)); break clock hour; break distance from the equator toward the fovea.

**Tamponade** — SF₆, C₃F₈, air, silicone oil 1000, or silicone oil 5000, plus tamponade volume (mL, capped at the vitreous volume). Percent fill is shown from that volume. Oil uses a lower density difference and interfacial tension, so the meniscus stays rounder and hydrostatic force is much smaller.

**Cavity fluid** — vitreous (default), aqueous, or BSS. This sets gas–liquid σ and the Young angle θ through the liquid (vitreous ~61 mN/m and 39°; aqueous ~65 mN/m and 30°; BSS ~72 mN/m and 30°). Those values go into λ, Bond number, and the wall contact condition.

**Positioning** — face-down angle (default sitting = 90°) and left/right head tilt.

## Notes

The inferior meniscus is a Young–Laplace surface with gravity at every fill (σ and θ from the cavity fluid), not a flat plane. Peak ΔP is typically around 1 mmHg.
