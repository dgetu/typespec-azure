import { Effect, Either, Option } from "effect";
import { Project, StructureKind } from "ts-morph";
import { describe, expect, it } from "vitest";
import { provideBinder } from "../../../src/framework/hooks/binder.js";
import {
  generateModularSources,
  makeInMemorySourceGenerationLayer,
  makeProductionSourceGenerationLayer,
  type SourceGenerationRegistry,
} from "../../../src/framework/source-generation.js";
import type { DiscriminatedUnionInput } from "../../../src/modular/serialization/discriminated-union/input.js";
import { prepareDiscriminatedUnionDeclaration } from "../../../src/modular/serialization/discriminated-union/prepare.js";
import { refineDiscriminatedUnion } from "../../../src/modular/serialization/discriminated-union/refinement.js";
import { renderDiscriminatedUnionSerializationPlan } from "../../../src/modular/serialization/discriminated-union/render.js";
import { buildDiscriminatedUnionSerializationPlan } from "../../../src/modular/serialization/discriminated-union/serialization-plan.js";

function input(): DiscriminatedUnionInput<object> {
  return {
    model: {},
    name: "documentIngressUnion",
    discriminator: { clientPropertyName: "documentType", wirePropertyName: "DocumentType" },
    subtypes: [{ model: {}, name: "document", discriminatorValues: ["document", "legacy"] }],
  };
}

function registerUnion(
  registry: SourceGenerationRegistry,
  sourceFile: ReturnType<Project["createSourceFile"]>,
  targetRefkey: string,
  callbacks: { count: number },
  unionInput = input(),
) {
  return prepareDiscriminatedUnionDeclaration({
    input: unionInput,
    direction: "serializer",
    sourceFile,
    declaration: {
      kind: StructureKind.Function,
      name: "unused",
      parameters: [{ name: "item", type: "unknown" }],
      statements: "return item;",
    },
    targetRefkey,
    subtypeDeclarationRefkey: () => {
      callbacks.count++;
      return "subtype";
    },
    subtypeTypeRefkey: () => {
      callbacks.count++;
      return "type";
    },
    legacyBaseRefkey: "base",
  }).pipe(Effect.flatMap(registry.register));
}

describe("discriminated-union serialization", () => {
  it("refines directional names and discriminator properties", () => {
    const serializer = Either.getOrThrow(refineDiscriminatedUnion("serializer")(input()));
    const deserializer = Either.getOrThrow(refineDiscriminatedUnion("deserializer")(input()));

    expect(serializer.proposedName).toBe("documentIngressUnionSerializer");
    expect(deserializer.proposedName).toBe("documentIngressUnionDeserializer");
    expect(serializer.discriminatorPropertyName).toBe("documentType");
    expect(deserializer.discriminatorPropertyName).toBe("DocumentType");
  });

  it("returns tagged errors with exact codes for invalid unions", () => {
    const missing = refineDiscriminatedUnion("serializer")({
      ...input(),
      discriminator: undefined,
    });
    const empty = refineDiscriminatedUnion("serializer")({
      ...input(),
      subtypes: [{ model: {}, name: "empty", discriminatorValues: [] }],
    });
    const same = refineDiscriminatedUnion("serializer")({
      ...input(),
      subtypes: [{ model: {}, name: "same", discriminatorValues: ["x", "x"] }],
    });
    const shared = refineDiscriminatedUnion("deserializer")({
      ...input(),
      subtypes: [
        { model: {}, name: "first", discriminatorValues: ["a", "shared"] },
        { model: {}, name: "second", discriminatorValues: ["b", "shared"] },
      ],
    });

    const errors = [missing, empty, same, shared].map((result) =>
      Option.getOrThrow(Either.getLeft(result)),
    );

    expect(errors.map((error) => error._tag)).toEqual([
      "MissingDiscriminator",
      "MissingDiscriminatorValue",
      "DuplicateDiscriminatorValue",
      "DuplicateDiscriminatorValue",
    ]);
    expect(errors.map((error) => error.message)).toEqual([
      "Discriminated union documentIngressUnion requires a discriminator.",
      "Discriminated-union subtype empty requires a discriminator value.",
      'Discriminated-union discriminator value "x" is owned by both same and same.',
      'Discriminated-union discriminator value "shared" is owned by both first and second.',
    ]);
  });

  it("recovers from invalid unions with Effect.catchTag", () => {
    const invalid = { ...input(), discriminator: undefined };

    const recovered = Effect.runSync(
      prepareDiscriminatedUnionDeclaration({
        input: invalid,
        direction: "serializer",
        sourceFile: new Project().createSourceFile("models.ts"),
        declaration: { kind: StructureKind.Function, name: "unused", statements: "" },
        targetRefkey: "target",
        subtypeDeclarationRefkey: () => "subtype",
        subtypeTypeRefkey: () => "type",
        legacyBaseRefkey: "base",
      }).pipe(
        Effect.catchTag("MissingDiscriminator", (error) =>
          Effect.succeed(`missing-discriminator: ${error.message}`),
        ),
      ),
    );

    expect(recovered).toBe(
      "missing-discriminator: Discriminated union documentIngressUnion requires a discriminator.",
    );
  });

  it("retains multiple values, subtype calls, and explicit legacy-base fallback", () => {
    const plan = buildDiscriminatedUnionSerializationPlan(
      Either.getOrThrow(refineDiscriminatedUnion("serializer")(input())),
    );
    expect(plan.cases[0]?.discriminatorValues).toEqual(["document", "legacy"]);
    expect(plan.fallback).toEqual({ kind: "legacy-base" });
    expect(
      renderDiscriminatedUnionSerializationPlan(plan, {
        subtypeDeclaration: () => "documentSerializer",
        subtypeType: () => "Document",
        legacyBase: () => "documentIngressSerializer",
      }),
    ).toMatch(
      /case "document":\s+case "legacy":\s+return documentSerializer\(item as Document\);[\s\S]*default:\s+return documentIngressSerializer\(item\);/,
    );
  });

  it("rejects duplicates before refkey callbacks or source mutation", () => {
    const sourceFile = new Project().createSourceFile("models.ts");
    let callbacks = 0;
    const duplicate = {
      ...input(),
      subtypes: [{ model: {}, name: "duplicate", discriminatorValues: ["x", "x"] }],
    };

    const result = Effect.runSync(
      prepareDiscriminatedUnionDeclaration({
        input: duplicate,
        direction: "serializer",
        sourceFile,
        declaration: { kind: StructureKind.Function, name: "unused", statements: "" },
        targetRefkey: "target",
        subtypeDeclarationRefkey: () => {
          callbacks++;
          return "subtype";
        },
        subtypeTypeRefkey: () => {
          callbacks++;
          return "type";
        },
        legacyBaseRefkey: "base",
      }).pipe(Effect.either),
    );
    expect(Option.getOrThrow(Either.getLeft(result))).toMatchObject({
      _tag: "DuplicateDiscriminatorValue",
      message:
        'Discriminated-union discriminator value "x" is owned by both duplicate and duplicate.',
    });
    expect(callbacks).toBe(0);
    expect(sourceFile.getStatements()).toEqual([]);
  });

  it("keeps valid preparation side-effect-free until commit", () => {
    const project = new Project();
    provideBinder(project);
    const sourceFile = project.createSourceFile("prepared.ts");
    const prepared = Effect.runSync(
      prepareDiscriminatedUnionDeclaration({
        input: input(),
        direction: "serializer",
        sourceFile,
        declaration: {
          kind: StructureKind.Function,
          name: "documentIngressUnionSerializer",
          parameters: [{ name: "item", type: "unknown" }],
          statements: "return item;",
        },
        targetRefkey: "target",
        subtypeDeclarationRefkey: () => "subtype",
        subtypeTypeRefkey: () => "type",
        legacyBaseRefkey: "base",
      }),
    );

    expect(sourceFile.getFunctions()).toEqual([]);
    prepared.commit("documentIngressUnionSerializer_1");
    expect(sourceFile.getFunctionOrThrow("documentIngressUnionSerializer_1")).toBeDefined();
  });

  it("runs one workflow unchanged against production and in-memory layers", async () => {
    async function run(useProduction: boolean) {
      const project = new Project();
      const sourceFile = project.createSourceFile("src/models.ts");
      const binder = provideBinder(project);
      const callbacks = { count: 0 };
      const events: string[] = [];
      for (const [key, name] of [
        ["subtype", "Document"],
        ["type", "DocumentType"],
        ["base", "documentIngressSerializer"],
      ] as const) {
        binder.trackDeclaration(key, name, sourceFile);
      }
      const resolveAllReferences = binder.resolveAllReferences.bind(binder);
      binder.resolveAllReferences = (...args) => {
        resolveAllReferences(...args);
        events.push("link");
      };
      const layer = useProduction
        ? makeProductionSourceGenerationLayer(binder)
        : makeInMemorySourceGenerationLayer({
            onLink: () => events.push("link"),
          });

      await Effect.runPromise(
        generateModularSources({ sourceRoot: "src" }, (registry) =>
          Effect.gen(function* () {
            yield* registerUnion(registry, sourceFile, "first", callbacks);
            events.push(sourceFile.getFunctions()[0]?.getName() ?? "");
            yield* registerUnion(registry, sourceFile, "second", callbacks);
            events.push(sourceFile.getFunctions()[1]?.getName() ?? "");
          }),
        ).pipe(Effect.provide(layer)),
      );

      return { callbacks: callbacks.count, events, sourceFile };
    }

    const production = await run(true);
    const inMemory = await run(false);
    expect(production.events).toEqual([
      "documentIngressUnionSerializer",
      "documentIngressUnionSerializer_1",
      "link",
    ]);
    expect(inMemory.events).toEqual(production.events);
    expect(inMemory.callbacks).toBe(production.callbacks);
    expect(production.sourceFile.getFunctions().map((fn) => fn.getName())).toEqual(
      inMemory.sourceFile.getFunctions().map((fn) => fn.getName()),
    );
  });

  it("preserves typed duplicate preflight across production and in-memory layers", async () => {
    async function run(useProduction: boolean) {
      const project = new Project();
      const sourceFile = project.createSourceFile("src/models.ts");
      const binder = provideBinder(project);
      const callbacks = { count: 0 };
      const duplicate = {
        ...input(),
        subtypes: [{ model: {}, name: "duplicate", discriminatorValues: ["x", "x"] }],
      };
      const layer = useProduction
        ? makeProductionSourceGenerationLayer(binder)
        : makeInMemorySourceGenerationLayer();
      const result = await Effect.runPromise(
        generateModularSources({ sourceRoot: "src" }, (registry) =>
          registerUnion(registry, sourceFile, "target", callbacks, duplicate).pipe(Effect.asVoid),
        ).pipe(Effect.provide(layer), Effect.either),
      );
      return { callbacks: callbacks.count, result, sourceFile };
    }

    for (const outcome of [await run(true), await run(false)]) {
      expect(Option.getOrThrow(Either.getLeft(outcome.result))).toMatchObject({
        _tag: "DuplicateDiscriminatorValue",
      });
      expect(outcome.callbacks).toBe(0);
      expect(outcome.sourceFile.getFunctions()).toEqual([]);
    }
  });
});
