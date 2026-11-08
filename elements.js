// CPK-style colors (hex) and van der Waals radii (Å) for common elements.

export const ELEMENT_COLORS = {
  H:  0xf0f0f0, He: 0xd9ffff, Li: 0xcc80ff, Be: 0xc2ff00, B:  0xffb5b5,
  C:  0x909090, N:  0x3050f8, O:  0xd90000, F:  0x90e050, Ne: 0xb3e3f5,
  Na: 0xab5cf2, Mg: 0x8aff00, Al: 0xbfa6a6, Si: 0xf0c8a0, P:  0xff8000,
  S:  0xffd123, Cl: 0x1ff01f, Ar: 0x80d1e3, K:  0x8f40d4, Ca: 0x3dff00,
  Ti: 0xbfc2c7, Cr: 0x8a99c7, Mn: 0x9c7ac7, Fe: 0xe06633, Co: 0xf090a0,
  Ni: 0x50d050, Cu: 0xc88033, Zn: 0x7d80b0, Br: 0xa62929, I:  0x940094,
  Se: 0xffa100, Se_alt: 0xffa100,
};

export const VDW_RADII = {
  H: 1.2, C: 1.7, N: 1.55, O: 1.52, F: 1.47, P: 1.8, S: 1.8,
  Cl: 1.75, Br: 1.85, I: 1.98,
};

export const ATOMIC_MASSES = {
  H: 1.008, He: 4.003, Li: 6.94, Be: 9.012, B: 10.81, C: 12.011,
  N: 14.007, O: 15.999, F: 18.998, Ne: 20.18, Na: 22.99, Mg: 24.305,
  Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948,
  K: 39.098, Ca: 40.078, Ti: 47.867, Cr: 51.996, Mn: 54.938, Fe: 55.845,
  Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ge: 72.63, Se: 78.971,
  Br: 79.904, Mo: 95.95, Sn: 118.71, I: 126.9, Pt: 195.08, Au: 196.97,
};

export function normalizeElement(raw) {
  if (!raw) return "X";
  const el = raw.trim().replace(/[^A-Za-z]/g, "");
  if (el.length === 0) return "X";
  return el[0].toUpperCase() + el.slice(1).toLowerCase();
}

export function elementColor(el) {
  return ELEMENT_COLORS[el] ?? 0xd9d9d9;
}

export function atomRadius(el, style) {
  const vdW = VDW_RADII[el] ?? 1.7;
  if (style === "spacefill") return vdW;
  if (style === "sticks") return 0.08; // cap for the ends of stick bonds
  // ball & stick: scaled covalent-ish sphere
  return Math.max(0.25, 0.17 * vdW);
}
