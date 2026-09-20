import { CLIENT_CODES, invalidRequest, localError } from "./errors.js";

export const SPACE_ID = /^corp_[0-9a-f]{32}$/u;
export const THREAD_ID = /^pth_[a-f0-9]{32}$/u;
export const AGENT_ID = /^agt_[a-f0-9]{32}$/u;
export const AGENT_REVISION_ID = /^agr_[a-f0-9]{32}$/u;
export const PUBLIC_RELEASE_ID = /^prl_[0-9a-f]{32}$/u;
export const PUBLIC_SESSION_TOKEN = /^pss_[A-Za-z0-9_-]{43}$/u;
export const DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export const RFC_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const EXPERT_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
export const TENANT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/u;
export const MAX_SPACES = 8;
export const MAX_EXPERTS = 3;
export const MAX_QUESTION = 2000;
export const MAX_TITLE = 200;
export const MAX_CURSOR = 1024;
export const MAX_PAGE = 25;
/** Detail `messages` is complete rows plus unmatched requests; server request ledger cap. */
export const MAX_THREAD_HISTORY = 40;
export const MAX_DOCUMENTS_FILTER = 200;

export function parseTenantId(value: string): string {
  if (typeof value !== "string" || !TENANT_ID.test(value)) {
    throw localError(CLIENT_CODES.INVALID_TENANT, "tenantId must be a bounded opaque identifier.");
  }
  return value;
}

export function parseSpaceId(value: string): string {
  if (typeof value !== "string" || !SPACE_ID.test(value)) {
    throw invalidRequest("space_id must match corp_ plus 32 hex characters.");
  }
  return value;
}

export function parseSpaceIds(values: readonly string[]): string[] {
  const items = unknownItems(values);
  if (items === null || items.length < 1 || items.length > MAX_SPACES) {
    throw invalidRequest("space_ids must contain 1 to 8 distinct private space ids.");
  }
  const copied: string[] = [];
  const seen = new Set<string>();
  for (const entry of items) {
    if (typeof entry !== "string") {
      throw invalidRequest("space_id must match corp_ plus 32 hex characters.");
    }
    const id = parseSpaceId(entry);
    if (seen.has(id)) throw invalidRequest("space_ids must be distinct.");
    seen.add(id);
    copied.push(id);
  }
  return copied;
}

export function parseThreadId(value: string): string {
  if (typeof value !== "string" || !THREAD_ID.test(value)) {
    throw invalidRequest("thread id must match pth_ plus 32 hex characters.");
  }
  return value;
}

export function parseAgentId(value: string): string {
  if (typeof value !== "string" || !AGENT_ID.test(value)) {
    throw invalidRequest("agent id must match agt_ plus 32 lowercase hex characters.");
  }
  return value;
}

export function parsePublicReleaseId(value: string): string {
  if (typeof value !== "string" || !PUBLIC_RELEASE_ID.test(value)) {
    throw invalidRequest("releaseId must match prl_ plus 32 lowercase hex characters.");
  }
  return value;
}

export function parseDocumentId(value: string): string {
  if (typeof value !== "string" || !DOCUMENT_ID.test(value)) {
    throw invalidRequest("document id is not a valid path segment.");
  }
  return value;
}

export function parseUuid(value: string, label: string): string {
  if (typeof value !== "string" || !RFC_UUID.test(value)) {
    throw invalidRequest(`${label} must be an RFC UUID (versions 1-8).`);
  }
  return value;
}

/** Case-insensitive UUID equality. parseUuid keeps the caller-owned spelling. */
export function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function parseExpertIds(values: readonly string[]): string[] {
  const items = unknownItems(values);
  if (items === null || items.length > MAX_EXPERTS) {
    throw invalidRequest("expert_ids must contain at most 3 distinct catalogue ids.");
  }
  const copied: string[] = [];
  const seen = new Set<string>();
  for (const entry of items) {
    if (typeof entry !== "string" || !EXPERT_ID.test(entry)) {
      throw invalidRequest("expert_ids must be opaque catalogue ids.");
    }
    if (seen.has(entry)) throw invalidRequest("expert_ids must be distinct.");
    seen.add(entry);
    copied.push(entry);
  }
  return copied;
}

function unknownItems(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const items: unknown[] = [];
  for (const item of value) {
    items.push(item);
  }
  return items;
}

export function encodeSegment(id: string): string {
  return encodeURIComponent(id);
}

export function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
