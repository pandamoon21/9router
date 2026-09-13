// kiro-cli 2.21.4 client fingerprint (Rust SDK grammar). Captured verbatim from
// real CLI traffic; see docs/03-chat-request-spec.md.
//
//   user-agent      -> business-metric tag `md/appVersion-<v>`, app name, os/lang.
//                      NO ua/2.1, NO api/.
//   x-amz-user-agent-> ua/2.1 + api/<service>/<ver> + m/<feature-flags>, NO md/.
//
// The `api/` service token differs per operation and MUST be parameterised when
// reused: `codewhispererstreaming` (GenerateAssistantResponse),
// `codewhispererruntime` (catalog / telemetry-event), `toolkittelemetry`,
// `ssooidc`. Only the inference constant is defined here.
export const KIRO_SDK_VERSION = "1.3.15";
export const KIRO_RUST_VERSION = "1.92.0";
export const KIRO_CLI_VERSION = "2.21.4";
export const KIRO_CODEWHISPERERSTREAMING_API_VERSION = "0.1.17975";

const kirosdk = `${KIRO_SDK_VERSION} ua/2.1`;

export const KIRO_CLI_USER_AGENT =
  `aws-sdk-rust/${KIRO_SDK_VERSION} os/windows lang/rust/${KIRO_RUST_VERSION} ` +
  `md/appVersion-${KIRO_CLI_VERSION} app/AmazonQ-For-CLI`;

export const KIRO_CLI_X_AMZ_USER_AGENT =
  `aws-sdk-rust/${kirosdk} api/codewhispererstreaming/${KIRO_CODEWHISPERERSTREAMING_API_VERSION} ` +
  `os/windows lang/rust/${KIRO_RUST_VERSION} m/F app/AmazonQ-For-CLI`;

export default {
  id: "kiro",
  priority: 10,
  alias: "kr",
  uiAlias: "kr",
  display: {
    name: "Kiro AI",
    icon: "psychology_alt",
    color: "#FF6B35",
    website: "https://kiro.dev",
    notice: {
      signupUrl: "https://kiro.dev",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "free",
  transport: {
    baseUrl: "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
    baseUrls: [
      "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
      "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse",
      "https://q.us-east-1.amazonaws.com/generateAssistantResponse",
    ],
    format: "kiro",
    retry: {
      "429": 0,
    },
    // Wire fingerprint of the kiro-cli 2.21.4 Rust client (captured 2026-09-13).
    // `user-agent` and `x-amz-user-agent` are deliberately DIFFERENT grammars:
    //   user-agent     : no ua/2.1, no api/, carries md/appVersion-<v>
    //   x-amz-user-agent: carries ua/2.1 + api/<service>/<ver> + m/<flags>, no md/
    // Do not unify them. The api/ token is inference-specific
    // (codewhispererstreaming); the catalog call uses codewhispererruntime and
    // telemetry uses toolkittelemetry — parameterise rather than reusing blindly.
    // See docs/03-chat-request-spec.md and 05-client-fingerprint.md.
    headers: {
      "Content-Type": "application/x-amz-json-1.0",
      Accept: "*/*",
      "User-Agent": KIRO_CLI_USER_AGENT,
      "X-Amz-User-Agent": KIRO_CLI_X_AMZ_USER_AGENT,
    },
    tokenUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken",
    authUrl: "https://prod.us-east-1.auth.desktop.kiro.dev",
    usage: {
      cwHost: "https://codewhisperer.us-east-1.amazonaws.com",
      qHost: "https://q.us-east-1.amazonaws.com",
      limitsPath: "/getUsageLimits",
    },
  },
  models: [
    // Opus (added per kiro.dev/changelog/models and kiro.dev/docs/models)
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "claude-opus-5-thinking", name: "Claude Opus 5 (Thinking)" },
    { id: "claude-opus-5-agentic", name: "Claude Opus 5 (Agentic)" },
    { id: "claude-opus-5-thinking-agentic", name: "Claude Opus 5 (Thinking + Agentic)" },
    { id: "claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "claude-opus-4.8-thinking", name: "Claude Opus 4.8 (Thinking)" },
    { id: "claude-opus-4.8-agentic", name: "Claude Opus 4.8 (Agentic)" },
    { id: "claude-opus-4.8-thinking-agentic", name: "Claude Opus 4.8 (Thinking + Agentic)" },
    { id: "claude-opus-4.7", name: "Claude Opus 4.7" },
    { id: "claude-opus-4.7-thinking", name: "Claude Opus 4.7 (Thinking)" },
    { id: "claude-opus-4.7-agentic", name: "Claude Opus 4.7 (Agentic)" },
    { id: "claude-opus-4.7-thinking-agentic", name: "Claude Opus 4.7 (Thinking + Agentic)" },
    { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-opus-4.5-thinking", name: "Claude Opus 4.5 (Thinking)" },
    { id: "claude-opus-4.5-agentic", name: "Claude Opus 4.5 (Agentic)" },
    { id: "claude-opus-4.5-thinking-agentic", name: "Claude Opus 4.5 (Thinking + Agentic)" },
    // Sonnet
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    // Haiku
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    // Non-Anthropic
    { id: "deepseek-3.2", name: "DeepSeek 3.2", strip: ["image","audio"] },
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next", strip: ["image","audio"] },
    { id: "glm-5", name: "GLM 5" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "gpt-5.6-sol", name: "GPT 5.6 Sol", contextLength: 272000, rateMultiplier: 2.4, upstreamModelId: "gpt-5.6-sol", description: "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window" },
    { id: "gpt-5.6-terra", name: "GPT 5.6 Terra", contextLength: 272000, rateMultiplier: 1.2, upstreamModelId: "gpt-5.6-terra", description: "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window" },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", contextLength: 272000, rateMultiplier: 0.6, upstreamModelId: "gpt-5.6-luna", description: "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window" },
    // Thinking variants
    { id: "claude-sonnet-5-thinking", name: "Claude Sonnet 5 (Thinking)" },
    { id: "claude-sonnet-4.5-thinking", name: "Claude Sonnet 4.5 (Thinking)" },
    { id: "claude-haiku-4.5-thinking", name: "Claude Haiku 4.5 (Thinking)" },
    { id: "gpt-5.6-sol-thinking", name: "GPT 5.6 Sol (Thinking)", contextLength: 272000, rateMultiplier: 2.4, upstreamModelId: "gpt-5.6-sol", description: "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window" },
    { id: "gpt-5.6-terra-thinking", name: "GPT 5.6 Terra (Thinking)", contextLength: 272000, rateMultiplier: 1.2, upstreamModelId: "gpt-5.6-terra", description: "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window" },
    { id: "gpt-5.6-luna-thinking", name: "GPT 5.6 Luna (Thinking)", contextLength: 272000, rateMultiplier: 0.6, upstreamModelId: "gpt-5.6-luna", description: "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window" },
    // Agentic variants
    { id: "claude-sonnet-5-agentic", name: "Claude Sonnet 5 (Agentic)" },
    { id: "claude-sonnet-4.5-agentic", name: "Claude Sonnet 4.5 (Agentic)" },
    { id: "claude-haiku-4.5-agentic", name: "Claude Haiku 4.5 (Agentic)" },
    { id: "gpt-5.6-sol-agentic", name: "GPT 5.6 Sol (Agentic)", contextLength: 272000, rateMultiplier: 2.4, upstreamModelId: "gpt-5.6-sol", description: "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window" },
    { id: "gpt-5.6-terra-agentic", name: "GPT 5.6 Terra (Agentic)", contextLength: 272000, rateMultiplier: 1.2, upstreamModelId: "gpt-5.6-terra", description: "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window" },
    { id: "gpt-5.6-luna-agentic", name: "GPT 5.6 Luna (Agentic)", contextLength: 272000, rateMultiplier: 0.6, upstreamModelId: "gpt-5.6-luna", description: "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window" },
    // Thinking + Agentic variants
    { id: "claude-sonnet-5-thinking-agentic", name: "Claude Sonnet 5 (Thinking + Agentic)" },
    { id: "claude-sonnet-4.5-thinking-agentic", name: "Claude Sonnet 4.5 (Thinking + Agentic)" },
    { id: "claude-haiku-4.5-thinking-agentic", name: "Claude Haiku 4.5 (Thinking + Agentic)" },
    { id: "gpt-5.6-sol-thinking-agentic", name: "GPT 5.6 Sol (Thinking + Agentic)", contextLength: 272000, rateMultiplier: 2.4, upstreamModelId: "gpt-5.6-sol", description: "Experimental preview of OpenAI GPT 5.6 Sol with 272k context window" },
    { id: "gpt-5.6-terra-thinking-agentic", name: "GPT 5.6 Terra (Thinking + Agentic)", contextLength: 272000, rateMultiplier: 1.2, upstreamModelId: "gpt-5.6-terra", description: "Experimental preview of OpenAI GPT 5.6 Terra with 272k context window" },
    { id: "gpt-5.6-luna-thinking-agentic", name: "GPT 5.6 Luna (Thinking + Agentic)", contextLength: 272000, rateMultiplier: 0.6, upstreamModelId: "gpt-5.6-luna", description: "Experimental preview of OpenAI GPT 5.6 Luna with 272k context window" },
  ],
  oauth: {
    ssoOidcEndpoint: "https://oidc.us-east-1.amazonaws.com",
    registerClientUrl: "https://oidc.us-east-1.amazonaws.com/client/register",
    deviceAuthUrl: "https://oidc.us-east-1.amazonaws.com/device_authorization",
    tokenUrl: "https://oidc.us-east-1.amazonaws.com/token",
    startUrl: "https://view.awsapps.com/start",
    clientName: "kiro-oauth-client",
    clientType: "public",
    scopes: [
      "codewhisperer:completions",
      "codewhisperer:analysis",
      "codewhisperer:conversations",
    ],
    grantTypes: [
      "urn:ietf:params:oauth:grant-type:device_code",
      "refresh_token",
    ],
    issuerUrl: "https://identitycenter.amazonaws.com/ssoins-722374e8c3c8e6c6",
    socialAuthEndpoint: "https://prod.us-east-1.auth.desktop.kiro.dev",
    socialLoginUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/login",
    socialTokenUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token",
    socialRefreshUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken",
    authMethods: [
      "builder-id",
      "idc",
      "google",
      "github",
      "import",
    ],
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
