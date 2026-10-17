import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Settld } from "../target/types/settld";
import idl from "../target/idl/settld.json";
import shops from "../services/auth/shops.json";

export const MINT = new anchor.web3.PublicKey(process.env.SETTLE_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export function connect() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program: Program<Settld> = new Program(idl as Settld, provider);
  const issuer = (provider.wallet as anchor.Wallet).payer;
  return { provider, program, conn: provider.connection, issuer };
}

export const pid = () => new anchor.web3.PublicKey((idl as { address: string }).address);
export const configPda = () => anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("config")], pid())[0];
export const vaultPda = () => anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vault")], pid())[0];
export const cardPda = (uid: number[]) => anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("card"), Buffer.from(uid)], pid())[0];
export function merchantPda(id: number) {
  const b = Buffer.alloc(2); b.writeUInt16LE(id);
  return anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("merchant"), b], pid())[0];
}

export function uidBytes(uid: string): number[] {
  const b = Buffer.from(uid.replace(/[^0-9a-f]/gi, ""), "hex");
  if (b.length !== 7) throw new Error("uid must be 7 bytes hex");
  return Array.from(b);
}

export function merchantKeypair(issuer: anchor.web3.Keypair, id: number): anchor.web3.Keypair {
  const seed = Buffer.alloc(32);
  issuer.secretKey.slice(0, 24).forEach((b, i) => (seed[i] = b));
  seed.writeUInt32LE(id, 24);
  seed.writeUInt32LE(0x5e771e, 28);
  return anchor.web3.Keypair.fromSeed(seed);
}

export function explorerTx(sig: string, rpc: string): string {
  if (rpc.includes("devnet")) return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  const u = new URL(rpc);
  u.search = "";
  return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(u.toString())}`;
}

export const UNITS_PER_CENT = 10_000;

export type Shop = { id: number; name: string; category: string; chain_category: number; kind: "pickup" | "digital"; address: string; geo: [number, number]; accepts_agents: boolean; max_ticket_cents: number };
export const SHOPS: Shop[] = (shops as unknown as Shop[]).map(({ id, name, category, chain_category, kind, address, geo, accepts_agents, max_ticket_cents }) => ({ id, name, category, chain_category, kind, address, geo, accepts_agents, max_ticket_cents }));
export const MERCHANT_IDS = SHOPS.map((s) => s.id);
