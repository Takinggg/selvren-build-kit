import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import * as browser from "../src/browser.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const FORBIDDEN_FILES = new Set(["client.ts", "transport.ts", "service-token.ts", "stream.ts"]);
const STORAGE_PATTERN = /localStorage|sessionStorage|document\.cookie/u;

type ImportKind = "static" | "reexport" | "side-effect" | "dynamic";
type RuntimeBucket = "node" | "service" | "private";

interface ModuleImport {
  readonly specifier: string;
  readonly kind: ImportKind;
  readonly typeOnly: boolean;
}

interface RuntimeModuleHit {
  readonly file: string;
  readonly specifier: string;
  readonly bucket: RuntimeBucket;
}

interface WalkResult {
  readonly files: string[];
  readonly runtimeModules: RuntimeModuleHit[];
}

function collectModuleImports(source: string, fileName = "module.ts"): ModuleImport[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports: ModuleImport[] = [];
  const visit = (node: ts.Node): void => {
    const collected = importFromNode(node);
    if (collected !== undefined) imports.push(collected);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function importFromNode(node: ts.Node): ModuleImport | undefined {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    return {
      specifier: node.moduleSpecifier.text,
      kind: node.importClause === undefined ? "side-effect" : "static",
      typeOnly: node.importClause === undefined ? false : isTypeOnlyImportClause(node.importClause),
    };
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
    return {
      specifier: node.moduleSpecifier.text,
      kind: "reexport",
      typeOnly: node.isTypeOnly || isTypeOnlyNamedExports(node.exportClause),
    };
  }
  const dynamic = literalDynamicImportSpecifier(node);
  if (dynamic !== undefined) return { specifier: dynamic, kind: "dynamic", typeOnly: false };
  return undefined;
}

function isTypeOnlyImportClause(clause: ts.ImportClause): boolean {
  if (clause.getFirstToken()?.kind === ts.SyntaxKind.TypeKeyword) return true;
  if (clause.name !== undefined) return false;
  const named = clause.namedBindings;
  if (named === undefined || !ts.isNamedImports(named) || named.elements.length === 0) return false;
  return named.elements.every((element) => element.isTypeOnly);
}

function isTypeOnlyNamedExports(clause: ts.NamedExportBindings | undefined): boolean {
  if (clause === undefined || !ts.isNamedExports(clause) || clause.elements.length === 0) return false;
  return clause.elements.every((element) => element.isTypeOnly);
}

function literalDynamicImportSpecifier(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) return undefined;
  const argument = node.arguments[0];
  if (argument === undefined || !ts.isStringLiteral(argument)) return undefined;
  return argument.text;
}

function resolveRelativeSpecifier(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
  const importerDir = posix.dirname(toPosix(importer));
  let resolved = posix.normalize(posix.join(importerDir, specifier));
  if (resolved === ".." || resolved.startsWith("../") || posix.isAbsolute(resolved)) return undefined;
  if (resolved.startsWith("./")) resolved = resolved.slice(2);
  if (resolved.endsWith(".js")) return `${resolved.slice(0, -3)}.ts`;
  if (resolved.endsWith(".ts")) return resolved;
  return `${resolved}.ts`;
}

function toPosix(file: string): string {
  return file.replaceAll("\\", "/");
}

function classifySpecifier(specifier: string, resolved: string | undefined): RuntimeBucket | "relative" | "external" {
  if (specifier.startsWith("node:")) return "node";
  const base = posix.basename(resolved ?? specifier.replace(/\.js$/u, ".ts"));
  if (base === "service-token.ts") return "service";
  if (FORBIDDEN_FILES.has(base)) return "private";
  if (specifier.startsWith("./") || specifier.startsWith("../")) return "relative";
  return "external";
}

function walkModuleGraph(entry: string, readSource: (file: string) => string): WalkResult {
  const seen = new Set<string>();
  const runtimeModules: RuntimeModuleHit[] = [];
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const item of collectModuleImports(readSource(file), file)) {
      const resolved = resolveRelativeSpecifier(file, item.specifier);
      const bucket = classifySpecifier(item.specifier, resolved);
      if (!item.typeOnly && (bucket === "node" || bucket === "service" || bucket === "private")) {
        runtimeModules.push({ file, specifier: item.specifier, bucket });
      }
      if (resolved !== undefined) visit(resolved);
    }
  };
  visit(entry);
  return { files: [...seen], runtimeModules };
}

function readSrc(file: string): string {
  return readFileSync(join(SRC, file), "utf8");
}

function isForbiddenFile(file: string): boolean {
  return FORBIDDEN_FILES.has(file) || FORBIDDEN_FILES.has(posix.basename(file));
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
    const files = walkModuleGraph("browser.ts", readSrc);
    expect(files.files).toContain("public-agent-transport.ts");
    expect(files.files).toContain("session-agent-transport.ts");
    expect(files.files).toContain("http-core.ts");
    expect(files.runtimeModules).toEqual([]);
    for (const file of files.files) {
      expect(isForbiddenFile(file)).toBe(false);
    }

    const publicGraph = walkModuleGraph("public-agent-transport.ts", readSrc);
    expect(publicGraph.files).toContain("public-agent-transport.ts");
    expect(publicGraph.files).toContain("http-core.ts");
    expect(publicGraph.runtimeModules).toEqual([]);
    for (const file of publicGraph.files) {
      expect(isForbiddenFile(file)).toBe(false);
      expect(readSrc(file)).not.toMatch(STORAGE_PATTERN);
    }
  });
});

describe("browser module graph helper", () => {
  it("walks static, reexport, side-effect, quoted dynamic, and parent imports with cycle tracking", () => {
    const sources: Record<string, string> = {
      "entry.ts": [
        `import { a } from "./nested/child.js";`,
        `export { b } from "./reexport.js";`,
        `import "./side.js";`,
        `void import("./dynamic-double.js");`,
        `void import('./dynamic-single.js');`,
        `import type { T } from "./types-only.js";`,
        `import { x } from './single-quote.js';`,
      ].join("\n"),
      "nested/child.ts": [
        `import { y } from "../up-from-nested.js";`,
        `import { z } from "./cycle-a.js";`,
      ].join("\n"),
      "nested/cycle-a.ts": `import { z } from "./cycle-b.js";`,
      "nested/cycle-b.ts": `import { z } from "./cycle-a.js";`,
      "up-from-nested.ts": "export const y = 1;",
      "reexport.ts": "export const b = 1;",
      "side.ts": "export {};",
      "dynamic-double.ts": "export {};",
      "dynamic-single.ts": "export {};",
      "types-only.ts": "export type T = string;",
      "single-quote.ts": "export const x = 1;",
    };
    const walked = walkModuleGraph("entry.ts", (file) => {
      const source = sources[file];
      if (source === undefined) throw new Error(`missing virtual module ${file}`);
      return source;
    });
    expect(walked.files.sort()).toEqual(
      [
        "dynamic-double.ts",
        "dynamic-single.ts",
        "entry.ts",
        "nested/child.ts",
        "nested/cycle-a.ts",
        "nested/cycle-b.ts",
        "reexport.ts",
        "side.ts",
        "single-quote.ts",
        "types-only.ts",
        "up-from-nested.ts",
      ].sort(),
    );
    expect(walked.runtimeModules).toEqual([]);
  });

  it("detects runtime node, service, and private modules and ignores type-only node specifiers", () => {
    const sources: Record<string, string> = {
      "bad.ts": [
        `import fs from "node:fs";`,
        `import { parseToken } from "./service-token.js";`,
        `import { SelvrenIntegrationClient } from "./client.js";`,
        `import { createTransport } from "./transport.js";`,
        `import { stream } from "./stream.js";`,
        `import type { Dirent } from "node:path";`,
      ].join("\n"),
      "service-token.ts": "export {};",
      "client.ts": "export {};",
      "transport.ts": "export {};",
      "stream.ts": "export {};",
    };
    const walked = walkModuleGraph("bad.ts", (file) => {
      const source = sources[file];
      if (source === undefined) throw new Error(`missing virtual module ${file}`);
      return source;
    });
    expect(walked.runtimeModules.map((hit) => `${hit.bucket}:${hit.specifier}`).sort()).toEqual(
      [
        "node:node:fs",
        "private:./client.js",
        "private:./stream.js",
        "private:./transport.js",
        "service:./service-token.js",
      ].sort(),
    );
    expect(walked.runtimeModules.some((hit) => hit.specifier === "node:path")).toBe(false);
  });
});
