import { expect, test } from "vitest";

import { ServiceTokenAuthenticator } from "../src/service-token.ts";

const token = "m6-service-token-abcdefghijklmnopqrstuvwxyz-0123456789";

test("accepts only an exact bearer token and returns a bounded audit actor", () => {
  const authenticator = new ServiceTokenAuthenticator(token, "nativepos-mcp");
  expect(authenticator.authenticate(`Bearer ${token}`)).toEqual({
    actorType: "api-token",
    actorId: "nativepos-mcp",
    source: "machine-api",
  });
  expect(authenticator.authenticate(undefined)).toBeNull();
  expect(authenticator.authenticate("Bearer wrong-token")).toBeNull();
  expect(authenticator.authenticate(`bearer ${token}`)).toBeNull();
  expect(authenticator.authenticate(`Bearer ${token} extra`)).toBeNull();
});

test("never exposes token material through serialization", () => {
  const authenticator = new ServiceTokenAuthenticator(token, "nativepos-mcp");
  expect(JSON.stringify(authenticator)).not.toContain(token);
  expect(String(authenticator)).not.toContain(token);
});
