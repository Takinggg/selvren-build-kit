import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError, isRetryableAgentError, shouldReuseClientRequestId } from "./retry.js";
import type { AgentTransport, ChatMessage, ChatRole, ChatStatus } from "./types.js";

function presentationMessageId(role: ChatRole, requestIdentity: string): string {
  return `${role}:${requestIdentity}`;
}

export interface PendingRequest {
  readonly question: string;
  readonly clientRequestId: string;
}

export interface AgentChatState {
  readonly messages: readonly ChatMessage[];
  readonly status: ChatStatus;
  readonly error: unknown;
  readonly pending: PendingRequest | null;
  readonly send: (question: string) => void;
  readonly retry: () => void;
  readonly cancel: () => void;
}

export interface UseAgentChatOptions {
  readonly transport: AgentTransport;
  readonly conversationKey: string;
}

export function parseConversationKey(value: string): string {
  if (typeof value !== "string") {
    throw new Error("conversationKey is required (verified subject + agent + revision).");
  }
  const key = value.trim();
  if (key.length < 1 || key.length > 512) {
    throw new Error("conversationKey is required (verified subject + agent + revision).");
  }
  return key;
}

/**
 * Stateful chat hook. Not part of the public package entry: pass an explicit
 * conversationKey (agent + revision + authenticated subject). Changing that
 * key aborts the in-flight request and drops messages, errors, pending, and
 * status. Changing only the transport object does not reset.
 */
export function useAgentChat(options: UseAgentChatOptions): AgentChatState {
  const conversationKey = parseConversationKey(options.conversationKey);
  const transportRef = useRef(options.transport);
  transportRef.current = options.transport;
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const statusRef = useRef<ChatStatus>("idle");
  const pendingRef = useRef<PendingRequest | null>(null);
  const errorRef = useRef<unknown>(null);
  const scopeRef = useRef(conversationKey);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<PendingRequest | null>(null);

  if (scopeRef.current !== conversationKey) {
    scopeRef.current = conversationKey;
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    statusRef.current = "idle";
    pendingRef.current = null;
    errorRef.current = null;
    setMessages([]);
    setStatus("idle");
    setError(null);
    setPending(null);
  }

  const setStatusBoth = (next: ChatStatus): void => {
    statusRef.current = next;
    setStatus(next);
  };

  const setPendingBoth = (next: PendingRequest | null): void => {
    pendingRef.current = next;
    setPending(next);
  };

  const setErrorBoth = (next: unknown): void => {
    errorRef.current = next;
    setError(next);
  };

  const runQuery = useCallback(async (question: string, clientRequestId: string): Promise<void> => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatusBoth("loading");
    setErrorBoth(null);
    try {
      const answer = await transportRef.current.query({
        question,
        clientRequestId,
        signal: controller.signal,
      });
      if (generation !== generationRef.current) return;
      setMessages((current) => [
        ...current,
        {
          id: presentationMessageId("assistant", clientRequestId),
          role: "assistant",
          text: answer.text,
          requestId: answer.requestId,
          outcome: answer.outcome,
          citations: answer.citations,
        },
      ]);
      setPendingBoth(null);
      setStatusBoth("idle");
    } catch (caught: unknown) {
      if (generation !== generationRef.current) return;
      if (isAbortError(caught)) {
        setStatusBoth("idle");
        return;
      }
      setErrorBoth(caught);
      setStatusBoth("error");
    }
  }, []);

  const send = useCallback(
    (raw: string): void => {
      if (statusRef.current === "loading") return;
      const question = raw.trim();
      if (question.length < 1) return;
      const clientRequestId = crypto.randomUUID();
      const next: PendingRequest = { question, clientRequestId };
      setPendingBoth(next);
      setMessages((current) => [
        ...current,
        {
          id: presentationMessageId("user", clientRequestId),
          role: "user",
          text: question,
          clientRequestId,
        },
      ]);
      void runQuery(question, clientRequestId);
    },
    [runQuery],
  );

  const retry = useCallback((): void => {
    const current = pendingRef.current;
    const currentError = errorRef.current;
    if (current === null || statusRef.current === "loading") return;
    if (currentError !== null && !isRetryableAgentError(currentError)) return;
    const reuse = currentError === null ? true : shouldReuseClientRequestId(currentError);
    const clientRequestId = reuse ? current.clientRequestId : crypto.randomUUID();
    if (clientRequestId !== current.clientRequestId) {
      const next: PendingRequest = { question: current.question, clientRequestId };
      setPendingBoth(next);
      setMessages((messagesNow) =>
        messagesNow.map((message) =>
          message.role === "user" && message.clientRequestId === current.clientRequestId
            ? {
                ...message,
                id: presentationMessageId("user", clientRequestId),
                clientRequestId,
              }
            : message,
        ),
      );
    }
    void runQuery(current.question, clientRequestId);
  }, [runQuery]);

  const cancel = useCallback((): void => {
    generationRef.current += 1;
    abortRef.current?.abort();
    setStatusBoth("idle");
  }, []);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  return { messages, status, error, pending, send, retry, cancel };
}
