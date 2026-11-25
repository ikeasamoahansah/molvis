// Pure geometry for the measure tool. Coordinates are {x, y, z} in Å.

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const len = (a) => Math.hypot(a.x, a.y, a.z);
const toDeg = (rad) => (rad * 180) / Math.PI;

export function distance(a, b) {
  return len(sub(b, a));
}

export function angle(a, b, c) {
  const u = sub(a, b);
  const v = sub(c, b);
  const cos = dot(u, v) / (len(u) * len(v));
  return toDeg(Math.acos(Math.min(1, Math.max(-1, cos))));
}

// IUPAC sign convention: positive when, looking along b→c, a is rotated clockwise to d.
export function dihedral(a, b, c, d) {
  const b0 = sub(a, b);
  const b1 = sub(c, b);
  const b2 = sub(d, c);
  const axis = scale(b1, 1 / len(b1));
  const v = sub(b0, scale(axis, dot(b0, axis)));
  const w = sub(b2, scale(axis, dot(b2, axis)));
  return toDeg(Math.atan2(dot(cross(axis, v), w), dot(v, w)));
}

// Measurement for an ordered selection of 2–4 points, or null otherwise.
export function measureSelection(points) {
  switch (points.length) {
    case 2:
      return { kind: "Distance", value: distance(points[0], points[1]), unit: "Å", decimals: 2 };
    case 3:
      return { kind: "Angle", value: angle(points[0], points[1], points[2]), unit: "°", decimals: 1 };
    case 4:
      return {
        kind: "Dihedral",
        value: dihedral(points[0], points[1], points[2], points[3]),
        unit: "°",
        decimals: 1,
      };
    default:
      return null;
  }
}
