const fs = require('fs');
const path = require('path');

let deployerKey = '';
try {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const match = envContent.match(/DEPLOYER_PRIVATE_KEY=([a-fA-F0-9x]+)/);
  if (match) deployerKey = match[1];
} catch (e) {}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000
      }
    }
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainId: 31337
    },
    botchain: {
      type: "http",
      url: "https://rpc.botchain.ai",
      chainId: 677,
      accounts: deployerKey ? [deployerKey] : []
    }
  }
};
