// BYO-key AI feedback client (OpenAI-compatible endpoints only).
// Credentials live in localStorage and are sent only to the endpoint the user chose.

const SETTINGS_KEY = "molvis-ai-settings";
const PRESETS = {
  openai:  { baseUrl: "https://api.openai.com/v1",   model: "gpt-4o-mini",                hint: "api.openai.com — CORS enabled for browser use" },
  groq:    { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile",   hint: "api.groq.com — CORS enabled" },
  together:{ baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", hint: "api.together.xyz" },
  ollama:  { baseUrl: "http://localhost:11434/v1",   model: "llama3.2",                   hint: "start Ollama with OLLAMA_ORIGINS=* so the browser may call it" },
  custom:  { baseUrl: "",                            model: "",                           hint: "any OpenAI-compatible /chat/completions endpoint" },
};

let settings = null;

export function loadSettings() {
  try {
    settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
  } catch { settings = null; }
  return settings;
}

export function saveSettings(s) {
  settings = s;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function clearSettings() {
  settings = null;
  localStorage.removeItem(SETTINGS_KEY);
}

export function isConfigured() {
  return !!(settings?.baseUrl && settings?.model);
}

export function getSettings() {
  return settings;
}

export function presetFor(name) { return PRESETS[name]; }

// Internally: POST {baseUrl}/chat/completions  (OpenAI-compatible)
async function chat(messages, temperature = 0.35, maxTokens = 350) {
  if (!isConfigured()) throw new Error("No AI endpoint configured");
  const s = settings;
  const res = await fetch(`${s.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: s.model, messages, temperature, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message ?? ""; } catch { /* non-JSON */ }
    throw new Error(`AI request failed (HTTP ${res.status})${detail ? ": " + detail : ""}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("AI returned an empty response");
  return text;
}

export function testConnection() {
  return chat([{ role: "user", content: "Reply with exactly: ok" }], 0, 8);
}

// ---------------------------------------------------------------- prompts ----

const SYSTEM_PROMPT = [
  "You are a patient chemistry tutor standing next to a student who is assembling a small molecule in a 3D editor.",
  "You receive the current structure as an atom and bond list (0-based indices), a formula, computed molar mass, and an automatic valence report.",
  "Respond in under 130 words, plain text only, with three short labeled sections:",
  "Problems: (valence violations first, then plausibility/stereochemistry concerns; reference atoms by index, e.g. \"atom 3 (O)\").",
  "Notes: (what the structure already achieves or interesting chemistry present).",
  "Next step: one concrete, single-action suggestion.",
  "You may not see the picture; reason from the list. Never invent atoms or bonds that are not in the list.",
].join(" ");

export function moleculeContext(mol, valenceIssues) {
  const lines = [];
  lines.push(`name: ${mol.name}`);
  const atoms = mol.atoms
    .map((a, i) => `[${i}]${a.el}(${a.x.toFixed(2)},${a.y.toFixed(2)},${a.z.toFixed(2)})`)
    .join(" ");
  lines.push(`atoms(${mol.atoms.length}): ${atoms}`);
  const bonds = mol.bonds.map((b) => `${b.a}-${b.b}(${b.order})`).join(" ");
  lines.push(`bonds(${mol.bonds.length}): ${bonds || "none"}`);
  if (valenceIssues?.length) lines.push(`automatic valence report: ${valenceIssues.join("; ")}`);
  else lines.push("automatic valence report: all atom valences within common limits");
  return lines.join("\n");
}

export function structureFeedback(mol, valenceIssues) {
  return chat([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: moleculeContext(mol, valenceIssues) +
        "\n\nGive your three-part feedback for the current structure.",
    },
  ]);
}

export function answerQuestion(mol, valenceIssues, question) {
  return chat([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: moleculeContext(mol, valenceIssues) +
        `\n\nThe student asks: ${question}\nAnswer briefly (under 100 words), grounding every claim in the list.`,
    },
  ]);
}
