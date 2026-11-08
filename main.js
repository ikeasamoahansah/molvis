import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { parseMolecule } from "./parser.js";
import { elementColor, atomRadius } from "./elements.js";
import { updateLegend } from "./legend.js";
import { renderInfoPanel, computeStats } from "./info.js";
import { initBuilder, start as startBuild, stop as stopBuild, isActive, handleSceneClick, undo as undoBuild, resetHistory } from "./builder.js";
import { valenceReport } from "./chem.js";
import * as ai from "./ai.js";

// ---------------------------------------------------------------- scene ------

const canvas = document.getElementById("scene");
const viewport = document.getElementById("viewport");
const tooltip = document.getElementById("tooltip");
const statusEl = document.getElementById("status");
const infoEl = document.getElementById("info");
const styleSelect = document.getElementById("style-select");
const legendEl = document.getElementById("legend");
const infoPanel = document.getElementById("info-panel");


const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
camera.position.set(0, 0, 40);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f47, 2.0));
const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(1, 1.5, 1);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.8);
fill.position.set(-1.5, -0.5, -1);
scene.add(fill);

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// --------------------------------------------------------------- state -------

let molecule = null;         // parsed data
let moleculeGroup = null;    // meshes in the scene
let atomMeshes = [];         // for hover picking
const centerOfRotation = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const unitSphere = new THREE.SphereGeometry(1, 24, 16);
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------- building -------

function clearMolecule() {
  if (moleculeGroup) {
    moleculeGroup.traverse((o) => {
      if (o.isMesh) o.material.dispose();
    });
    scene.remove(moleculeGroup);
  }
  moleculeGroup = null;
  atomMeshes = [];
  hideTooltip();
}

function atomMaterial(el) {
  return new THREE.MeshStandardMaterial({
    color: elementColor(el),
    roughness: 0.35,
    metalness: 0.05,
  });
}

const bondMaterial = new THREE.MeshStandardMaterial({
  color: 0xb0b0b0,
  roughness: 0.4,
  metalness: 0.05,
});

// -------------------------------------------------------------- theme --------

const THEMES = {
  dark: {
    bg: 0x14161a, bond: 0xb0b0b0, title: "Switch to light mode",
    icon: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  },
  light: {
    bg: 0xeef1f5, bond: 0x70757d, title: "Switch to dark mode",
    icon: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  },
};

const themeToggle = document.getElementById("theme-toggle");

let theme =
  localStorage.getItem("molvis-theme") ??
  (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");

function applyTheme(name) {
  theme = name;
  const t = THEMES[name];
  document.documentElement.dataset.theme = name;
  scene.background.set(t.bg);
  bondMaterial.color.set(t.bond);
  themeToggle.innerHTML = t.icon;
  themeToggle.title = t.title;
  localStorage.setItem("molvis-theme", name);
}

function toggleTheme() {
  applyTheme(theme === "dark" ? "light" : "dark");
}

applyTheme(theme);
themeToggle.addEventListener("click", toggleTheme);

function addCylinder(group, from, to, radius, material) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 1e-6) return;
  const mesh = new THREE.Mesh(unitCylinder, material);
  mesh.scale.set(radius, len, radius);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.multiplyScalar(1 / len));
  group.add(mesh);
}

function addAtom(group, a, radius, index) {
  const mesh = new THREE.Mesh(unitSphere, atomMaterial(a.el));
  mesh.scale.setScalar(radius);
  mesh.position.set(a.x, a.y, a.z);
  mesh.userData = { el: a.el, x: a.x, y: a.y, z: a.z, index };
  group.add(mesh);
  atomMeshes.push(mesh);
}

function buildMolecule(mol, style, fit = true) {
  clearMolecule();
  const group = new THREE.Group();

  for (let i = 0; i < mol.atoms.length; i++) {
    addAtom(group, mol.atoms[i], atomRadius(mol.atoms[i].el, style), i);
  }

  if (style !== "spacefill") {
    const bondRadius = style === "sticks" ? 0.09 : 0.12;
    for (const { a, b, order } of mol.bonds) {
      const pa = new THREE.Vector3(mol.atoms[a].x, mol.atoms[a].y, mol.atoms[a].z);
      const pb = new THREE.Vector3(mol.atoms[b].x, mol.atoms[b].y, mol.atoms[b].z);
      const mid = pa.clone().add(pb).multiplyScalar(0.5);
      const axis = pb.clone().sub(pa).normalize();

      // perpendicular for fanning out double/triple bonds
      let perp = new THREE.Vector3(0, 1, 0).cross(axis);
      if (perp.lengthSq() < 0.01) perp = new THREE.Vector3(1, 0, 0).cross(axis);
      perp.normalize();

      const count = Math.min(order, 3);
      const spread = bondRadius * 3.2;
      for (let i = 0; i < count; i++) {
        const offsetAngle = count === 1 ? 0 : (i - (count - 1) / 2) * (count === 2 ? 1 : 2.0944);
        const off = i === 0 && count === 1
          ? new THREE.Vector3()
          : perp.clone().applyAxisAngle(axis, offsetAngle).multiplyScalar(spread);
        const ca = new THREE.Vector3(pa.x + off.x, pa.y + off.y, pa.z + off.z);
        const cb = new THREE.Vector3(pb.x + off.x, pb.y + off.y, pb.z + off.z);
        const cMid = new THREE.Vector3(mid.x + off.x, mid.y + off.y, mid.z + off.z);
        addCylinder(group, ca, cMid, bondRadius, bondMaterial);
        addCylinder(group, cMid, cb, bondRadius, bondMaterial);
      }
    }
  }

  moleculeGroup = group;
  scene.add(group);
  if (fit) fitCamera(group, style);
  updateInfo(mol);
  updateLegend(legendEl, mol);
}

function fitCamera(group, style) {
  const box = new THREE.Box3().setFromObject(group);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  centerOfRotation.copy(sphere.center);
  controls.target.copy(sphere.center);

  const fov = (camera.fov * Math.PI) / 180;
  const margin = style === "spacefill" ? 1.35 : 1.5;
  const dist = Math.max(sphere.radius / Math.sin(fov / 2) * margin, sphere.radius + 5);
  const dir = new THREE.Vector3(0.6, 0.4, 1).normalize();
  camera.near = Math.max(dist / 100, 0.05);
  camera.far = Math.max(dist * 20, 500);
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.updateProjectionMatrix();
}

function updateInfo(mol) {
  const counts = [];
  const hist = {};
  for (const a of mol.atoms) hist[a.el] = (hist[a.el] ?? 0) + 1;
  for (const [el, n] of Object.entries(hist).sort((x, y) => y[1] - x[1])) {
    counts.push(`${countLabel(el)}${n}`);
  }
  infoEl.innerHTML =
    `<strong>${escapeHtml(mol.name)}</strong> · ${mol.atoms.length} atoms` +
    (mol.bonds.length ? ` · ${mol.bonds.length} bonds` : "") +
    ` · ${counts.length ? counts.join(" ") : ""}`;
}

function countLabel(el) {
  return `<span class="elem">${el}</span>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ------------------------------------------------------------ loading --------

async function loadText(text, filename) {
  let mol;
  try {
    mol = parseMolecule(text, filename);
  } catch (err) {
    showStatus(err.message, true);
    return;
  }
  // PubChem SDFs carry the numeric CID as the title line — prefer the filename
  if (/^\d+$/.test(mol.name) && /\S/.test(filename)) {
    mol.name = filename.replace(/\.\w+$/, "").replace(/_/g, " ");
  }
  molecule = mol;
  resetHistory();
  buildMolecule(mol, styleSelect.value, true);
  document.getElementById("build-name").value = mol.name;
  renderInfoPanel(infoPanel, mol, currentSourceName);
  showStatus(`Loaded ${filename} — ${mol.format.toUpperCase()} format`);
}

async function loadFile(file) {
  if (!file) return;
  const text = await file.text();
  currentSourceName = file.name;
  await loadText(text, file.name);
}

let currentSourceName = "";

async function fetchFromPubChem(query) {
  const q = query.trim();
  if (!q) return;
  const kind = /^\d+$/.test(q) ? "cid" : "name";
  showStatus(`Fetching "${q}" from PubChem…`);
  try {
    const res = await fetch(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${kind}/${encodeURIComponent(q)}/SDF?record_type=3d`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!/V2000|V3000/.test(text)) throw new Error("unexpected response");
    currentSourceName = `${q}.sdf`;
    await loadText(text, `${q}.sdf`);
  } catch {
    showStatus(`Could not fetch "${q}" from PubChem (not found or offline).`, true);
  }
}

// ------------------------------------------------------------- UI wiring ------

document.getElementById("open-btn").addEventListener("click", () =>
  document.getElementById("file-input").click()
);

document.getElementById("file-input").addEventListener("change", (e) => {
  loadFile(e.target.files[0]);
  e.target.value = "";
});

styleSelect.addEventListener("change", () => {
  if (molecule) buildMolecule(molecule, styleSelect.value);
});

document.getElementById("sample-select").addEventListener("change", async (e) => {
  const path = e.target.value;
  e.target.value = "";
  if (!path) return;
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    currentSourceName = path.split("/").pop();
    await loadText(text, currentSourceName);
  } catch {
    showStatus(`Could not load ${path}. Serve the folder over HTTP (python3 -m http.server).`, true);
  }
});

const pubchemInput = document.getElementById("pubchem-input");
document.getElementById("pubchem-btn").addEventListener("click", () => fetchFromPubChem(pubchemInput.value));
pubchemInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") fetchFromPubChem(pubchemInput.value);
});

document.getElementById("details-btn").addEventListener("click", () =>
  infoPanel.classList.toggle("open")
);

// drag & drop
const dropOverlay = document.getElementById("drop-overlay");
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  dropOverlay.classList.add("visible");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.remove("visible"); }
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove("visible");
  loadFile(e.dataTransfer?.files?.[0]);
});

// hover tooltips + click picking
const pointerPx = { x: 0, y: 0 };
renderer.domElement.addEventListener("pointermove", (e) => {
  pointerPx.x = e.clientX;
  pointerPx.y = e.clientY;
  pointerToNDC(e.clientX, e.clientY);
});

function pointerToNDC(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((clientX - rect.left) / rect.width) * 2 - 1,
              -((clientY - rect.top) / rect.height) * 2 + 1);
}

function pickAtom(clientX, clientY) {
  pointerToNDC(clientX, clientY);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(atomMeshes, false);
  return hits.length ? hits[0].object : null;
}

// click-vs-drag: only treat quick, stationary pointer actions as clicks
let downX = 0, downY = 0, downT = 0;
renderer.domElement.addEventListener("pointerdown", (e) => {
  downX = e.clientX;
  downY = e.clientY;
  downT = performance.now();
  hideTooltip();
});

renderer.domElement.addEventListener("pointerup", (e) => {
  if (performance.now() - downT > 450 || Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
  if (!isActive()) return;
  const mesh = pickAtom(e.clientX, e.clientY);
  handleSceneClick(mesh ? mesh.userData.index : null);
});

window.addEventListener("keydown", (e) => {
  if (!isActive()) return;
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undoBuild();
  }
});

function tickPick() {
  if (!atomMeshes.length) return;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(atomMeshes, false);
  if (hits.length) {
    const d = hits[0].object.userData;
    tooltip.textContent = `${d.el} · atom #${d.index + 1} · (${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)})`;
    tooltip.style.left = `${pointerPx.x}px`;
    tooltip.style.top = `${pointerPx.y}px`;
    tooltip.classList.add("show");
  } else {
    hideTooltip();
  }
  requestAnimationFrame(tickPick);
}

function hideTooltip() { tooltip.classList.remove("show"); }
requestAnimationFrame(tickPick);

// ---------------------------------------------------------------- status ------

let statusTimer = null;
function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
  statusEl.classList.add("show");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusEl.classList.remove("show"), isError ? 6000 : 3500);
}

// initial hints until something loads (the tooltip loop above starts immediately)
renderer.domElement.addEventListener("dblclick", () => {
  if (moleculeGroup) fitCamera(moleculeGroup, styleSelect.value);
});

infoEl.innerHTML = "<strong>No molecule loaded</strong> — open a .pdb/.sdf file, drop one here, or run a sample.";

ai.loadSettings();

// ------------------------------------------------------------ build mode ------

initBuilder({
  getMolecule: () => molecule,
  rebuild: (fit) => { if (molecule) buildMolecule(molecule, styleSelect.value, fit); },
  refreshPanels: () => {
    if (!molecule) return;
    updateInfo(molecule);
    updateLegend(legendEl, molecule);
    renderInfoPanel(infoPanel, molecule, currentSourceName);
  },
  showStatus,
  feedback: aiFeedback,
  planePoint: () => {
    if (!pointer || !camera) return null;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, controls.target);
    const p = new THREE.Vector3();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, camera);
    return ray.ray.intersectPlane(plane, p) ? p : null;
  },
});

const buildBtn = document.getElementById("build-btn");
buildBtn.addEventListener("click", () => {
  if (isActive()) {
    stopBuild();
    buildBtn.classList.remove("selected");
    return;
  }
  if (!molecule) {
    molecule = { name: "Draft molecule", atoms: [], bonds: [], format: "sdf" };
    buildMolecule(molecule, styleSelect.value, false);
  }
  startBuild();
  buildBtn.classList.add("selected");
});

// --------------------------------------------------------- AI feedback UI -----

function plainToHtml(text) {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

async function aiFeedback(question) {
  if (!isActive() || !molecule) return;
  const body = document.getElementById("feedback-body");
  const stateEl = document.getElementById("feedback-state");
  const stats = computeStats(molecule);
  const issues = valenceReport(molecule);

  const issueList = issues.length
    ? `<ul>${issues.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
    : `<div class="fb-ok">No valence or connectivity issues detected (${molecule.atoms.length} atoms, ${molecule.bonds.length} bonds).</div>`;

  const molar = stats.molecularWeight
    ? `${stats.formula} · ${stats.molecularWeight.toFixed(2)} g/mol`
    : stats.formula;

  body.innerHTML = `
    <div class="fb-checks">
      <div class="fb-label">computed checks</div>
      <div class="fb-meta">${escapeHtml(molar)}</div>
      ${issueList}
    </div>
    <div id="fb-ai"></div>
    <div class="fb-inputs-sent">${question ? escapeHtml(question) : ""}</div>`;
  stateEl.textContent = "";

  const slot = document.getElementById("fb-ai");
  if (!ai.isConfigured()) {
    slot.innerHTML = `<div class="fb-note">Add an API key (sliders icon in the toolbar) for narrative coaching — built-in checks keep working without it.</div>`;
    return;
  }
  slot.textContent = "thinking…";
  stateEl.textContent = "· querying";
  try {
    const answer = question
      ? await ai.answerQuestion(molecule, issues, question)
      : await ai.structureFeedback(molecule, issues);
    stateEl.textContent = "";
    slot.innerHTML = `<div class="fb-ai">${plainToHtml(answer)}</div>`;
  } catch (err) {
    stateEl.textContent = "";
    slot.innerHTML = `<div class="fb-error">${escapeHtml(err.message)}</div>`;
  }
}

// ----------------------------------------------------------- AI settings ------

const settingsOverlay = document.getElementById("settings-overlay");
const testResult = document.getElementById("ai-test-result");

function populateSettings() {
  const s = ai.getSettings() ?? {};
  document.getElementById("ai-base").value = s.baseUrl ?? "";
  document.getElementById("ai-model").value = s.model ?? "";
  document.getElementById("ai-key").value = s.apiKey ?? "";
  testResult.textContent = "";
}

document.getElementById("settings-btn").addEventListener("click", () => {
  populateSettings();
  settingsOverlay.classList.remove("hidden");
});
document.getElementById("settings-close").addEventListener("click", () =>
  settingsOverlay.classList.add("hidden")
);
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.add("hidden");
});

document.getElementById("ai-preset").addEventListener("change", (e) => {
  const preset = ai.presetFor(e.target.value);
  if (!preset) return;
  document.getElementById("ai-base").value = preset.baseUrl;
  document.getElementById("ai-model").value = preset.model;
});

document.getElementById("ai-save").addEventListener("click", () => {
  ai.saveSettings({
    baseUrl: document.getElementById("ai-base").value.trim(),
    model: document.getElementById("ai-model").value.trim(),
    apiKey: document.getElementById("ai-key").value,
  });
  settingsOverlay.classList.add("hidden");
  showStatus(isActive() ? "AI settings saved — coach enabled" : "AI settings saved");
});

document.getElementById("ai-clear").addEventListener("click", () => {
  ai.clearSettings();
  populateSettings();
  testResult.textContent = "stored settings cleared";
});

document.getElementById("ai-test").addEventListener("click", () => {
  testResult.textContent = "testing…";
  ai.saveSettings({
    baseUrl: document.getElementById("ai-base").value.trim(),
    model: document.getElementById("ai-model").value.trim(),
    apiKey: document.getElementById("ai-key").value,
  });
  ai.testConnection()
    .then(() => { testResult.textContent = "connection ok"; })
    .catch((err) => { testResult.textContent = err.message; });
});
