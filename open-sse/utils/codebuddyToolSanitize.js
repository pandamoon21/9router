import { recordRenamedToolNames } from "./opencodeFingerprint.js";

// CodeBuddy CN/Intl model validation quirks (measured against
// copilot.tencent.com/v2/chat/completions on 2026-09-29).
//
// 1. Tool names — the Kimi (k3-1, k2.7) and DeepSeek gateways enforce a stricter
//    name grammar than the API accepts: `^[a-zA-Z_][a-zA-Z0-9_-]*$`. A name that
//    starts with a digit (e.g. the 9Remote MCP tool `9remote_openArtifact`) is
//    rejected for the whole request with code 11152 "the tool name is invalid or
//    duplicated" — even though GLM/Hunyuan/MiniMax accept the same payload.
//    Names are rewritten to a valid spelling and restored on the response leg.
//
// 2. Tool schemas — the DeepSeek (v4-pro, v4.1-flash) gateway rejects a tool whose
//    `parameters` carries a root `$schema` key when the schema is non-trivial,
//    with code 11129 "invalid function call parameters". Stripping `$schema`
//    (Meta/JSON-Schema dialect markers carry no meaning to these validators)
//    makes the same tool pass on every model.
//
// 3. tool_choice — CodeBuddy unmarshals `tool_choice` as a Go string (11101
//    "cannot unmarshal object into Go struct field Request.tool_choice of type
//    string"). The OpenAI object forms ({type:"function",function:{name}} and
//    Claude-native {type:"auto"}) are rejected; only the string forms
//    ("auto"|"none"|"required"|"<tool-name>") are accepted. Flatten to a string.
//
// All passes are fail-open: any error leaves the body untouched.

// Mirrors the grammar the strict CodeBuddy gateways accept.
const TOOL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

// Read a tool name from either flat ({name}) or chat ({function:{name}}) shape.
function toolNameOf(tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return "";
  if (typeof tool.name === "string" && tool.name) return tool.name;
  const fn = tool.function;
  if (fn && typeof fn === "object" && typeof fn.name === "string") return fn.name;
  return "";
}

// Flatten any tool_choice shape to the string CodeBuddy accepts, or "" if the
// value carries no usable decision.
//   "auto"|"none"|"required"|"<name>"           -> unchanged
//   {type:"function",function:{name:"X"}}         -> "X"
//   {type:"tool",name:"X"} (Claude-native)        -> "X"
//   {type:"auto"|"any"|"none"}                    -> "auto"|"required"|"none"
export function flatToolChoiceName(choice) {
  if (typeof choice === "string") return choice;
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return "";
  if (typeof choice.function?.name === "string" && choice.function.name) return choice.function.name;
  if (typeof choice.name === "string" && choice.name) return choice.name;
  if (choice.type === "auto") return "auto";
  if (choice.type === "any") return "required";
  if (choice.type === "none") return "none";
  return "";
}

// Deterministic, collision-free valid name. Leading-digit / illegal-char names
// get an underscore prefix, then any residual illegal char becomes "_".
function sanitizeToolName(name, used) {
  let safe = String(name).replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!/^[a-zA-Z_]/.test(safe)) safe = `_${safe}`;
  // Guarantee uniqueness (a collision would itself trip the "duplicated" error).
  let candidate = safe;
  let n = 2;
  while (used.has(candidate)) candidate = `${safe}_${n++}`;
  used.add(candidate);
  return candidate;
}

// Rewrite one tool object in place-safe fashion, returning {tool, from, to} or null.
function renameTool(tool, rename) {
  const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : null;
  const current = fn ? fn.name : tool.name;
  if (typeof current !== "string" || TOOL_NAME_PATTERN.test(current)) return null;
  const next = sanitizeToolName(current, rename.used);
  rename.map.set(next, current);
  return fn ? { ...tool, function: { ...fn, name: next } } : { ...tool, name: next };
}

/**
 * Rename tools whose names fail CodeBuddy's grammar and fix every reference to
 * them (tool_choice, assistant tool_calls in history, Claude tool_use blocks).
 * Records the rename map so the response leg restores the client's spelling.
 *
 * @param {object} body - OpenAI Chat Completions request body
 * @param {object} [mapKey] - object to key the rename map on. chatCore looks the
 *   map up on the body it handed to the executor (translatedBody), which the
 *   executor's super.transformRequest may have already cloned — so callers pass
 *   the original body here to keep the lookup working. Defaults to `body`.
 * @returns {object} the same body (mutated) for chaining
 */
export function sanitizeCodeBuddyToolNames(body, mapKey) {
  try {
    if (!body || typeof body !== "object" || !Array.isArray(body.tools) || body.tools.length === 0) return body;

    const rename = { map: new Map(), used: new Set(body.tools.map(toolNameOf).filter(Boolean)) };
    body.tools = body.tools.map((tool) => renameTool(tool, rename) || tool);

    if (rename.map.size === 0) return body;

    // old spelling -> new spelling, for rewriting references below. `rename.map`
    // is new -> old (used by the response leg to restore the client's name).
    const forward = new Map([...rename.map].map(([next, original]) => [original, next]));

    // tool_choice is flattened to a string by flattenCodeBuddyToolChoice()
    // (run before this pass); fold any rename into it so it still points at the
    // tool name actually sent upstream.
    if (typeof body.tool_choice === "string" && forward.has(body.tool_choice)) {
      body.tool_choice = forward.get(body.tool_choice);
    }

    // History: assistant.tool_calls[].function.name and Claude tool_use blocks.
    if (Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (!msg || typeof msg !== "object") continue;
        if (Array.isArray(msg.tool_calls)) {
          msg.tool_calls = msg.tool_calls.map((tc) => {
            const name = tc?.function?.name;
            return typeof name === "string" && forward.has(name)
              ? { ...tc, function: { ...tc.function, name: forward.get(name) } }
              : tc;
          });
        }
        if (Array.isArray(msg.content)) {
          msg.content = msg.content.map((block) =>
            block?.type === "tool_use" && typeof block.name === "string" && forward.has(block.name)
              ? { ...block, name: forward.get(block.name) }
              : block);
        }
      }
    }

    recordRenamedToolNames(mapKey || body, rename.map);
    return body;
  } catch {
    return body;
  }
}

/**
 * Flatten `tool_choice` to the string CodeBuddy's gateway unmarshals into
 * (11101 rejects the OpenAI object form). No-op when absent or already a string.
 * Must run before sanitizeCodeBuddyToolNames so a forced tool name is rewritten
 * along with the declaration.
 *
 * @param {object} body - OpenAI Chat Completions request body
 * @returns {object} the same body (mutated) for chaining
 */
export function flattenCodeBuddyToolChoice(body) {
  try {
    if (!body || typeof body !== "object") return body;
    if (body.tool_choice === undefined || typeof body.tool_choice === "string") return body;
    const flat = flatToolChoiceName(body.tool_choice);
    if (flat) body.tool_choice = flat;
    else delete body.tool_choice;
    return body;
  } catch {
    return body;
  }
}

// Recursively drop `$schema` markers from a JSON schema object.
function stripSchemaMarkers(node) {
  if (!node || typeof node !== "object") return;
  delete node.$schema;
  for (const value of Object.values(node)) stripSchemaMarkers(value);
}

/**
 * Strip `$schema` from every tool's parameters. DeepSeek's gateway rejects a
 * non-trivial schema that carries one (11129); the marker is meaningless to these
 * validators, so removal is safe for all CodeBuddy models.
 *
 * @param {object} body - OpenAI Chat Completions request body
 * @returns {object} the same body (mutated) for chaining
 */
export function stripCodeBuddySchemaMarkers(body) {
  try {
    if (!Array.isArray(body?.tools)) return body;
    for (const tool of body.tools) {
      const params = tool?.function?.parameters ?? tool?.parameters ?? tool?.input_schema;
      if (params && typeof params === "object") stripSchemaMarkers(params);
    }
    return body;
  } catch {
    return body;
  }
}
