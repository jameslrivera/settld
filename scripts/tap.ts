const SERVICE = (process.env.SERVICE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const UID = process.env.UID ?? "041ce210bf6181";
const MERCHANT = Number(process.env.MERCHANT ?? 1);
const AMOUNT = process.env.AMOUNT ? Number(process.env.AMOUNT) : undefined;

async function main() {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.TAP_TOKEN) headers["x-tap-token"] = process.env.TAP_TOKEN;
  const body: Record<string, unknown> = { uid: UID, merchant_id: MERCHANT };
  if (AMOUNT !== undefined) { body.amount_cents = AMOUNT; body.item = process.env.ITEM ?? "Manual tap"; }

  type TapResponse = {
    approved: boolean; amount_cents: number; item?: string | null; score: number;
    settled?: boolean; reason?: string; reasons?: { feature: string }[]; explorer?: string | null;
  };
  const t0 = Date.now();
  const r = await fetch(`${SERVICE}/tap`, { method: "POST", headers, body: JSON.stringify(body) });
  const d = (await r.json()) as TapResponse;
  const ms = Date.now() - t0;

  if (d.reason === "no_order") {
    console.log(`nothing rung up at merchant ${MERCHANT}; arm the register or kiosk first`);
    return;
  }
  console.log(`${d.approved ? "approved" : "stopped "}  ${(d.amount_cents / 100).toFixed(2)}  ${d.item ?? ""}`);
  console.log(`score ${d.score}  ${ms} ms round trip  settled=${d.settled}`);
  if (d.reasons?.length) console.log("reasons:", d.reasons.map((x) => x.feature).join(", "));
  if (d.explorer) console.log(d.explorer);
}

main().catch((e) => { console.error(e); process.exit(1); });
