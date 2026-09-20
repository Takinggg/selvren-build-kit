import { describe, expect, it } from "vitest";
import * as browser from "../src/browser.js";

describe("browser entry", () => {
  it("does not export the credential client", () => {
    expect("SelvrenIntegrationClient" in browser).toBe(false);
    expect(typeof browser.createAgentTransport).toBe("function");
    expect(typeof browser.createSessionAgentTransport).toBe("function");
    expect(typeof browser.safeHref).toBe("function");
    expect(typeof browser.SelvrenIntegrationError).toBe("function");
  });
});
