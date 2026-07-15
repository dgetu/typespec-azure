export interface DiscriminatedUnionSubtypeInput<Model = unknown> {
  readonly model: Model;
  readonly name: string;
  readonly discriminatorValues: readonly string[];
}

export interface DiscriminatedUnionInput<Model = unknown> {
  readonly model: Model;
  readonly name: string;
  readonly discriminator?: {
    readonly clientPropertyName: string;
    readonly wirePropertyName: string;
  };
  readonly subtypes: readonly DiscriminatedUnionSubtypeInput<Model>[];
}
