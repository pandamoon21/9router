// CodeBuddy international (codebuddy.ai) — mirrors codebuddy-cn registry shape,
// swapping the Tencent CN domain for the .ai endpoint set. All OAuth/plugin URLs
// use the /v2/plugin prefix with platform=ide (CN uses platform=CLI).
export default {
  id: "codebuddy-intl",
  alias: "cbai",
  uiAlias: "cbai",
  hidden: false,
  priority: 90,
  display: {
    name: "CodeBuddy",
    icon: "smart_toy",
    color: "#006EFF",
    website: "https://www.codebuddy.ai",
    notice: {
      signupUrl: "https://www.codebuddy.ai",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    // Chat gateway is OpenAI-compatible SSE (same /v2/chat/completions path as CN).
    baseUrl: "https://www.codebuddy.ai/v2/chat/completions",
    forceStream: true,
    // CodeBuddy intl speaks the same unified OpenAI reasoning_effort shape as CN.
    thinkingFormat: "openai",
    headers: {
      "User-Agent": "IDE/2.133.1 CodeBuddy/2.133.1",
      "X-Product": "SaaS",
      "X-IDE-Type": "IDE",
      "X-IDE-Name": "IDE",
      "x-requested-with": "XMLHttpRequest",
      "x-codebuddy-request": "1",
    "X-Domain": "www.codebuddy.ai",
    "X-IDE-Version": "2.133.1",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
    // Intl billing endpoint mirrors CN shape (data.Response.Data.Accounts[]).
    usage: {
      url: "https://www.codebuddy.ai/v2/billing/meter/get-user-resource",
    },
  },
  // Same model lineup exposed by the CN gateway — intl backend is the same catalog.
  models: [
    { id: "deep-model", name: "Deep" },
    { id: "deepseek-v4.1-flash", name: "Deepseek-V4.1-Flash" },
    { id: "deepseek-v4.1-flash-sg", name: "Deepseek-V4.1-Flash" },
    { id: "gpt-6-astra", name: "GPT-6-Astra" },
    { id: "hy4-preview", name: "Hy4 preview" },
    { id: "hy3", name: "Hy3" },
    { id: "kimi-k2.8-preview", name: "Kimi-K2.8-Preview" },
    { id: "gpt-5.6-sol", name: "GPT-5.6-Sol" },
    { id: "gpt-5.6-terra", name: "GPT-5.6-Terra" },
    { id: "gpt-5.6-luna", name: "GPT-5.6-Luna" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gemini-3.5-flash", name: "Gemini-3.5-Flash" },
    { id: "glm-5.3", name: "GLM-5.3" },
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "kimi-k3", name: "Kimi-K3" },
    { id: "kimi-k2.6", name: "Kimi-K2.6" },
  ],
  oauth: {
    baseUrl: "https://www.codebuddy.ai",
    stateUrl: "https://www.codebuddy.ai/v2/plugin/auth/state",
    tokenUrl: "https://www.codebuddy.ai/v2/plugin/auth/token",
    refreshUrl: "https://www.codebuddy.ai/v2/plugin/auth/token/refresh",
    userAgent: "IDE/2.133.1 CodeBuddy/2.133.1",
    platform: "ide",
    pollInterval: 5000,
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
