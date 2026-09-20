export type IntegrationFetch = (input: string, init: RequestInit) => Promise<Response>;

export type TokenProvider = () => string | Promise<string>;

export interface SelvrenIntegrationClientOptions {
  readonly baseUrl: string;
  readonly tenantId: string;
  readonly tokenProvider: TokenProvider;
  readonly fetch?: IntegrationFetch;
}

export interface IntegrationRequestOptions {
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

export type Language = "fr" | "en";

export interface DocumentProgressIndeterminate {
  readonly kind: "indeterminate";
}

export interface DocumentProgressMeasured {
  readonly kind: "measured";
  readonly completed: number;
  readonly total: number;
  readonly unit: "bytes" | "chunks" | "pages";
}

export type DocumentProgress = DocumentProgressIndeterminate | DocumentProgressMeasured;

export interface DocumentError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface EnterpriseDocument {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly media_type: string;
  readonly size_bytes: number;
  readonly state: "queued" | "processing" | "ready" | "failed" | "deleted";
  readonly phase: "receiving" | "reading" | "extracting" | "indexing" | "ready" | "failed" | "deleted";
  readonly progress: DocumentProgress;
  readonly error: DocumentError | null;
  readonly actions: { readonly retry: boolean; readonly delete: boolean; readonly query: boolean };
  readonly created_at: string;
  readonly updated_at: string;
  readonly pending_conflicts: number;
  readonly space_id?: string;
}

export type TextMediaType = "text/plain" | "text/markdown";

export type BinaryMediaType =
  | "application/pdf"
  | "application/zip"
  | "text/csv"
  | "text/tab-separated-values"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export type DocumentImportInput = {
  readonly client_document_id: string;
  readonly name: string;
} & (
  | { readonly media_type: TextMediaType; readonly text: string }
  | { readonly media_type: BinaryMediaType; readonly content_base64: string }
);

export interface DocumentImportResult {
  readonly document: EnterpriseDocument;
  readonly replayed: boolean;
  readonly request_id: string;
}

export interface AnswerExpert {
  readonly id: string;
  readonly name: string;
  readonly knowledge_space: string;
  readonly corpus_version: string;
}

export interface PrivateCitation {
  readonly id: string;
  readonly source_kind: "enterprise" | "expert";
  readonly expert_id: string | null;
  readonly document_id: string;
  readonly document_name: string;
  readonly document_version: string;
  readonly chunk_id: string;
  readonly excerpt: string;
  readonly location: string | null;
  readonly space_id?: string;
  readonly url?: string;
  readonly attribution?: string;
  readonly license?: string;
}

export interface ConflictCandidate {
  readonly id: string;
  readonly value: string;
  readonly document_id: string;
  readonly document_name: string;
  readonly document_version: string;
  readonly chunk_id: string;
  readonly excerpt: string;
  readonly location: string | null;
  readonly source_date: string | null;
}

export interface PrivateConflict {
  readonly id: string;
  readonly revision: number;
  readonly status: "pending" | "resolved" | "ignored";
  readonly context: { readonly project: string; readonly field: string };
  readonly candidates: readonly ConflictCandidate[];
  readonly selected_candidate_id: string | null;
  readonly history: readonly {
    readonly action: string;
    readonly actor_id: string | null;
    readonly at: string;
    readonly candidate_id: string | null;
  }[];
  readonly updated_at: string;
  readonly space_id?: string;
}

export interface AnswerClaim {
  readonly id: string;
  readonly text: string;
  readonly kind: "fact" | "inference";
  readonly citation_ids: readonly string[];
  readonly quote: string;
}

export interface AnswerVerification {
  readonly method: "grounded-claims-v2";
  readonly claims: number;
  readonly inferences: number;
  readonly checks: readonly string[];
}

export interface PrivateAnswer {
  readonly request_id: string;
  readonly answer: string;
  readonly answer_mode: "extractive" | "generated";
  readonly outcome: "answered" | "insufficient_evidence";
  readonly citations: readonly PrivateCitation[];
  readonly conflicts: readonly PrivateConflict[];
  readonly expert: AnswerExpert | null;
  readonly experts?: readonly AnswerExpert[];
  readonly claims?: readonly AnswerClaim[];
  readonly missing?: readonly string[];
  readonly missing_expert_ids?: readonly string[];
  readonly verification?: AnswerVerification;
}

export interface PrivateQueryInput {
  readonly space_ids: readonly string[];
  readonly question: string;
  readonly client_request_id: string;
  readonly expert_id?: string;
  readonly expert_ids?: readonly string[];
  readonly document_ids?: readonly string[];
  readonly context?: { readonly project: string; readonly field?: string };
  readonly language?: Language;
}

/**
 * Integration query against a published agent. Draft is not available to
 * service credentials; verified dashboard sessions use the browser transport.
 */
export interface AgentQueryInput {
  readonly client_request_id: string;
  readonly question: string;
  readonly document_ids?: readonly string[];
  readonly language?: Language;
  readonly revision?: "published";
}

export interface AgentQueryResult extends PrivateAnswer {
  readonly agent_id: string;
  readonly agent_revision_id: string;
  readonly agent_revision_number: number;
  /** Concurrent publication after paid generation; the answer is still the original snapshot. Omitted by older backends. */
  readonly revision_changed?: boolean | undefined;
}

export interface ThreadSummary {
  readonly id: string;
  readonly title: string;
  readonly auto_title: boolean;
  readonly space_ids: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
  readonly revision: number;
  readonly message_count: number;
}

export interface PrivateThreadPage {
  readonly threads: readonly ThreadSummary[];
  readonly next_cursor: string | null;
  readonly request_id: string;
}

export interface PrivateThreadMessage {
  readonly id: string;
  readonly question: string;
  readonly language: Language;
  readonly expert_ids: readonly string[];
  readonly document_ids?: readonly string[];
  readonly answer: PrivateAnswer | null;
  readonly sources_changed: boolean;
  readonly created_at: string;
  readonly status: "pending" | "complete" | "failed";
  readonly failure_code: string | null;
}

export interface PrivateThreadDetail extends ThreadSummary {
  readonly messages: readonly PrivateThreadMessage[];
  readonly request_id: string;
}

export interface ThreadCreateInput {
  readonly client_id: string;
  readonly title?: string;
}

export interface ThreadCreateResult {
  readonly thread: ThreadSummary;
  readonly replayed: boolean;
  readonly request_id: string;
}

export interface ThreadListInput {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface PrivateThreadSendInput {
  readonly client_message_id: string;
  readonly expected_revision: number;
  readonly question: string;
  readonly language: Language;
  readonly expert_ids?: readonly string[];
  readonly document_ids?: readonly string[];
}

export interface ThreadSendResult {
  readonly message: PrivateThreadMessage;
  readonly replayed: boolean;
  readonly request_id: string;
}
