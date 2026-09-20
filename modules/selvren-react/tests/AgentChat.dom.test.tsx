import { act } from "react";
import { describe, expect, it } from "vitest";
import { AgentChat } from "../src/AgentChat.js";
import type { AgentAnswer, AgentTransport } from "../src/types.js";
import { click, render, setTextarea } from "./render.js";

const KEY_A = "org_a:user_a:agt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:published";
const KEY_B = "org_b:user_b:agt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:published";

const ANSWER: AgentAnswer = {
  requestId: "req-final",
  text: "Deux boulons.",
  outcome: "answered",
  citations: [
    {
      id: "c1",
      documentName: "note.txt",
      excerpt: "Deux boulons.",
      location: "p.1",
      url: "https://files.example.test/note.txt",
    },
  ],
};

const ANSWER_B: AgentAnswer = {
  requestId: "req-b",
  text: "Réponse de l’agent B.",
  outcome: "answered",
  citations: [],
};

function timeoutError(): Error {
  return Object.assign(new Error("The request timed out."), {
    name: "SelvrenIntegrationError",
    code: "REQUEST_TIMEOUT",
    status: 504,
    retryGuidance: "read-then-decide",
  });
}

function abortedTypedError(): Error {
  return Object.assign(new Error("The request was aborted."), {
    name: "SelvrenIntegrationError",
    code: "REQUEST_ABORTED",
    status: 0,
    retryGuidance: "none",
  });
}

function submitQuestion(container: HTMLElement, question: string): void {
  const textarea = container.querySelector("textarea");
  const form = container.querySelector("form");
  if (!(textarea instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) {
    throw new Error("expected form");
  }
  act(() => {
    setTextarea(textarea, question);
  });
  act(() => {
    form.requestSubmit();
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AgentChat", () => {
  it("renders user and assistant messages after a final response, without fake token streaming", async () => {
    const transport: AgentTransport = {
      query: () => Promise.resolve(ANSWER),
    };
    const view = render(<AgentChat conversationKey={KEY_A} transport={transport} />);
    submitQuestion(view.container, "Combien ?");
    await flush();
    expect(view.container.querySelector("[data-selvren-role='user']")?.textContent).toContain("Combien ?");
    expect(view.container.querySelector("[data-selvren-role='assistant']")?.textContent).toContain("Deux boulons.");
    expect(view.container.querySelector("[data-selvren-loading]")).toBeNull();
    expect(view.container.textContent).not.toMatch(/%/);
    expect(view.container.textContent).not.toContain("token");
  });

  it("reuses the same clientRequestId on retry after a network-ambiguous timeout", async () => {
    const ids: string[] = [];
    let attempts = 0;
    const transport: AgentTransport = {
      query: ({ clientRequestId }) => {
        ids.push(clientRequestId);
        attempts += 1;
        if (attempts === 1) return Promise.reject(timeoutError());
        return Promise.resolve(ANSWER);
      },
    };
    const view = render(<AgentChat conversationKey={KEY_A} transport={transport} />);
    submitQuestion(view.container, "Combien ?");
    await flush();
    const retry = view.container.querySelector(".selvren-agent-error__retry");
    if (!(retry instanceof HTMLButtonElement)) throw new Error("expected retry");
    act(() => {
      click(retry);
    });
    await flush();
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(view.container.querySelectorAll("[data-selvren-role='user']")).toHaveLength(1);
    expect(view.container.querySelector("[data-selvren-role='assistant']")?.textContent).toContain("Deux boulons.");
  });

  it("reuses the same clientRequestId after an aborted in-flight request", async () => {
    const ids: string[] = [];
    let attempts = 0;
    const transport: AgentTransport = {
      query: ({ clientRequestId }) => {
        ids.push(clientRequestId);
        attempts += 1;
        if (attempts === 1) return Promise.reject(abortedTypedError());
        return Promise.resolve(ANSWER);
      },
    };
    const view = render(<AgentChat conversationKey={KEY_A} transport={transport} />);
    submitQuestion(view.container, "Combien ?");
    await flush();
    const retry = view.container.querySelector(".selvren-agent-error__retry");
    if (!(retry instanceof HTMLButtonElement)) throw new Error("expected retry after abort");
    act(() => {
      click(retry);
    });
    await flush();
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(view.container.querySelector("[data-selvren-role='assistant']")?.textContent).toContain("Deux boulons.");
  });

  it("mints a new UUID after a terminal idempotence failure", async () => {
    const ids: string[] = [];
    let attempts = 0;
    const failed = Object.assign(new Error("This message id failed terminally."), {
      name: "SelvrenIntegrationError",
      code: "ENTERPRISE_MESSAGE_FAILED",
      status: 409,
      retryGuidance: "new-idempotency",
    });
    const transport: AgentTransport = {
      query: ({ clientRequestId }) => {
        ids.push(clientRequestId);
        attempts += 1;
        if (attempts === 1) return Promise.reject(failed);
        return Promise.resolve(ANSWER);
      },
    };
    const view = render(<AgentChat conversationKey={KEY_A} transport={transport} />);
    submitQuestion(view.container, "Combien ?");
    await flush();
    const retry = view.container.querySelector(".selvren-agent-error__retry");
    if (!(retry instanceof HTMLButtonElement)) throw new Error("expected retry");
    act(() => {
      click(retry);
    });
    await flush();
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("ignores a second submit while loading and drops a late response after unmount", async () => {
    const controllers: AbortSignal[] = [];
    let resolveQuery: ((value: AgentAnswer) => void) | undefined;
    let calls = 0;
    const transport: AgentTransport = {
      query: ({ signal }) => {
        calls += 1;
        if (signal !== undefined) controllers.push(signal);
        return new Promise((resolve) => {
          resolveQuery = resolve;
        });
      },
    };
    const view = render(<AgentChat conversationKey={KEY_A} transport={transport} />);
    submitQuestion(view.container, "Première");
    submitQuestion(view.container, "Deuxième");
    expect(calls).toBe(1);
    expect(view.container.querySelector("[data-selvren-loading]")?.textContent).toBe("Réponse en cours");
    const pending = resolveQuery;
    view.unmount();
    expect(controllers[0]?.aborted).toBe(true);
    await act(async () => {
      pending?.(ANSWER);
      await Promise.resolve();
    });
    expect(document.body.textContent).not.toContain("Deux boulons.");
  });

  it("does not invent success data when the transport fails", async () => {
    const transport: AgentTransport = {
      query: () => Promise.reject(timeoutError()),
    };
    const view = render(<AgentChat conversationKey={KEY_A} transport={transport} />);
    submitQuestion(view.container, "Combien ?");
    await flush();
    expect(view.container.querySelector("[role='alert']")?.textContent).toContain("timed out");
    expect(view.container.querySelector("[data-selvren-role='assistant']")).toBeNull();
  });

  it("drops previous user, assistant, error, pending and draft when conversationKey changes", async () => {
    const controllers: AbortSignal[] = [];
    let resolveA: ((value: AgentAnswer) => void) | undefined;
    const transportA: AgentTransport = {
      query: ({ signal }) => {
        if (signal !== undefined) controllers.push(signal);
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      },
    };
    const transportB: AgentTransport = {
      query: () => Promise.resolve(ANSWER_B),
    };
    const view = render(<AgentChat conversationKey={KEY_A} transport={transportA} />);
    const textarea = view.container.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("expected textarea");
    act(() => {
      setTextarea(textarea, "brouillon A");
    });
    submitQuestion(view.container, "Question A");
    expect(view.container.querySelector("[data-selvren-role='user']")?.textContent).toContain("Question A");
    expect(view.container.querySelector("[data-selvren-loading]")).not.toBeNull();

    view.rerender(<AgentChat conversationKey={KEY_B} transport={transportB} />);
    expect(controllers[0]?.aborted).toBe(true);
    expect(view.container.querySelector("[data-selvren-role='user']")).toBeNull();
    expect(view.container.querySelector("[data-selvren-role='assistant']")).toBeNull();
    expect(view.container.querySelector("[role='alert']")).toBeNull();
    expect(view.container.querySelector("[data-selvren-loading]")).toBeNull();
    expect(view.container.textContent).toContain("Aucune conversation pour le moment.");
    expect(view.container.textContent).not.toContain("Question A");
    expect(view.container.textContent).not.toContain("Deux boulons.");
    const nextInput = view.container.querySelector("textarea");
    if (!(nextInput instanceof HTMLTextAreaElement)) throw new Error("expected textarea");
    expect(nextInput.value).toBe("");

    await act(async () => {
      resolveA?.(ANSWER);
      await Promise.resolve();
    });
    expect(view.container.textContent).not.toContain("Deux boulons.");
    expect(view.container.textContent).not.toContain("Question A");

    submitQuestion(view.container, "Question B");
    await flush();
    expect(view.container.querySelector("[data-selvren-role='user']")?.textContent).toContain("Question B");
    expect(view.container.querySelector("[data-selvren-role='assistant']")?.textContent).toContain(
      "Réponse de l’agent B.",
    );
    expect(view.container.textContent).not.toContain("Question A");
    expect(view.container.textContent).not.toContain("Deux boulons.");
  });

  it("does not reset messages when only the transport object identity changes", async () => {
    const first: AgentTransport = {
      query: () => Promise.resolve(ANSWER),
    };
    const view = render(<AgentChat conversationKey={KEY_A} transport={first} />);
    submitQuestion(view.container, "Combien ?");
    await flush();
    expect(view.container.querySelector("[data-selvren-role='assistant']")?.textContent).toContain("Deux boulons.");
    const second: AgentTransport = {
      query: () => Promise.resolve(ANSWER_B),
    };
    view.rerender(<AgentChat conversationKey={KEY_A} transport={second} />);
    expect(view.container.querySelector("[data-selvren-role='user']")?.textContent).toContain("Combien ?");
    expect(view.container.querySelector("[data-selvren-role='assistant']")?.textContent).toContain("Deux boulons.");
    expect(view.container.textContent).not.toContain("Réponse de l’agent B.");
  });

  it("keeps unique presentation keys when requestId echoes clientRequestId across two exchanges", async () => {
    const ids: string[] = [];
    let attempts = 0;
    const transport: AgentTransport = {
      query: (input) => {
        ids.push(input.clientRequestId);
        attempts += 1;
        if (attempts === 1) return Promise.reject(timeoutError());
        return Promise.resolve({
          requestId: input.clientRequestId,
          text: "demo",
          outcome: "answered",
          citations: [],
        });
      },
    };
    const duplicateKeyWarnings: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: Parameters<typeof console.error>) => {
      const text = args.map(String).join(" ");
      if (text.includes("same key") || text.includes('unique "key"')) {
        duplicateKeyWarnings.push(text);
      }
      originalConsoleError.apply(console, args);
    };
    try {
      const view = render(<AgentChat conversationKey={KEY_A} transport={transport} />);
      submitQuestion(view.container, "Question 1");
      await flush();
      const retry = view.container.querySelector(".selvren-agent-error__retry");
      if (!(retry instanceof HTMLButtonElement)) throw new Error("expected retry");
      act(() => {
        click(retry);
      });
      await flush();
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(ids[1]);
      expect(ids[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      submitQuestion(view.container, "Question 2");
      await flush();
      expect(ids).toHaveLength(3);
      expect(ids[2]).not.toBe(ids[0]);

      const users = view.container.querySelectorAll("[data-selvren-role='user']");
      const assistants = view.container.querySelectorAll("[data-selvren-role='assistant']");
      expect(users).toHaveLength(2);
      expect(assistants).toHaveLength(2);
      expect(view.container.querySelectorAll(".selvren-agent-chat__messages > li")).toHaveLength(4);
      expect(users[0]?.textContent).toContain("Question 1");
      expect(users[1]?.textContent).toContain("Question 2");
      expect(assistants[0]?.textContent).toContain("demo");
      expect(assistants[1]?.textContent).toContain("demo");
      expect(duplicateKeyWarnings).toEqual([]);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("keeps unique assistant rows when the server reuses one requestId across two turns", async () => {
    const CONSTANT_REQUEST_ID = "req-server-constant";
    const seen = new Set<string>();
    let turns = 0;
    const transport: AgentTransport = {
      query: (input) => {
        seen.add(input.clientRequestId);
        turns += 1;
        return Promise.resolve({
          requestId: CONSTANT_REQUEST_ID,
          text: turns === 1 ? "premier" : "second",
          outcome: "answered",
          citations: [],
        });
      },
    };
    const duplicateKeyWarnings: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: Parameters<typeof console.error>) => {
      const text = args.map(String).join(" ");
      if (text.includes("same key") || text.includes('unique "key"')) {
        duplicateKeyWarnings.push(text);
      }
      originalConsoleError.apply(console, args);
    };
    try {
      const view = render(<AgentChat conversationKey={KEY_A} transport={transport} />);
      submitQuestion(view.container, "Question 1");
      await flush();
      submitQuestion(view.container, "Question 2");
      await flush();
      expect(seen.size).toBe(2);
      const users = view.container.querySelectorAll("[data-selvren-role='user']");
      const assistants = view.container.querySelectorAll("[data-selvren-role='assistant']");
      expect(users).toHaveLength(2);
      expect(assistants).toHaveLength(2);
      expect(view.container.querySelectorAll(".selvren-agent-chat__messages > li")).toHaveLength(4);
      expect(users[0]?.textContent).toContain("Question 1");
      expect(users[1]?.textContent).toContain("Question 2");
      expect(assistants[0]?.textContent).toContain("premier");
      expect(assistants[1]?.textContent).toContain("second");
      expect(assistants[0]?.textContent).not.toContain("second");
      expect(duplicateKeyWarnings).toEqual([]);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
