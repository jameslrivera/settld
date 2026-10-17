import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as anchor from "@anchor-lang/core";
import { BN } from "@anchor-lang/core";
import {
  getMint, getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, transferChecked, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { connect, MINT, MERCHANT_IDS, configPda, vaultPda, cardPda, merchantPda, merchantKeypair, uidBytes, explorerTx } from "../../scripts/common";

const PORT = Number(process.env.SIDECAR_PORT ?? 8787);
process.on("unhandledRejection", (e) => console.error("unhandled:", (e as Error)?.message ?? e));
process.on("uncaughtException", (e) => console.error("uncaught:", e.message));

const { program, conn, issuer } = connect();
const parser = new anchor.EventParser(program.programId, program.coder);
const explorer = (sig: string) => explorerTx(sig, conn.rpcEndpoint);
const CONFIG = configPda();
const VAULT = vaultPda();
const ALL_MERCHANTS = new BN("18446744073709551615");
const NO_CAP = new BN("18446744073709551615");

const key = (s: string) => new anchor.web3.PublicKey(s);
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u64 = (n: number | bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const agentPda = (owner: anchor.web3.PublicKey, agentId: number) =>
  anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("agent"), owner.toBuffer(), u16(agentId)], program.programId)[0];
const intentPda = (agent: anchor.web3.PublicKey, nonce: number | bigint) =>
  anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("intent"), agent.toBuffer(), u64(nonce)], program.programId)[0];
const hex = (bytes: number[]) => Buffer.from(bytes).toString("hex");

function merchantMask(ids?: number[] | null, mask?: string | number | null): BN {
  if (mask !== undefined && mask !== null) return new BN(String(mask));
  if (!ids || ids.length === 0) return ALL_MERCHANTS;
  let m = 0n;
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 0 || id >= 64) throw new Error(`merchant id ${id} cannot be put in an allowlist (0 to 63)`);
    m |= 1n << BigInt(id);
  }
  return new BN(m.toString());
}
function units(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0 || v > Number.MAX_SAFE_INTEGER) throw new Error(`${what} must be a positive whole number of token units`);
  return v;
}
async function slotIn(seconds: number): Promise<number> {
  return (await conn.getSlot("confirmed")) + Math.round(seconds / 0.4);
}

type PolicyIn = {
  budget_total?: number; per_txn_max?: number; daily_max?: number;
  allowed_merchants?: number[]; merchant_mask?: string | number;
  hour_start?: number; hour_end?: number; approval_threshold?: number; max_txn_per_hour?: number;
};
function toPolicy(p: PolicyIn) {
  const cap = (v: number | undefined) => {
    if (v === undefined || v === null) return NO_CAP;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error("policy caps must be whole numbers of token units, zero or more");
    return new BN(v);
  };
  return {
    budgetTotal: cap(p.budget_total),
    perTxnMax: cap(p.per_txn_max),
    dailyMax: cap(p.daily_max),
    merchantMask: merchantMask(p.allowed_merchants, p.merchant_mask),
    hourStart: p.hour_start ?? 0,
    hourEnd: p.hour_end ?? 0,
    approvalThreshold: cap(p.approval_threshold),
    maxTxnPerHour: p.max_txn_per_hour ?? 0,
  };
}

let blockhash = "";
let decimals: number | null = null;
let issuerAta: anchor.web3.PublicKey | null = null;
const merchantAtas = new Map<number, anchor.web3.PublicKey>();
async function refreshBlockhash() { try { blockhash = (await conn.getLatestBlockhash("confirmed")).blockhash; } catch {  } }
async function dec() { if (decimals === null) decimals = (await getMint(conn, MINT)).decimals; return decimals; }
async function issuerTokenAccount() { if (!issuerAta) issuerAta = (await getOrCreateAssociatedTokenAccount(conn, issuer, MINT, issuer.publicKey)).address; return issuerAta; }
async function merchantAta(id: number) {
  let a = merchantAtas.get(id);
  if (!a) {
    const rec = await program.account.merchant.fetchNullable(merchantPda(id), "confirmed");
    a = rec ? rec.tokenAccount : (await getOrCreateAssociatedTokenAccount(conn, issuer, MINT, merchantKeypair(issuer, id).publicKey)).address;
    merchantAtas.set(id, a);
  }
  return a;
}
const opts = { skipPreflight: true, commitment: "confirmed" as const };

async function sendOrVerify(send: () => Promise<string>, verify: () => Promise<boolean>): Promise<string | null> {
  try {
    return await send();
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (!/not confirmed/i.test(msg)) throw e;
    const sig = /signature (\w+)/i.exec(msg)?.[1] ?? null;
    for (let i = 0; i < 20; i++) {
      if (await verify()) return sig;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw e;
  }
}

function explain(e: unknown): string {
  const err = e as { message?: string; logs?: string[]; error?: { errorCode?: { code?: string }; errorMessage?: string } };
  if (err?.error?.errorCode?.code) return `${err.error.errorCode.code}: ${err.error.errorMessage ?? ""}`.trim();
  const text = err?.message ?? JSON.stringify(e);
  const dec = /"Custom":\s*(\d+)/.exec(text);
  const hex = (err.logs ?? []).map((l) => /custom program error: 0x([0-9a-f]+)/i.exec(l)).find(Boolean);
  const custom = dec ?? hex;
  if (custom) {
    const code = dec ? Number(dec[1]) : parseInt(custom[1], 16);
    const known = ((program.idl as unknown as { errors?: { code: number; name: string; msg?: string }[] }).errors ?? []).find((x) => x.code === code);
    if (known) return `${known.name}: ${known.msg ?? ""}`.trim();
    if (code === 1) return "InsufficientFunds: the token account does not hold enough";
    return `program error ${code}`;
  }
  if (/Unknown action/.test(text)) return "the transaction failed on chain without a readable program error";
  return text;
}

async function register(uid: string, dailyLimit: number, owner?: string | null, force = false) {
  const u = uidBytes(uid);
  const pda = cardPda(u);
  const ownerKey = owner ? key(owner) : issuer.publicKey;
  const existing = await program.account.card.fetchNullable(pda, "confirmed");
  if (existing) {
    if (!("person" in existing.kind)) throw new Error("this serial belongs to an agent's task card");
    const same = existing.owner.equals(ownerKey);
    const unowned = existing.owner.equals(issuer.publicKey) || existing.owner.equals(anchor.web3.PublicKey.default);
    if (!same && !unowned && !force) throw new Error("this card belongs to another account");
    let sig: string | null = null;
    if (!same) {
      sig = await sendOrVerify(
        () => program.methods.setCardOwner(u, ownerKey).accountsPartial({ issuer: issuer.publicKey, config: CONFIG, card: pda }).rpc(opts),
        async () => { const c = await program.account.card.fetchNullable(pda, "confirmed"); return !!c && c.owner.equals(ownerKey); },
      );
    }
    return { card_pda: pda.toBase58(), sig, explorer: sig ? explorer(sig) : null, already: true, owner: ownerKey.toBase58(), previous_owner: existing.owner.toBase58() };
  }
  const sig = await program.methods.registerCard(u, new BN(dailyLimit), ownerKey)
    .accountsPartial({ issuer: issuer.publicKey, config: CONFIG, card: pda }).rpc(opts);
  await waitForAccount(pda);
  return { card_pda: pda.toBase58(), sig, explorer: explorer(sig), already: false, owner: ownerKey.toBase58() };
}

async function waitForAccount(pda: anchor.web3.PublicKey, tries = 20) {
  for (let i = 0; i < tries; i++) {
    if (await conn.getAccountInfo(pda, "confirmed")) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function setStatus(uid: string, blocked: boolean) {
  const u = uidBytes(uid);
  const sig = await sendOrVerify(
    () => program.methods.setCardStatus(u, blocked ? { blocked: {} } : { active: {} }).accountsPartial({ issuer: issuer.publicKey, config: CONFIG, card: cardPda(u) }).rpc(opts),
    async () => { const c = await program.account.card.fetchNullable(cardPda(u), "confirmed"); return !!c && ("blocked" in c.status) === blocked; },
  );
  return { sig, explorer: sig ? explorer(sig) : null, status: blocked ? "blocked" : "active" };
}

async function cardState(uid: string, until?: (balance: number) => boolean) {
  const pda = cardPda(uidBytes(uid));
  let c = null;
  for (let i = 0; i < 20; i++) {
    c = await program.account.card.fetchNullable(pda, "confirmed");
    if (c && (!until || until(c.balance.toNumber()))) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!c) throw new Error(`card account not found ${pda.toBase58()}`);
  return {
    balance: c.balance.toNumber(), daily_limit: c.dailyLimit.toNumber(), spent_today: c.spentToday.toNumber(),
    status: "blocked" in c.status ? "blocked" : "active", kind: "task" in c.kind ? "task" : "person",
    owner: c.owner.toBase58(), auth_count: c.authCount.toNumber(), expires_slot: c.expiresSlot.toNumber(),
  };
}

async function sendDecision(tx: anchor.web3.Transaction, merchantId: number, t0: number) {
  tx.recentBlockhash = blockhash || (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.feePayer = issuer.publicKey;
  tx.sign(issuer);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, preflightCommitment: "processed" });
  const sent_ms = Date.now() - t0;
  let processed_ms = 0, confirmed_ms = 0;
  for (let i = 0; i < 80 && !confirmed_ms; i++) {
    const s = (await conn.getSignatureStatuses([sig])).value[0];
    if (s) {
      if (!processed_ms) processed_ms = Date.now() - t0;
      if (s.err) return { sig, explorer: explorer(sig), error: explain({ message: JSON.stringify(s.err) }), landed: true, sent_ms, processed_ms };
      if (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized") confirmed_ms = Date.now() - t0;
    }
    if (!confirmed_ms) await new Promise((r) => setTimeout(r, 100));
  }
  if (!confirmed_ms) return { sig, explorer: explorer(sig), error: processed_ms ? "transaction processed but not confirmed in time" : "transaction was not seen by the cluster", landed: processed_ms > 0, sent_ms, processed_ms };
  let approved: boolean | null = null, reason: number | null = null, kind: number | null = null;
  for (let i = 0; i < 15 && approved === null; i++) {
    const full = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (full?.meta?.logMessages) {
      for (const ev of parser.parseLogs(full.meta.logMessages)) {
        if (ev.name === "authEvent") { approved = ev.data.approved as boolean; reason = ev.data.reason as number; kind = ev.data.kind as number; }
      }
    }
    if (approved === null) await new Promise((r) => setTimeout(r, 200));
  }
  if (approved === null) return { sig, explorer: explorer(sig), error: "confirmed but the decision event could not be read", landed: true, sent_ms, processed_ms, confirmed_ms };
  const bal = approved ? await conn.getTokenAccountBalance(await merchantAta(merchantId), "confirmed").catch(() => null) : null;
  return { sig, explorer: explorer(sig), approved, reason, kind, landed: true, settled: approved === true, merchant_balance: bal?.value.uiAmountString ?? null, sent_ms, processed_ms, confirmed_ms };
}

async function pay(uid: string, amount: number, riskBps: number, merchantId: number, nonce: number) {
  const u = uidBytes(uid);
  const t0 = Date.now();
  const tx = await program.methods.pay(u, new BN(amount), riskBps, merchantId, new BN(nonce))
    .accountsPartial({
      issuer: issuer.publicKey, config: CONFIG, card: cardPda(u), merchant: merchantPda(merchantId), mint: MINT, vault: VAULT,
      merchantTokenAccount: await merchantAta(merchantId), tokenProgram: TOKEN_PROGRAM_ID,
    }).transaction();
  const out = await sendDecision(tx, merchantId, t0);
  if (out.landed) {
    const c = await program.account.card.fetchNullable(cardPda(u), "confirmed").catch(() => null);
    if (c) return { ...out, balance: c.balance.toNumber(), spent_today: c.spentToday.toNumber(), status: "blocked" in c.status ? "blocked" : "active" };
  }
  return out;
}

async function deposit(uid: string, amountUnits: number) {
  const u = uidBytes(uid);
  const before = (await cardState(uid)).balance;
  const sig = await program.methods.deposit(u, new BN(amountUnits))
    .accountsPartial({ payer: issuer.publicKey, config: CONFIG, card: cardPda(u), mint: MINT, from: await issuerTokenAccount(), vault: VAULT, tokenProgram: TOKEN_PROGRAM_ID })
    .rpc(opts);
  return { sig, explorer: explorer(sig), ...(await cardState(uid, (b) => b >= before + amountUnits)) };
}

async function withdraw(uid: string, toWallet: string, amountUnits: number) {
  const u = uidBytes(uid);
  const to = key(toWallet);
  const toAta = getAssociatedTokenAddressSync(MINT, to, true);
  const ix = await program.methods.withdraw(u, new BN(amountUnits))
    .accountsPartial({ issuer: issuer.publicKey, config: CONFIG, card: cardPda(u), mint: MINT, vault: VAULT, destination: toAta, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
  const tx = new anchor.web3.Transaction().add(createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, toAta, to, MINT)).add(ix);
  const before = (await cardState(uid)).balance;
  const sig = await anchor.web3.sendAndConfirmTransaction(conn, tx, [issuer], opts);
  const state = await cardState(uid, (b) => b <= before - amountUnits);
  const bal = await conn.getTokenAccountBalance(toAta, "confirmed").catch(() => null);
  return { sig, explorer: explorer(sig), to_wallet: toWallet, to_ata: toAta.toBase58(), wallet_usdc: bal?.value.uiAmountString ?? null, ...state };
}

async function settle(merchantId: number, amountUnits: number) {
  const sig = await program.methods.settle(merchantId, new BN(amountUnits))
    .accountsPartial({ issuer: issuer.publicKey, config: CONFIG, merchant: merchantPda(merchantId), mint: MINT, vault: VAULT, merchantTokenAccount: await merchantAta(merchantId), tokenProgram: TOKEN_PROGRAM_ID })
    .rpc(opts);
  return { sig, explorer: explorer(sig) };
}

async function merchantAgentPolicy(merchantId: number, acceptsAgents: boolean, maxAgentTicket: number) {
  const pda = merchantPda(merchantId);
  const sig = await sendOrVerify(
    () => program.methods.setMerchantAgentPolicy(merchantId, acceptsAgents, new BN(maxAgentTicket)).accountsPartial({ issuer: issuer.publicKey, config: CONFIG, merchant: pda }).rpc(opts),
    async () => { const m = await program.account.merchant.fetchNullable(pda, "confirmed"); return !!m && m.acceptsAgents === acceptsAgents && m.maxAgentTicket.toString(10) === String(maxAgentTicket); },
  );
  return { sig, explorer: sig ? explorer(sig) : null, merchant_id: merchantId, accepts_agents: acceptsAgents, max_agent_ticket: maxAgentTicket };
}

async function agentState(owner: string, agentId: number, tries = 1) {
  const pda = agentPda(key(owner), agentId);
  let a = null;
  for (let i = 0; i < tries; i++) {
    a = await program.account.agent.fetchNullable(pda, "confirmed");
    if (a) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!a) throw new Error(`agent account not found ${pda.toBase58()}`);
  const p = a.policy;
  return {
    agent_pda: pda.toBase58(), owner: a.owner.toBase58(), agent_id: a.agentId, frozen: a.frozen,
    balance: a.balance.toNumber(), spent_total: a.spentTotal.toNumber(), spent_today: a.spentToday.toNumber(),
    txn_this_hour: a.txnThisHour, open_tasks: a.openTasks, auth_count: a.authCount.toNumber(),
    policy_version: a.policyVersion, policy_hash: hex(a.policyHash as number[]),
    policy: {
      budget_total: p.budgetTotal.toString(10), per_txn_max: p.perTxnMax.toString(10), daily_max: p.dailyMax.toString(10),
      merchant_mask: p.merchantMask.toString(10), hour_start: p.hourStart, hour_end: p.hourEnd,
      approval_threshold: p.approvalThreshold.toString(10), max_txn_per_hour: p.maxTxnPerHour,
    },
  };
}

async function registerAgent(owner: string, agentId: number, policy: PolicyIn) {
  const pda = agentPda(key(owner), agentId);
  if (await conn.getAccountInfo(pda)) return { ...(await agentState(owner, agentId)), sig: null, already: true };
  const sig = await program.methods.registerAgent(key(owner), agentId, toPolicy(policy))
    .accountsPartial({ issuer: issuer.publicKey, config: CONFIG, agent: pda }).rpc(opts);
  await waitForAccount(pda);
  return { ...(await agentState(owner, agentId, 10)), sig, explorer: explorer(sig), already: false };
}

async function setAgentPolicy(owner: string, agentId: number, policy: PolicyIn) {
  const before = (await agentState(owner, agentId)).policy_version;
  const sig = await sendOrVerify(
    () => program.methods.setAgentPolicy(key(owner), agentId, toPolicy(policy)).accountsPartial({ issuer: issuer.publicKey, config: CONFIG, agent: agentPda(key(owner), agentId) }).rpc(opts),
    async () => (await agentState(owner, agentId)).policy_version > before,
  );
  let state = await agentState(owner, agentId);
  for (let i = 0; i < 10 && state.policy_version === before; i++) { await new Promise((r) => setTimeout(r, 500)); state = await agentState(owner, agentId); }
  return { ...state, sig, explorer: sig ? explorer(sig) : null };
}

async function fundAgent(uid: string, owner: string, agentId: number, amountUnits: number, direction: "fund" | "clawback") {
  const u = uidBytes(uid);
  const accounts = { issuer: issuer.publicKey, config: CONFIG, card: cardPda(u), agent: agentPda(key(owner), agentId) };
  const before = (await agentState(owner, agentId)).balance;
  const m = direction === "fund"
    ? program.methods.fundAgent(u, key(owner), agentId, new BN(amountUnits))
    : program.methods.clawback(u, key(owner), agentId, new BN(amountUnits));
  const sig = await m.accountsPartial(accounts).rpc(opts);
  let state = await agentState(owner, agentId);
  for (let i = 0; i < 10 && state.balance === before; i++) { await new Promise((r) => setTimeout(r, 500)); state = await agentState(owner, agentId); }
  return { sig, explorer: explorer(sig), agent: state, card: await cardState(uid) };
}

async function openTaskCard(owner: string, agentId: number, uid: string, budgetUnits: number, allowed?: number[] | null, expiresSlot = 0) {
  const u = uidBytes(uid);
  const pda = cardPda(u);
  if (await conn.getAccountInfo(pda)) return { card_pda: pda.toBase58(), sig: null, already: true, card: await cardState(uid) };
  const expires = expiresSlot > 0 ? expiresSlot : await slotIn(30 * 60);
  const sig = await program.methods.openTaskCard(key(owner), agentId, u, new BN(budgetUnits), merchantMask(allowed), new BN(expires))
    .accountsPartial({ issuer: issuer.publicKey, config: CONFIG, agent: agentPda(key(owner), agentId), card: pda }).rpc(opts);
  await waitForAccount(pda);
  return { card_pda: pda.toBase58(), sig, explorer: explorer(sig), already: false, card: await cardState(uid), agent: await agentState(owner, agentId) };
}

async function closeTaskCard(owner: string, agentId: number, uid: string) {
  const u = uidBytes(uid);
  const pda = cardPda(u);
  const existing = await program.account.card.fetchNullable(pda, "confirmed");
  if (!existing) return { sig: null, explorer: null, returned_units: 0, already: true, agent: await agentState(owner, agentId) };
  const left = existing.balance.toNumber();
  const sig = await sendOrVerify(
    () => program.methods.closeTaskCard(key(owner), agentId, u).accountsPartial({ issuer: issuer.publicKey, config: CONFIG, agent: agentPda(key(owner), agentId), card: pda }).rpc(opts),
    async () => !(await conn.getAccountInfo(pda, "confirmed")),
  );
  for (let i = 0; i < 20 && (await conn.getAccountInfo(pda, "confirmed")); i++) await new Promise((r) => setTimeout(r, 500));
  return { sig, explorer: sig ? explorer(sig) : null, returned_units: left, agent: await agentState(owner, agentId) };
}

async function approveIntent(owner: string, agentId: number, nonce: number, merchantId: number, amountUnits: number, expiresSlot = 0, approvedBy?: string | null) {
  const agent = agentPda(key(owner), agentId);
  const pda = intentPda(agent, nonce);
  if (await conn.getAccountInfo(pda)) return { intent_pda: pda.toBase58(), sig: null, already: true };
  const expires = expiresSlot > 0 ? expiresSlot : await slotIn(15 * 60);
  const sig = await program.methods.approveIntent(key(owner), agentId, new BN(nonce), merchantId, new BN(units(amountUnits, "amount")), new BN(expires), approvedBy ? key(approvedBy) : key(owner))
    .accountsPartial({ issuer: issuer.publicKey, config: CONFIG, agent, intent: pda }).rpc(opts);
  await waitForAccount(pda);
  return { intent_pda: pda.toBase58(), sig, explorer: explorer(sig), already: false, expires_slot: expires };
}

async function closeIntent(owner: string, agentId: number, nonce: number) {
  const agent = agentPda(key(owner), agentId);
  const pda = intentPda(agent, nonce);
  if (!(await conn.getAccountInfo(pda))) return { intent_pda: pda.toBase58(), sig: null, already: true };
  const sig = await program.methods.closeIntent(key(owner), agentId, new BN(nonce))
    .accountsPartial({ issuer: issuer.publicKey, config: CONFIG, agent, intent: pda }).rpc(opts);
  return { intent_pda: pda.toBase58(), sig, explorer: explorer(sig), already: false };
}

async function setAgentFrozen(owner: string, agentId: number, frozen: boolean) {
  const sig = await sendOrVerify(
    () => program.methods.setAgentFrozen(key(owner), agentId, frozen).accountsPartial({ issuer: issuer.publicKey, config: CONFIG, agent: agentPda(key(owner), agentId) }).rpc(opts),
    async () => (await agentState(owner, agentId)).frozen === frozen,
  );
  let state = await agentState(owner, agentId);
  for (let i = 0; i < 10 && state.frozen !== frozen; i++) { await new Promise((r) => setTimeout(r, 500)); state = await agentState(owner, agentId); }
  return { sig, explorer: sig ? explorer(sig) : null, ...state };
}

async function freezeAll(owner: string, agentIds: number[]) {
  if (!agentIds.length) return { sig: null, frozen: [] };
  const sig = await program.methods.freezeAll(key(owner))
    .accountsPartial({ issuer: issuer.publicKey, config: CONFIG })
    .remainingAccounts(agentIds.map((id) => ({ pubkey: agentPda(key(owner), id), isWritable: true, isSigner: false })))
    .rpc(opts);
  return { sig, explorer: explorer(sig), frozen: agentIds };
}

async function payAgent(uid: string, owner: string, agentId: number, amount: number, riskBps: number, merchantId: number, nonce: number, intentNonce?: number | null) {
  const u = uidBytes(uid);
  const agent = agentPda(key(owner), agentId);
  const t0 = Date.now();
  const tx = await program.methods.payAgent(u, new BN(amount), riskBps, merchantId, new BN(nonce))
    .accountsPartial({
      issuer: issuer.publicKey, config: CONFIG, card: cardPda(u), agent, merchant: merchantPda(merchantId), mint: MINT, vault: VAULT,
      merchantTokenAccount: await merchantAta(merchantId), intent: intentNonce === undefined || intentNonce === null ? null : intentPda(agent, intentNonce),
      tokenProgram: TOKEN_PROGRAM_ID,
    }).transaction();
  return sendDecision(tx, merchantId, t0);
}

async function depositRequest(uid: string, amountUnits: number) {
  const reference = anchor.web3.Keypair.generate().publicKey;
  const amount = (amountUnits / 10 ** (await dec())).toString();
  const params = new URLSearchParams({ amount, "spl-token": MINT.toBase58(), reference: reference.toBase58(), label: "Settld", message: `Fund Settld card ${uid.slice(-4).toUpperCase()}` });
  return { reference: reference.toBase58(), url: `solana:${issuer.publicKey.toBase58()}?${params.toString()}`, recipient: issuer.publicKey.toBase58(), mint: MINT.toBase58(), amount_units: amountUnits };
}

async function depositCheck(reference: string) {
  const sigs = await conn.getSignaturesForAddress(key(reference), { limit: 5 }, "confirmed");
  if (!sigs.length) return { found: false };
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await conn.getParsedTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx?.meta) continue;
    const me = issuer.publicKey.toBase58();
    const pre = tx.meta.preTokenBalances?.find((b) => b.mint === MINT.toBase58() && b.owner === me);
    const post = tx.meta.postTokenBalances?.find((b) => b.mint === MINT.toBase58() && b.owner === me);
    const delta = Number(post?.uiTokenAmount.amount ?? 0) - Number(pre?.uiTokenAmount.amount ?? 0);
    if (delta > 0) return { found: true, sig: s.signature, explorer: explorer(s.signature), amount_units: delta, from_wallet: tx.transaction.message.accountKeys[0].pubkey.toBase58() };
  }
  return { found: false };
}

const DEMO_WALLET_FILE = path.join(__dirname, "..", "..", "target", "demo-wallet.json");
function demoWallet(): anchor.web3.Keypair {
  if (fs.existsSync(DEMO_WALLET_FILE)) return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(DEMO_WALLET_FILE, "utf8"))));
  const kp = anchor.web3.Keypair.generate();
  fs.writeFileSync(DEMO_WALLET_FILE, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}
async function demoWalletInfo(topUpUnits = 0) {
  const kp = demoWallet();
  const ata = getAssociatedTokenAddressSync(MINT, kp.publicKey);
  let sig: string | null = null;
  if (topUpUnits > 0) {
    const tx = new anchor.web3.Transaction();
    if ((await conn.getBalance(kp.publicKey)) < 0.02e9) tx.add(anchor.web3.SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: kp.publicKey, lamports: 0.05e9 }));
    tx.add(createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, ata, kp.publicKey, MINT));
    tx.add(createTransferCheckedInstruction(await issuerTokenAccount(), MINT, ata, issuer.publicKey, BigInt(topUpUnits), await dec()));
    sig = await anchor.web3.sendAndConfirmTransaction(conn, tx, [issuer], opts);
  }
  const bal = await conn.getTokenAccountBalance(ata, "confirmed").catch(() => null);
  return { wallet: kp.publicKey.toBase58(), ata: ata.toBase58(), usdc: bal?.value.uiAmountString ?? "0", sol: (await conn.getBalance(kp.publicKey)) / 1e9, topup_sig: sig };
}
async function walletPay(url: string) {
  const u = new URL(url);
  const recipient = key(u.pathname);
  const amount = Number(u.searchParams.get("amount"));
  const reference = key(u.searchParams.get("reference")!);
  const kp = demoWallet();
  const d = await dec();
  const ix = createTransferCheckedInstruction(getAssociatedTokenAddressSync(MINT, kp.publicKey), MINT, getAssociatedTokenAddressSync(MINT, recipient), kp.publicKey, BigInt(Math.round(amount * 10 ** d)), d);
  ix.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
  const sig = await anchor.web3.sendAndConfirmTransaction(conn, new anchor.web3.Transaction().add(ix), [kp], opts);
  return { sig, explorer: explorer(sig), from_wallet: kp.publicKey.toBase58() };
}
const AGENT_KEYS_FILE = path.join(__dirname, "..", "..", "keys", "agents.json");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function signEd25519(secretKey: Uint8Array, message: string): string {
  const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(secretKey.slice(0, 32))]), format: "der", type: "pkcs8" });
  return crypto.sign(null, Buffer.from(message, "utf8"), key).toString("base64");
}

function verifyEd25519(publicKey: Uint8Array, message: string, signatureB64: string): boolean {
  const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey)]), format: "der", type: "spki" });
  return crypto.verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
}

function keyView(pk: anchor.web3.PublicKey) {
  return { key: pk.toBase58(), key_b64: Buffer.from(pk.toBytes()).toString("base64") };
}

function agentKeypair(ref: string): anchor.web3.Keypair {
  let keys: Record<string, number[]> = {};
  try { keys = JSON.parse(fs.readFileSync(AGENT_KEYS_FILE, "utf8")); } catch { keys = {}; }
  if (keys[ref]) return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(keys[ref]));
  const kp = anchor.web3.Keypair.generate();
  keys[ref] = Array.from(kp.secretKey);
  fs.mkdirSync(path.dirname(AGENT_KEYS_FILE), { recursive: true });
  fs.writeFileSync(AGENT_KEYS_FILE, JSON.stringify(keys));
  return kp;
}

const MEMO_PROGRAM = new anchor.web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

async function anchorRecord(agentPda: string, length: number, head: string) {
  const memo = `settld.agent ${agentPda} ${length} ${head}`;
  const ix = new anchor.web3.TransactionInstruction({ programId: MEMO_PROGRAM, keys: [{ pubkey: issuer.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(memo, "utf8") });
  const tx = new anchor.web3.Transaction().add(ix);
  tx.feePayer = issuer.publicKey;
  const sig = await anchor.web3.sendAndConfirmTransaction(conn, tx, [issuer], opts);
  const slot = (await conn.getSignatureStatuses([sig])).value[0]?.slot ?? null;
  return { sig, explorer: explorer(sig), memo, slot };
}

const PEOPLE_KEYS_FILE = path.join(__dirname, "..", "..", "keys", "people.json");
function peopleKeys(): Record<string, number[]> {
  try { return JSON.parse(fs.readFileSync(PEOPLE_KEYS_FILE, "utf8")); } catch { return {}; }
}
function personKeypair(personId: string): anchor.web3.Keypair | null {
  const k = peopleKeys()[personId];
  return k ? anchor.web3.Keypair.fromSecretKey(Uint8Array.from(k)) : null;
}
async function walletNew(personId: string) {
  const keys = peopleKeys();
  let kp = personKeypair(personId);
  let sig: string | null = null;
  if (!kp) {
    kp = anchor.web3.Keypair.generate();
    keys[personId] = Array.from(kp.secretKey);
    fs.mkdirSync(path.dirname(PEOPLE_KEYS_FILE), { recursive: true });
    fs.writeFileSync(PEOPLE_KEYS_FILE, JSON.stringify(keys));
  }
  const ata = getAssociatedTokenAddressSync(MINT, kp.publicKey);
  if ((await conn.getBalance(kp.publicKey)) < 0.01e9) {
    const tx = new anchor.web3.Transaction()
      .add(anchor.web3.SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: kp.publicKey, lamports: 0.02e9 }))
      .add(createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, ata, kp.publicKey, MINT));
    sig = await anchor.web3.sendAndConfirmTransaction(conn, tx, [issuer], opts);
  }
  return { address: kp.publicKey.toBase58(), ata: ata.toBase58(), sig, explorer: sig ? explorer(sig) : null };
}
async function walletInfo(personId: string) {
  const kp = personKeypair(personId);
  if (!kp) return { error: "no wallet" };
  const ata = getAssociatedTokenAddressSync(MINT, kp.publicKey);
  const bal = await conn.getTokenAccountBalance(ata, "confirmed").catch(() => null);
  return { address: kp.publicKey.toBase58(), ata: ata.toBase58(), usdc: bal?.value.uiAmountString ?? "0", sol: (await conn.getBalance(kp.publicKey)) / 1e9 };
}
async function walletLoad(personId: string, uid: string, amountUnits: number) {
  const kp = personKeypair(personId);
  if (!kp) return { error: "no wallet" };
  const u = uidBytes(uid);
  const ata = getAssociatedTokenAddressSync(MINT, kp.publicKey);
  const ix = await program.methods.deposit(u, new BN(amountUnits))
    .accountsPartial({ payer: kp.publicKey, config: CONFIG, card: cardPda(u), mint: MINT, from: ata, vault: VAULT, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
  const before = (await cardState(uid)).balance;
  const sig = await anchor.web3.sendAndConfirmTransaction(conn, new anchor.web3.Transaction().add(ix), [kp], opts);
  const state = await cardState(uid, (b) => b >= before + amountUnits);
  const bal = await conn.getTokenAccountBalance(ata, "confirmed").catch(() => null);
  return { sig, explorer: explorer(sig), from_wallet: kp.publicKey.toBase58(), wallet_usdc: bal?.value.uiAmountString ?? "0", ...state };
}

async function walletSweep(personId: string, toWallet?: string) {
  const kp = personKeypair(personId);
  if (!kp) return { error: "no wallet" };
  const to = toWallet ? key(toWallet) : issuer.publicKey;
  const d = await dec();
  const fromAta = getAssociatedTokenAddressSync(MINT, kp.publicKey);
  const toAta = getAssociatedTokenAddressSync(MINT, to, true);
  const bal = await conn.getTokenAccountBalance(fromAta, "confirmed").catch(() => null);
  const amount = BigInt(bal?.value.amount ?? "0");
  let usdcSig: string | null = null;
  if (amount > 0n) {
    const tx = new anchor.web3.Transaction()
      .add(createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, toAta, to, MINT))
      .add(createTransferCheckedInstruction(fromAta, MINT, toAta, kp.publicKey, amount, d));
    tx.feePayer = issuer.publicKey;
    usdcSig = await anchor.web3.sendAndConfirmTransaction(conn, tx, [issuer, kp], opts);
  }
  const lamports = await conn.getBalance(kp.publicKey);
  let solSig: string | null = null;
  if (lamports > 0) {
    const tx = new anchor.web3.Transaction().add(anchor.web3.SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: to, lamports }));
    tx.feePayer = issuer.publicKey;
    solSig = await anchor.web3.sendAndConfirmTransaction(conn, tx, [issuer, kp], opts);
  }
  return { to_wallet: to.toBase58(), usdc: bal?.value.uiAmountString ?? "0", sol: lamports / 1e9, usdc_sig: usdcSig, usdc_explorer: usdcSig ? explorer(usdcSig) : null, sol_sig: solSig, sol_explorer: solSig ? explorer(solSig) : null };
}

async function sweep(ids: number[]) {
  const d = await dec();
  const results = [];
  for (const id of ids) {
    const ata = await merchantAta(id);
    const bal = await conn.getTokenAccountBalance(ata, "confirmed");
    const amount = BigInt(bal.value.amount);
    if (amount === 0n) { results.push({ merchant_id: id, swept: "0", sig: null }); continue; }
    const sig = await transferChecked(conn, issuer, ata, MINT, await issuerTokenAccount(), merchantKeypair(issuer, id), amount, d, [], opts);
    results.push({ merchant_id: id, swept: bal.value.uiAmountString, sig, explorer: explorer(sig) });
  }
  return { results };
}

async function balances() {
  const b = await conn.getTokenAccountBalance(await issuerTokenAccount());
  const v = await conn.getTokenAccountBalance(VAULT).catch(() => null);
  const merchants = [];
  for (const id of MERCHANT_IDS) {
    const ata = await merchantAta(id);
    const mb = await conn.getTokenAccountBalance(ata).catch(() => null);
    const rec = await program.account.merchant.fetchNullable(merchantPda(id), "confirmed");
    merchants.push({ id, wallet: merchantKeypair(issuer, id).publicKey.toBase58(), ata: ata.toBase58(), usdc: mb?.value.uiAmountString ?? "0", accepts_agents: rec?.acceptsAgents ?? false, max_agent_ticket: rec?.maxAgentTicket.toNumber() ?? 0 });
  }
  return { issuer: issuer.publicKey.toBase58(), issuer_ata: (await issuerTokenAccount()).toBase58(), vault: VAULT.toBase58(), vault_usdc: v?.value.uiAmountString ?? "0", mint: MINT.toBase58(), usdc: b.value.uiAmountString, sol: (await conn.getBalance(issuer.publicKey)) / 1e9, merchants };
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const send = (code: number, obj: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    try {
      const b = body ? JSON.parse(body) : {};
      switch (req.url) {
        case "/health": return send(200, { ok: true, program: program.programId.toBase58(), rpc: conn.rpcEndpoint, config: CONFIG.toBase58(), vault: VAULT.toBase58() });
        case "/balances": return send(200, await balances());
        case "/register": return send(200, await register(b.uid, b.daily_limit ?? 500_000_000, b.owner, !!b.force));
        case "/card": return send(200, await cardState(b.uid));
        case "/pay": return send(200, await pay(b.uid, units(b.amount, "amount"), b.risk_bps, b.merchant_id, b.nonce ?? Date.now()));
        case "/deposit": return send(200, await deposit(b.uid, units(b.amount_units, "amount_units")));
        case "/withdraw": return send(200, await withdraw(b.uid, b.to_wallet, b.amount_units));
        case "/settle": return send(200, await settle(b.merchant_id, b.amount_units));
        case "/set_status": return send(200, await setStatus(b.uid, !!b.blocked));
        case "/merchant/agent_policy": return send(200, await merchantAgentPolicy(b.merchant_id, !!b.accepts_agents, b.max_agent_ticket ?? 0));
        case "/agent/register": return send(200, await registerAgent(b.owner, b.agent_id, b.policy ?? {}));
        case "/agent/policy": return send(200, await setAgentPolicy(b.owner, b.agent_id, b.policy ?? {}));
        case "/agent/state": return send(200, await agentState(b.owner, b.agent_id));
        case "/agent/fund": return send(200, await fundAgent(b.uid, b.owner, b.agent_id, units(b.amount_units, "amount_units"), "fund"));
        case "/agent/clawback": return send(200, await fundAgent(b.uid, b.owner, b.agent_id, units(b.amount_units, "amount_units"), "clawback"));
        case "/agent/task/open": return send(200, await openTaskCard(b.owner, b.agent_id, b.uid, units(b.budget_units, "budget_units"), b.allowed_merchants, b.expires_slot ?? 0));
        case "/agent/task/close": return send(200, await closeTaskCard(b.owner, b.agent_id, b.uid));
        case "/agent/intent": return send(200, await approveIntent(b.owner, b.agent_id, b.nonce, b.merchant_id, b.amount_units, b.expires_slot ?? 0, b.approved_by));
        case "/agent/intent/close": return send(200, await closeIntent(b.owner, b.agent_id, b.nonce));
        case "/agent/freeze": return send(200, await setAgentFrozen(b.owner, b.agent_id, !!b.frozen));
        case "/agent/freeze_all": return send(200, await freezeAll(b.owner, b.agent_ids ?? []));
        case "/agent/pay": return send(200, await payAgent(b.uid, b.owner, b.agent_id, units(b.amount, "amount"), b.risk_bps, b.merchant_id, b.nonce ?? Date.now(), b.intent_nonce));
        case "/deposit_request": return send(200, await depositRequest(b.uid, b.amount_units));
        case "/deposit_check": return send(200, await depositCheck(b.reference));
        case "/demo_wallet": return send(200, await demoWalletInfo(b.topup_units ?? 0));
        case "/wallet_pay": return send(200, await walletPay(b.url));
        case "/kya/issuer": return send(200, { issuer: issuer.publicKey.toBase58(), issuer_b64: Buffer.from(issuer.publicKey.toBytes()).toString("base64") });
        case "/kya/sign": return send(200, { signature: signEd25519(issuer.secretKey, String(b.message ?? "")), issuer: issuer.publicKey.toBase58(), issuer_b64: Buffer.from(issuer.publicKey.toBytes()).toString("base64") });
        case "/kya/agent/key": return send(200, keyView(agentKeypair(String(b.ref)).publicKey));
        case "/kya/agent/sign": { const kp = agentKeypair(String(b.ref)); return send(200, { signature: signEd25519(kp.secretKey, String(b.message ?? "")), ...keyView(kp.publicKey) }); }
        case "/kya/anchor": return send(200, await anchorRecord(String(b.agent_pda), Number(b.length), String(b.head)));
        case "/kya/merchant/sign": { const kp = merchantKeypair(issuer, Number(b.merchant_id)); return send(200, { signature: signEd25519(kp.secretKey, String(b.message ?? "")), ...keyView(kp.publicKey) }); }
        case "/kya/verify": return send(200, { ok: verifyEd25519(Buffer.from(String(b.key_b64), "base64"), String(b.message ?? ""), String(b.signature ?? "")) });
        case "/wallet/new": return send(200, await walletNew(b.person_id));
        case "/wallet/info": return send(200, await walletInfo(b.person_id));
        case "/wallet/load": return send(200, await walletLoad(b.person_id, b.uid, b.amount_units));
        case "/wallet/sweep": return send(200, await walletSweep(b.person_id, b.to_wallet));
        case "/sweep": return send(200, await sweep(b.merchant_ids ?? MERCHANT_IDS));
        default: return send(404, { error: "unknown route" });
      }
    } catch (e: unknown) {
      const err = e as { message?: string; logs?: string[] };
      const why = explain(e);
      console.error("request failed:", req.url, why, err?.message && err.message !== why ? `(${err.message.slice(0, 200)})` : "", err?.logs ?? "");
      send(500, { error: why, logs: err?.logs });
    }
  });
});

refreshBlockhash().then(() => {
  setInterval(refreshBlockhash, 10_000);
  server.listen(PORT, "127.0.0.1", () => console.log(`sidecar on http://127.0.0.1:${PORT} program=${program.programId.toBase58()} rpc=${conn.rpcEndpoint.replace(/api-key=.*/, "api-key=…")}`));
});
