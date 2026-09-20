/**
 * Service-token parser for SelvrenIntegrationClient. Server-only.
 * Must not be imported from the browser entry or session transport.
 */
import { CLIENT_CODES, localError } from "./errors.js";

export const TOKEN = /^selvren_int_[A-Za-z0-9_-]{16,256}$/u;

export function parseToken(value: string): string {
  if (typeof value !== "string" || !TOKEN.test(value)) {
    throw localError(
      CLIENT_CODES.INVALID_TOKEN,
      "tokenProvider must return a selvren_int_* secret; it is never placed in a URL or log.",
    );
  }
  return value;
}
