import * as anchor from "@anchor-lang/core";
import { BN } from "@anchor-lang/core";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { connect, configPda, vaultPda, cardPda } from "./common";

const CARDS = Number(process.env.CARDS ?? 2000);
const RATE = Number(process.env.RATE ?? 500);
const BATCH = Number(process.env.BATCH ?? 20);
const SECONDS = Number(process.env.SECONDS ?? 20);
const CU_PRICE = Number(process.env.CU_PRICE ?? 1000);

const { Transaction, ComputeBudgetProgram } = anchor.web3;
const uidFor = (i: number): number[] => [0x04, (i >> 24) & 0xff, (i >> 16) & 0xff, (i >> 8) & 0xff, i & 0xff, 0xaa, 0x55];

async function main() {
  const { provider, program, conn, issuer } = connect();
  const config = configPda();
  const cards = Array.from({ length: CARDS }, (_, i) => { const uid = uidFor(i); return { uid, pda: cardPda(uid) }; });

  const infos: (anchor.web3.AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < cards.length; i += 100) infos.push(...(await conn.getMultipleAccountsInfo(cards.slice(i, i + 100).map((c) => c.pda))));
  const missing = cards.filter((_, i) => !infos[i]);
  console.log(`cards: ${CARDS}, to seed: ${missing.length}`);
  const SEED_PER_TX = 8;
  let t0 = Date.now();
  for (let i = 0; i < missing.length; i += SEED_PER_TX) {
    const tx = new Transaction();
    for (const c of missing.slice(i, i + SEED_PER_TX)) {
      tx.add(await program.methods.registerCard(c.uid, new BN(1_000_000_000), issuer.publicKey).accountsPartial({ issuer: issuer.publicKey, config, card: c.pda }).instruction());
    }
    await provider.sendAndConfirm(tx, [], { commitment: "processed", skipPreflight: true });
  }
  if (missing.length) {
    await new Promise((r) => setTimeout(r, 2000));
    console.log(`seeded ${missing.length} cards in ${Date.now() - t0} ms`);

    const { mint } = await program.account.config.fetch(config);
    const issuerAta = getAssociatedTokenAddressSync(mint, issuer.publicKey);
    const vault = vaultPda();
    t0 = Date.now();
    for (let i = 0; i < missing.length; i += 4) {
      const tx = new Transaction();
      for (const c of missing.slice(i, i + 4)) {
        tx.add(await program.methods.deposit(c.uid, new BN(1_000_000))
          .accountsPartial({ payer: issuer.publicKey, config, card: c.pda, mint, from: issuerAta, vault, tokenProgram: TOKEN_PROGRAM_ID }).instruction());
      }
      await provider.sendAndConfirm(tx, [], { commitment: "processed", skipPreflight: true });
    }
    await new Promise((r) => setTimeout(r, 2000));
    console.log(`funded ${missing.length} cards in ${Date.now() - t0} ms`);
  }

  let blockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  const bhTimer = setInterval(async () => { try { blockhash = (await conn.getLatestBlockhash("confirmed")).blockhash; } catch {  } }, 10_000);

  let nonce = Date.now();
  let next = 0;
  async function buildBatch(): Promise<anchor.web3.Transaction> {
    const picked = Array.from({ length: BATCH }, () => cards[next++ % cards.length]);
    const items = picked.map(() => ({
      amount: new BN(100 + Math.floor(Math.random() * 5000)),
      riskBps: Math.random() < 0.02 ? 9000 : Math.floor(Math.random() * 3000),
      merchantId: 1 + Math.floor(Math.random() * 4),
    }));
    const batchNonce = nonce;
    nonce += BATCH;
    const ix = await program.methods.authorizeBatch(new BN(batchNonce), items)
      .accountsPartial({ issuer: issuer.publicKey, config })
      .remainingAccounts(picked.map((c) => ({ pubkey: c.pda, isWritable: true, isSigner: false })))
      .instruction();
    const tx = new Transaction({ feePayer: issuer.publicKey, recentBlockhash: blockhash });
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE }));
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000 + 2_000 * BATCH }));
    tx.add(ix);
    return tx;
  }

  const probe = await provider.wallet.signTransaction(await buildBatch());
  console.log(`tx size for a batch of ${BATCH}: ${probe.serialize().length} bytes (limit 1232)`);

  const txPerSec = RATE / BATCH;
  const tickMs = 1000 / txPerSec;
  const sigs: string[] = [];
  const sendErrors: Record<string, number> = {};
  let sent = 0;
  console.log(`firing ${RATE} items/s as ${txPerSec.toFixed(1)} tx/s for ${SECONDS}s`);
  t0 = Date.now();
  const deadline = t0 + SECONDS * 1000;
  let scheduled = t0;
  const inflight: Promise<void>[] = [];
  while (Date.now() < deadline) {
    scheduled += tickMs;
    const signed = await provider.wallet.signTransaction(await buildBatch());
    inflight.push(conn.sendRawTransaction(signed.serialize(), { skipPreflight: true, preflightCommitment: "processed" })
      .then((s) => { sigs.push(s); sent++; })
      .catch((e: Error) => { const k = String(e.message ?? e).slice(0, 80); sendErrors[k] = (sendErrors[k] ?? 0) + 1; }));
    const wait = scheduled - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  await Promise.all(inflight);
  const elapsed = (Date.now() - t0) / 1000;
  clearInterval(bhTimer);
  console.log(`sent ${sent} txs (${sent * BATCH} taps) in ${elapsed.toFixed(1)}s = ${(sent / elapsed).toFixed(1)} tx/s, ${((sent * BATCH) / elapsed).toFixed(0)} taps/s`);
  if (Object.keys(sendErrors).length) console.log("send errors:", sendErrors);

  await new Promise((r) => setTimeout(r, 4000));
  let ok = 0, failed = 0, unknown = 0;
  const errKinds: Record<string, number> = {};
  for (let i = 0; i < sigs.length; i += 256) {
    const st = await conn.getSignatureStatuses(sigs.slice(i, i + 256), { searchTransactionHistory: true });
    for (const s of st.value) {
      if (!s) unknown++;
      else if (s.err) { failed++; const k = JSON.stringify(s.err).slice(0, 80); errKinds[k] = (errKinds[k] ?? 0) + 1; }
      else ok++;
    }
  }
  console.log(`landed ok=${ok} failed=${failed} unknown=${unknown} of ${sigs.length}`);
  if (Object.keys(errKinds).length) console.log("on-chain errors:", errKinds);

  if (sigs.length) {
    const tx = await conn.getTransaction(sigs[Math.floor(sigs.length / 2)], { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const cu = tx?.meta?.logMessages?.find((l) => l.includes("consumed"));
    console.log("sample:", cu, "| fee lamports:", tx?.meta?.fee);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
