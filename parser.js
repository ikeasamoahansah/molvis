// Text parsers for PDB and SDF/MOL (V2000 + V3000).
// A parsed molecule looks like:
//   { name, atoms: [{el, x, y, z}], bonds: [{a, b, order}] }  (0-based atom indices)

const TWO_LETTER_ELEMENTS = new Set([
  "Li", "Be", "Ne", "Na", "Mg", "Al", "Si", "Cl", "Ar", "Ca", "Zn", "Br",
  "Si", "Se", "He", "Ti", "Cr", "Mn", "Fe", "Co", "Ni", "Cu",
]);

function guessElementFromName(name) {
  const s = (name || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  if (!s) return "C";
  // "CL1"-style atom names encode the element before the digits
  if (s.length >= 2 && !/\d/.test(s[1]) && TWO_LETTER_ELEMENTS.has(cap2(s))) return cap2(s);
  // otherwise prefer the one-letter reading (protein "CA" = carbon)
  if (s[0] === "C" || s[0] === "N" || s[0] === "O" || s[0] === "S" || s[0] === "P" || s[0] === "H") return s[0];
  if (s.length >= 2 && TWO_LETTER_ELEMENTS.has(cap2(s))) return cap2(s);
  return s[0];
}

function cap2(s) { return s[0] + s[1].toLowerCase(); }

// Fallback covalent radii (Å) for bonding atoms by distance
const COVALENT_RADII = {
  H: 0.37, B: 0.82, C: 0.77, N: 0.75, O: 0.74, F: 0.71, Na: 1.66, Mg: 1.41,
  Si: 1.11, P: 1.06, S: 1.02, Cl: 0.99, K: 2.03, Ca: 1.76, Ti: 1.36,
  Cr: 1.27, Mn: 1.39, Fe: 1.25, Co: 1.26, Ni: 1.21, Cu: 1.38, Zn: 1.22,
  Br: 1.14, I: 1.33, Se: 1.16,
};

// Connect atom pairs that are within bonding distance (used when the file has
// no CONECT records, e.g. typical macromolecular PDBs).
function autoConnectBonds(atoms) {
  const bonds = [];
  const existing = new Set();
  const radii = atoms.map((a) => COVALENT_RADII[a.el] ?? 0.8);
  const key = (i, j) => (i < j ? `${i}-${j}` : `${j}-${i}`);
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const max = (radii[i] + radii[j]) * 1.3;
      const dx = atoms[i].x - atoms[j].x;
      if (dx > max || dx < -max) continue;
      const dy = atoms[i].y - atoms[j].y;
      if (dy > max || dy < -max) continue;
      const dz = atoms[i].z - atoms[j].z;
      if (dz > max || dz < -max) continue;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= max * max) {
        const k = key(i, j);
        if (!existing.has(k)) {
          existing.add(k);
          bonds.push({ a: i, b: j, order: 1 });
        }
      }
    }
  }
  return bonds;
}

function toFloat(s) { const v = parseFloat(s); return Number.isFinite(v) ? v : 0; }

export function detectFormat(text, filename = "") {
  const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  if (ext === "pdb" || ext === "ent") return "pdb";
  if (ext === "sdf" || ext === "sd" || ext === "mol" || ext === "mdl") return "sdf";
  if (/V2000|V3000|\$\$\$\$/.test(text)) return "sdf";
  if (/(^|\n)(ATOM|HETATM|HEADER|COMPND|CONECT|CRYST1|MODEL )/.test(text)) return "pdb";
  return "sdf";
}

// ---------------------------------------------------------------- PDB -------

export function parsePDB(text) {
  const atoms = [];
  const bonds = [];
  const serialToIndex = new Map();
  const titles = [];
  let name = "";

  for (const line of text.split(/\r?\n/)) {
    const record = line.slice(0, 6).trim().toUpperCase();

    if (record === "TITLE") {
      titles.push(line.slice(10).trim());
    } else if (record === "COMPND") {
      const t = line.slice(10).trim();
      const m = t.match(/MOLECULE:\s*([^;]+)/i);
      if (m) name = m[1].trim();
      else if (!name && t && !/^MOL_ID/i.test(t)) name = t.replace(/^\d+\s*/, "");
    } else if (record === "ATOM" || record === "HETATM") {
      // skip alternate conformations other than "A"
      const altLoc = line[16] ?? " ";
      if (altLoc !== " " && altLoc !== "A") continue;

      // element is most reliable in columns 77-78; fall back to the atom name
      let el = line.slice(76, 78).trim().toUpperCase();
      if (!/^[A-Z]{1,2}$/.test(el)) el = guessElementFromName(line.slice(12, 16));
      else el = el[0] + el.slice(1).toLowerCase();

      const serial = parseInt(line.slice(6, 11), 10);
      serialToIndex.set(serial, atoms.length);
      atoms.push({
        el,
        x: toFloat(line.slice(30, 38)),
        y: toFloat(line.slice(38, 46)),
        z: toFloat(line.slice(46, 54)),
        chain: line[21] ?? "",
        resName: line.slice(17, 20).trim(),
        resSeq: parseInt(line.slice(22, 26), 10),
        het: record === "HETATM",
      });
    } else if (record === "CONECT") {
      const from = serialToIndex.get(parseInt(line.slice(6, 11), 10));
      if (from === undefined) continue;
      for (const col of [12, 16, 20, 24]) {
        const part = line.slice(col, col + 4).trim();
        const serial = parseInt(part, 10);
        const to = serialToIndex.get(serial);
        if (to !== undefined && to !== from) bonds.push({ a: from, b: to, order: 1 });
      }
    } else if (record === "ENDMDL" && atoms.length > 0) {
      break; // only the first model of an ensemble
    }
  }

  if (titles.length) name = name || titles.join(" ");
  const mol = { name: name || "PDB molecule", atoms, bonds };
  // PDBs without CONECT (most proteins) need bonds inferred from distance
  if (bonds.length < atoms.length / 2) {
    mol.bonds = autoConnectBonds(atoms);
  }
  return mol;
}

// ---------------------------------------------------------------- SDF -------

export function parseSDF(text) {
  const isV3000 = /M\s+V30\s+BEGIN CTAB/.test(text);
  return isV3000 ? parseV3000(text) : parseV2000(text);
}

function parseV2000(text) {
  const lines = text.split(/\r?\n/);
  const name = (lines[0] || "").trim() || "SDF molecule";

  // find the counts line (in case of multi-record files, use the first record)
  let countsIdx = 3;
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    if (/^\s*\d{3}\s*\d{3}/.test(lines[i])) { countsIdx = i; break; }
  }
  const counts = lines[countsIdx] || "";
  const nAtoms = parseInt(counts.slice(0, 3), 10) || 0;
  const nBonds = parseInt(counts.slice(3, 6), 10) || 0;

  const atoms = [];
  for (let i = 0; i < nAtoms; i++) {
    const l = lines[countsIdx + 1 + i] ?? "";
    atoms.push({
      el: (l.slice(31, 34).trim() || "C"),
      x: toFloat(l.slice(0, 10)),
      y: toFloat(l.slice(10, 20)),
      z: toFloat(l.slice(20, 30)),
    });
  }

  const bonds = [];
  for (let i = 0; i < nBonds; i++) {
    const l = lines[countsIdx + 1 + nAtoms + i] ?? "";
    const a = parseInt(l.slice(0, 3), 10) - 1;
    const b = parseInt(l.slice(3, 6), 10) - 1;
    const order = parseInt(l.slice(6, 9), 10) || 1;
    if (a >= 0 && b >= 0 && a < atoms.length && b < atoms.length) {
      bonds.push({ a, b, order: order === 4 ? 2 : order }); // aromatic → treat as double
    }
  }
  return { name, atoms, bonds };
}

function parseV3000(text) {
  const lines = text.split(/\r?\n/);
  const atoms = [];
  const bonds = [];
  let mode = null;
  let name = "SDF molecule";

  const firstId = lines.findIndex((l) => /V3000/.test(l));
  if (firstId > 0 && (lines[firstId - 1] ?? "").trim() !== "") name = lines[firstId - 1].trim();

  for (const line of lines) {
    const m = line.match(/V30\s+(.*)$/);
    if (!m) continue;
    const body = m[1].trim();

    if (/^BEGIN ATOM$/i.test(body)) { mode = "atom"; continue; }
    if (/^END ATOM$/i.test(body))   { mode = null;  continue; }
    if (/^BEGIN BOND$/i.test(body)) { mode = "bond"; continue; }
    if (/^END BOND$/i.test(body))   { mode = null;  continue; }

    if (mode === "atom") {
      // "1 C -0.5 1.2 0.3 0"  — fields are space-separated
      const f = body.split(/\s+/);
      if (f.length >= 5) {
        atoms.push({ el: f[1], x: toFloat(f[2]), y: toFloat(f[3]), z: toFloat(f[4]) });
      }
    } else if (mode === "bond") {
      // "1 2 1 2" — index, order, atom1, atom2
      const f = body.split(/\s+/);
      if (f.length >= 4) {
        const a = parseInt(f[2], 10) - 1;
        const b = parseInt(f[3], 10) - 1;
        const order = parseInt(f[1], 10) || 1;
        if (a >= 0 && b >= 0 && a < atoms.length && b < atoms.length) {
          bonds.push({ a, b, order: order === 4 ? 2 : order });
        }
      }
    }
  }
  return { name, atoms, bonds };
}

// -------------------------------------------------------------- entry -------

export function parseMolecule(text, filename = "") {
  const format = detectFormat(text, filename);
  const mol = format === "pdb" ? parsePDB(text) : parseSDF(text);
  if (mol.atoms.length === 0) {
    throw new Error(`No atoms found — "${filename || "input"}" is not a valid ${format.toUpperCase()} file.`);
  }
  mol.format = format;
  return mol;
}
