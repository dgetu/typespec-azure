import { createDefaultHttpClient, createPipelineRequest } from "@azure/core-rest-pipeline";
import { assert, beforeEach, describe, it } from "vitest";

import { ResiliencyServiceDrivenClient } from "./generated/resiliency/srv-driven-old/src/index.js";
describe("Service Driven old Client v1", () => {
  let client: ResiliencyServiceDrivenClient;

  beforeEach(() => {
    client = new ResiliencyServiceDrivenClient("http://localhost:3002", "v1", {
      allowInsecureConnection: true,
      apiVersion: "v1",
    });
  });

  it("should work with none parameter", async () => {
    const result = await client.fromNone();
    assert.isUndefined(result);
  });

  it("should work with one optional parameter", async () => {
    const result = await client.fromOneOptional({
      parameter: "optional",
    });
    assert.isUndefined(result);
  });

  it("should work with one required parameter", async () => {
    const result = await client.fromOneRequired("required");
    assert.isUndefined(result);
  });
});
describe("Service Driven old Client v2", () => {
  let client: ResiliencyServiceDrivenClient;

  beforeEach(() => {
    client = new ResiliencyServiceDrivenClient("http://localhost:3002", "v2", {
      allowInsecureConnection: true,
      apiVersion: "v1",
    });
  });

  it("should work with none parameter", async () => {
    const result = await client.fromNone();
    assert.isUndefined(result);
  });

  it("should work with one optional parameter", async () => {
    const result = await client.fromOneOptional({
      parameter: "optional",
    });
    assert.isUndefined(result);
  });

  it("should work with one required parameter", async () => {
    const result = await client.fromOneRequired("required");
    assert.isUndefined(result);
  });

  it("should call a new operation through the raw pipeline", async () => {
    const breakTheGlassClient = new ResiliencyServiceDrivenClient("http://localhost:3002", "v2", {
      allowInsecureConnection: true,
      apiVersion: "v2",
    });
    const response = await breakTheGlassClient.pipeline.sendRequest(
      createDefaultHttpClient(),
      createPipelineRequest({
        url: "http://localhost:3002/resiliency/service-driven/client:v1/service:v2/api-version:v2/add-operation",
        method: "DELETE",
        allowInsecureConnection: true,
      }),
    );
    assert.equal(response.status, 204);
  });
});
