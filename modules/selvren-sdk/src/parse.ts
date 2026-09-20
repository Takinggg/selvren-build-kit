import { invalidRequest, malformedResponse } from "./errors.js";
import {
  AGENT_ID,
  AGENT_REVISION_ID,
  EXPERT_ID,
  FAILURE_CODE,
  MAX_CURSOR,
  MAX_PAGE,
  MAX_QUESTION,
  MAX_THREAD_HISTORY,
  MAX_TITLE,
  parseDocumentId,
  parseExpertIds,
  parseSpaceId,
  parseSpaceIds,
  parseThreadId,
  parseUuid,
  sameUuid,
  uniqueStrings,
} from "./ids.js";
import type {
  AgentQueryInput,
  AgentQueryResult,
  AnswerClaim,
  AnswerExpert,
  AnswerVerification,
  BinaryMediaType,
  DocumentImportInput,
  DocumentImportResult,
  EnterpriseDocument,
  PrivateAnswer,
  PrivateCitation,
  PrivateConflict,
  PrivateQueryInput,
  PrivateThreadDetail,
  PrivateThreadMessage,
  PrivateThreadPage,
  PrivateThreadSendInput,
  TextMediaType,
  ThreadCreateInput,
  ThreadCreateResult,
  ThreadListInput,
  ThreadSendResult,
  ThreadSummary,
} from "./types.js";

const TEXT_MEDIA: readonly TextMediaType[] = ["text/plain", "text/markdown"];
const BINARY_MEDIA: readonly BinaryMediaType[] = [
  "application/pdf",
  "application/zip",
  "text/csv",
  "text/tab-separated-values",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];
const DOC_STATES = ["queued", "processing", "ready", "failed", "deleted"] as const;
const DOC_PHASES = ["receiving", "reading", "extracting", "indexing", "ready", "failed", "deleted"] as const;
const CONTROL_TITLE = /[\p{Cc}\p{Cs}\p{Cf}]/u;
const CONTROL_QUESTION = /[\p{Cc}\p{Cf}]/u;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function malformed(requestId?: string): never {
  throw malformedResponse(requestId);
}

function req(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) malformed();
  return value;
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") malformed();
  return value;
}

function bool(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") malformed();
  return value;
}

function safeNonNegInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) malformed();
  return value;
}

function requestIdOf(record: Record<string, unknown>): string {
  const value = record.request_id;
  if (typeof value !== "string" || value.length < 1 || value.length > 128) malformed();
  return value;
}

export function snapshotQuestion(value: string): string {
  if (typeof value !== "string" || value.length > MAX_QUESTION) {
    throw invalidRequest("question must be 1 to 2000 characters.");
  }
  if (CONTROL_QUESTION.test(value.replace(/[\t\n\r]/gu, ""))) {
    throw invalidRequest("question must not contain control characters.");
  }
  const question = value.trim();
  if (question.length < 1 || question.length > MAX_QUESTION) {
    throw invalidRequest("question must be 1 to 2000 characters.");
  }
  return question;
}

export function snapshotTitle(value: string): string {
  if (typeof value !== "string") throw invalidRequest("title must be a string.");
  const title = value.trim();
  if (title.length < 1 || title.length > MAX_TITLE || CONTROL_TITLE.test(title)) {
    throw invalidRequest("title must be 1 to 200 characters without control characters.");
  }
  return title;
}

export function snapshotImport(input: DocumentImportInput): Record<string, unknown> {
  const clientDocumentId = parseUuid(input.client_document_id, "client_document_id");
  if (typeof input.name !== "string" || input.name.trim() === "" || input.name.length > 256) {
    throw invalidRequest("document name is invalid.");
  }
  if (isTextImport(input)) {
    if (typeof input.text !== "string" || input.text.trim() === "") {
      throw invalidRequest("text documents require a nonempty text field.");
    }
    return {
      client_document_id: clientDocumentId,
      name: input.name,
      media_type: input.media_type,
      text: input.text,
    };
  }
  if (!isBinaryImport(input) || typeof input.content_base64 !== "string" || input.content_base64.length < 1) {
    throw invalidRequest("binary documents require content_base64 only.");
  }
  return {
    client_document_id: clientDocumentId,
    name: input.name,
    media_type: input.media_type,
    content_base64: input.content_base64,
  };
}

function isTextImport(
  input: DocumentImportInput,
): input is DocumentImportInput & { media_type: TextMediaType; text: string } {
  return (TEXT_MEDIA as readonly string[]).includes(input.media_type) && "text" in input;
}

function isBinaryImport(
  input: DocumentImportInput,
): input is DocumentImportInput & { media_type: BinaryMediaType; content_base64: string } {
  return (BINARY_MEDIA as readonly string[]).includes(input.media_type) && "content_base64" in input;
}

export function snapshotQuery(input: PrivateQueryInput): {
  body: Record<string, unknown>;
  spaceIds: string[];
} {
  const spaceIds = parseSpaceIds(input.space_ids);
  const question = snapshotQuestion(input.question);
  const clientRequestId = parseUuid(input.client_request_id, "client_request_id");
  if (input.expert_id !== undefined && input.expert_ids !== undefined) {
    throw invalidRequest("Use one expert selection field.");
  }
  const body: Record<string, unknown> = {
    space_ids: [...spaceIds],
    question,
    client_request_id: clientRequestId,
  };
  if (input.expert_id !== undefined) {
    if (typeof input.expert_id !== "string" || !EXPERT_ID.test(input.expert_id)) {
      throw invalidRequest("expert_id must be an opaque catalogue id.");
    }
    body.expert_id = input.expert_id;
  }
  if (input.expert_ids !== undefined) {
    const expertIds = parseExpertIds(input.expert_ids);
    if (expertIds.length < 1) throw invalidRequest("expert_ids must contain 1 to 3 distinct ids.");
    body.expert_ids = expertIds;
  }
  if (input.document_ids !== undefined) {
    body.document_ids = snapshotDocumentIds(input.document_ids);
  }
  if (input.context !== undefined) {
    body.context = snapshotContext(input.context);
  }
  if (input.language !== undefined) {
    body.language = parseLanguage(input.language);
  }
  return { body, spaceIds };
}

/**
 * Snapshots the published-agent query body before any token await.
 * Service credentials cannot request a draft revision.
 */
export function snapshotAgentQuery(input: AgentQueryInput): Record<string, unknown> {
  if (!isRecord(input)) throw invalidRequest("queryAgent input is required.");
  const revision = (input as { revision?: unknown }).revision;
  if (revision !== undefined && revision !== "published") {
    throw invalidRequest("queryAgent on an integration client always uses revision published.");
  }
  const question = snapshotQuestion(input.question);
  const clientRequestId = parseUuid(input.client_request_id, "client_request_id");
  const body: Record<string, unknown> = {
    client_request_id: clientRequestId,
    revision: "published",
    question,
  };
  if (input.document_ids !== undefined) {
    body.document_ids = snapshotDocumentIds(input.document_ids);
  }
  if (input.language !== undefined) {
    body.language = parseLanguage(input.language);
  }
  return body;
}

function snapshotDocumentIds(values: readonly string[]): string[] {
  const items = unknownItems(values);
  if (items === null || items.length < 1 || items.length > 200) {
    throw invalidRequest("document_ids must contain 1 to 200 ids.");
  }
  const copied: string[] = [];
  for (const entry of items) {
    if (typeof entry !== "string") throw invalidRequest("document id is not a valid path segment.");
    copied.push(parseDocumentId(entry));
  }
  return copied;
}

function snapshotContext(context: { project: string; field?: string }): Record<string, unknown> {
  if (typeof context.project !== "string" || context.project.trim() === "" || context.project.length > 128) {
    throw invalidRequest("context.project is invalid.");
  }
  if (context.field === undefined) return { project: context.project };
  if (typeof context.field !== "string") throw invalidRequest("context.field is invalid.");
  return { project: context.project, field: context.field };
}

export function parseLanguage(value: unknown): "fr" | "en" {
  if (value !== "fr" && value !== "en") throw invalidRequest("language must be fr or en.");
  return value;
}

export function snapshotThreadCreate(
  spaceIds: readonly string[],
  input: ThreadCreateInput,
): { body: Record<string, unknown>; spaceIds: string[] } {
  const selection = parseSpaceIds(spaceIds);
  const clientId = parseUuid(input.client_id, "client_id");
  const body: Record<string, unknown> = { space_ids: [...selection], client_id: clientId };
  if (input.title !== undefined) body.title = snapshotTitle(input.title);
  return { body, spaceIds: selection };
}

export function snapshotThreadList(
  spaceIds: readonly string[],
  input: ThreadListInput | undefined,
): { selection: string[]; query: string } {
  const selection = parseSpaceIds(spaceIds);
  const parts = [`space_ids=${encodeURIComponent(selection.join(","))}`];
  if (input?.cursor !== undefined) {
    if (typeof input.cursor !== "string" || input.cursor.length < 1 || input.cursor.length > MAX_CURSOR) {
      throw invalidRequest("cursor is invalid.");
    }
    parts.push(`cursor=${encodeURIComponent(input.cursor)}`);
  }
  if (input?.limit !== undefined) {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_PAGE) {
      throw invalidRequest("limit must be 1 to 25.");
    }
    parts.push(`limit=${String(input.limit)}`);
  }
  return { selection, query: parts.join("&") };
}

export function snapshotSend(
  spaceIds: readonly string[],
  input: PrivateThreadSendInput,
): { body: Record<string, unknown>; spaceIds: string[]; clientMessageId: string } {
  const selection = parseSpaceIds(spaceIds);
  const clientMessageId = parseUuid(input.client_message_id, "client_message_id");
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) {
    throw invalidRequest("expected_revision must be a safe nonnegative integer.");
  }
  const body: Record<string, unknown> = {
    space_ids: [...selection],
    client_message_id: clientMessageId,
    expected_revision: input.expected_revision,
    question: snapshotQuestion(input.question),
    language: parseLanguage(input.language),
  };
  if (input.expert_ids !== undefined) body.expert_ids = parseExpertIds(input.expert_ids);
  if (input.document_ids !== undefined) body.document_ids = snapshotDocumentIds(input.document_ids);
  return { body, spaceIds: selection, clientMessageId };
}

export function parseDocumentList(body: unknown): EnterpriseDocument[] {
  const record = req(body);
  const documents = unknownItems(record.documents);
  if (documents === null) malformed(requestIdOf(record));
  return documents.map((item) => parseDocument(item));
}

export function parseImportResult(body: unknown): DocumentImportResult {
  const record = req(body);
  const requestId = requestIdOf(record);
  if (typeof record.replayed !== "boolean") malformed(requestId);
  return {
    request_id: requestId,
    replayed: record.replayed,
    document: parseDocument(record.document),
  };
}

export function parseDocument(value: unknown): EnterpriseDocument {
  const record = req(value);
  const state = record.state;
  const phase = record.phase;
  if (!isMember(state, DOC_STATES) || !isMember(phase, DOC_PHASES)) malformed();
  const document: EnterpriseDocument = {
    id: parseDocumentId(str(record, "id")),
    version: str(record, "version"),
    name: str(record, "name"),
    media_type: str(record, "media_type"),
    size_bytes: safeNonNegInt(record.size_bytes),
    state,
    phase,
    progress: parseProgress(record.progress),
    error: parseDocumentError(record.error),
    actions: parseActions(record.actions),
    created_at: str(record, "created_at"),
    updated_at: str(record, "updated_at"),
    pending_conflicts: safeNonNegInt(record.pending_conflicts),
  };
  if (record.space_id === undefined) return document;
  return { ...document, space_id: parseSpaceId(str(record, "space_id")) };
}

function parseProgress(value: unknown): EnterpriseDocument["progress"] {
  const record = req(value);
  if (record.kind === "indeterminate") return { kind: "indeterminate" };
  if (record.kind !== "measured") malformed();
  const unit = record.unit;
  if (unit !== "bytes" && unit !== "chunks" && unit !== "pages") malformed();
  const total = record.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) malformed();
  return { kind: "measured", completed: safeNonNegInt(record.completed), total, unit };
}

function parseDocumentError(value: unknown): EnterpriseDocument["error"] {
  if (value === null) return null;
  const record = req(value);
  if (typeof record.retryable !== "boolean") malformed();
  return { code: str(record, "code"), message: str(record, "message"), retryable: record.retryable };
}

function parseActions(value: unknown): EnterpriseDocument["actions"] {
  const record = req(value);
  return { retry: bool(record, "retry"), delete: bool(record, "delete"), query: bool(record, "query") };
}

export function parseAnswer(body: unknown, spaceIds: readonly string[]): PrivateAnswer {
  const answer = parseAnswerEnvelope(body);
  assertCitationPlacement(answer, spaceIds);
  return answer;
}

function parseAnswerEnvelope(body: unknown): PrivateAnswer {
  const record = req(body);
  const requestId = requestIdOf(record);
  const citations = parseCitations(record.citations);
  const answerMode = record.answer_mode;
  if (answerMode !== "generated" && answerMode !== "extractive") malformed(requestId);
  return {
    request_id: requestId,
    answer: str(record, "answer"),
    answer_mode: answerMode,
    outcome: record.outcome === "insufficient_evidence" ? "insufficient_evidence" : parseOutcome(record.outcome),
    citations,
    conflicts: parseConflicts(record.conflicts),
    expert: parseExpert(record.expert),
    ...optionalAnswerFields(record),
  };
}

export function parseAgentAnswer(body: unknown, expectedAgentId: string): AgentQueryResult {
  const record = req(body);
  const requestId = requestIdOf(record);
  const agentId = record.agent_id;
  if (typeof agentId !== "string" || !AGENT_ID.test(agentId) || agentId !== expectedAgentId) {
    malformed(requestId);
  }
  const revisionId = record.agent_revision_id;
  if (typeof revisionId !== "string" || !AGENT_REVISION_ID.test(revisionId)) {
    malformed(requestId);
  }
  const revisionNumber = record.agent_revision_number;
  if (typeof revisionNumber !== "number" || !Number.isSafeInteger(revisionNumber) || revisionNumber < 1) {
    malformed(requestId);
  }
  const answer = parseAnswerEnvelope(body);
  const result: AgentQueryResult = {
    ...answer,
    agent_id: agentId,
    agent_revision_id: revisionId,
    agent_revision_number: revisionNumber,
  };
  const revisionChanged = record.revision_changed;
  if (revisionChanged === undefined) return result;
  if (typeof revisionChanged !== "boolean") malformed(requestId);
  return { ...result, revision_changed: revisionChanged };
}

function parseOutcome(value: unknown): "answered" {
  if (value !== "answered") malformed();
  return "answered";
}

interface AnswerExtras {
  experts?: AnswerExpert[];
  claims?: AnswerClaim[];
  missing?: string[];
  missing_expert_ids?: string[];
  verification?: AnswerVerification;
}

function optionalAnswerFields(record: Record<string, unknown>): AnswerExtras {
  const extra: AnswerExtras = {};
  if (record.experts !== undefined) extra.experts = parseExperts(record.experts);
  if (record.claims !== undefined) extra.claims = parseClaims(record.claims);
  if (record.missing !== undefined) extra.missing = parseMissing(record.missing);
  if (record.missing_expert_ids !== undefined) extra.missing_expert_ids = parseMissing(record.missing_expert_ids);
  if (record.verification !== undefined) extra.verification = parseVerification(record.verification);
  return extra;
}

function parseExpert(value: unknown): AnswerExpert | null {
  if (value === null) return null;
  const record = req(value);
  return {
    id: str(record, "id"),
    name: str(record, "name"),
    knowledge_space: str(record, "knowledge_space"),
    corpus_version: str(record, "corpus_version"),
  };
}

function parseExperts(value: unknown): AnswerExpert[] {
  const items = unknownItems(value);
  if (items === null || items.length > 3) malformed();
  const experts: AnswerExpert[] = [];
  for (const item of items) {
    const expert = parseExpert(item);
    if (expert === null) malformed();
    experts.push(expert);
  }
  return experts;
}

function parseCitations(value: unknown): PrivateCitation[] {
  const items = unknownItems(value);
  if (items === null) malformed();
  return items.map((item) => parseCitation(item));
}

function parseCitation(value: unknown): PrivateCitation {
  const record = req(value);
  const sourceKind = record.source_kind === "expert" ? "expert" : "enterprise";
  const expertId = record.expert_id;
  const citation: PrivateCitation = {
    id: str(record, "id"),
    source_kind: sourceKind,
    expert_id: expertId === null ? null : typeof expertId === "string" ? expertId : null,
    document_id: str(record, "document_id"),
    document_name: str(record, "document_name"),
    document_version: str(record, "document_version"),
    chunk_id: str(record, "chunk_id"),
    excerpt: str(record, "excerpt"),
    location: record.location === null ? null : str(record, "location"),
    ...optionalCitation(record, sourceKind),
  };
  if (sourceKind === "enterprise" && citation.space_id === undefined) malformed();
  return citation;
}

interface CitationExtras {
  space_id?: string;
  url?: string;
  attribution?: string;
  license?: string;
}

function optionalCitation(
  record: Record<string, unknown>,
  sourceKind: "enterprise" | "expert",
): CitationExtras {
  const extra: CitationExtras = {};
  if (record.space_id !== undefined) extra.space_id = parseSpaceId(str(record, "space_id"));
  if (typeof record.url === "string") extra.url = record.url;
  if (typeof record.attribution === "string") extra.attribution = record.attribution;
  if (typeof record.license === "string") extra.license = record.license;
  if (sourceKind === "enterprise" && extra.space_id === undefined) malformed();
  return extra;
}

function parseConflicts(value: unknown): PrivateConflict[] {
  const items = unknownItems(value);
  if (items === null) malformed();
  return items.map((item) => parseConflict(item));
}

function parseConflict(value: unknown): PrivateConflict {
  const record = req(value);
  const status = record.status;
  if (status !== "pending" && status !== "resolved" && status !== "ignored") malformed();
  const context = req(record.context);
  const conflict: PrivateConflict = {
    id: str(record, "id"),
    revision: safeNonNegInt(record.revision),
    status,
    context: { project: str(context, "project"), field: str(context, "field") },
    candidates: parseCandidates(record.candidates),
    selected_candidate_id: record.selected_candidate_id === null ? null : str(record, "selected_candidate_id"),
    history: parseHistory(record.history),
    updated_at: str(record, "updated_at"),
  };
  if (record.space_id === undefined) return conflict;
  return { ...conflict, space_id: parseSpaceId(str(record, "space_id")) };
}

function parseCandidates(value: unknown): PrivateConflict["candidates"] {
  const items = unknownItems(value);
  if (items === null) malformed();
  return items.map((item) => {
    const record = req(item);
    return {
      id: str(record, "id"),
      value: str(record, "value"),
      document_id: str(record, "document_id"),
      document_name: str(record, "document_name"),
      document_version: str(record, "document_version"),
      chunk_id: str(record, "chunk_id"),
      excerpt: str(record, "excerpt"),
      location: record.location === null ? null : str(record, "location"),
      source_date: record.source_date === null ? null : str(record, "source_date"),
    };
  });
}

function parseHistory(value: unknown): PrivateConflict["history"] {
  const items = unknownItems(value);
  if (items === null) malformed();
  return items.map((item) => {
    const record = req(item);
    return {
      action: str(record, "action"),
      actor_id: record.actor_id === null ? null : str(record, "actor_id"),
      at: str(record, "at"),
      candidate_id: record.candidate_id === null ? null : str(record, "candidate_id"),
    };
  });
}

function parseClaims(value: unknown): AnswerClaim[] {
  const items = unknownItems(value);
  if (items === null) malformed();
  return items.map((item) => {
    const record = req(item);
    const kind = record.kind;
    if (kind !== "fact" && kind !== "inference") malformed();
    return {
      id: str(record, "id"),
      text: str(record, "text"),
      kind,
      citation_ids: stringItems(record.citation_ids),
      quote: str(record, "quote"),
    };
  });
}

function parseMissing(value: unknown): string[] {
  return stringItems(value);
}

function parseVerification(value: unknown): AnswerVerification {
  const record = req(value);
  if (record.method !== "grounded-claims-v2") malformed();
  return {
    method: "grounded-claims-v2",
    claims: safeNonNegInt(record.claims),
    inferences: safeNonNegInt(record.inferences),
    checks: stringItems(record.checks),
  };
}

export function assertCitationPlacement(
  answer: Pick<PrivateAnswer, "citations" | "conflicts"> | null,
  spaceIds: readonly string[],
): void {
  if (!answer) return;
  for (const citation of answer.citations) {
    if (citation.source_kind !== "enterprise") continue;
    if (!citation.space_id || !spaceIds.includes(citation.space_id)) {
      throw malformedResponse();
    }
  }
  for (const conflict of answer.conflicts) {
    if (conflict.space_id !== undefined && !spaceIds.includes(conflict.space_id)) {
      throw malformedResponse();
    }
  }
}

export function parseThreadPage(body: unknown, spaceIds: readonly string[]): PrivateThreadPage {
  const record = req(body);
  const requestId = requestIdOf(record);
  const threadsRaw = unknownItems(record.threads);
  if (threadsRaw === null || threadsRaw.length > MAX_PAGE) malformed(requestId);
  const threads = threadsRaw.map((item) => parseThreadSummary(item));
  if (!uniqueStrings(threads.map((thread) => thread.id))) malformed(requestId);
  for (const thread of threads) {
    if (!thread.space_ids.every((id) => spaceIds.includes(id))) malformed(requestId);
  }
  const next = record.next_cursor;
  if (next !== null && typeof next !== "string") malformed(requestId);
  return { request_id: requestId, threads, next_cursor: next };
}

export function parseThreadSummary(value: unknown): ThreadSummary {
  const record = req(value);
  const spaceIds = parseSpaceIdsArray(record.space_ids);
  return {
    id: parseThreadId(str(record, "id")),
    title: str(record, "title"),
    auto_title: bool(record, "auto_title"),
    space_ids: spaceIds,
    created_at: str(record, "created_at"),
    updated_at: str(record, "updated_at"),
    revision: safeNonNegInt(record.revision),
    message_count: safeNonNegInt(record.message_count),
  };
}

function parseSpaceIdsArray(value: unknown): string[] {
  try {
    return parseSpaceIds(stringItems(value));
  } catch (error: unknown) {
    malformedCaught(error);
  }
}

export function parseThreadCreate(body: unknown, spaceIds: readonly string[]): ThreadCreateResult {
  const record = req(body);
  const requestId = requestIdOf(record);
  if (typeof record.replayed !== "boolean") malformed(requestId);
  const thread = parseThreadSummary(record.thread);
  if (!sameSelection(thread.space_ids, spaceIds)) malformed(requestId);
  return { request_id: requestId, replayed: record.replayed, thread };
}

export function parseThreadDetail(
  body: unknown,
  spaceIds: readonly string[],
  threadId: string,
): PrivateThreadDetail {
  const record = req(body);
  const requestId = requestIdOf(record);
  const summary = parseThreadSummary(record);
  if (summary.id !== threadId || !sameSelection(summary.space_ids, spaceIds)) malformed(requestId);
  const messagesRaw = unknownItems(record.messages);
  if (messagesRaw === null || messagesRaw.length > MAX_THREAD_HISTORY) malformed(requestId);
  const messages = messagesRaw.map((item) => parseThreadMessage(item, spaceIds, requestId));
  if (!uniqueStrings(messages.map((message) => message.id))) malformed(requestId);
  return { ...summary, request_id: requestId, messages };
}

export function parseSendResult(
  body: unknown,
  spaceIds: readonly string[],
  clientMessageId: string,
): ThreadSendResult {
  const record = req(body);
  const requestId = requestIdOf(record);
  if (typeof record.replayed !== "boolean") malformed(requestId);
  const message = parseThreadMessage(record.message, spaceIds, requestId);
  if (!sameUuid(message.id, clientMessageId)) malformed(requestId);
  return { request_id: requestId, replayed: record.replayed, message };
}

export function parseThreadMessage(
  value: unknown,
  spaceIds: readonly string[],
  requestId?: string,
): PrivateThreadMessage {
  const record = req(value);
  const status = record.status;
  if (status !== "pending" && status !== "complete" && status !== "failed") malformed(requestId);
  const answer = record.answer === null ? null : parseMessageAnswer(record.answer, spaceIds);
  if (status === "complete" && bool(record, "sources_changed") !== (answer === null)) malformed(requestId);
  if ((status === "pending" || status === "failed") && answer !== null) malformed(requestId);
  const failure = record.failure_code;
  if (status === "failed") {
    if (typeof failure !== "string" || !FAILURE_CODE.test(failure)) malformed(requestId);
  } else if (failure !== null) malformed(requestId);
  let expertIds: string[];
  try {
    expertIds = parseExpertIds(stringItems(record.expert_ids));
  } catch (error: unknown) {
    malformedCaught(error, requestId);
  }
  assertCitationPlacement(answer, spaceIds);
  const message: PrivateThreadMessage = {
    id: responseUuid(str(record, "id"), requestId),
    question: storedQuestion(str(record, "question"), requestId),
    language: storedLanguage(record.language, requestId),
    expert_ids: expertIds,
    answer,
    sources_changed: bool(record, "sources_changed"),
    created_at: str(record, "created_at"),
    status,
    failure_code: failure === null ? null : failure,
  };
  if (record.document_ids === undefined) return message;
  try {
    return { ...message, document_ids: snapshotDocumentIds(stringItems(record.document_ids)) };
  } catch (error: unknown) {
    malformedCaught(error, requestId);
  }
}

function storedQuestion(value: string, requestId?: string): string {
  try {
    return snapshotQuestion(value);
  } catch (error: unknown) {
    malformedCaught(error, requestId);
  }
}

function storedLanguage(value: unknown, requestId?: string): "fr" | "en" {
  try {
    return parseLanguage(value);
  } catch (error: unknown) {
    malformedCaught(error, requestId);
  }
}

function responseUuid(value: string, requestId?: string): string {
  try {
    return parseUuid(value, "id");
  } catch (error: unknown) {
    malformedCaught(error, requestId);
  }
}

function parseMessageAnswer(value: unknown, spaceIds: readonly string[]): PrivateAnswer {
  const record = req(value);
  if (typeof record.request_id !== "string") {
    return parseAnswer({ ...record, request_id: "message" }, spaceIds);
  }
  return parseAnswer(record, spaceIds);
}

function malformedCaught(error: unknown, requestId?: string): never {
  if (error instanceof Error) {
    malformed(requestId);
  }
  malformed(requestId);
}

function unknownItems(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const items: unknown[] = [];
  for (const item of value) {
    items.push(item);
  }
  return items;
}

function stringItems(value: unknown): string[] {
  const items = unknownItems(value);
  if (items === null) malformed();
  const strings: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") malformed();
    strings.push(item);
  }
  return strings;
}

function sameSelection(returned: readonly string[], requested: readonly string[]): boolean {
  return returned.length === requested.length && returned.every((id) => requested.includes(id));
}

function isMember<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}
