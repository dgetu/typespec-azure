import { Effect, Either } from "effect";
import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { provideBinder } from "../../../src/framework/hooks/binder.js";
import { resolveReference } from "../../../src/framework/reference.js";
import {
  DeclarationRegistration,
  DeclarationRegistrationError,
  generateModularSources,
  InvalidRegistrationReceiptsError,
  LinkResolution,
  LinkResolutionError,
  makeInMemorySourceGenerationLayer,
  makeProductionSourceGenerationLayer,
} from "../../../src/framework/source-generation.js";

describe("source generation", () => {
  it("delegates collision selection and reference linking to the production binder", async () => {
    const project = new Project();
    const declarations = project.createSourceFile("src/declarations.ts");
    const consumer = project.createSourceFile("src/consumer.ts");
    const binder = provideBinder(project);
    const selectedNames: string[] = [];
    const secondKey = Symbol("second");

    await Effect.runPromise(
      generateModularSources({ sourceRoot: "src" }, (registry) =>
        Effect.gen(function* () {
          for (const referenceKey of [Symbol("first"), secondKey]) {
            yield* registry.register({
              referenceKey,
              proposedName: "Widget",
              collisionScope: declarations,
              commit: (selectedName) => {
                selectedNames.push(selectedName);
                declarations.addTypeAlias({ name: selectedName, type: "string", isExported: true });
              },
            });
          }
          consumer.addTypeAlias({
            name: "UsesWidget",
            type: resolveReference(secondKey),
          });
        }),
      ).pipe(Effect.provide(makeProductionSourceGenerationLayer(binder))),
    );

    expect(selectedNames).toEqual(["Widget", "Widget_1"]);
    expect(consumer.getFullText()).toContain('import { Widget_1 } from "./declarations.js";');
    expect(consumer.getTypeAliasOrThrow("UsesWidget").getTypeNodeOrThrow().getText()).toBe(
      "Widget_1",
    );
  });

  it("substitutes the in-memory layer and links after the producer", async () => {
    const events: string[] = [];
    const selectedNames: string[] = [];
    const scope = {};

    await Effect.runPromise(
      generateModularSources({ sourceRoot: "source" }, (registry) =>
        Effect.gen(function* () {
          events.push("producer-start");
          for (const referenceKey of ["one", "two"]) {
            yield* registry.register({
              referenceKey,
              proposedName: "Name",
              collisionScope: scope,
              commit: (name) => selectedNames.push(name),
            });
          }
          events.push("producer-end");
        }),
      ).pipe(
        Effect.provide(
          makeInMemorySourceGenerationLayer({
            onLink: ({ sourceRoot }) => events.push(`link:${sourceRoot}`),
          }),
        ),
      ),
    );

    expect(selectedNames).toEqual(["Name", "Name_1"]);
    expect(events).toEqual(["producer-start", "producer-end", "link:source"]);
  });

  it("reports an injected registration failure from the fixed workflow", async () => {
    const committed: string[] = [];
    const cause = new Error("injected registration failure");

    const result = await Effect.runPromise(
      generateModularSources({ sourceRoot: "source" }, (registry) =>
        Effect.gen(function* () {
          for (const referenceKey of ["one", "two", "three"]) {
            yield* registry.register({
              referenceKey,
              proposedName: "Name",
              collisionScope: "scope",
              commit: (name) => committed.push(name),
            });
          }
        }),
      ).pipe(
        Effect.provide(
          makeInMemorySourceGenerationLayer({
            fail: { at: "registration", attempt: 2, cause },
          }),
        ),
        Effect.either,
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(DeclarationRegistrationError);
      expect(result.left.cause).toBe(cause);
    }
    expect(committed).toEqual(["Name"]);
  });

  it("reports an injected link failure from the fixed workflow after production", async () => {
    const events: string[] = [];
    const cause = new Error("injected link failure");

    const result = await Effect.runPromise(
      generateModularSources({ sourceRoot: "source" }, (registry) =>
        registry
          .register({
            referenceKey: "one",
            proposedName: "Name",
            collisionScope: "scope",
            commit: (name) => events.push(`commit:${name}`),
          })
          .pipe(Effect.asVoid),
      ).pipe(
        Effect.provide(makeInMemorySourceGenerationLayer({ fail: { at: "link", cause } })),
        Effect.either,
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(LinkResolutionError);
      expect(result.left.cause).toBe(cause);
    }
    expect(events).toEqual(["commit:Name"]);
  });

  it("isolates overlapping in-memory layer capsules when one fails", async () => {
    const scope = {};
    const key = Symbol("shared-key");
    const leftNames: string[] = [];
    const rightNames: string[] = [];
    const cause = new Error("left capsule failed");
    const run = (names: string[], layer: ReturnType<typeof makeInMemorySourceGenerationLayer>) =>
      generateModularSources({ sourceRoot: "shared" }, (registry) =>
        Effect.gen(function* () {
          yield* Effect.yieldNow();
          for (let index = 0; index < 2; index++) {
            yield* registry.register({
              referenceKey: key,
              proposedName: "Shared",
              collisionScope: scope,
              commit: (name) => names.push(name),
            });
            yield* Effect.yieldNow();
          }
        }),
      ).pipe(Effect.provide(layer));

    const [left, right] = await Effect.runPromise(
      Effect.all(
        [
          run(
            leftNames,
            makeInMemorySourceGenerationLayer({
              fail: { at: "registration", attempt: 2, cause },
            }),
          ).pipe(Effect.either),
          run(rightNames, makeInMemorySourceGenerationLayer()).pipe(Effect.either),
        ],
        { concurrency: "unbounded" },
      ),
    );

    expect(Either.isLeft(left)).toBe(true);
    expect(Either.isRight(right)).toBe(true);
    expect(leftNames).toEqual(["Shared"]);
    expect(rightNames).toEqual(["Shared", "Shared_1"]);
  });

  it("consumes the exact receipt sequence only once with a typed failure", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const registration = yield* DeclarationRegistration;
        const resolution = yield* LinkResolution;
        const receipt = yield* registration.register({
          referenceKey: "one",
          proposedName: "Name",
          collisionScope: {},
          commit: () => {},
        });
        yield* resolution.resolve([receipt], { sourceRoot: "source" });
        return yield* resolution.resolve([receipt], { sourceRoot: "source" }).pipe(Effect.flip);
      }).pipe(Effect.provide(makeInMemorySourceGenerationLayer())),
    );

    expect(error).toBeInstanceOf(InvalidRegistrationReceiptsError);
  });

  it("reports registration adapter failures in the typed error channel", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const registration = yield* DeclarationRegistration;
        return yield* registration
          .register({
            referenceKey: "one",
            proposedName: "Name",
            collisionScope: {},
            commit: () => {
              throw new Error("commit failed");
            },
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(makeInMemorySourceGenerationLayer())),
    );

    expect(error).toBeInstanceOf(DeclarationRegistrationError);
  });

  it("rejects registration after terminal resolution", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const registration = yield* DeclarationRegistration;
        const resolution = yield* LinkResolution;
        yield* resolution.resolve([], { sourceRoot: "source" });
        return yield* registration
          .register({
            referenceKey: "late",
            proposedName: "Late",
            collisionScope: {},
            commit: () => {},
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(makeInMemorySourceGenerationLayer())),
    );

    expect(error).toBeInstanceOf(DeclarationRegistrationError);
  });

  it("does not reserve a production name when declaration commit fails", async () => {
    const project = new Project();
    const sourceFile = project.createSourceFile("src/declarations.ts");
    const binder = provideBinder(project);

    const selectedName = await Effect.runPromise(
      Effect.gen(function* () {
        const registration = yield* DeclarationRegistration;
        yield* registration
          .register({
            referenceKey: "failed",
            proposedName: "Widget",
            collisionScope: sourceFile,
            commit: () => {
              throw new Error("commit failed");
            },
          })
          .pipe(Effect.flip);
        let selected = "";
        yield* registration.register({
          referenceKey: "succeeded",
          proposedName: "Widget",
          collisionScope: sourceFile,
          commit: (name) => {
            selected = name;
          },
        });
        return selected;
      }).pipe(Effect.provide(makeProductionSourceGenerationLayer(binder))),
    );

    expect(selectedName).toBe("Widget");
  });

  it("enters a failed terminal state when linking fails", async () => {
    let linkAttempts = 0;
    const layer = makeInMemorySourceGenerationLayer({
      onLink: () => {
        linkAttempts++;
        throw new Error("link failed");
      },
    });
    const errors = await Effect.runPromise(
      Effect.gen(function* () {
        const resolution = yield* LinkResolution;
        const first = yield* resolution.resolve([], { sourceRoot: "source" }).pipe(Effect.flip);
        const second = yield* resolution.resolve([], { sourceRoot: "source" }).pipe(Effect.flip);
        return [first, second] as const;
      }).pipe(Effect.provide(layer)),
    );

    expect(errors[0]).toBeInstanceOf(LinkResolutionError);
    expect(errors[1]).toBeInstanceOf(InvalidRegistrationReceiptsError);
    expect(linkAttempts).toBe(1);
  });

  it("collects concurrently requested registrations in issuance order", async () => {
    const committed: string[] = [];

    await Effect.runPromise(
      generateModularSources({ sourceRoot: "source" }, (registry) =>
        Effect.all(
          ["first", "second", "third"].map((referenceKey) =>
            registry.register({
              referenceKey,
              proposedName: "Name",
              collisionScope: {},
              commit: (selectedName) => committed.push(selectedName),
            }),
          ),
          { concurrency: "unbounded", discard: true },
        ),
      ).pipe(Effect.provide(makeInMemorySourceGenerationLayer())),
    );

    expect(committed).toEqual(["Name", "Name", "Name"]);
  });
});
