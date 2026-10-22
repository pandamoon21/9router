import { AI_PROVIDERS } from "@/shared/constants/providers";

export function usesAwsCredentialForm(provider) {
  return AI_PROVIDERS[provider]?.credentialForm === "aws";
}

export function toProviderConnectionResponse(connection) {
  const { apiKey, accessToken, refreshToken, idToken, ...safe } = connection;
  // The tokens themselves never leave the server, but the dashboard needs to
  // know whether a renewable credential exists at all (CodeBuddy shows
  // "no refresh token" instead of waiting for the access token to die).
  safe.hasRefreshToken = !!refreshToken;
  safe.hasAccessToken = !!accessToken;

  if (!usesAwsCredentialForm(connection.provider) || !connection.providerSpecificData) {
    return safe;
  }

  const { sessionToken, ...providerSpecificData } = connection.providerSpecificData;
  return { ...safe, providerSpecificData };
}
