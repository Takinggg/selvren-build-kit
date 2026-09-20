import { CLIENT_CODES, localError, type SelvrenIntegrationError } from "./errors.js";

/**
 * Detects a document-bearing browser (or happy-dom) runtime.
 * Service credentials must never be constructed there.
 */
export function isBrowserDocumentRuntime(): boolean {
  const globalRecord = globalThis as { window?: unknown };
  const windowValue = globalRecord.window;
  if (typeof windowValue !== "object" || windowValue === null) return false;
  return "document" in windowValue;
}

export function assertServerRuntime(): void {
  if (isBrowserDocumentRuntime()) {
    throw browserForbiddenError();
  }
}

export function browserForbiddenError(): SelvrenIntegrationError {
  return localError(CLIENT_CODES.BROWSER_FORBIDDEN, BROWSER_CLIENT_MESSAGE);
}

export const BROWSER_CLIENT_MESSAGE =
  "SelvrenIntegrationClient is server-only. Do not construct it in a browser; service tokens must stay on the server.";
