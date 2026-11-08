// Builds a description / stats view for the loaded molecule.
import { ATOMIC_MASSES, elementColor, normalizeElement } from "./elements.js";

const WATER_RESNAMES = new Set(["HOH", "H2O", "DOD", "WAT", "TIP3", "SOL"]);

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function hex(color) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function computeStats(mol) {
  const counts = new Map();
  for (const a of mol.atoms) {
    const el = normalizeElement(a.el);
    counts.set(el, (counts.get(el) ?? 0) + 1);
  }

  let mw = 0;
  let unknown = 0;
  for (const [el, n] of counts) {
    const m = ATOMIC_MASSES[el];
    if (m) mw += m * n;
    else unknown += n;
  }

  // Hill notation: C, then H, then everything else alphabetically
  const sortedElements = [...counts.keys()].sort((a, b) => {
    if (a === "C") return -1;
    if (b === "C") return 1;
    if (a === "H") return -1;
    if (b === "H") return 1;
    return a.localeCompare(b);
  });
  const formula = sortedElements.map((el) => `${el}${counts.get(el) > 1 ? `<sub>${counts.get(el)}</sub>` : ""}`).join("");

  const orders = {};
  for (const b of mol.bonds) orders[b.order] = (orders[b.order] ?? 0) + 1;

  let minX, minY, minZ, maxX, maxY, maxZ;
  minX = minY = minZ = Infinity;
  maxX = maxY = maxZ = -Infinity;
  for (const a of mol.atoms) {
    if (a.x < minX) minX = a.x;
    if (a.x > maxX) maxX = a.x;
    if (a.y < minY) minY = a.y;
    if (a.y > maxY) maxY = a.y;
    if (a.z < minZ) minZ = a.z;
    if (a.z > maxZ) maxZ = a.z;
  }

  const chains = new Set();
  const residueKeys = new Set();
  const ligands = new Set();
  for (const a of mol.atoms) {
    if (!a.chain && !a.resSeq) continue; // SDF atoms carry no PDB residue info
    if (a.chain) chains.add(a.chain);
    if (a.resSeq) residueKeys.add(`${a.chain ?? ""}:${a.resSeq}:${a.resName ?? ""}`);
    if (a.het && a.resName && !WATER_RESNAMES.has(a.resName.toUpperCase())) ligands.add(a.resName);
  }

  return {
    counts: [...counts.entries()].sort((a, b) => b[1] - a[1]),
    formula,
    molecularWeight: mw,
    unknownElements: unknown,
    heavyAtoms: mol.atoms.length - (counts.get("H") ?? 0),
    bondOrders: orders,
    dims: { dx: maxX - minX, dy: maxY - minY, dz: maxZ - minZ },
    isPdb: mol.format === "pdb",
    chains: [...chains],
    residueCount: residueKeys.size,
    ligands: [...ligands],
    atoms: mol.atoms,
  };
}

function row(label, value) {
  if (value === undefined || value === null || value === "") return "";
  return `<div class="ip-row"><span>${label}</span><b>${value}</b></div>`;
}

function description(mol, s) {
  if (!s.isPdb) {
    let t = `Small molecule parsed from an <b>SDF/MOL</b> file. `;
    t += `It contains <b>${mol.atoms.length}</b> atoms with a molecular weight of <b>${s.molecularWeight.toFixed(2)} g/mol</b>.`;
    if (s.bondOrders[2] || s.bondOrders[3]) {
      t += ` The structure includes <b>${(s.bondOrders[2] ?? 0) + (s.bondOrders[3] ?? 0)}</b> multiple bond${(s.bondOrders[2] ?? 0) + (s.bondOrders[3] ?? 0) === 1 ? "" : "s"}, shown as fanned cylinders in the render.`;
    }
    return t;
  }
  if (s.residueCount > 4) {
    let t = `Macromolecular structure parsed from a <b>PDB</b> file: <b>${s.residueCount}</b> residues across <b>${s.chains.length || 1}</b> chain${s.chains.length > 1 ? "s" : ""}. `;
    t += `Bond lines not present in the file were inferred from covalent distances.`;
    if (s.ligands.length) t += ` Bound cofactors/ligands detected: ${s.ligands.map(esc).join(", ")}.`;
    return t;
  }
  return `Small molecule parsed from a <b>PDB</b> file (${mol.atoms.length} atoms).`;
}

export function renderInfoPanel(panel, mol, source) {
  if (!panel.querySelector(".ip-head")) {
    panel.innerHTML = `
      <div class="ip-head">
        <span>Details</span>
        <button class="ip-close" aria-label="Close details">×</button>
      </div>
      <div class="ip-body"></div>`;
    panel.querySelector(".ip-close").addEventListener("click", () => panel.classList.remove("open"));
  }
  const body = panel.querySelector(".ip-body");

  const s = computeStats(mol);
  const total = mol.atoms.length;
  const bar = s.counts
    .map(([el, n]) => `<span class="comp-seg" style="background:${hex(elementColor(el))}" title="${el}: ${n}" data-w="${(n / total) * 100}"></span>`)
    .join("");
  // correct after insertion: tiny slices need a visible min-width
  const orderBits = [];
  if (s.bondOrders[1]) orderBits.push(`${s.bondOrders[1]} single`);
  if (s.bondOrders[2]) orderBits.push(`${s.bondOrders[2]} double`);
  if (s.bondOrders[3]) orderBits.push(`${s.bondOrders[3]} triple`);
  const unknownNote = s.unknownElements
    ? ` <span class="ip-note">(${s.unknownElements} unknown element${s.unknownElements > 1 ? "s" : ""} excluded)</span>`
    : "";

  body.innerHTML = `
    <div class="ip-section">
      <div class="ip-name">${esc(mol.name)}</div>
      ${source ? `<div class="ip-source">source: ${esc(source)}</div>` : ""}
      <div class="ip-desc">${description(mol, s)}</div>
    </div>
    <div class="ip-section">
      <div class="ip-label">Composition</div>
      <div class="ip-formula">${s.formula}${unknownNote}</div>
      ${s.molecularWeight ? row("Molar mass", `${s.molecularWeight.toFixed(2)} g/mol`) : ""}
      <div class="ip-row"><span>Atoms</span><b>${total} (${s.heavyAtoms} heavy)</b></div>
      ${mol.bonds.length ? row("Bonds", `${mol.bonds.length} — ${orderBits.join(" · ")}`) : ""}
      <div class="comp-bar">${bar}</div>
    </div>
    <div class="ip-section">
      <div class="ip-label">Structure</div>
      ${row("Bounding box", `${s.dims.dx.toFixed(1)} × ${s.dims.dy.toFixed(1)} × ${s.dims.dz.toFixed(1)} Å`)}
      ${s.isPdb && s.chains.length ? row("Chains", s.chains.join(", ")) : ""}
      ${s.isPdb ? row("Residues", s.residueCount) : ""}
      ${s.isPdb && s.ligands.length ? row("Ligands", esc(s.ligands.join(", "))) : ""}
    </div>`;

  // apply min widths without polluting the shared template strings
  body.querySelectorAll(".comp-seg").forEach((segEl) => {
    const w = parseFloat(segEl.dataset.w);
    const pct = Math.min(100, Math.max(1.5, w));
    if (w < 1.5) segEl.style.setProperty("width", `${pct}%`);
    else segEl.style.width = `${w}%`;
  });

  panel.classList.add("open");
}
