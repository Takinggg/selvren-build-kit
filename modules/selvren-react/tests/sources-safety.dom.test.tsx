import { describe, expect, it } from "vitest";
import { AnswerSources } from "../src/AnswerSources.js";
import { render } from "./render.js";

describe("AnswerSources safety", () => {
  it("renders excerpt and name as text and ignores javascript URLs", () => {
    const view = render(
      <AnswerSources
        heading="Sources"
        citations={[
          {
            id: "xss",
            documentName: "<img src=x>",
            excerpt: "<script>alert(1)</script>",
            location: "<b>p.1</b>",
            url: "javascript:alert(1)",
          },
        ]}
      />,
    );
    expect(view.container.querySelector("a")).toBeNull();
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.textContent).toContain("<img src=x>");
    expect(view.container.textContent).toContain("<script>alert(1)</script>");
    expect(view.container.textContent).toContain("<b>p.1</b>");
  });

  it("keeps http(s) links with rel noopener noreferrer", () => {
    const view = render(
      <AnswerSources
        heading="Sources"
        citations={[
          {
            id: "ok",
            documentName: "note.txt",
            excerpt: "Deux boulons.",
            location: null,
            url: "https://files.example.test/note.txt",
          },
        ]}
      />,
    );
    const anchor = view.container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://files.example.test/note.txt");
    expect(anchor?.getAttribute("rel")).toContain("noopener");
    expect(anchor?.getAttribute("rel")).toContain("noreferrer");
    expect(anchor?.getAttribute("target")).toBe("_blank");
  });
});
