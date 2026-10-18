export const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const mask = (uid: string) => "•••• " + uid.slice(-4).toUpperCase();
export const initials = (s: string) => s.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
export const pctf = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) : "0.0") + "%";
export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

export const FEATURE_LABEL: Record<string, string> = {
  velocity_60s: "Transactions in last 60 s",
  two_merchants_60s: "Two merchants within 60 s",
  amount_vs_usual: "Amount vs usual spend",
  new_card: "New card",
  distance_km: "Distance from usual shops",
  hour: "Hour of day",
  category_risk: "Merchant category risk",
  insufficient_balance: "Not enough balance",
  card_frozen: "Card locked",
  daily_limit: "Daily limit",
  high_risk: "Risk threshold",
  no_order: "No order rung up",
  agent_frozen: "Agent frozen",
  merchant_not_allowed: "Shop not on the agent's list",
  outside_window: "Outside the agent's hours",
  over_budget: "Over the agent's budget",
  needs_approval: "Needs the owner's approval",
  too_many_per_hour: "Too many agent purchases this hour",
  task_expired: "Task card expired",
  chain_error: "Network error",
  chain_unconfirmed: "Not confirmed in time",
};

export const PLAIN: Record<string, string> = {
  two_merchants_60s: "card used at two places within a minute",
  velocity_60s: "several transactions in under a minute",
  amount_vs_usual: "much larger than this card's usual purchase",
  distance_km: "far from where this card normally shops",
  new_card: "card is not registered",
  hour: "unusual time for this card",
  category_risk: "higher-risk type of merchant",
  card_frozen: "the card is locked",
  insufficient_balance: "not enough money on the card for this purchase",
  daily_limit: "over the card's daily limit",
  high_risk: "risk score over the on-chain threshold",
  program_declined: "refused by the on-chain policy",
  no_order: "nothing was rung up at the register",
  agent_frozen: "the agent is frozen",
  merchant_not_allowed: "this shop is not on the agent's allowed list",
  outside_window: "outside the hours the agent may buy",
  over_budget: "over the agent's budget",
  needs_approval: "waiting for the owner to approve",
  too_many_per_hour: "too many purchases this hour",
  task_expired: "the task card expired",
  chain_error: "the network could not be reached",
  chain_unconfirmed: "the network did not confirm it in time",
};
export const plain = (f: string) => PLAIN[f] ?? FEATURE_LABEL[f] ?? f;
