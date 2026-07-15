import { Context, Data, Effect, Layer, Ref } from "effect";
import type { SourceFile } from "ts-morph";
import { generateLocallyUniqueName } from "../modular/helpers/naming-helpers.js";
import type { Binder } from "./hooks/binder.js";

const RegistrationReceiptType: unique symbol = Symbol("RegistrationReceipt");

export interface RegistrationReceipt {
  readonly [RegistrationReceiptType]: typeof RegistrationReceiptType;
}

interface IssuedReceipt extends RegistrationReceipt {
  readonly session: symbol;
  readonly sequence: number;
}

export interface PreparedDeclaration {
  readonly referenceKey: unknown;
  readonly proposedName: string;
  readonly collisionScope: unknown;
  readonly commit: (selectedName: string) => void;
}

export interface LinkOptions {
  readonly sourceRoot: string;
  readonly testRoot?: string;
}

export class DeclarationRegistrationError extends Data.TaggedError("DeclarationRegistrationError")<{
  readonly cause: unknown;
}> {}

export class LinkResolutionError extends Data.TaggedError("LinkResolutionError")<{
  readonly cause: unknown;
}> {}

export class InvalidRegistrationReceiptsError extends Data.TaggedError(
  "InvalidRegistrationReceiptsError",
) {}

export interface DeclarationRegistrationService {
  readonly register: (
    declaration: PreparedDeclaration,
  ) => Effect.Effect<RegistrationReceipt, DeclarationRegistrationError>;
}

export class DeclarationRegistration extends Context.Tag("DeclarationRegistration")<
  DeclarationRegistration,
  DeclarationRegistrationService
>() {}

export interface LinkResolutionService {
  readonly resolve: (
    receipts: readonly RegistrationReceipt[],
    options: LinkOptions,
  ) => Effect.Effect<void, InvalidRegistrationReceiptsError | LinkResolutionError>;
}

export class LinkResolution extends Context.Tag("LinkResolution")<
  LinkResolution,
  LinkResolutionService
>() {}

interface SourceGenerationAdapter {
  readonly register: (declaration: PreparedDeclaration) => void;
  readonly link: (options: LinkOptions) => void;
}

interface SessionState {
  readonly issued: readonly IssuedReceipt[];
  readonly phase: "open" | "linking" | "succeeded" | "failed";
}

function makeSourceGenerationLayer(makeAdapter: () => SourceGenerationAdapter) {
  return Layer.effectContext(
    Effect.gen(function* () {
      const adapter = makeAdapter();
      const session = Symbol("SourceGenerationSession");
      const state = yield* Ref.make<SessionState>({ issued: [], phase: "open" });
      const mutex = yield* Effect.makeSemaphore(1);

      const registration: DeclarationRegistrationService = {
        register: (declaration) =>
          mutex.withPermits(1)(
            Effect.gen(function* () {
              const current = yield* Ref.get(state);
              if (current.phase !== "open") {
                return yield* new DeclarationRegistrationError({
                  cause: new Error("Source-generation registration is closed."),
                });
              }
              yield* Effect.try({
                try: () => adapter.register(declaration),
                catch: (cause) => new DeclarationRegistrationError({ cause }),
              });
              return yield* Ref.modify(state, (current) => {
                const receipt: IssuedReceipt = {
                  [RegistrationReceiptType]: RegistrationReceiptType,
                  session,
                  sequence: current.issued.length,
                };
                return [receipt, { ...current, issued: [...current.issued, receipt] }];
              });
            }),
          ),
      };

      const resolution: LinkResolutionService = {
        resolve: (receipts, options) =>
          mutex.withPermits(1)(
            Effect.gen(function* () {
              const accepted = yield* Ref.modify(state, (current) => {
                const exactSequence =
                  current.phase === "open" &&
                  receipts.length === current.issued.length &&
                  receipts.every((receipt, index) => receipt === current.issued[index]);
                return [
                  exactSequence,
                  exactSequence ? { ...current, phase: "linking" as const } : current,
                ];
              });
              if (!accepted) {
                return yield* new InvalidRegistrationReceiptsError();
              }
              yield* Effect.try({
                try: () => adapter.link(options),
                catch: (cause) => new LinkResolutionError({ cause }),
              }).pipe(
                Effect.tap(() =>
                  Ref.update(state, (current) => ({ ...current, phase: "succeeded" as const })),
                ),
                Effect.catchAll((error) =>
                  Ref.update(state, (current) => ({ ...current, phase: "failed" as const })).pipe(
                    Effect.zipRight(Effect.fail(error)),
                  ),
                ),
              );
            }),
          ),
      };

      return Context.make(DeclarationRegistration, registration).pipe(
        Context.add(LinkResolution, resolution),
      );
    }),
  );
}

export function makeProductionSourceGenerationLayer(binder: Binder) {
  return makeSourceGenerationLayer(() => ({
    register: (declaration) =>
      binder.registerDeclaration(
        declaration.referenceKey,
        declaration.proposedName,
        declaration.collisionScope as SourceFile,
        declaration.commit,
      ),
    link: ({ sourceRoot, testRoot }) => binder.resolveAllReferences(sourceRoot, testRoot),
  }));
}

export interface InMemorySourceGenerationOptions {
  readonly onLink?: (options: LinkOptions) => void;
  readonly fail?:
    | { readonly at: "registration"; readonly attempt: number; readonly cause: unknown }
    | { readonly at: "link"; readonly cause: unknown };
}

export function makeInMemorySourceGenerationLayer(options: InMemorySourceGenerationOptions = {}) {
  if (
    options.fail?.at === "registration" &&
    (!Number.isInteger(options.fail.attempt) || options.fail.attempt < 1)
  ) {
    throw new RangeError("Registration failure attempt must be a positive integer.");
  }

  return makeSourceGenerationLayer(() => {
    const namesByScope = new Map<unknown, Set<string>>();
    let registrationAttempt = 0;
    return {
      register: ({ collisionScope, proposedName, commit }) => {
        registrationAttempt++;
        if (options.fail?.at === "registration" && registrationAttempt === options.fail.attempt) {
          throw options.fail.cause;
        }
        const names = namesByScope.get(collisionScope) ?? new Set<string>();
        const selectedName = generateLocallyUniqueName(proposedName, names);
        commit(selectedName);
        names.add(selectedName);
        namesByScope.set(collisionScope, names);
      },
      link: (linkOptions) => {
        if (options.fail?.at === "link") {
          throw options.fail.cause;
        }
        options.onLink?.(linkOptions);
      },
    };
  });
}

export interface SourceGenerationRegistry {
  readonly register: (
    declaration: PreparedDeclaration,
  ) => Effect.Effect<RegistrationReceipt, DeclarationRegistrationError>;
}

export function generateModularSources<E, R>(
  options: LinkOptions,
  produce: (registry: SourceGenerationRegistry) => Effect.Effect<void, E, R>,
): Effect.Effect<
  void,
  E | DeclarationRegistrationError | InvalidRegistrationReceiptsError | LinkResolutionError,
  R | DeclarationRegistration | LinkResolution
> {
  return Effect.gen(function* () {
    const registration = yield* DeclarationRegistration;
    const resolution = yield* LinkResolution;
    const receipts: RegistrationReceipt[] = [];
    const receiptMutex = yield* Effect.makeSemaphore(1);
    const registry: SourceGenerationRegistry = {
      register: (declaration) =>
        receiptMutex.withPermits(1)(
          registration.register(declaration).pipe(
            Effect.tap((receipt) =>
              Effect.sync(() => {
                receipts.push(receipt);
              }),
            ),
          ),
        ),
    };
    yield* produce(registry);
    yield* resolution.resolve(receipts, options);
  });
}
