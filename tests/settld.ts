import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import {
  createMint, createAssociatedTokenAccount, mintTo, getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import { createHash } from "crypto";
import { Settld } from "../target/types/settld";

const UID = [0x04, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6];
const MERCHANT_ID = 7;
const DOLLAR = 1_000_000;
const ALL = new BN("18446744073709551615");

const seed = (s: string, extra?: Buffer) =>
  anchor.web3.PublicKey.findProgramAddressSync(extra ? [Buffer.from(s), extra] : [Buffer.from(s)], anchor.workspace.settld.programId)[0];
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

describe("settld", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.settld as Program<Settld>;
  const issuer = (provider.wallet as anchor.Wallet).payer;
  const conn = provider.connection;

  const config = seed("config");
  const vault = seed("vault");
  const card = seed("card", Buffer.from(UID));
  const merchant = seed("merchant", u16(MERCHANT_ID));

  let mint: anchor.web3.PublicKey;
  let issuerAta: anchor.web3.PublicKey;
  let merchantAta: anchor.web3.PublicKey;
  const shop = anchor.web3.Keypair.generate();

  async function authEvents(sig: string) {
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const parser = new anchor.EventParser(program.programId, program.coder);
    return [...parser.parseLogs(tx!.meta!.logMessages!)].filter((e) => e.name === "authEvent").map((e) => e.data as anchor.IdlEvents<Settld>["authEvent"]);
  }

  async function lastAuthEvent(run: () => Promise<string>) {
    const sig = await run();
    const evs = await authEvents(sig);
    return { sig, ev: evs[evs.length - 1] };
  }

  function pay(amount: number, riskBps: number, nonce: number) {
    return program.methods
      .pay(UID, new BN(amount), riskBps, MERCHANT_ID, new BN(nonce))
      .accountsPartial({ issuer: issuer.publicKey, config, card, merchant, mint, vault, merchantTokenAccount: merchantAta, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
  }

  it("sets up the issuer, the mint and one merchant", async () => {
    mint = await createMint(conn, issuer, issuer.publicKey, null, 6);
    issuerAta = await createAssociatedTokenAccount(conn, issuer, mint, issuer.publicKey);
    await mintTo(conn, issuer, mint, issuerAta, issuer, 1_000 * DOLLAR);
    merchantAta = await createAssociatedTokenAccount(conn, issuer, mint, shop.publicKey);

    await program.methods.initConfig(8000)
      .accountsPartial({ issuer: issuer.publicKey, config, mint, vault, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    await program.methods.registerMerchant(MERCHANT_ID, 1)
      .accountsPartial({ issuer: issuer.publicKey, config, merchant, tokenAccount: merchantAta })
      .rpc();

    const c = await program.account.config.fetch(config);
    assert.equal(c.declineBps, 8000);
    assert.equal(c.mint.toBase58(), mint.toBase58());
    assert.isFalse((await program.account.merchant.fetch(merchant)).acceptsAgents);
  });

  it("registers a card keyed by its serial", async () => {
    await program.methods.registerCard(UID, new BN(50 * DOLLAR), issuer.publicKey)
      .accountsPartial({ issuer: issuer.publicKey, config, card })
      .rpc();
    const c = await program.account.card.fetch(card);
    assert.deepEqual(Array.from(c.uid), UID);
    assert.equal(c.dailyLimit.toNumber(), 50 * DOLLAR);
    assert.equal(c.balance.toNumber(), 0);
    assert.equal(c.spentToday.toNumber(), 0);
    assert.deepEqual(c.kind, { person: {} });
    assert.equal(c.owner.toBase58(), issuer.publicKey.toBase58());
  });

  it("moves a deposit into the vault and credits the card", async () => {
    await program.methods.deposit(UID, new BN(20 * DOLLAR))
      .accountsPartial({ payer: issuer.publicKey, config, card, mint, from: issuerAta, vault, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    assert.equal((await program.account.card.fetch(card)).balance.toNumber(), 20 * DOLLAR);
    assert.equal(Number((await getAccount(conn, vault)).amount), 20 * DOLLAR);
  });

  it("pays the merchant in the same transaction as the authorization", async () => {
    const before = Number((await getAccount(conn, merchantAta)).amount);
    const { ev } = await lastAuthEvent(() => pay(5.5 * DOLLAR, 300, 1));
    assert.isTrue(ev.approved);
    assert.equal(ev.reason, 0);
    assert.isTrue(ev.settled);
    assert.equal(ev.kind, 0);
    const after = Number((await getAccount(conn, merchantAta)).amount);
    assert.equal(after - before, 5.5 * DOLLAR);
    const c = await program.account.card.fetch(card);
    assert.equal(c.balance.toNumber(), 14.5 * DOLLAR);
    assert.equal(c.spentToday.toNumber(), 5.5 * DOLLAR);
    assert.equal((await program.account.merchant.fetch(merchant)).settledTotal.toNumber(), 5.5 * DOLLAR);
  });

  it("stops a high-risk tap without moving money, and without erroring", async () => {
    const before = Number((await getAccount(conn, merchantAta)).amount);
    const { ev } = await lastAuthEvent(() => pay(1 * DOLLAR, 9500, 2));
    assert.isFalse(ev.approved);
    assert.equal(ev.reason, 3);
    assert.isFalse(ev.settled);
    assert.equal(Number((await getAccount(conn, merchantAta)).amount), before);
    assert.equal((await program.account.card.fetch(card)).balance.toNumber(), 14.5 * DOLLAR);
  });

  it("stops a tap larger than the balance", async () => {
    const { ev } = await lastAuthEvent(() => pay(20 * DOLLAR, 100, 3));
    assert.isFalse(ev.approved);
    assert.equal(ev.reason, 4);
  });

  it("returns money to a wallet on withdraw", async () => {
    const before = Number((await getAccount(conn, issuerAta)).amount);
    await program.methods.withdraw(UID, new BN(4.5 * DOLLAR))
      .accountsPartial({ issuer: issuer.publicKey, config, card, mint, vault, destination: issuerAta, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    assert.equal(Number((await getAccount(conn, issuerAta)).amount) - before, 4.5 * DOLLAR);
    assert.equal((await program.account.card.fetch(card)).balance.toNumber(), 10 * DOLLAR);
  });

  it("refuses a frozen card even with a clean score, and will not let it withdraw", async () => {
    await program.methods.setCardStatus(UID, { blocked: {} })
      .accountsPartial({ issuer: issuer.publicKey, config, card })
      .rpc();
    const { ev } = await lastAuthEvent(() => pay(1 * DOLLAR, 0, 4));
    assert.isFalse(ev.approved);
    assert.equal(ev.reason, 1);
    try {
      await program.methods.withdraw(UID, new BN(1 * DOLLAR))
        .accountsPartial({ issuer: issuer.publicKey, config, card, mint, vault, destination: issuerAta, tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
      assert.fail("expected CardBlocked");
    } catch (e: unknown) {
      assert.include(String(e), "CardBlocked");
    }
    await program.methods.setCardStatus(UID, { active: {} })
      .accountsPartial({ issuer: issuer.publicKey, config, card })
      .rpc();
  });

  it("rejects a zero amount outright", async () => {
    try {
      await pay(0, 0, 99);
      assert.fail("expected ZeroAmount");
    } catch (e: unknown) {
      assert.include(String(e), "ZeroAmount");
    }
  });

  it("stops a tap over the daily limit", async () => {
    await program.methods.deposit(UID, new BN(60 * DOLLAR))
      .accountsPartial({ payer: issuer.publicKey, config, card, mint, from: issuerAta, vault, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    const { ev } = await lastAuthEvent(() => pay(45 * DOLLAR, 100, 5));
    assert.isFalse(ev.approved);
    assert.equal(ev.reason, 2);
  });
});

describe("agents", () => {
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.settld as Program<Settld>;
  const issuer = (provider.wallet as anchor.Wallet).payer;
  const conn = provider.connection;

  const config = seed("config");
  const vault = seed("vault");
  const owner = anchor.web3.Keypair.generate().publicKey;
  const OWNER_UID = [0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66];
  const TASK_UID = [0x7a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01];
  const ownerCard = seed("card", Buffer.from(OWNER_UID));
  const taskCard = seed("card", Buffer.from(TASK_UID));
  const AGENT_ID = 1;
  const SHOP = MERCHANT_ID;
  const OTHER = 9;
  const agent = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("agent"), owner.toBuffer(), u16(AGENT_ID)], program.programId)[0];
  const merchantPda = (id: number) => seed("merchant", u16(id));
  const intentPda = (nonce: number) => anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("intent"), agent.toBuffer(), u64(nonce)], program.programId)[0];

  let mint: anchor.web3.PublicKey;
  let issuerAta: anchor.web3.PublicKey;
  let shopAta: anchor.web3.PublicKey;
  let otherAta: anchor.web3.PublicKey;

  const policy = {
    budgetTotal: new BN(40 * DOLLAR),
    perTxnMax: new BN(10 * DOLLAR),
    dailyMax: new BN(40 * DOLLAR),
    merchantMask: new BN(1 << SHOP),
    hourStart: 0,
    hourEnd: 0,
    approvalThreshold: new BN(6 * DOLLAR),
    maxTxnPerHour: 3,
  };

  async function decision(run: () => Promise<string>) {
    const sig = await run();
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const parser = new anchor.EventParser(program.programId, program.coder);
    const evs = [...parser.parseLogs(tx!.meta!.logMessages!)].filter((e) => e.name === "authEvent").map((e) => e.data as anchor.IdlEvents<Settld>["authEvent"]);
    return evs[evs.length - 1];
  }

  function payAgent(amount: number, riskBps: number, merchantId: number, nonce: number, intent: anchor.web3.PublicKey | null = null) {
    return program.methods.payAgent(TASK_UID, new BN(amount), riskBps, merchantId, new BN(nonce))
      .accountsPartial({
        issuer: issuer.publicKey, config, card: taskCard, agent, merchant: merchantPda(merchantId), mint, vault,
        merchantTokenAccount: merchantId === SHOP ? shopAta : otherAta, intent, tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  it("registers an agent under an owner and funds it from the owner's card", async () => {
    mint = (await program.account.config.fetch(config)).mint;
    issuerAta = getAssociatedTokenAddressSync(mint, issuer.publicKey);
    shopAta = (await program.account.merchant.fetch(merchantPda(SHOP))).tokenAccount;

    await program.methods.registerCard(OWNER_UID, new BN(500 * DOLLAR), owner)
      .accountsPartial({ issuer: issuer.publicKey, config, card: ownerCard }).rpc();
    await program.methods.deposit(OWNER_UID, new BN(50 * DOLLAR))
      .accountsPartial({ payer: issuer.publicKey, config, card: ownerCard, mint, from: issuerAta, vault, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
    await program.methods.registerAgent(owner, AGENT_ID, policy)
      .accountsPartial({ issuer: issuer.publicKey, config, agent }).rpc();
    await program.methods.fundAgent(OWNER_UID, owner, AGENT_ID, new BN(40 * DOLLAR))
      .accountsPartial({ issuer: issuer.publicKey, config, card: ownerCard, agent }).rpc();

    const a = await program.account.agent.fetch(agent);
    assert.equal(a.owner.toBase58(), owner.toBase58());
    assert.equal(a.agentId, AGENT_ID);
    assert.equal(a.balance.toNumber(), 40 * DOLLAR);
    assert.equal(a.policyVersion, 1);
    const encoded = program.coder.types.encode("agentPolicy", policy);
    assert.equal(Buffer.from(a.policyHash).toString("hex"), createHash("sha256").update(encoded).digest("hex"));
    assert.equal(a.policy.perTxnMax.toNumber(), 10 * DOLLAR);
    assert.equal((await program.account.card.fetch(ownerCard)).balance.toNumber(), 10 * DOLLAR);
  });

  it("refuses to fund an agent from a card the owner does not hold", async () => {
    try {
      await program.methods.fundAgent(UID, owner, AGENT_ID, new BN(1))
        .accountsPartial({ issuer: issuer.publicKey, config, card: seed("card", Buffer.from(UID)), agent }).rpc();
      assert.fail("expected NotOwner");
    } catch (e: unknown) {
      assert.include(String(e), "NotOwner");
    }
  });

  it("changes the policy and records a new version and hash", async () => {
    const before = await program.account.agent.fetch(agent);
    await program.methods.setAgentPolicy(owner, AGENT_ID, { ...policy, dailyMax: new BN(30 * DOLLAR) })
      .accountsPartial({ issuer: issuer.publicKey, config, agent }).rpc();
    const after = await program.account.agent.fetch(agent);
    assert.equal(after.policyVersion, 2);
    assert.notDeepEqual(Array.from(after.policyHash), Array.from(before.policyHash));
    await program.methods.setAgentPolicy(owner, AGENT_ID, policy)
      .accountsPartial({ issuer: issuer.publicKey, config, agent }).rpc();
    assert.deepEqual(Array.from((await program.account.agent.fetch(agent)).policyHash), Array.from(before.policyHash));
  });

  it("opens a task card that holds part of the agent's budget", async () => {
    await program.methods.openTaskCard(owner, AGENT_ID, TASK_UID, new BN(20 * DOLLAR), ALL, new BN(0))
      .accountsPartial({ issuer: issuer.publicKey, config, agent, card: taskCard }).rpc();
    const a = await program.account.agent.fetch(agent);
    assert.equal(a.balance.toNumber(), 20 * DOLLAR);
    assert.equal(a.openTasks, 1);
    const t = await program.account.card.fetch(taskCard);
    assert.equal(t.balance.toNumber(), 20 * DOLLAR);
    assert.deepEqual(t.kind, { task: {} });
    assert.equal(t.owner.toBase58(), agent.toBase58());
  });

  it("refuses an agent order at a shop that has not opted in", async () => {
    const ev = await decision(() => payAgent(5 * DOLLAR, 100, SHOP, 1));
    assert.isFalse(ev.approved);
    assert.equal(ev.reason, 6);
    try {
      await program.methods.registerMerchant(63, 1).accountsPartial({ issuer: issuer.publicKey, config, merchant: merchantPda(63), tokenAccount: vault }).rpc();
      assert.fail("expected MerchantIsVault");
    } catch (e: unknown) {
      assert.include(String(e), "MerchantIsVault");
    }
    await program.methods.setMerchantAgentPolicy(SHOP, true, new BN(0))
      .accountsPartial({ issuer: issuer.publicKey, config, merchant: merchantPda(SHOP) }).rpc();
    assert.isTrue((await program.account.merchant.fetch(merchantPda(SHOP))).acceptsAgents);
  });

  it("pays the shop for an agent order inside the policy", async () => {
    const before = Number((await getAccount(conn, shopAta)).amount);
    const ev = await decision(() => payAgent(5 * DOLLAR, 100, SHOP, 2));
    assert.isTrue(ev.approved);
    assert.equal(ev.reason, 0);
    assert.isTrue(ev.settled);
    assert.equal(ev.kind, 1);
    assert.equal(ev.agentId, AGENT_ID);
    assert.equal(Number((await getAccount(conn, shopAta)).amount) - before, 5 * DOLLAR);
    assert.equal((await program.account.card.fetch(taskCard)).balance.toNumber(), 15 * DOLLAR);
    assert.equal((await program.account.agent.fetch(agent)).spentTotal.toNumber(), 5 * DOLLAR);
  });

  it("will not accept a task card through the person tap", async () => {
    try {
      await program.methods.pay(TASK_UID, new BN(DOLLAR), 100, SHOP, new BN(3))
        .accountsPartial({ issuer: issuer.publicKey, config, card: taskCard, merchant: merchantPda(SHOP), mint, vault, merchantTokenAccount: shopAta, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
      assert.fail("expected WrongCardKind");
    } catch (e: unknown) {
      assert.include(String(e), "WrongCardKind");
    }
  });

  it("stops an agent order over the per-purchase cap", async () => {
    const ev = await decision(() => payAgent(11 * DOLLAR, 100, SHOP, 4));
    assert.isFalse(ev.approved);
    assert.equal(ev.reason, 8);
  });

  it("holds an order above the approval threshold until the owner approves", async () => {
    const held = await decision(() => payAgent(8 * DOLLAR, 100, SHOP, 5));
    assert.isFalse(held.approved);
    assert.equal(held.reason, 9);

    const nonce = 77;
    await program.methods.approveIntent(owner, AGENT_ID, new BN(nonce), SHOP, new BN(8 * DOLLAR), new BN(0), owner)
      .accountsPartial({ issuer: issuer.publicKey, config, agent, intent: intentPda(nonce) }).rpc();
    const ok = await decision(() => payAgent(8 * DOLLAR, 100, SHOP, 6, intentPda(nonce)));
    assert.isTrue(ok.approved);
    assert.isTrue(ok.intentUsed);
    assert.equal(ok.agent.toBase58(), agent.toBase58());
    assert.isTrue((await program.account.intent.fetch(intentPda(nonce))).used);
    assert.equal((await program.account.card.fetch(taskCard)).balance.toNumber(), 7 * DOLLAR);
  });

  it("does not accept a used intent twice, and closes it to recover the rent", async () => {
    const ev = await decision(() => payAgent(7 * DOLLAR, 100, SHOP, 7, intentPda(77)));
    assert.isFalse(ev.approved);
    assert.equal(ev.reason, 9);
    assert.isFalse(ev.intentUsed);
    const before = await conn.getBalance(issuer.publicKey);
    await program.methods.closeIntent(owner, AGENT_ID, new BN(77))
      .accountsPartial({ issuer: issuer.publicKey, config, agent, intent: intentPda(77) }).rpc();
    assert.isNull(await conn.getAccountInfo(intentPda(77)));
    assert.isAbove(await conn.getBalance(issuer.publicKey), before);
  });

  it("refuses to close an intent through another agent", async () => {
    const nonce = 78;
    await program.methods.approveIntent(owner, AGENT_ID, new BN(nonce), SHOP, new BN(1 * DOLLAR), new BN(0), owner)
      .accountsPartial({ issuer: issuer.publicKey, config, agent, intent: intentPda(nonce) }).rpc();
    const stranger = anchor.web3.Keypair.generate().publicKey;
    const otherAgent = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("agent"), stranger.toBuffer(), u16(1)], program.programId)[0];
    await program.methods.registerAgent(stranger, 1, policy).accountsPartial({ issuer: issuer.publicKey, config, agent: otherAgent }).rpc();
    try {
      await program.methods.closeIntent(stranger, 1, new BN(nonce))
        .accountsPartial({ issuer: issuer.publicKey, config, agent: otherAgent, intent: intentPda(nonce) }).rpc();
      assert.fail("expected a seeds or has_one failure");
    } catch (e: unknown) {
      assert.match(String(e), /ConstraintSeeds|ConstraintHasOne|AccountNotInitialized/);
    }
    await program.methods.closeIntent(owner, AGENT_ID, new BN(nonce))
      .accountsPartial({ issuer: issuer.publicKey, config, agent, intent: intentPda(nonce) }).rpc();
  });

  it("stops an agent order at a shop outside the agent's allowlist", async () => {
    const other = anchor.web3.Keypair.generate();
    otherAta = await createAssociatedTokenAccount(conn, issuer, mint, other.publicKey);
    await program.methods.registerMerchant(OTHER, 2)
      .accountsPartial({ issuer: issuer.publicKey, config, merchant: merchantPda(OTHER), tokenAccount: otherAta }).rpc();
    await program.methods.setMerchantAgentPolicy(OTHER, true, new BN(0))
      .accountsPartial({ issuer: issuer.publicKey, config, merchant: merchantPda(OTHER) }).rpc();
    const ev = await decision(() => payAgent(1 * DOLLAR, 100, OTHER, 8));
    assert.isFalse(ev.approved);
    assert.equal(ev.reason, 6);
  });

  it("counts purchases per hour", async () => {
    const third = await decision(() => payAgent(1 * DOLLAR, 100, SHOP, 9));
    assert.isTrue(third.approved);
    const fourth = await decision(() => payAgent(1 * DOLLAR, 100, SHOP, 10));
    assert.isFalse(fourth.approved);
    assert.equal(fourth.reason, 10);
  });

  it("freezes the agent, one at a time and all at once", async () => {
    await program.methods.setAgentFrozen(owner, AGENT_ID, true)
      .accountsPartial({ issuer: issuer.publicKey, config, agent }).rpc();
    const ev = await decision(() => payAgent(1 * DOLLAR, 100, SHOP, 11));
    assert.isFalse(ev.approved);
    assert.equal(ev.reason, 5);
    await program.methods.setAgentFrozen(owner, AGENT_ID, false)
      .accountsPartial({ issuer: issuer.publicKey, config, agent }).rpc();
    assert.isFalse((await program.account.agent.fetch(agent)).frozen);

    await program.methods.freezeAll(owner)
      .accountsPartial({ issuer: issuer.publicKey, config })
      .remainingAccounts([{ pubkey: agent, isWritable: true, isSigner: false }]).rpc();
    assert.isTrue((await program.account.agent.fetch(agent)).frozen);
    await program.methods.setAgentFrozen(owner, AGENT_ID, false)
      .accountsPartial({ issuer: issuer.publicKey, config, agent }).rpc();
  });

  it("closes the task card and returns what is left to the agent", async () => {
    await program.methods.closeTaskCard(owner, AGENT_ID, TASK_UID)
      .accountsPartial({ issuer: issuer.publicKey, config, agent, card: taskCard }).rpc();
    assert.isNull(await conn.getAccountInfo(taskCard));
    const a = await program.account.agent.fetch(agent);
    assert.equal(a.balance.toNumber(), 26 * DOLLAR);
    assert.equal(a.openTasks, 0);
  });

  it("claws the agent's balance back to the owner's card", async () => {
    await program.methods.clawback(OWNER_UID, owner, AGENT_ID, new BN(26 * DOLLAR))
      .accountsPartial({ issuer: issuer.publicKey, config, card: ownerCard, agent }).rpc();
    assert.equal((await program.account.agent.fetch(agent)).balance.toNumber(), 0);
    assert.equal((await program.account.card.fetch(ownerCard)).balance.toNumber(), 36 * DOLLAR);
  });
});

describe("authorize_batch", () => {
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.settld as Program<Settld>;
  const issuer = (provider.wallet as anchor.Wallet).payer;
  const config = seed("config");
  const vault = seed("vault");
  const N = 20;
  const uids = Array.from({ length: N }, (_, i) => [0x04, 0xb0, 0x00, 0x00, i, 0x01, 0x02]);
  const pdas = uids.map((u) => seed("card", Buffer.from(u)));

  it("authorizes 20 cards in one transaction", async () => {
    for (let i = 0; i < N; i += 8) {
      const tx = new anchor.web3.Transaction();
      for (let j = i; j < Math.min(i + 8, N); j++) {
        tx.add(await program.methods.registerCard(uids[j], new BN(500 * DOLLAR), issuer.publicKey)
          .accountsPartial({ issuer: issuer.publicKey, config, card: pdas[j] }).instruction());
      }
      await provider.sendAndConfirm(tx);
    }

    const { mint } = await program.account.config.fetch(config);
    const issuerAta = getAssociatedTokenAddressSync(mint, issuer.publicKey);
    for (let i = 0; i < N; i += 4) {
      const tx = new anchor.web3.Transaction();
      for (let j = i; j < Math.min(i + 4, N); j++) {
        tx.add(await program.methods.deposit(uids[j], new BN(1 * DOLLAR))
          .accountsPartial({ payer: issuer.publicKey, config, card: pdas[j], mint, from: issuerAta, vault, tokenProgram: TOKEN_PROGRAM_ID }).instruction());
      }
      await provider.sendAndConfirm(tx);
    }

    const items = uids.map((_, i) => ({ amount: new BN(1_000 + i), riskBps: i === 3 ? 9_999 : 100, merchantId: i }));
    const sig = await program.methods.authorizeBatch(new BN(500), items)
      .accountsPartial({ issuer: issuer.publicKey, config })
      .remainingAccounts(pdas.map((p) => ({ pubkey: p, isWritable: true, isSigner: false })))
      .rpc();

    const tx = await provider.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    console.log("      ", tx?.meta?.logMessages?.find((l) => l.includes("consumed")));
    const parser = new anchor.EventParser(program.programId, program.coder);
    const seen = [...parser.parseLogs(tx!.meta!.logMessages!)].map((e) => e.data as anchor.IdlEvents<Settld>["authEvent"]);

    assert.equal(seen.length, N);
    assert.deepEqual(Array.from(seen[5].uid), uids[5]);
    assert.equal(seen[5].nonce.toNumber(), 505);
    assert.isFalse(seen[3].approved);
    assert.equal(seen[3].reason, 3);
    assert.equal(seen.filter((e) => e.approved).length, N - 1);
  });

  it("rejects a batch whose item count does not match its accounts", async () => {
    try {
      await program.methods.authorizeBatch(new BN(1), [{ amount: new BN(1), riskBps: 0, merchantId: 0 }])
        .accountsPartial({ issuer: issuer.publicKey, config })
        .remainingAccounts(pdas.slice(0, 2).map((p) => ({ pubkey: p, isWritable: true, isSigner: false })))
        .rpc();
      assert.fail("expected BatchLengthMismatch");
    } catch (e: unknown) {
      assert.include(String(e), "BatchLengthMismatch");
    }
  });
});
