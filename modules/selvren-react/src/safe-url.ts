/** http(s) only, no userinfo. Citation strings are never treated as HTML. */
export function safeHref(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 2048) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  if (parsed.username !== "" || parsed.password !== "") return undefined;
  if (parsed.hostname === "") return undefined;
  return parsed.toString();
}
