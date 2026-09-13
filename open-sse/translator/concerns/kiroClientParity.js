/**
 * kiro-cli client parity helpers.
 *
 * Values here are lifted from a captured kiro-cli 2.21.4 session so both Kiro
 * request translators (openai→kiro, claude→kiro) emit the same body shape the
 * real client does. See docs/03-chat-request-spec.md in the research repo.
 */
import { v4 as uuidv4 } from "uuid";

/**
 * The client always sets envState on the current message, e.g.
 *   {"operatingSystem": "windows", "currentWorkingDirectory": "C:\\...\\repo"}
 *
 * `operatingSystem` is an API enum (lowercase `windows`/`linux`/`macos`), NOT
 * Node's `process.platform` value (`win32`/`darwin`). Only these two keys were
 * ever observed.
 */
export function buildKiroEnvState(cwd = process.cwd()) {
  const platform = process.platform;
  const operatingSystem =
    platform === "win32" ? "windows" :
    platform === "darwin" ? "macos" :
    "linux";
  return { operatingSystem, currentWorkingDirectory: cwd };
}

/**
 * `origin` is `KIRO_CLI` on every userInputMessage the real client sends
 * (the IDE uses `AI_EDITOR`; this provider emulates the CLI).
 */
export const KIRO_CLI_ORIGIN = "KIRO_CLI";

/**
 * `agentTaskType` is `vibe` for the default agent and `spec` in plan mode.
 */
export const KIRO_CLI_AGENT_TASK_TYPE = "vibe";

/**
 * A fresh continuation id per turn. Must NOT reuse the conversationId.
 */
export function newKiroAgentContinuationId() {
  return uuidv4();
}
