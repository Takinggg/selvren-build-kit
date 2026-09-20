import { useAuth } from "@clerk/react";
import { AgentChat } from "@selvren/react";
import { createSessionAgentTransport, SelvrenIntegrationError } from "@selvren/sdk/browser";
import { useMemo, type ReactElement } from "react";
import { firstPartyConversationKey } from "./conversation-key.js";

type SessionTransport = ReturnType<typeof createSessionAgentTransport>;

type TransportSetup =
  | { readonly ok: true; readonly transport: SessionTransport }
  | { readonly ok: false; readonly message: string };

/**
 * First-party chat for a host that already mounts ClerkProvider.
 * `getToken` is the Clerk session access token. Selvren verifies that
 * identity on the API. This component does not send end_user_ref.
 */
export function InternalAgentChat(props: {
  readonly apiOrigin: string;
  readonly agentId: string;
  readonly revision?: "published" | "draft" | undefined;
}): ReactElement {
  const auth = useAuth();
  const revision = props.revision ?? "published";
  const setup = useMemo((): TransportSetup => {
    try {
      return {
        ok: true,
        transport: createSessionAgentTransport({
          baseUrl: props.apiOrigin,
          agentId: props.agentId,
          getAccessToken: () => auth.getToken(),
          revision,
        }),
      };
    } catch (error: unknown) {
      return { ok: false, message: configurationErrorMessage(error) };
    }
  }, [props.apiOrigin, props.agentId, auth.getToken, revision]);

  if (!setup.ok) {
    return <p role="alert">{setup.message}</p>;
  }
  if (!auth.isLoaded) {
    return <p>Chargement de la session…</p>;
  }
  if (!auth.isSignedIn || typeof auth.userId !== "string" || auth.userId.length < 1) {
    return <p>Connexion professionnelle requise. Ce chat n’est pas un accès public anonyme.</p>;
  }

  const conversationKey = firstPartyConversationKey({
    userId: auth.userId,
    organizationId: auth.orgId,
    agentId: props.agentId,
    revision,
  });

  return <AgentChat conversationKey={conversationKey} transport={setup.transport} />;
}

function configurationErrorMessage(error: unknown): string {
  if (error instanceof SelvrenIntegrationError) {
    if (error.code === "INVALID_ORIGIN") {
      return "apiOrigin must be an HTTPS origin (HTTP only on loopback). Userinfo, query, hash and path are rejected.";
    }
    if (
      error.message.length > 0 &&
      error.message.length <= 300 &&
      !error.message.includes("<") &&
      !error.message.includes("selvren_int_")
    ) {
      return error.message;
    }
  }
  return "Invalid agent chat configuration. Check apiOrigin and agentId.";
}
