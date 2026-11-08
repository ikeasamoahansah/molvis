// Pure chemistry helpers with no DOM / three.js dependencies (unit-testable).

// Common maximum valences used for consistency warnings.
const MAX_VALENCE = { H: 1, B: 3, C: 4, N: 4, O: 2, F: 1, Al: 3, Si: 4, P: 5, S: 6, Cl: 1, Br: 1, I: 1 };

function cap(s, width) { return String(s).padStart(width, " "); }
function fix(v, width) { return v.toFixed(4).padStart(width, " "); }

/**
 * Returns a list of human-readable valence issues:
 * - over-valent atoms (bonds exceed the common maximum for the element)
 * - isolated atoms (no bonds at all, informational)
 */
export function valenceReport(mol) {
  const issues = [];
  if (mol.atoms.length === 0) return issues;

  const sums = new Array(mol.atoms.length).fill(0);
  const neighborCount = new Array(mol.atoms.length).fill(0);
  for (const b of mol.bonds) {
    if (b.a < 0 || b.b < 0 || b.a >= sums.length || b.b >= sums.length) continue;
    if (b.a === b.b) continue;
    sums[b.a] += b.order;
    sums[b.b] += b.order;
    neighborCount[b.a] += 1;
    neighborCount[b.b] += 1;
  }

  for (let i = 0; i < mol.atoms.length; i++) {
    const el = mol.atoms[i].el;
    const max = MAX_VALENCE[el];
    if (max !== undefined && sums[i] > max) {
      issues.push(`atom [${i}] (${el}) has total bond order ${sums[i]} (max ${max} for ${el})`);
    }
    if (neighborCount[i] === 0 && mol.atoms.length > 1) {
      issues.push(`atom [${i}] (${el}) is not bonded to anything`);
    }
  }
  return issues;
}

/**
 * Serializes a molecule to V2000 SDF.
 */
export function moleculeToSDF(mol) {
  const counts =
    cap(mol.atoms.length, 3) + cap(mol.bonds.length, 3) +
    "  0  0  0  0  0  0  0  0999 V2000";
  const atomLines = mol.atoms
    .map((a) => `${fix(a.x, 10)}${fix(a.y, 10)}${fix(a.z, 10)} ${cap(a.el, 3).trimEnd()}`.trimEnd() + `  0  0  0  0  0  0  0  0  0  0  0  0`);
  const bondLines = mol.bonds
    .map((b) => `${cap(b.a + 1, 3)}${cap(b.b + 1, 3)}${cap(Math.min(Math.max(b.order, 1), 3), 3)}  0`);
  return [
    mol.name ?? "molvis",
    "  molvis",
    "",
    counts,
    ...atomLines,
    ...bondLines,
    "M  END",
    "$$$$",
    "",
  ].join("\n");
}
