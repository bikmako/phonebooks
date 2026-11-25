import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../server/worker.js";

test("account requests use Workers-compatible fetch without following provider redirects", async t => {
  const appOrigin = "https://phonebooks.test";
  const providerOrigin = "https://accounts.test";
  const providerFetch = t.mock.method(globalThis, "fetch", async () => new Response(null, {
    status: 307,
    headers: { Location: "https://redirect.test/auth/v1/signup" },
  }));

  const response = await worker.fetch(new Request(appOrigin + "/api/auth/register", {
    method: "POST",
    headers: { Origin: appOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test@example.test", password: "test-password" }),
  }), { SUPABASE_URL: providerOrigin, SUPABASE_PUBLISHABLE_KEY: "test-key" });

  assert.equal(providerFetch.mock.callCount(), 1);
  assert.equal(providerFetch.mock.calls[0].arguments[0].href, providerOrigin + "/auth/v1/signup");
  assert.equal(providerFetch.mock.calls[0].arguments[1].redirect, "manual");
  assert.equal(response.status, 503);
  assert.equal(response.headers.has("Location"), false);
});
