export default {
  id: "codebuddy-cn",
  // Short model prefix (cbcn/glm-5.2). "cbcn" = CodeBuddy CN; reserve "cbai"
  // for a future codebuddy-ai (intl) provider. The full id still resolves.
  alias: "cbcn",
  uiAlias: "cbcn",
  hidden: false,
  priority: 90,
  display: {
    name: "CodeBuddy CN",
    icon: "smart_toy",
    color: "#006EFF",
    website: "https://copilot.tencent.com",
    notice: {
      signupUrl: "https://copilot.tencent.com",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://copilot.tencent.com/v2/chat/completions",
    forceStream: true,
    // CodeBuddy is a unified OpenAI-compatible gateway: every model (GLM, Kimi,
    // MiniMax, DeepSeek, Hunyuan) takes reasoning via OpenAI-style reasoning_effort,
    // not its vendor-native thinking shape. Force the openai thinking format.
    thinkingFormat: "openai",
    // UA/version bumped to match real CLI @tencent-ai/codebuddy-code@2.156.0
    // (npm view … version, 2026-09-20). Older `CLI/x.y.z CodeBuddy/x.y.z` shape
    // was the pre-2.156 wire fingerprint; current bundle sends `CodeBuddyCode/1.0`.
    // Both accepted by Tencent WAF in probes; leaving the versioned string so
    // /v2/report telemetry (identity.js) still has one CLI version to advertise.
    headers: {
      "User-Agent": "CLI/2.156.0 CodeBuddy/2.156.0",
      "X-Product": "SaaS",
      "X-IDE-Type": "CLI",
      "X-IDE-Name": "CLI",
      "x-requested-with": "XMLHttpRequest",
      "x-codebuddy-request": "1",
      "X-Domain": "www.codebuddy.cn",
      "X-IDE-Version": "2.156.0",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
    // Quota endpoint differs from the chat gateway: POST returns nested Tencent
    // billing payload (data.Response.Data.Accounts[]). See services/usage/codebuddy-cn.js.
    usage: {
      url: "https://copilot.tencent.com/v2/billing/meter/get-user-resource",
    },
  },
  models: [
    { id: "deepseek-v4-pro", name: "Deepseek-V4-Pro" },
    { id: "deepseek-v4-flash", name: "Deepseek-V4-Flash" },
    { id: "deepseek-v4.1-flash", name: "Deepseek-V4.1-Flash" },
    { id: "deepseek-v3-2-volc", name: "DeepSeek-V3.2" },
    { id: "minimax-m2.5", name: "MiniMax-M2.5" },
    { id: "minimax-m3", name: "MiniMax-M3" },
    { id: "minimax-m2.7", name: "MiniMax-M2.7" },
    { id: "glm-5.3", name: "GLM-5.3" },
    { id: "glm-5.3-flash", name: "GLM-5.3-Flash" },
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "glm-5.1", name: "GLM-5.1" },
    { id: "glm-5.0", name: "GLM-5.0" },
    { id: "glm-5.0-turbo", name: "GLM-5.0-Turbo" },
    { id: "glm-5v-turbo", name: "GLM-5v-Turbo" },
    { id: "glm-4.7", name: "GLM-4.7" },
    { id: "glm-4.6", name: "GLM-4.6" },
    { id: "glm-4.6v", name: "GLM-4.6V" },
    { id: "kimi-k3-1", name: "Kimi-K3" },
    { id: "kimi-k2.8-preview", name: "Kimi-K2.8-Preview" },
    { id: "kimi-k2.7", name: "Kimi-K2.7-Code" },
    { id: "kimi-k2.6", name: "Kimi-K2.6" },
    { id: "kimi-k2.5", name: "Kimi-K2.5" },
    { id: "kimi-k2-thinking", name: "Kimi-K2-Thinking" },
    { id: "hy3", name: "Hy3" },
    { id: "hy3-x", name: "Hy3" },
    { id: "hy4-preview-f", name: "Hy4 preview" },
    { id: "hy4-preview", name: "Hy4 preview" },
    { id: "hunyuan-chat", name: "Hunyuan-Turbos" },
  ],
  oauth: {
    baseUrl: "https://copilot.tencent.com",
    stateUrl: "https://copilot.tencent.com/v2/plugin/auth/state",
    tokenUrl: "https://copilot.tencent.com/v2/plugin/auth/token",
    refreshUrl: "https://copilot.tencent.com/v2/plugin/auth/token/refresh",
    userAgent: "CLI/2.156.0 CodeBuddy/2.156.0",
    platform: "CLI",
    pollInterval: 5000,
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
