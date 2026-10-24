import assert from "node:assert/strict";
import test from "node:test";
import { gatewayActualCost } from "@aihot/backend/providers/actual-cost";

test("gateway fee is actual only when amount and currency are explicitly reported", () => {
  assert.deepEqual(gatewayActualCost({ usage: { total_tokens: 50, cost: 0.012, currency: "USD" } }), { amount: 0.012, currency: "USD", basis: "actual" });
  assert.deepEqual(gatewayActualCost({ billing: { amount: "0.08", currency: "RMB" } }), { amount: 0.08, currency: "CNY", basis: "actual" });
  assert.equal(gatewayActualCost({ usage: { prompt_tokens: 10, completion_tokens: 20 } }), null);
  assert.equal(gatewayActualCost({ cost: 0.1 }), null);
  assert.equal(gatewayActualCost({ cost: 0.1, currency: "USD", cost_basis: "estimated" }), null);
});
