/**
 * Runtime-neutral HTTP primitives shared by session and service transports.
 * Must not import the service client, service transport, or parseToken.
 */
import {
  abortedError,
  boundedCode,
  boundedRequestId,
  httpError,
  invalidRequest,
  redirectBlocked,
  SelvrenIntegrationError,
  timeoutError,
} from "./errors.js";

export const JSON_TIMEOUT_MS = 60_000;
export const READ_TIMEOUT_MS = 15_000;
export const STREAM_TIMEOUT_MS = 145_000;
export const JSON_MAX_BYTES = 1_048_576;
export const PREHEADER_MAX_BYTES = 16 * 1024;

export interface JsonExchange {
  readonly status: number;
  readonly requestId: string | undefined;
  readonly body: unknown;
}

export interface ComposedAbort {
  readonly signal: AbortSignal;
  timedOut(): boolean;
  cleanup(): void;
}

export function composeAbort(timeoutMs: number, caller: AbortSignal | undefined): ComposedAbort {
  const controller = new AbortController();
  let timedOut = false;
  if (caller?.aborted) {
    controller.abort();
    return { signal: controller.signal, timedOut: () => false, cleanup: () => undefined };
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = (): void => {
    controller.abort();
  };
  caller?.addEventListener("abort", onCallerAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    },
  };
}

export function isAbortError(error: unknown): error is Error {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function signalAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Resolves `source` or rejects with AbortError as soon as `signal` aborts.
 * Removes the abort listener on settlement. A late rejection of `source`
 * is absorbed so it cannot become an unhandled rejection after abort.
 */
export function awaitWithAbort<T>(source: Promise<T>, signal: AbortSignal): Promise<T> {
  const absorbLate = (): void => {
    void source.then(
      () => undefined,
      () => undefined,
    );
  };
  if (signal.aborted) {
    absorbLate();
    return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      absorbLate();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    source.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          absorbLate();
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        reject(error instanceof Error ? error : new Error("operation failed"));
      },
    );
  });
}

export function joinUrl(origin: string, path: string): string {
  return `${origin}${path}`;
}

export async function completeJsonResponse(
  response: Response,
  signal: AbortSignal,
  empty: boolean,
): Promise<JsonExchange> {
  assertNoRedirect(response);
  const raw = await readBoundedText(response, signal, JSON_MAX_BYTES);
  const body = parseJsonOrNull(raw);
  const requestId = requestIdOf(body);
  if (empty) {
    if (response.status !== 204) throw httpFromBody(response.status, body, requestId);
    return { status: 204, requestId, body: null };
  }
  if (!response.ok) throw httpFromBody(response.status, body, requestId);
  return { status: response.status, requestId, body };
}

export function mapTransportError(
  error: unknown,
  composed: ComposedAbort,
  kind: "json" | "stream",
): Error {
  if (error instanceof SelvrenIntegrationError) return error;
  if (isAbortError(error)) {
    return composed.timedOut() ? timeoutError(kind) : abortedError();
  }
  return error instanceof Error ? error : abortedError();
}

export function assertNoRedirect(response: Response): void {
  if (response.type === "opaqueredirect" || isRedirectStatus(response.status)) {
    throw redirectBlocked(response.status === 0 ? 302 : response.status);
  }
}

export function assertTokenNotInUrl(url: string, token: string): void {
  if (token.length > 0 && url.includes(token)) {
    throw invalidRequest("The access token is never placed in a URL or log.");
  }
}

export async function readBoundedText(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
): Promise<string> {
  const declared = contentLength(response);
  if (declared !== undefined && declared > maxBytes) {
    throw httpError(response.status, "PAYLOAD_TOO_LARGE", undefined);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    for (let reads = 0; reads < maxBytes + 8; reads += 1) {
      const chunk = await readWithAbort(reader, signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw httpError(response.status, "PAYLOAD_TOO_LARGE", undefined);
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error: unknown) {
    if (isAbortError(error)) throw error;
    if (error instanceof SelvrenIntegrationError) throw error;
    return text.slice(0, maxBytes);
  } finally {
    cancelReader(reader);
  }
}

export function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (body === null) return;
  try {
    cancelReader(body.getReader());
  } catch {
    // Getting or canceling a reader must not replace the original safe error.
  }
}

export function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Cancel rejection or a synchronous throw must not replace the original safe error.
  }
  try {
    reader.releaseLock();
  } catch {
    // Lock release is best-effort after cancel.
  }
}

export function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Stream aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      reject(new DOMException("Stream aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (chunk) => {
        signal.removeEventListener("abort", onAbort);
        resolve(chunk);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error("stream read failed"));
      },
    );
  });
}

function contentLength(response: Response): number | undefined {
  const raw = response.headers.get("content-length");
  if (raw === null) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function parseJsonOrNull(text: string): unknown {
  if (text === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    if (error instanceof SelvrenIntegrationError) throw error;
    return null;
  }
}

function requestIdOf(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  return boundedRequestId(body.request_id);
}

function httpFromBody(status: number, body: unknown, requestId?: string): SelvrenIntegrationError {
  const record = isRecord(body) ? body : undefined;
  const errorField = record !== undefined && isRecord(record.error) ? record.error : undefined;
  const code = boundedCode(errorField?.code);
  return httpError(status, code, requestId ?? boundedRequestId(record?.request_id));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
