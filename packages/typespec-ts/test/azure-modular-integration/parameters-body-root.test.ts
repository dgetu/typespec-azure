import { beforeEach, describe, it } from "vitest";

import { BodyRootClient } from "./generated/parameters/body-root/src/index.js";

describe("Parameters BodyRoot Client", () => {
  let client: BodyRootClient;

  beforeEach(() => {
    client = new BodyRootClient({
      endpoint: "http://localhost:3002",
      allowInsecureConnection: true,
      retryOptions: { maxRetries: 0 },
    });
  });

  it("should send a body root nested inside a wrapper", async () => {
    await client.nested({
      bodyRootParameters: {
        category: "widget",
        linkType: "hard",
        wasSuccessful: true,
      },
    });
  });
});
