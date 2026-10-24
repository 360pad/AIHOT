type ActualCost = { amount: number; currency: "CNY" | "USD"; basis: "actual" };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function amount(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function currency(value: unknown): ActualCost["currency"] | null {
  const code = String(value ?? "").trim().toUpperCase();
  if (["CNY", "RMB", "YUAN", "¥"].includes(code)) return "CNY";
  if (["USD", "$"].includes(code)) return "USD";
  return null;
}

/** Only records an amount the gateway explicitly returned together with a recognized currency. */
export function gatewayActualCost(response: Record<string, unknown>): ActualCost | null {
  const usage = record(response.usage);
  const billing = record(response.billing);
  const candidates = [
    [response.cost, response.currency ?? response.cost_currency ?? response.currency_code],
    [response.cost_amount, response.currency ?? response.cost_currency ?? response.currency_code],
    [response.total_cost, response.currency ?? response.cost_currency ?? response.currency_code],
    [response.total_cost_amount, response.currency ?? response.cost_currency ?? response.currency_code],
    [usage.cost, usage.currency ?? usage.cost_currency ?? usage.currency_code ?? response.currency],
    [usage.total_cost, usage.currency ?? usage.cost_currency ?? usage.currency_code ?? response.currency],
    [billing.amount ?? billing.cost ?? billing.total_cost, billing.currency ?? response.currency],
  ];
  for (const [rawAmount, rawCurrency] of candidates) {
    const costRecord = record(rawAmount);
    const reportedBasis = String(costRecord.basis ?? costRecord.type ?? response.cost_basis ?? "").toLowerCase();
    if (reportedBasis.includes("estimate") || costRecord.estimated === true) continue;
    const n = amount(costRecord.amount ?? costRecord.value ?? rawAmount);
    const c = currency(costRecord.currency ?? costRecord.currency_code ?? rawCurrency);
    if (n !== null && c) return { amount: n, currency: c, basis: "actual" };
  }
  return null;
}
