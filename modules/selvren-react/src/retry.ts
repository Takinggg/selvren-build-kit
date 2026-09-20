export type RetryGuidance = "none" | "read-then-decide" | "replay-same-idempotency" | "new-idempotency";

interface GuidedError {
  readonly name: string;
  readonly retryGuidance: RetryGuidance;
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isRequestAborted(error: unknown): boolean {
  return isAbortError(error) || errorCode(error) === "REQUEST_ABORTED";
}

function asGuided(error: unknown): GuidedError | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as { name?: unknown; retryGuidance?: unknown };
  if (typeof record.retryGuidance !== "string") return undefined;
  if (
    record.retryGuidance !== "none" &&
    record.retryGuidance !== "read-then-decide" &&
    record.retryGuidance !== "replay-same-idempotency" &&
    record.retryGuidance !== "new-idempotency"
  ) {
    return undefined;
  }
  return { name: typeof record.name === "string" ? record.name : "", retryGuidance: record.retryGuidance };
}

export function shouldReuseClientRequestId(error: unknown): boolean {
  if (isRequestAborted(error)) return true;
  const guided = asGuided(error);
  if (guided === undefined) return true;
  if (guided.retryGuidance === "new-idempotency") return false;
  if (guided.retryGuidance === "none") return false;
  return true;
}

export function isRetryableAgentError(error: unknown): boolean {
  if (isRequestAborted(error)) return true;
  const guided = asGuided(error);
  if (guided === undefined) return true;
  return guided.retryGuidance !== "none";
}

export function errorDisplayText(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null) return fallback;
  const record = error as { name?: unknown; message?: unknown };
  if (record.name !== "SelvrenIntegrationError") return fallback;
  if (typeof record.message !== "string" || record.message.length < 1 || record.message.length > 300) {
    return fallback;
  }
  if (record.message.includes("<") || record.message.includes("selvren_int_")) return fallback;
  return record.message;
}
