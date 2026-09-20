import { AgentChat } from "@selvren/react";
import { lazy, Suspense, useMemo, useRef, useState, type ReactElement } from "react";
import { CopySnippet } from "../copy-snippet.js";
import { createFixtureTransport, type DemoOutcome } from "../fixture-transport.js";
import { readLiveConfig } from "../live-config.js";
import { CHAT_SNIPPET } from "../snippets.js";

const LiveShell = lazy(async () => {
  const module = await import("../live-shell.js");
  return { default: module.LiveShell };
});

const DEMO_AGENT = `agt_${"d".repeat(32)}`;

const OUTCOMES: readonly { readonly id: DemoOutcome; readonly label: string }[] = [
  { id: "answered", label: "Réponse normale" },
  { id: "insufficient_evidence", label: "Abstention" },
  { id: "denied", label: "Accès refusé" },
  { id: "network", label: "Erreur réseau" },
];

export function ChatSection({ mode }: { readonly mode: "fixture" | "live" }): ReactElement {
  return (
    <article className="kit-entry" id="chat">
      <div>
        <h2>Chat d’agent</h2>
        <p>
          <code>AgentChat</code> conserve un transcript <strong>local</strong> (messages, erreur, requête en cours). Ce
          n’est pas l’historique serveur des fils privés. Un changement de <code>conversationKey</code> (déconnexion,
          organisation, agent, révision) efface cet état visible.
        </p>
        <CopySnippet label="Exemple AgentChat" code={CHAT_SNIPPET} />
      </div>
      {mode === "live" ? <LiveChatPreview /> : <FixtureChatPreview />}
    </article>
  );
}

function FixtureChatPreview(): ReactElement {
  const [outcome, setOutcome] = useState<DemoOutcome>("answered");
  const [resetId, setResetId] = useState(0);
  const outcomeRef = useRef(outcome);
  outcomeRef.current = outcome;
  const transport = useMemo(() => createFixtureTransport(() => outcomeRef.current), []);
  const conversationKey = `demo:gallery:${DEMO_AGENT}:published:${String(resetId)}`;

  return (
    <div>
      <p className="kit-demo-note" role="status">
        Données de démonstration — aucun appel à l’API
      </p>
      <fieldset className="kit-fieldset">
        <legend>Résultat du prochain envoi</legend>
        {OUTCOMES.map((item) => (
          <label key={item.id} className="kit-choice">
            <input
              type="radio"
              name="demo-outcome"
              checked={outcome === item.id}
              onChange={() => {
                setOutcome(item.id);
              }}
            />
            {item.label}
          </label>
        ))}
      </fieldset>
      <p>
        <button
          type="button"
          className="kit-button"
          onClick={() => {
            setResetId((current) => current + 1);
          }}
        >
          Réinitialiser la démonstration
        </button>
      </p>
      <AgentChat conversationKey={conversationKey} transport={transport} />
    </div>
  );
}

function LiveChatPreview(): ReactElement {
  const result = readLiveConfig();
  if (!result.ok) {
    return (
      <p className="kit-status" role="status">
        {result.message}
      </p>
    );
  }
  return (
    <Suspense fallback={<p>Chargement du mode authentifié…</p>}>
      <LiveShell config={result.config} />
    </Suspense>
  );
}
