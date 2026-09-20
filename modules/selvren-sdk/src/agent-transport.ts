import { safeHref } from "./safe-href.js";
import type { AgentQueryResult, PrivateAnswer, PrivateCitation } from "./types.js";

/**
 * Browser-safe transport for agent UI. First-party dashboard sessions use
 * `createSessionAgentTransport`. Custom hosts may inject `AgentTransport.query`.
 */
export interface AgentQueryRequest {
  readonly question: string;
  readonly clientRequestId: string;
  readonly signal?: AbortSignal | undefined;
}

export interface AgentCitation {
  readonly id: string;
  readonly documentName: string;
  readonly excerpt: string;
  readonly location: string | null;
  readonly url?: string | undefined;
}

export interface AgentAnswer {
  readonly requestId: string;
  readonly text: string;
  readonly outcome: "answered" | "insufficient_evidence";
  readonly citations: readonly AgentCitation[];
  /** Concurrent publication after paid generation; the answer is still the original snapshot. */
  readonly revisionChanged?: boolean | undefined;
}

export interface AgentTransport {
  query(request: AgentQueryRequest): Promise<AgentAnswer>;
}

export function createAgentTransport(query: AgentTransport["query"]): AgentTransport {
  return { query };
}

/**
 * Maps a private-space or agent query envelope to the UI answer shape.
 * Must not be called from the browser with a service token.
 */
export function agentAnswerFromPrivateQuery(answer: PrivateAnswer): AgentAnswer {
  const mapped: AgentAnswer = {
    requestId: answer.request_id,
    text: answer.answer,
    outcome: answer.outcome,
    citations: answer.citations.map(mapCitation),
  };
  const revisionChanged = revisionChangedOf(answer);
  if (revisionChanged === undefined) return mapped;
  return { ...mapped, revisionChanged };
}

function revisionChangedOf(answer: PrivateAnswer): boolean | undefined {
  if (!("revision_changed" in answer)) return undefined;
  const value = (answer as AgentQueryResult).revision_changed;
  return typeof value === "boolean" ? value : undefined;
}

function mapCitation(citation: PrivateCitation): AgentCitation {
  const mapped: AgentCitation = {
    id: citation.id,
    documentName: citation.document_name,
    excerpt: citation.excerpt,
    location: citation.location,
  };
  const href = safeHref(citation.url);
  if (href === undefined) return mapped;
  return { ...mapped, url: href };
}
