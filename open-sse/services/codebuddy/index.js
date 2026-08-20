export {
  extractCodebuddyUid,
  generateStableQimei36,
  generateStableMachineId,
  generateStableSessionId,
  getCodebuddyIdentity,
  buildCodebuddyCommonFields,
  CODEBUDDY_BUILD_INFO,
  CODEBUDDY_CLI_VERSION,
} from "./identity.js";

export {
  sendCodebuddyLifecycle,
  sendCodebuddyPreChat,
  sendCodebuddyPostChat,
  sendCodebuddyGalileoCollect,
  sendCodebuddyGalileoTrace,
  fetchCodebuddyAegisWhitelist,
  ensureCodebuddyStartupTelemetry,
} from "./telemetry.js";
