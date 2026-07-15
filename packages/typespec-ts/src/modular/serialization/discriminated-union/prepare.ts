import { Effect, pipe } from "effect";
import type { FunctionDeclarationStructure, SourceFile } from "ts-morph";
import { resolveReference } from "../../../framework/reference.js";
import { enqueueStatement } from "../../../framework/source-file-batch.js";
import type { PreparedDeclaration } from "../../../framework/source-generation.js";
import type { DiscriminatedUnionInput } from "./input.js";
import {
  effectFromEither,
  refineDiscriminatedUnion,
  type InvalidDiscriminatedUnionError,
  type SerializationDirection,
} from "./refinement.js";
import { renderDiscriminatedUnionSerializationPlan } from "./render.js";
import {
  buildDiscriminatedUnionSerializationPlan,
  type DiscriminatedUnionSerializationPlan,
} from "./serialization-plan.js";

export interface DiscriminatedUnionDeclarationBindings<Model> {
  readonly input: DiscriminatedUnionInput<Model>;
  readonly direction: SerializationDirection;
  readonly sourceFile: SourceFile;
  readonly declaration: FunctionDeclarationStructure;
  readonly targetRefkey: unknown;
  readonly subtypeDeclarationRefkey: (model: Model) => unknown;
  readonly subtypeTypeRefkey: (model: Model) => unknown;
  readonly legacyBaseRefkey: unknown;
}

export function prepareDiscriminatedUnionDeclaration<Model>(
  bindings: DiscriminatedUnionDeclarationBindings<Model>,
): Effect.Effect<PreparedDeclaration, InvalidDiscriminatedUnionError> {
  return pipe(
    bindings.input,
    refineDiscriminatedUnion(bindings.direction),
    effectFromEither,
    Effect.map(buildDiscriminatedUnionSerializationPlan),
    Effect.map((plan) => prepareDeclaration(bindings, plan)),
  );
}

function prepareDeclaration<Model>(
  bindings: DiscriminatedUnionDeclarationBindings<Model>,
  plan: DiscriminatedUnionSerializationPlan<Model>,
): PreparedDeclaration {
  const statements = renderDiscriminatedUnionSerializationPlan(plan, {
    subtypeDeclaration: (model) => resolveReference(bindings.subtypeDeclarationRefkey(model)),
    subtypeType: (model) => resolveReference(bindings.subtypeTypeRefkey(model)),
    legacyBase: () => resolveReference(bindings.legacyBaseRefkey),
  });
  const { name: _name, statements: _statements, ...shell } = bindings.declaration;

  return {
    referenceKey: bindings.targetRefkey,
    proposedName: plan.proposedName,
    collisionScope: bindings.sourceFile,
    commit: (selectedName) => {
      enqueueStatement(bindings.sourceFile, { ...shell, name: selectedName, statements });
    },
  };
}
