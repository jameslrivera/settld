import * as anchor from "@anchor-lang/core";

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  console.log("deployed; run scripts/seed.ts to create the config, vault and merchants");
};
