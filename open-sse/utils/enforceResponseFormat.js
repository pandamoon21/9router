// CodeBuddy upstream (cn + intl) is stream-only and ignores/breaks on
// response_format: models answer in prose when it is present, even with the
// schema riding in the system message (verified empirically on the CN gateway).
// The only lever these models actually follow is a JSON directive inside the
// LAST user message. This helper drops response_format from the body and
// mirrors the schema/directive into the last user text instead.
//
// Pure function: returns a new body only when a change is needed, otherwise
// returns the same reference so callers may keep mutating in place.

function buildDirective(rf) {
  if (rf.type === "json_object") return "Respond only in valid JSON.";
  if (rf.type === "json_schema") {
    const schema = rf.json_schema?.schema ?? rf.json_schema;
    if (schema) {
      return `You must respond with valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}`;
    }
  }
  return "";
}

export function enforceResponseFormat(body) {
  const rf = body?.response_format;
  if (!rf || (rf.type !== "json_schema" && rf.type !== "json_object")) return body;
  if (!Array.isArray(body.messages)) return body;

  const directive = buildDirective(rf);
  if (!directive) return body;

  const messages = body.messages.map((m) => ({ ...m }));
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    const content = msg.content;
    if (typeof content === "string") {
      msg.content = `${content}\n\n${directive}`;
    } else if (Array.isArray(content)) {
      const parts = content.map((p) => ({ ...p }));
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j];
        if (part?.type === "text" && typeof part.text === "string") {
          parts[j] = { ...part, text: `${part.text}\n\n${directive}` };
          break;
        }
      }
      msg.content = parts;
    }
    break;
  }

  const { response_format, ...rest } = body;
  return { ...rest, messages };
}
