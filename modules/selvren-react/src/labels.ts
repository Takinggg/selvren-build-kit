import type { AgentChatLabels } from "./types.js";

export const DEFAULT_LABELS: AgentChatLabels = {
  landmark: "Conversation avec l’agent",
  input: "Votre question",
  submit: "Envoyer",
  cancel: "Annuler",
  retry: "Réessayer",
  loading: "Réponse en cours",
  error: "La requête a échoué.",
  sources: "Sources",
  empty: "Aucune conversation pour le moment.",
  assistant: "Assistant",
  user: "Vous",
};

export function mergeLabels(overrides: Partial<AgentChatLabels> | undefined): AgentChatLabels {
  if (overrides === undefined) return DEFAULT_LABELS;
  return { ...DEFAULT_LABELS, ...overrides };
}
