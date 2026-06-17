import { randomBytes } from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export const ROHLIK_MCP_URL = "https://mcp.rohlik.cz/mcp";

export const OAUTH_COOKIE = "rohlik_oauth"; // transient flow state
export const SESSION_COOKIE = "rohlik_session"; // tokens

export interface RohlikOAuthState {
  redirectUri: string;
  clientInformation?: OAuthClientInformationMixed;
  codeVerifier?: string;
  state?: string;
  tokens?: OAuthTokens;
}

// What we persist in the SESSION_COOKIE after a successful sign-in.
export interface RohlikSession {
  clientInformation?: OAuthClientInformationMixed;
  tokens: OAuthTokens;
  redirectUri: string;
}

/**
 * OAuthClientProvider for the Rohlik MCP server, backed by a plain state object
 * that the route handlers serialize into encrypted cookies. The SDK drives
 * discovery, dynamic client registration, PKCE and token refresh; this class
 * just stores/loads the pieces and captures the authorization URL.
 */
export class RohlikOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | null = null;
  private readonly _state: RohlikOAuthState;
  private readonly _onTokens?: (tokens: OAuthTokens) => void;

  constructor(state: RohlikOAuthState, onTokens?: (tokens: OAuthTokens) => void) {
    this._state = { ...state };
    this._onTokens = onTokens;
    if (!this._state.state) {
      this._state.state = randomBytes(24).toString("base64url");
    }
  }

  get redirectUrl(): string {
    return this._state.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Spajz",
      redirect_uris: [this._state.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return this._state.state!;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this._state.clientInformation;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this._state.clientInformation = info;
  }

  tokens(): OAuthTokens | undefined {
    return this._state.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this._state.tokens = tokens;
    this._onTokens?.(tokens);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(verifier: string): void {
    this._state.codeVerifier = verifier;
  }

  codeVerifier(): string {
    if (!this._state.codeVerifier) {
      throw new Error("Missing PKCE code verifier");
    }
    return this._state.codeVerifier;
  }

  get snapshot(): RohlikOAuthState {
    return this._state;
  }
}
