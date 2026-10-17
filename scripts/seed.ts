import { BN } from "@anchor-lang/core";
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { connect, MINT, SHOPS, UNITS_PER_CENT, configPda, vaultPda, merchantPda, merchantKeypair } from "./common";

async function main() {
  const { program, conn, issuer } = connect();
  console.log("program", program.programId.toBase58());
  console.log("issuer ", issuer.publicKey.toBase58());

  const config = configPda();
  if (await conn.getAccountInfo(config)) {
    console.log("config exists", config.toBase58());
  } else {
    const sig = await program.methods.initConfig(8000)
      .accountsPartial({ issuer: issuer.publicKey, config, mint: MINT, vault: vaultPda(), tokenProgram: TOKEN_PROGRAM_ID })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("init_config", sig);
  }
  console.log("vault  ", vaultPda().toBase58());

  for (const m of SHOPS) {
    const kp = merchantKeypair(issuer, m.id);
    const ata = await getOrCreateAssociatedTokenAccount(conn, issuer, MINT, kp.publicKey);
    const pda = merchantPda(m.id);
    if (await conn.getAccountInfo(pda)) {
      console.log(`merchant ${m.id} exists`, m.name, ata.address.toBase58());
    } else {
      const sig = await program.methods.registerMerchant(m.id, m.chain_category)
        .accountsPartial({ issuer: issuer.publicKey, config, merchant: pda, tokenAccount: ata.address })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      console.log(`merchant ${m.id}`, m.name, ata.address.toBase58(), sig);
    }
    const cap = new BN(m.max_ticket_cents * UNITS_PER_CENT);
    let rec = null;
    for (let i = 0; i < 10 && !rec; i++) rec = await program.account.merchant.fetchNullable(pda, "confirmed").catch(() => null) || (await new Promise((r) => setTimeout(r, 500)), null);
    if (!rec) throw new Error(`merchant ${m.id} account not readable`);
    if (rec.acceptsAgents !== m.accepts_agents || !rec.maxAgentTicket.eq(cap)) {
      const sig = await program.methods.setMerchantAgentPolicy(m.id, m.accepts_agents, cap)
        .accountsPartial({ issuer: issuer.publicKey, config, merchant: pda })
        .rpc({ skipPreflight: true, commitment: "confirmed" });
      console.log(`merchant ${m.id} agent policy: accepts=${m.accepts_agents} cap=$${(m.max_ticket_cents / 100).toFixed(2)}`, sig);
    } else {
      console.log(`merchant ${m.id} agent policy unchanged: accepts=${rec.acceptsAgents} cap=$${(rec.maxAgentTicket.toNumber() / UNITS_PER_CENT / 100).toFixed(2)}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
