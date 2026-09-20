/**
 * Bounded client errors. Messages are static; server text is never copied.
 * Local failures use status 0. HTTP failures keep the response status.
 */

export type SelvrenRetryGuidance =
  | "none"
  | "read-then-decide"
  | "replay-same-idempotency"
  | "new-idempotency";

export class SelvrenIntegrationError extends Error {
  override readonly name = "SelvrenIntegrationError";
  readonly code: string;
  readonly status: number;
  readonly requestId: string | undefined;
  readonly retryGuidance: SelvrenRetryGuidance;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { requestId?: string | undefined; retryGuidance?: SelvrenRetryGuidance | undefined } = {},
  ) {
    super(message);
    this.name = "SelvrenIntegrationError";
    this.code = code;
    this.status = status;
    this.requestId = options.requestId;
    this.retryGuidance = options.retryGuidance ?? "none";
  }
}

export const CLIENT_CODES = {
  INVALID_ORIGIN: "INVALID_ORIGIN",
  INVALID_TOKEN: "INVALID_TOKEN",
  INVALID_TENANT: "INVALID_TENANT",
  INVALID_REQUEST: "INVALID_REQUEST",
  BROWSER_FORBIDDEN: "BROWSER_FORBIDDEN",
  REDIRECT_BLOCKED: "REDIRECT_BLOCKED",
  REQUEST_ABORTED: "REQUEST_ABORTED",
  REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
  STREAM_TIMEOUT: "STREAM_TIMEOUT",
  STREAM_AMBIGUOUS: "STREAM_AMBIGUOUS",
  MALFORMED_RESPONSE: "MALFORMED_RESPONSE",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

const BOUNDED_CODE = /^[A-Z][A-Z0-9_]{0,79}$/u;
const ENTERPRISE_CODE = /^ENTERPRISE_[A-Z0-9_]{1,69}$/u;
const REQUEST_ID = /^[A-Za-z0-9._:~-]{1,128}$/u;

export function boundedCode(value: unknown): string {
  return typeof value === "string" && BOUNDED_CODE.test(value)
    ? value
    : CLIENT_CODES.UNKNOWN_ERROR;
}

export function enterpriseCode(value: unknown): string | undefined {
  return typeof value === "string" && ENTERPRISE_CODE.test(value) ? value : undefined;
}

export function boundedRequestId(value: unknown): string | undefined {
  return typeof value === "string" && REQUEST_ID.test(value) ? value : undefined;
}

export function localError(
  code: string,
  message: string,
  retryGuidance: SelvrenRetryGuidance = "none",
): SelvrenIntegrationError {
  return new SelvrenIntegrationError(0, code, message, { retryGuidance });
}

export function invalidRequest(message: string): SelvrenIntegrationError {
  return localError(CLIENT_CODES.INVALID_REQUEST, message);
}

export function malformedResponse(requestId?: string): SelvrenIntegrationError {
  return new SelvrenIntegrationError(502, CLIENT_CODES.MALFORMED_RESPONSE, STATIC.malformed, {
    ...(requestId !== undefined ? { requestId } : {}),
    retryGuidance: "read-then-decide",
  });
}

export function redirectBlocked(status: number): SelvrenIntegrationError {
  return new SelvrenIntegrationError(status, CLIENT_CODES.REDIRECT_BLOCKED, STATIC.redirect, {
    retryGuidance: "none",
  });
}

export function abortedError(): SelvrenIntegrationError {
  return localError(CLIENT_CODES.REQUEST_ABORTED, STATIC.aborted, "read-then-decide");
}

export function timeoutError(kind: "json" | "stream"): SelvrenIntegrationError {
  if (kind === "stream") {
    return new SelvrenIntegrationError(504, CLIENT_CODES.STREAM_TIMEOUT, STATIC.streamTimeout, {
      retryGuidance: "read-then-decide",
    });
  }
  return new SelvrenIntegrationError(504, CLIENT_CODES.REQUEST_TIMEOUT, STATIC.requestTimeout, {
    retryGuidance: "read-then-decide",
  });
}

export function streamAmbiguous(requestId?: string): SelvrenIntegrationError {
  return new SelvrenIntegrationError(503, CLIENT_CODES.STREAM_AMBIGUOUS, STATIC.streamAmbiguous, {
    ...(requestId !== undefined ? { requestId } : {}),
    retryGuidance: "read-then-decide",
  });
}

export function httpError(
  status: number,
  code: string,
  requestId: string | undefined,
): SelvrenIntegrationError {
  return new SelvrenIntegrationError(status, code, httpMessage(status, code), {
    ...(requestId !== undefined ? { requestId } : {}),
    retryGuidance: retryGuidanceFor(code, status),
  });
}

export function streamErrorStatus(code: string): number {
  if (code === "ENTERPRISE_ACCESS_DENIED") return 403;
  if (code === "ENTERPRISE_THREAD_NOT_FOUND") return 404;
  if (code === "ENTERPRISE_CONFLICT") return 409;
  return 503;
}

export function isSelvrenIntegrationError(error: unknown): error is SelvrenIntegrationError {
  if (error instanceof SelvrenIntegrationError) return true;
  if (typeof error !== "object" || error === null) return false;
  const record = error as { name?: unknown; retryGuidance?: unknown; code?: unknown };
  return record.name === "SelvrenIntegrationError" && typeof record.code === "string";
}

/**
 * Network-ambiguous failures keep the caller UUID. Terminal message failure mints a new one.
 * `none` is not retried blindly.
 */
export function shouldReuseClientRequestId(error: unknown): boolean {
  if (isSelvrenIntegrationError(error) && error.code === CLIENT_CODES.REQUEST_ABORTED) return true;
  if (!isSelvrenIntegrationError(error)) return true;
  if (error.retryGuidance === "new-idempotency") return false;
  if (error.retryGuidance === "none") return false;
  return true;
}

export function isRetryableAgentError(error: unknown): boolean {
  if (!isSelvrenIntegrationError(error)) return true;
  return error.retryGuidance !== "none" || error.code === CLIENT_CODES.REQUEST_ABORTED;
}

function retryGuidanceFor(code: string, status: number): SelvrenRetryGuidance {
  if (code === "ENTERPRISE_MESSAGE_FAILED") return "new-idempotency";
  if (code === "PUBLIC_AGENT_BUSY") return "replay-same-idempotency";
  if (code === "PUBLIC_AGENT_CONFLICT") return "none";
  if (code === "PUBLIC_AGENT_DENIED" || code === "PUBLIC_AGENT_UNAVAILABLE") return "none";
  if (code === CLIENT_CODES.STREAM_AMBIGUOUS || code === CLIENT_CODES.STREAM_TIMEOUT) {
    return "read-then-decide";
  }
  if (code === "ENTERPRISE_STREAM_PAYLOAD_TOO_LARGE" || code === "ENTERPRISE_STREAM_TIMEOUT") {
    return "read-then-decide";
  }
  if (status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return "read-then-decide";
  }
  if (status === 409) return "read-then-decide";
  return "none";
}

function httpMessage(status: number, code: string): string {
  if (code === "PUBLIC_AGENT_DENIED") return STATIC.publicDenied;
  if (code === "PUBLIC_AGENT_UNAVAILABLE") return STATIC.publicUnavailable;
  if (code === "PUBLIC_AGENT_BUSY") return STATIC.publicBusy;
  if (code === "PUBLIC_AGENT_CONFLICT") return STATIC.publicConflict;
  if (code === "ENTERPRISE_ACCESS_DENIED" || status === 401 || status === 403) return STATIC.denied;
  if (code === "ENTERPRISE_THREAD_NOT_FOUND" || status === 404) return STATIC.notFound;
  if (code === "ENTERPRISE_CONFLICT" || status === 409) return STATIC.conflict;
  if (code === "ENTERPRISE_MESSAGE_FAILED") return STATIC.messageFailed;
  if (code === "ENTERPRISE_INVALID_REQUEST" || status === 400) return STATIC.invalid;
  return STATIC.failed;
}

const STATIC = {
  malformed: "The server response did not match the documented envelope.",
  redirect: "Redirects are not followed; credentials are not forwarded.",
  aborted: "The request was aborted.",
  requestTimeout:
    "The request timed out. Read current state before retrying. Mutations must keep the same idempotency id; do not mint a new one after an ambiguous timeout.",
  streamTimeout:
    "The stream timed out without a usable final event. GET the thread before sending again. Keep the same client_message_id if you replay; never auto-generate.",
  streamAmbiguous:
    "The stream was unusable (truncated, duplicated, or unexpected events). GET the thread before sending again. Keep the same client_message_id if you replay; never auto-generate.",
  denied: "Access was denied.",
  notFound: "The resource was not found.",
  conflict: "The resource changed. Read current revision before retrying.",
  publicDenied: "This public agent request was denied.",
  publicUnavailable: "This public agent is unavailable.",
  publicBusy: "This public agent request is already in progress.",
  publicConflict: "This public agent request conflicts with a previous question.",
  messageFailed: "This message id failed terminally. Use a new client_message_id for a new attempt.",
  invalid: "The request was rejected as invalid.",
  failed: "The request failed.",
} as const;
