import { ClerkProvider, SignIn, useAuth } from "@clerk/react";
import type { ReactElement } from "react";
import { InternalAgentChat } from "./internal-agent-chat.js";
import type { LiveConfig } from "./live-config.js";

export function LiveShell({ config }: { readonly config: LiveConfig }): ReactElement {
  return (
    <ClerkProvider publishableKey={config.publishableKey}>
      <LiveSession config={config} />
    </ClerkProvider>
  );
}

export default LiveShell;

function LiveSession({ config }: { readonly config: LiveConfig }): ReactElement {
  const auth = useAuth();
  if (!auth.isLoaded) {
    return <p>Chargement de la session Clerk…</p>;
  }
  if (!auth.isSignedIn) {
    return (
      <div className="kit-live-sign-in">
        <p>
          Connexion professionnelle requise sur la même instance Clerk que l’API Selvren. Ce mode n’est pas un accès
          anonyme.
        </p>
        <SignIn routing="hash" />
      </div>
    );
  }
  return (
    <div>
      <p className="kit-live-note" role="status">
        Session authentifiée — appels réels vers l’API. L’agent doit être publié ; les droits sont accordés côté
        serveur.
      </p>
      <InternalAgentChat apiOrigin={config.apiOrigin} agentId={config.agentId} revision="published" />
    </div>
  );
}
