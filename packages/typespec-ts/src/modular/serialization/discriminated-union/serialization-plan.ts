import type { RefinedDiscriminatedUnion, SerializationDirection } from "./refinement.js";

export interface SubtypeSelectionCase<Model = unknown> {
  readonly discriminatorValues: readonly string[];
  readonly subtype: Model;
}

export interface DiscriminatedUnionSerializationPlan<Model = unknown> {
  readonly direction: SerializationDirection;
  readonly model: Model;
  readonly proposedName: string;
  readonly discriminatorPropertyName: string;
  readonly cases: readonly SubtypeSelectionCase<Model>[];
  readonly fallback: { readonly kind: "legacy-base" };
}

export function buildDiscriminatedUnionSerializationPlan<Model>(
  input: RefinedDiscriminatedUnion<Model>,
): DiscriminatedUnionSerializationPlan<Model> {
  return {
    direction: input.direction,
    model: input.model,
    proposedName: input.proposedName,
    discriminatorPropertyName: input.discriminatorPropertyName,
    cases: input.subtypes.map((subtype) => ({
      discriminatorValues: subtype.discriminatorValues,
      subtype: subtype.model,
    })),
    fallback: { kind: "legacy-base" },
  };
}
