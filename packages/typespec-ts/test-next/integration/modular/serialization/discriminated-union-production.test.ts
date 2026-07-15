import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { emitModularModelsFromTypeSpec } from "../../../../test/util/emit-util.js";

function expectCompiles(source: string): void {
  const fileName = resolve("test-next/integration/modular/serialization/discriminated-union.ts");
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fileName
      ? ts.createSourceFile(path, source, languageVersion, true)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  host.writeFile = () => undefined;
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([fileName], options, host));
  expect(diagnostics, ts.formatDiagnostics(diagnostics, host)).toEqual([]);
}

async function emitWithCollision(occupied: "requestSerializer" | "requestDeserializer") {
  return emitModularModelsFromTypeSpec(
    `
      @clientName("$DO_NOT_NORMALIZE$${occupied}", "javascript")
      model Occupied { value: string; }
      @discriminator("kind") model Document { @encodedName("application/json", "Kind") kind: string; }
      model Request extends Document { kind: "request"; }
      @route("/documents") interface Service {
        process(@body body: Document, @query occupied: Occupied): Document;
      }`,
    { needTCGC: true },
  );
}

describe("discriminated-union production", () => {
  it.each([
    ["requestSerializer", "requestSerializer_1", "requestDeserializer"],
    ["requestDeserializer", "requestDeserializer_1", "requestSerializer"],
  ] as const)(
    "resolves the independent %s collision and compiles",
    async (occupied, selected, other) => {
      const models = await emitWithCollision(occupied);
      expect(models!.getFunctionOrThrow(selected)).toBeDefined();
      expect(models!.getFunctionOrThrow(other)).toBeDefined();
      expect(models!.getFunctionOrThrow("documentUnionSerializer").getBodyText()).toContain(
        occupied === "requestSerializer"
          ? "return requestSerializer_1"
          : "return requestSerializer",
      );
      expect(models!.getFunctionOrThrow("documentUnionDeserializer").getBodyText()).toMatch(
        /switch \(item\["Kind"\]\)/,
      );
      expectCompiles(models!.getFullText());
    },
  );

  it("preserves serializer and deserializer zero-case wrappers", async () => {
    const serializerZero = await emitModularModelsFromTypeSpec(
      `@discriminator("kind") model Base { kind: string; } model Response extends Base { kind: "response"; }
       @route("/documents") interface Service { process(@body body: Base): Response; }`,
      { needTCGC: true },
    );
    const deserializerZero = await emitModularModelsFromTypeSpec(
      `@discriminator("kind") model Base { kind: string; } model Request extends Base { kind: "request"; }
       @route("/documents") interface Service { process(@body body: Request): Base; }`,
      { needTCGC: true },
    );
    expect(serializerZero!.getFunctionOrThrow("baseUnionSerializer").getBodyText()).toMatch(
      /default:\s+return baseSerializer\(item\);/,
    );
    expect(deserializerZero!.getFunctionOrThrow("baseUnionDeserializer").getBodyText()).toMatch(
      /default:\s+return baseDeserializer\(item\);/,
    );
  });
});
