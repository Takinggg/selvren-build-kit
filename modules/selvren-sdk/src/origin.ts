import { CLIENT_CODES, localError, SelvrenIntegrationError } from "./errors.js";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Integration origin: HTTPS, or HTTP on explicit loopback only.
 * Rejects userinfo, query, hash, and any non-origin path.
 */
export function assertIntegrationOrigin(baseUrl: string): string {
  if (typeof baseUrl !== "string" || baseUrl.trim() !== baseUrl || baseUrl.length < 8) {
    throw originError();
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch (error: unknown) {
    if (error instanceof SelvrenIntegrationError) throw error;
    throw originError();
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    throw originError();
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") throw originError();
  if (parsed.hostname === "") throw originError();
  const loopback = LOOPBACK.has(parsed.hostname);
  if (parsed.protocol === "https:") {
    return parsed.origin;
  }
  if (parsed.protocol === "http:" && loopback) {
    return parsed.origin;
  }
  throw originError();
}

function originError(): SelvrenIntegrationError {
  return localError(
    CLIENT_CODES.INVALID_ORIGIN,
    "SELVREN_API_URL must be an HTTPS origin (HTTP only on loopback). Userinfo, query, hash and path are rejected.",
  );
}
