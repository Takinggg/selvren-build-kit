import type { AgentAnswer, AgentCitation, AgentTransport } from "@selvren/react";
import { SelvrenIntegrationError } from "@selvren/sdk/browser";

export type DemoOutcome = "answered" | "insufficient_evidence" | "denied" | "network";

const DELAY_MS = 400;
const SERVER_REQUEST_ID = "demo-server-request";

const DEMO_CITATION: AgentCitation = {
  id: "demo-c1",
  documentName: "document-de-demonstration.txt",
  excerpt: "Ceci est un extrait de démonstration. Aucun fait métier n’est affirmé.",
  location: "l.1",
  url: "https://example.test/document-de-demonstration.txt",
};

export const DEMO_CITATIONS: readonly AgentCitation[] = [DEMO_CITATION];

export function createFixtureTransport(readOutcome: () => DemoOutcome): AgentTransport {
  return {
    query: async ({ signal }) => {
      await delay(DELAY_MS, signal);
      return finish(readOutcome());
    },
  };
}

function finish(outcome: DemoOutcome): AgentAnswer {
  if (outcome === "denied") {
    throw new SelvrenIntegrationError(403, "ENTERPRISE_ACCESS_DENIED", "Access was denied.", {
      retryGuidance: "none",
    });
  }
  if (outcome === "network") {
    throw new TypeError("Failed to fetch");
  }
  if (outcome === "insufficient_evidence") {
    return {
      requestId: SERVER_REQUEST_ID,
      text: "Les sources de démonstration ne permettent pas de répondre. Aucun fait métier n’est affirmé.",
      outcome: "insufficient_evidence",
      citations: [],
    };
  }
  return {
    requestId: SERVER_REQUEST_ID,
    text: "Réponse de démonstration. Cette phrase n’est pas un fait métier.",
    outcome: "answered",
    citations: DEMO_CITATIONS,
  };
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
