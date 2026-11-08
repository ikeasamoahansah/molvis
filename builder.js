// Build mode: atom palette, bond tools, deterministic chemistry checks,
// undo stack, and SDF export. AI narrative feedback lives in ai.js; this
// module produces all the *computed* facts the AI can comment on.

import * as THREE from "three";
import { moleculeToSDF, valenceReport } from "./chem.js";

const BOND_LENGTHS = { H: 1.09, C: 1.52, N: 1.47, O: 1.43, F: 1.35, S: 1.8, Cl: 1.77, Br: 1.94, I: 2.14, P: 1.84 };

let deps = null;                 // wired in init(): { pickAtom, planePoint, rebuild, refreshPanels, showStatus, requestFeedback, getMolecule }
let bar, hintEl;                 // DOM
let active = false;
let tool = "add";                // add | bond | erase
let element = "C";
let bondOrder = 1;
let pendingA = null;             // first atom clicked in bond mode
let undoStack = [];
let feedbackTimer = null;

export function initBuilder(d) {
  deps = d;
  bar = document.getElementById("buildbar");
  hintEl = document.getElementById("build-hint");

  document.getElementById("build-close").addEventListener("click", stop);
  document.getElementById("build-new").addEventListener("click", newMolecule);
  document.getElementById("build-undo").addEventListener("click", undo);
  document.getElementById("build-export").addEventListener("click", exportSDF);

  for (const btn of bar.querySelectorAll("[data-tool]")) {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  }
  for (const btn of bar.querySelectorAll("[data-element]")) {
    btn.addEventListener("click", () => { element = btn.dataset.element; refreshBar(); });
  }
  for (const btn of bar.querySelectorAll("[data-order]")) {
    btn.addEventListener("click", () => { bondOrder = parseInt(btn.dataset.order, 10); refreshBar(); });
  }

  document.getElementById("build-name").addEventListener("input", (e) => {
    deps.getMolecule().name = e.target.value || "Draft molecule";
  });
  document.getElementById("feedback-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = document.getElementById("feedback-question").value.trim();
    document.getElementById("feedback-question").value = "";
    requestFeedback(q);
  });
}

export function start() {
  active = true;
  pendingA = null;
  bar.classList.add("open");
  card()?.classList.add("open");
  refreshBar();
  deps.feedback(null);
}

export function stop() {
  active = false;
  pendingA = null;
  bar.classList.remove("open");
  card()?.classList.remove("open");
}

export function isActive() { return active; }

function card() { return document.getElementById("feedback-card"); }

function setTool(t) {
  tool = t;
  pendingA = null;
  refreshBar();
}

function refreshBar() {
  bar.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("selected", b.dataset.tool === tool));
  bar.querySelectorAll("[data-element]").forEach((b) => b.classList.toggle("selected", b.dataset.element === element));
  bar.querySelectorAll("[data-order]").forEach((b) => b.classList.toggle("selected", +b.dataset.order === bondOrder));
  document.getElementById("build-status").textContent =
    `${deps.getMolecule().atoms.length} atoms · ${deps.getMolecule().bonds.length} bonds`;
  hintEl.textContent =
    tool === "add" ? "click empty space to place an atom · click an atom to bond off it" :
    tool === "bond" ? (pendingA === null ? "click the first atom of the new bond" : `from atom ${pendingA + 1}: click the second atom (same pair again upgrades order)`) :
    "click an atom to erase it and its bonds";
}

// -------------------------------------------------------------- editing ------

function snapshot() {
  const mol = deps.getMolecule();
  undoStack.push({
    atoms: mol.atoms.map((a) => ({ ...a })),
    bonds: mol.bonds.map((b) => ({ ...b })),
    name: mol.name,
  });
  if (undoStack.length > 60) undoStack.shift();
}

export function undo() {
  if (!active || !undoStack.length) { deps.showStatus("Nothing to undo."); return; }
  const mol = deps.getMolecule();
  const s = undoStack.pop();
  mol.atoms = s.atoms;
  mol.bonds = s.bonds;
  mol.name = s.name;
  pendingA = null;
  afterEdit("undo");
}

export function newMolecule() {
  if (active) snapshot();
  const name = document.getElementById("build-name").value || "Draft molecule";
  const mol = deps.getMolecule();
  mol.name = name;
  mol.atoms = [];
  mol.bonds = [];
  mol.format = "sdf";
  pendingA = null;
  afterEdit("cleared canvas");
}

export function handleSceneClick(atomIndex) {
  if (!active) return;
  const mol = deps.getMolecule();

  if (tool === "erase") {
    if (atomIndex === null) return;
    snapshot();
    mol.bonds = mol.bonds
      .filter((b) => b.a !== atomIndex && b.b !== atomIndex)
      .map((b) => ({
        ...b,
        a: b.a > atomIndex ? b.a - 1 : b.a,
        b: b.b > atomIndex ? b.b - 1 : b.b,
      }));
    mol.atoms.splice(atomIndex, 1);
    pendingA = null;
    afterEdit(`removed atom ${atomIndex + 1} (undo restores it)`);
    return;
  }

  if (tool === "bond") {
    if (atomIndex === null) return;
    if (pendingA === null) { pendingA = atomIndex; refreshBar(); return; }
    if (pendingA === atomIndex) { pendingA = null; refreshBar(); return; }
    snapshot();
    const existing = mol.bonds.find(
      (b) => (b.a === pendingA && b.b === atomIndex) || (b.a === atomIndex && b.b === pendingA));
    if (existing) existing.order = bondOrder;
    else mol.bonds.push({ a: pendingA, b: atomIndex, order: bondOrder });
    pendingA = null;
    afterEdit("bond added/updated");
    return;
  }

  // tool === "add"
  snapshot();
  const molEdges = mol;
  if (atomIndex !== null) {
    const a = mol.atoms[atomIndex];
    const pos = new THREE.Vector3(a.x, a.y, a.z);
    const neighbors = molEdges.bonds.map((b) => {
      const other = b.a === atomIndex ? b.b : b.b === atomIndex ? b.a : -1;
      if (other < 0) return null;
      const o = mol.atoms[other];
      return new THREE.Vector3(o.x - a.x, o.y - a.y, o.z - a.z).normalize();
    }).filter(Boolean);

    let dir;
    if (neighbors.length) {
      const sum = neighbors.reduce((s, v) => s.add(v), new THREE.Vector3());
      dir = sum.lengthSq() > 1e-6 ? sum.normalize() : new THREE.Vector3(0, 1, 0);
    } else {
      dir = new THREE.Vector3(0.3, 0.45, 1).normalize();
    }
    dir.multiplyScalar(-1); // fan new bonds away from the existing group

    const len = BOND_LENGTHS[element] ?? 1.5;
    mol.atoms.push({ el: element, x: pos.x + dir.x * len, y: pos.y + dir.y * len, z: pos.z + dir.z * len });
    mol.bonds.push({ a: atomIndex, b: mol.atoms.length - 1, order: bondOrder });
    afterEdit(`added ${element} bonded to atom ${atomIndex + 1}`);
    return;
  }

  // free placement on the plane through the current view center
  const p = deps.planePoint();
  if (!p) return;
  mol.atoms.push({ el: element, x: p.x, y: p.y, z: p.z });
  afterEdit(`placed ${element} at view center plane`);
}

function afterEdit(note) {
  deps.rebuild(false);
  refreshBar();
  deps.refreshPanels();
  deps.showStatus(`Build: ${note}`);
  scheduleFeedback(1500);
}

// ------------------------------------------------------- chemistry checks ----

export function currentIssues() {
  return valenceReport(deps.getMolecule());
}

// ------------------------------------------------------- AI feedback loop ----

function scheduleFeedback(delay = 1500) {
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => deps.feedback(null), delay);
}

export function resetHistory() {
  undoStack = [];
  pendingA = null;
}

// ---------------------------------------------------------------- export -----

export function exportSDF() {
  const mol = deps.getMolecule();
  if (!mol.atoms.length) { deps.showStatus("Nothing to export — place atoms first.", true); return; }
  const blob = new Blob([moleculeToSDF(mol)], { type: "chemical/x-mdl-molfile" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (mol.name || "molvis").replace(/\s+/g, "_").replace(/[^\w.-]/g, "") + ".sdf";
  a.click();
  URL.revokeObjectURL(a.href);
  deps.showStatus(`Exported ${(mol.name || "molvis").replace(/\s+/g, "_")}.sdf`);
}
