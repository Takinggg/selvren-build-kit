import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

export interface RenderResult {
  readonly container: HTMLElement;
  readonly rerender: (node: ReactNode) => void;
  readonly unmount: () => void;
}

interface Mounted {
  root: Root;
  container: HTMLElement;
}

const mounted = new Set<Mounted>();

export function render(node: ReactNode): RenderResult {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const entry: Mounted = { root, container };
  mounted.add(entry);
  act(() => {
    root.render(node);
  });
  return {
    container,
    rerender: (node: ReactNode): void => {
      act(() => {
        root.render(node);
      });
    },
    unmount: (): void => {
      if (!mounted.has(entry)) return;
      mounted.delete(entry);
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  for (const entry of [...mounted]) {
    mounted.delete(entry);
    act(() => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
});

export function setTextarea(element: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

export function click(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}
