import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as browser from "../src/browser.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const FORBIDDEN = new Set(["client.ts", "transport.ts", "service-token.ts", "stream.ts"]);

function walk(entry: string, seen = new Set<string>()): string[] {
  if (seen.has(entry)) return [...seen];
  seen.add(entry);
  const source = readFileSync(join(SRC, entry), "utf8");
  for (const match of source.matchAll(/from "\.\/([^"]+)\.js"/g)) {
    const imported = match[1];
    if (imported !== undefined) walk(`${imported}.ts`, seen);
  }
  return [...seen];
}

describe("browser entry", () => {
  it("does not export the credential client", () => {
    expect("SelvrenIntegrationClient" in browser).toBe(false);
    expect(typeof browser.createAgentTransport).toBe("function");
    expect(typeof browser.createSessionAgentTransport).toBe("function");
    expect(typeof browser.createPublicAgentTransport).toBe("function");
    expect(typeof browser.safeHref).toBe("function");
    expect(typeof browser.SelvrenIntegrationError).toBe("function");
  });

  it("does not import the service client, service token parser, or Node", () => {
    const files = walk("browser.ts");
    expect(files).toContain("public-agent-transport.ts");
    expect(files).toContain("session-agent-transport.ts");
    expect(files).toContain("http-core.ts");
    for (const file of files) {
      expect(FORBIDDEN.has(file)).toBe(false);
      const source = readFileSync(join(SRC, file), "utf8");
      expect(source).not.toMatch(/from ["']node:/);
      expect(source).not.toMatch(/from ["']\.\/service-token\.js["']/);
    }
    const publicSource = readFileSync(join(SRC, "public-agent-transport.ts"), "utf8");
    expect(publicSource).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});
