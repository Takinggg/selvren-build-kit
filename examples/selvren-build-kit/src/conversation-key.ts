/**
 * Compose the UI conversationKey from a verified Clerk subject and the agent.
 * Do not take these values from a form field or query string.
 * The key isolates visible state; it is not an authority claim.
 */
export function firstPartyConversationKey(input: {
  readonly userId: string;
  readonly organizationId: string | null | undefined;
  readonly agentId: string;
  readonly revision: "published" | "draft";
}): string {
  if (typeof input.userId !== "string" || input.userId.trim() === "") {
    throw new Error("conversationKey requires a verified user id from the session.");
  }
  if (typeof input.agentId !== "string" || input.agentId.trim() === "") {
    throw new Error("conversationKey requires the agent id.");
  }
  const organizationId = input.organizationId;
  const subject =
    typeof organizationId === "string" && organizationId.trim() !== ""
      ? `${organizationId}:${input.userId}`
      : input.userId;
  return `${subject}:${input.agentId}:${input.revision}`;
}
