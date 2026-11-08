import { elementColor, VDW_RADII, normalizeElement } from "./elements.js";

const BOND_GRAY = "#b0b0b0"; // matches the bond material used in the scene

function bondSvg(count) {
  // one, two, or three gray parallel strokes, like fanned cylinders in the scene
  const w = 36;
  const ys = count === 1 ? [10] : count === 2 ? [5.5, 14.5] : [3, 10, 17];
  const lines = ys
    .map((y) => `<line x1="4" y1="${y}" x2="${w - 4}" y2="${y}" stroke="${BOND_GRAY}" stroke-width="${count === 1 ? 3 : 2.2}" stroke-linecap="round"/>`)
    .join("");
  return `<svg width="${w}" height="20" viewBox="0 0 ${w} 20">${lines}</svg>`;
}

function buildSkeleton(root) {
  root.innerHTML = `
    <div class="legend-head">
      <span>Legend</span>
      <button id="legend-toggle" aria-label="Collapse legend">–</button>
    </div>
    <div class="legend-body">
      <div class="legend-section" id="legend-atoms">
        <div class="legend-label">Atoms (CPK)</div>
        <div class="legend-chips"></div>
      </div>
      <div class="legend-section" id="legend-bonds">
        <div class="legend-label">Bonds</div>
        <div class="bond-list">
          <div class="bond-row"><span class="bond-glyph">${bondSvg(1)}</span> single</div>
          <div class="bond-row"><span class="bond-glyph">${bondSvg(2)}</span> double</div>
          <div class="bond-row"><span class="bond-glyph">${bondSvg(3)}</span> triple</div>
        </div>
      </div>
    </div>`;

  const btn = root.querySelector("#legend-toggle");
  btn.addEventListener("click", () => {
    const collapsed = root.classList.toggle("collapsed");
    btn.textContent = collapsed ? "+" : "–";
  });
}

// Show CPK chips for the elements actually present in the loaded molecule.
export function updateLegend(root, mol) {
  if (!root.querySelector(".legend-head")) buildSkeleton(root);
  root.classList.add("visible");

  const chips = root.querySelector(".legend-chips");
  const counts = new Map();
  for (const a of mol?.atoms ?? []) {
    const el = normalizeElement(a.el);
    counts.set(el, (counts.get(el) ?? 0) + 1);
  }

  if (counts.size === 0) {
    chips.innerHTML = `<span class="legend-empty">Open a molecule to see its elements</span>`;
    return;
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  chips.innerHTML = sorted
    .map(([el, n]) => {
      const color = `#${elementColor(el).toString(16).padStart(6, "0")}`;
      const note = VDW_RADII[el] ? "" : " (approx.)";
      return `<div class="chip" title="${el} — ${n} atom${n === 1 ? "" : "s"}${note}">
        <span class="swatch" style="background:${color}"></span>${el}
      </div>`;
    })
    .join("");
}

export { buildSkeleton };
