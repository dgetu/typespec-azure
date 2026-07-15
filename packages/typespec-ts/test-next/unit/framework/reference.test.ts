import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import type { ReferenceableSymbol } from "../../../src/framework/dependency.js";
import {
  SourceFileSymbol,
  type StaticHelperMetadata,
} from "../../../src/framework/load-static-helpers.js";
import { resolveReference } from "../../../src/framework/reference.js";
import { refkey } from "../../../src/framework/refkey.js";

describe("reference", () => {
  it("constructs exact placeholders without binder context", () => {
    const objectKey = {};
    expect(resolveReference("plain")).toBe("__PLACEHOLDER_plain__");
    expect(resolveReference(objectKey)).toBe(`__PLACEHOLDER_${refkey(objectKey)}__`);
  });

  it("normalizes external dependencies and static helpers without binder context", () => {
    const dependency: ReferenceableSymbol = {
      kind: "externalDependency",
      name: "Client",
      module: "@azure-rest/core-client",
    };
    const helper: StaticHelperMetadata = {
      kind: "function",
      location: "helpers.ts",
      name: "helper",
      [SourceFileSymbol]: new Project().createSourceFile("helpers.ts"),
    };

    expect(resolveReference(dependency)).toBe(`__PLACEHOLDER_${refkey(dependency)}__`);
    expect(resolveReference(helper)).toBe(`__PLACEHOLDER_${refkey(helper)}__`);
  });
});
