import type { DiscriminatedUnionSerializationPlan } from "./serialization-plan.js";

export interface DiscriminatedUnionRenderBindings<Model> {
  readonly subtypeDeclaration: (model: Model) => string;
  readonly subtypeType: (model: Model) => string;
  readonly legacyBase: () => string;
}

export function renderDiscriminatedUnionSerializationPlan<Model>(
  plan: DiscriminatedUnionSerializationPlan<Model>,
  bindings: DiscriminatedUnionRenderBindings<Model>,
): string {
  const discriminant =
    plan.direction === "serializer"
      ? `item.${plan.discriminatorPropertyName}`
      : `item[${JSON.stringify(plan.discriminatorPropertyName)}]`;
  const cases = plan.cases.map(
    ({ discriminatorValues, subtype }) => `
      ${discriminatorValues.map((value) => `case ${JSON.stringify(value)}:`).join("\n")}
        return ${bindings.subtypeDeclaration(subtype)}(item as ${bindings.subtypeType(subtype)});
    `,
  );

  return `
    switch (${discriminant}) {
     ${cases.join("\n")}
      default:
        return ${bindings.legacyBase()}(item);
    }
  `;
}
