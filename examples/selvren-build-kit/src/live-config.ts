export interface LiveConfig {
  readonly publishableKey: string;
  readonly apiOrigin: string;
  readonly agentId: string;
}

export type LiveConfigResult =
  | { readonly ok: true; readonly config: LiveConfig }
  | { readonly ok: false; readonly message: string };

const AGENT_ID = /^agt_[0-9a-f]{32}$/u;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function readLiveConfig(): LiveConfigResult {
  const publishableKey = envValue("VITE_CLERK_PUBLISHABLE_KEY");
  const apiOrigin = envValue("VITE_SELVREN_API_ORIGIN");
  const agentId = envValue("VITE_SELVREN_AGENT_ID");
  const missing = missingNames(publishableKey, apiOrigin, agentId);
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Configuration incomplète : ${missing.join(", ")}. Copiez .env.example vers .env. Aucune réponse fictive n’est affichée en mode authentifié.`,
    };
  }
  const keyError = publishableKeyError(publishableKey);
  if (keyError !== undefined) return { ok: false, message: keyError };
  const origin = parseOrigin(apiOrigin);
  if (origin === undefined) {
    return {
      ok: false,
      message:
        "VITE_SELVREN_API_ORIGIN must be an HTTPS origin (HTTP only on loopback), without path, query, hash or userinfo.",
    };
  }
  if (!AGENT_ID.test(agentId)) {
    return { ok: false, message: "VITE_SELVREN_AGENT_ID must be agt_ plus 32 lowercase hex characters." };
  }
  return { ok: true, config: { publishableKey, apiOrigin: origin, agentId } };
}

function envValue(name: "VITE_CLERK_PUBLISHABLE_KEY" | "VITE_SELVREN_API_ORIGIN" | "VITE_SELVREN_AGENT_ID"): string {
  const value = import.meta.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function missingNames(publishableKey: string, apiOrigin: string, agentId: string): string[] {
  const missing: string[] = [];
  if (publishableKey.length < 1) missing.push("VITE_CLERK_PUBLISHABLE_KEY");
  if (apiOrigin.length < 1) missing.push("VITE_SELVREN_API_ORIGIN");
  if (agentId.length < 1) missing.push("VITE_SELVREN_AGENT_ID");
  return missing;
}

function publishableKeyError(value: string): string | undefined {
  if (value.startsWith("sk_") || value.startsWith("selvren_int_") || value.startsWith("selvren_private_")) {
    return "VITE_CLERK_PUBLISHABLE_KEY must be a Clerk publishable key. Do not put a secret in the browser.";
  }
  if (!value.startsWith("pk_test_") && !value.startsWith("pk_live_")) {
    return "VITE_CLERK_PUBLISHABLE_KEY must start with pk_test_ or pk_live_.";
  }
  return undefined;
}

function parseOrigin(value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    return undefined;
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") return undefined;
  if (parsed.protocol === "https:") return parsed.origin;
  if (parsed.protocol === "http:" && LOOPBACK.has(parsed.hostname)) return parsed.origin;
  return undefined;
}
