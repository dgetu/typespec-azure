import { Data, Effect, Either } from "effect";
import type { DiscriminatedUnionInput, DiscriminatedUnionSubtypeInput } from "./input.js";

export type SerializationDirection = "serializer" | "deserializer";

export type InvalidDiscriminatedUnionError = Data.TaggedEnum<{
  MissingDiscriminator: { readonly message: string };
  MissingDiscriminatorValue: { readonly message: string };
  DuplicateDiscriminatorValue: { readonly message: string };
}>;

const InvalidDiscriminatedUnionError = Data.taggedEnum<InvalidDiscriminatedUnionError>();

export interface RefinedDiscriminatedUnion<Model = unknown> {
  readonly direction: SerializationDirection;
  readonly model: Model;
  readonly proposedName: string;
  readonly discriminatorPropertyName: string;
  readonly subtypes: readonly DiscriminatedUnionSubtypeInput<Model>[];
}

export function effectFromEither<A, E>(either: Either.Either<A, E>): Effect.Effect<A, E> {
  return Either.match(either, {
    onLeft: Effect.fail,
    onRight: Effect.succeed,
  });
}

export const refineDiscriminatedUnion =
  (direction: SerializationDirection) =>
  <Model>(
    input: DiscriminatedUnionInput<Model>,
  ): Either.Either<RefinedDiscriminatedUnion<Model>, InvalidDiscriminatedUnionError> => {
    if (!input.discriminator) {
      return Either.left(
        InvalidDiscriminatedUnionError.MissingDiscriminator({
          message: `Discriminated union ${input.name} requires a discriminator.`,
        }),
      );
    }

    const owners = new Map<string, string>();
    for (const subtype of input.subtypes) {
      if (subtype.discriminatorValues.length === 0) {
        return Either.left(
          InvalidDiscriminatedUnionError.MissingDiscriminatorValue({
            message: `Discriminated-union subtype ${subtype.name} requires a discriminator value.`,
          }),
        );
      }
      for (const value of subtype.discriminatorValues) {
        const owner = owners.get(value);
        if (owner) {
          return Either.left(
            InvalidDiscriminatedUnionError.DuplicateDiscriminatorValue({
              message: `Discriminated-union discriminator value ${JSON.stringify(value)} is owned by both ${owner} and ${subtype.name}.`,
            }),
          );
        }
        owners.set(value, subtype.name);
      }
    }

    return Either.right({
      direction,
      model: input.model,
      proposedName: `${input.name}${direction === "serializer" ? "Serializer" : "Deserializer"}`,
      discriminatorPropertyName:
        direction === "serializer"
          ? input.discriminator.clientPropertyName
          : input.discriminator.wirePropertyName,
      subtypes: input.subtypes,
    });
  };
