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

/**
 * Injected by the host. Must not carry a service token.
 * Dedicated agent HTTP routes are supplied by the host server, not this package.
 */
export interface AgentTransport {
  query(request: AgentQueryRequest): Promise<AgentAnswer>;
}

export type ChatRole = "user" | "assistant";

/**
 * `id` is a local presentation key (`${role}:${clientRequestId}`).
 * Assistant rows use the pending clientRequestId, not `answer.requestId`,
 * because a valid custom transport may reuse the server id across turns.
 * `answer.requestId` stays on the `requestId` field. HTTP idempotence is
 * unchanged.
 */
export type ChatMessage =
  | {
      readonly id: string;
      readonly role: "user";
      readonly text: string;
      readonly clientRequestId: string;
    }
  | {
      readonly id: string;
      readonly role: "assistant";
      readonly text: string;
      readonly requestId: string;
      readonly outcome: AgentAnswer["outcome"];
      readonly citations: readonly AgentCitation[];
    };

export type ChatStatus = "idle" | "loading" | "error";

export interface AgentChatLabels {
  readonly landmark: string;
  readonly input: string;
  readonly submit: string;
  readonly cancel: string;
  readonly retry: string;
  readonly loading: string;
  readonly error: string;
  readonly sources: string;
  readonly empty: string;
  readonly assistant: string;
  readonly user: string;
}
