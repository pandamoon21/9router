// One-shot: regenerate tests/__baseline__/known-fails.txt from the vitest JSON report.
// NOTE: the gate (verify-no-regression.mjs) only matches on the test name — its own
// file-path extraction is broken for any absolute path that does not contain "/app/".
// Entries therefore carry "<file> :: <name>" for readability, but the gate reads the
// full line as the key, so it intends "<file> :: <name>" too; see _KNOWN_FAILS_FIX.
// Usage: node scripts/_regen-known-fails.mjs
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2] || "tests/__baseline__/current.json";
const out = process.argv[3] || "tests/__baseline__/known-fails.txt";

const r = JSON.parse(readFileSync(src, "utf8"));
const lines = r.testResults
  .flatMap((f) =>
    f.assertionResults
      .filter((a) => a.status === "failed")
      .map((a) => {
        const p = String(f.name || "").replace(/\\/g, "/");
        const i = p.indexOf("/tests/");
        const rel = i >= 0 ? p.slice(i + 1) : p.split("/").slice(-2).join("/");
        return `${rel} :: ${a.fullName}`;
      })
  )
  .sort();

writeFileSync(out, lines.join("\n") + "\n");
console.log(`known-fails.txt -> ${lines.length} entries`);
