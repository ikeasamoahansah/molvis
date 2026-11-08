# molvis

A minimal 3D molecule visualizer for the browser. Supports **PDB** and
**SDF/MOL** (V2000 and V3000) files — view, measure, build, and export, with
an optional AI chemistry coach (bring your own API key).

## Running

The app is a pure static site — no build step, no dependencies to install.
Serve the folder with any static file server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

(ES modules require HTTP; opening `index.html` over `file://` won't work.)

## Deploying

Host it anywhere static hosting works — Vercel, Netlify, GitHub Pages:

- **Vercel (recommended flow):** push this repo to GitHub, then
  [import it in the Vercel dashboard](https://vercel.com/new) — framework
  detection: *Other*, build command: (none), output directory: `.`.
- **Vercel CLI:** `npx vercel` from this folder.
- **GitHub Pages:** Settings → Pages → deploy from branch `main`
  (`/root`).

## Usage

- **Open button** (folder icon) — pick a `.pdb`, `.ent`, `.sdf`, `.sd`, `.mol`
  or `.mdl` file.
- **Drag & drop** — drop a file anywhere on the page.
- **Samples menu** — load a bundled molecule (caffeine, aspirin, ethanol,
  crambin 1CRN).
- **PubChem box** — type a trivial name or CID (e.g. `caffeine` or `2244`) and
  hit Fetch to pull 3D coordinates from the
  [PubChem REST API](https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest).

### Viewing

| Control | Action |
|---|---|
| Left drag | rotate |
| Scroll / pinch | zoom |
| Right drag | pan |
| Hover | atom tooltip (element, index, coordinates) |
| Double-click | re-center and re-fit the camera |

Three render styles: **Ball & stick** (default), **Spacefill** (van der Waals),
and **Sticks**. Atom colors follow CPK convention; bonds are split into two
half-colored cylinders; double/triple bonds from SDF files are fanned out into
parallel cylinders.

### Details panel

Opens automatically on every load (and can be toggled with the details
button in the toolbar). It is derived from the parsed file only, so everything updates when
you load a new molecule:

- **Description** — a generated summary; for SDF files it describes the small
  molecule, for PDB proteins it reports residues/chains and any inferred bonds
  and bound ligands (water molecules are filtered out).
- **Composition** — molecular formula in Hill notation, molar mass (from a
  standard atomic-mass table), total and heavy atom count, bond counts by
  order, and a proportional color bar of the element make-up.
- **Structure** — bounding box dimensions in Å, plus chain IDs, residue count,
  and ligand names for PDB files. Unknown elements (those missing from the
  mass table) are excluded from the molar mass and noted.

### Legend

A bottom-right legend shows CPK color chips for the elements present in the
current molecule and glyph samples for single/double/triple bonds. Collapsible
via the `–` button in its header.

### Appearance

The theme button in the toolbar toggles light and dark mode. The choice is
remembered in `localStorage` (first visit follows your OS `prefers-color-scheme`),
and it recolors the CSS theme plus the Three.js scene background and bond gray.

## Build mode

The pencil icon toggles an editor for constructing molecules from scratch or
editing a loaded one:

- **add** — click empty space to place the selected element on the plane
  facing the camera, or click an existing atom to bond a new atom off it
  (placed along a sensible direction away from its other bonds). Pick the
  1/2/3 buttons for single/double/triple bonds.
- **bond** — click two atoms in sequence; clicking an existing pair again
  upgrades its order.
- **erase** — click an atom to remove it and its bonds.
- **undo** (button or Ctrl+Z), **new** (clear canvas), **export** (writes a
  V2000 `.sdf` you can reload here or open in any chemistry program).

Every edit runs a deterministic valence check (over-valent atoms, isolated
atoms) in the build bar; the formula and molar mass update live.

## AI coach (bring your own key)

The sliders icon opens AI settings. The app talks to any
OpenAI-compatible `/chat/completions` endpoint — OpenAI, Groq, Together, a
local Ollama server, or a custom one. The key is stored in `localStorage`
and sent only to the base URL you configure; nothing is proxied elsewhere.

When build mode is active, edits (debounced ~1.5 s) send the model the
atom/bond list plus the computed valence report and the coach card replies
with three short sections: problems (referenced by atom index), notes on what
the structure achieves, and one concrete next step. The free-form "ask" box
answers questions grounded in the same list.

Design boundary: all numbers (valences, formula, mass, coordinates) are
computed locally; the model only narrates and suggests.

## How it works

- `parser.js` — pure text parsers. PDB: `ATOM`/`HETATM` coordinates (element
  taken from columns 77–78 when present, otherwise inferred from the atom name;
  first `MODEL` only) plus `CONECT` bond records; chain/residue/ligand data is
  carried per atom for the details panel. SDF: counts/atom/bond blocks for
  V2000, and `M  V30 BEGIN ATOM/BOND` blocks for V3000. Format is detected
  from the file extension first, then from content.
- `elements.js` — CPK colors, van der Waals radii, and standard atomic masses.
- `info.js` — derived molecule description: formula, molar mass, composition
  bar, bond orders, bounding box, chains/residues/ligands for PDB.
- `legend.js` — the CPK color / bond-order legend.
- `builder.js` — build-mode editing state machine (add/bond/erase, undo,
  element palette, placement planes).
- `chem.js` — pure, dependency-free chemistry: valence rules/checks and the
  V2000 SDF writer (unit-testable in Node).
- `ai.js` — BYO-key OpenAI-compatible client, settings storage, prompt and
  context serialization for the AI coach.
- `main.js` — Three.js scene, orbit controls, picking, light/dark theme,
  file/sample/PubChem loading, style switching, build/AI wiring.

## Known limitations

- Element inference from PDB atom *names* (when the element column is missing)
  is heuristic: protein `"CA"` is read as carbon, not calcium.
- PDB bond orders are always single (CONECT has no order information).
- No implicit-hydrogen or valence repair: only explicit atoms/bonds are shown.
