import { AgentError, isRetryableAgentError } from "@selvren/react";
import { SelvrenIntegrationError } from "@selvren/sdk/browser";
import { useState, type ReactElement } from "react";
import { CopySnippet } from "../copy-snippet.js";
import { ERROR_SNIPPET } from "../snippets.js";

const DENIED = new SelvrenIntegrationError(403, "ENTERPRISE_ACCESS_DENIED", "Access was denied.", {
  retryGuidance: "none",
});
const TIMEOUT = new SelvrenIntegrationError(504, "REQUEST_TIMEOUT", "The request timed out.", {
  retryGuidance: "read-then-decide",
});

export function StatesSection(): ReactElement {
  const [retryCount, setRetryCount] = useState(0);

  return (
    <article className="kit-entry" id="etats">
      <div>
        <h2>États et erreurs</h2>
        <p>
          <code>AgentError</code> n’affiche un bouton Réessayer que lorsque l’erreur est rejouable. Un refus d’accès ne
          l’est pas. Après un timeout, le chat réutilise le même UUID.
        </p>
        <CopySnippet label="Exemple AgentError" code={ERROR_SNIPPET} />
      </div>
      <div className="kit-stack">
        <AgentError error={DENIED} errorLabel="La requête a échoué." retryLabel="Réessayer" />
        <AgentError
          error={TIMEOUT}
          errorLabel="La requête a échoué."
          retryLabel="Réessayer"
          retryable={isRetryableAgentError(TIMEOUT)}
          onRetry={() => {
            setRetryCount((current) => current + 1);
          }}
        />
        <p className="kit-caption">Reprises de démonstration sur l’erreur rejouable : {String(retryCount)}.</p>
      </div>
    </article>
  );
}
