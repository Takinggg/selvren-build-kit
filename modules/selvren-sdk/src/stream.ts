/**
 * SSE decoder for POST /private-threads/:id/messages/stream.
 * Protocol is the server contract: one `accepted`, heartbeat comments, then
 * one `final` or `error`. The model answer is never token-streamed.
 */
import {
  boundedCode,
  boundedRequestId,
  enterpriseCode,
  httpError,
  SelvrenIntegrationError,
  streamAmbiguous,
  streamErrorStatus,
} from "./errors.js";
import { parseSendResult } from "./parse.js";
import type { ThreadSendResult } from "./types.js";
import {
  assertNoRedirect,
  cancelBody,
  cancelReader,
  isAbortError,
  mapTransportError,
  PREHEADER_MAX_BYTES,
  readBoundedText,
  readWithAbort,
} from "./http-core.js";
import { openStreamResponse, type TransportContext } from "./transport.js";

export const PRIVATE_THREAD_STREAM_TIMEOUT_MS = 145_000;
const FRAME_MAX_BYTES = 256 * 1024;
const TOTAL_MAX_BYTES = 1024 * 1024;
const MAX_READS = TOTAL_MAX_BYTES + 8;
const utf8 = new TextEncoder();

interface StreamExpectation {
  threadId: string;
  clientMessageId: string;
}

interface StreamState {
  expected: StreamExpectation;
  accepted: boolean;
  requestId: string | undefined;
  done: boolean;
  terminal: unknown;
}

interface ParsedSseFrame {
  event: string;
  data: string | undefined;
}

export async function readMessageStream(
  ctx: TransportContext,
  input: {
    path: string;
    bodyText: string;
    threadId: string;
    clientMessageId: string;
    spaceIds: readonly string[];
    timeoutMs: number;
    signal?: AbortSignal | undefined;
  },
): Promise<ThreadSendResult> {
  const { response, composed } = await openStreamResponse(ctx, input);
  try {
    await assertStreamResponse(response, composed.signal);
    const body = response.body;
    if (!body) throw streamAmbiguous();
    const terminal = await readTerminalData(body, composed.signal, {
      threadId: input.threadId,
      clientMessageId: input.clientMessageId,
    });
    return parseSendResult(terminal, input.spaceIds, input.clientMessageId);
  } catch (error: unknown) {
    throw mapTransportError(error, composed, "stream");
  } finally {
    composed.cleanup();
  }
}

async function assertStreamResponse(response: Response, signal: AbortSignal): Promise<void> {
  assertNoRedirect(response);
  if (!response.ok) {
    throw await readPreheaderError(response, signal);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status !== 200 || !contentType.includes("text/event-stream")) {
    cancelBody(response.body);
    throw streamAmbiguous();
  }
}

async function readPreheaderError(response: Response, signal: AbortSignal): Promise<SelvrenIntegrationError> {
  const text = await readBoundedText(response, signal, PREHEADER_MAX_BYTES);
  let raw: unknown;
  try {
    raw = text === "" ? null : (JSON.parse(text) as unknown);
  } catch (error: unknown) {
    if (error instanceof SelvrenIntegrationError) throw error;
    raw = null;
  }
  const record = isRecord(raw) ? raw : undefined;
  const errorField = record !== undefined && isRecord(record.error) ? record.error : undefined;
  return httpError(response.status, boundedCode(errorField?.code), boundedRequestId(record?.request_id));
}

async function readTerminalData(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  expected: StreamExpectation,
): Promise<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const state: StreamState = {
    expected,
    accepted: false,
    requestId: undefined,
    done: false,
    terminal: undefined,
  };
  let rest = "";
  let totalBytes = 0;
  try {
    for (let reads = 0; reads < MAX_READS; reads += 1) {
      const chunk = await readWithAbort(reader, signal);
      if (chunk.done) {
        rest = consumeFrames(state, rest + decoder.decode());
        if (state.done) return state.terminal;
        throw streamAmbiguous(state.requestId);
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > TOTAL_MAX_BYTES) throw streamAmbiguous(state.requestId);
      rest = consumeFrames(state, rest + decoder.decode(chunk.value, { stream: true }));
      if (state.done) return state.terminal;
    }
    throw streamAmbiguous(state.requestId);
  } catch (error: unknown) {
    if (error instanceof SelvrenIntegrationError) throw error;
    if (isAbortError(error)) throw error;
    throw streamAmbiguous();
  } finally {
    cancelReader(reader);
  }
}

function consumeFrames(state: StreamState, buffer: string): string {
  const { frames, rest } = extractFrames(buffer);
  let doneAt = -1;
  for (let i = 0; i < frames.length; i += 1) {
    const block = frames[i] ?? "";
    if (frameBytes(block) > FRAME_MAX_BYTES) throw streamAmbiguous(state.requestId);
    applyBlock(state, block);
    if (state.done) {
      doneAt = i;
      break;
    }
  }
  if (state.done) rejectTrailingSemantic(frames, doneAt);
  if (frameBytes(rest) > FRAME_MAX_BYTES) throw streamAmbiguous(state.requestId);
  return rest;
}

function rejectTrailingSemantic(frames: readonly string[], doneAt: number): void {
  for (let i = doneAt + 1; i < frames.length; i += 1) {
    if (parseFrame(frames[i] ?? "")) throw streamAmbiguous();
  }
}

function extractFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;
  for (let n = 0; n < buffer.length + 1; n += 1) {
    const match = /\r\n\r\n|\n\n|\r\r/.exec(rest);
    if (!match) break;
    const index = match.index;
    frames.push(rest.slice(0, index));
    rest = rest.slice(index + match[0].length);
  }
  return { frames, rest };
}

function applyBlock(state: StreamState, block: string): void {
  const frame = parseFrame(block);
  if (!frame) return;
  if (frame.data === undefined) throw streamAmbiguous(state.requestId);
  applyFrame(state, { event: frame.event, data: frame.data });
}

function parseFrame(block: string): ParsedSseFrame | null {
  let event = "";
  let data: string | undefined;
  let sawField = false;
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "" || line.startsWith(":")) continue;
    sawField = true;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data = data === undefined ? value : `${data}\n${value}`;
  }
  if (!sawField) return null;
  return { event, data };
}

function applyFrame(state: StreamState, frame: ParsedSseFrame & { data: string }): void {
  let data: unknown;
  try {
    data = JSON.parse(frame.data) as unknown;
  } catch (error: unknown) {
    if (error instanceof SelvrenIntegrationError) throw error;
    throw streamAmbiguous(state.requestId);
  }
  if (frame.event === "accepted") {
    applyAccepted(state, data);
    return;
  }
  if (frame.event === "final") {
    applyFinal(state, data);
    return;
  }
  if (frame.event === "error") {
    applyErrorFrame(state, data);
    return;
  }
  throw streamAmbiguous(state.requestId);
}

function applyAccepted(state: StreamState, data: unknown): void {
  if (state.accepted) throw streamAmbiguous(state.requestId);
  const threadId = readField(data, "thread_id");
  const clientMessageId = readField(data, "client_message_id");
  const requestId = readField(data, "request_id");
  const stage = readField(data, "stage");
  if (
    stage !== "authorized" ||
    threadId !== state.expected.threadId ||
    clientMessageId !== state.expected.clientMessageId ||
    typeof requestId !== "string" ||
    boundedRequestId(requestId) === undefined
  ) {
    throw streamAmbiguous();
  }
  state.accepted = true;
  state.requestId = requestId;
}

function applyFinal(state: StreamState, data: unknown): void {
  if (!state.accepted || state.done) throw streamAmbiguous(state.requestId);
  const requestId = readField(data, "request_id");
  if (typeof requestId !== "string" || requestId !== state.requestId) {
    throw streamAmbiguous(state.requestId);
  }
  state.done = true;
  state.terminal = data;
}

function applyErrorFrame(state: StreamState, data: unknown): void {
  if (!state.accepted) throw streamAmbiguous(state.requestId);
  const requestId = readField(data, "request_id");
  if (typeof requestId !== "string" || requestId !== state.requestId) {
    throw streamAmbiguous(state.requestId);
  }
  const code = enterpriseCode(readField(data, "code"));
  if (code === undefined) throw streamAmbiguous(state.requestId);
  throw httpError(streamErrorStatus(code), code, requestId);
}

function readField(data: unknown, name: string): unknown {
  return isRecord(data) ? data[name] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function frameBytes(text: string): number {
  return utf8.encode(text).byteLength;
}
