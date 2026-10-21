const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

async function main() {
  console.log('====================================================');
  console.log('DECISIONX PROTOCOL - BOT CHAIN MAINNET DEPLOYER');
  console.log('====================================================\n');

  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('ERROR: .env file missing');
    process.exit(1);
  }
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/DEPLOYER_PRIVATE_KEY=([a-fA-F0-9x]+)/);
  if (!match) {
    console.error('ERROR: DEPLOYER_PRIVATE_KEY not found in .env');
    process.exit(1);
  }
  const rawPrivKey = match[1];
  const privKey = rawPrivKey.startsWith('0x') ? rawPrivKey : '0x' + rawPrivKey;

  const rpcUrl = 'https://rpc.botchain.ai';
  const expectedChainId = 677;
  console.log('Connecting to BOT Chain Mainnet RPC:', rpcUrl);
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log(`Validated Chain ID: ${chainId} (Expected: ${expectedChainId})`);
  if (chainId !== expectedChainId) {
    console.error(`FATAL: Connected chain ID ${chainId} does not match BOT Chain Mainnet (677)`);
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privKey, provider);
  const deployerAddress = await wallet.getAddress();
  console.log('Deployer Address:', deployerAddress);

  const balance = await provider.getBalance(deployerAddress);
  const balanceBot = ethers.formatEther(balance);
  console.log(`Deployer Balance: ${balanceBot} BOT (${balance.toString()} Wei)`);

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || 20000000000n;
  console.log(`Current Gas Price: ${gasPrice.toString()} Wei (${Number(gasPrice) / 1e9} Gwei)`);

  // Load compiled artifact
  const artifactPath = path.join(__dirname, '..', 'artifacts', 'DecisionX.json');
  if (!fs.existsSync(artifactPath)) {
    console.error('ERROR: Artifacts not found. Run "npm run compile" first.');
    process.exit(1);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployTx = await factory.getDeployTransaction();
  const estimatedGas = 2223389n; // Measured exact deployment gas
  const estimatedCost = estimatedGas * gasPrice;
  const estimatedCostBot = ethers.formatEther(estimatedCost);
  console.log(`Estimated Deployment Gas: ${estimatedGas.toLocaleString()} gas`);
  console.log(`Estimated Deployment Cost: ~${estimatedCostBot} BOT\n`);

  if (balance < estimatedCost) {
    console.warn('====================================================');
    console.warn('⚠️  DEPLOYMENT BLOCKED: INSUFFICIENT BOT BALANCE');
    console.warn('====================================================');
    console.warn(`Deployer: ${deployerAddress}`);
    console.warn(`Current Balance: ${balanceBot} BOT`);
    console.warn(`Required Balance: >= ${estimatedCostBot} BOT`);
    console.warn(`Network: BOT Chain Mainnet (Chain ID 677)`);
    console.warn(`Please fund ${deployerAddress} with at least ${estimatedCostBot} BOT and re-run deploy.`);
    return {
      status: 'BLOCKED',
      deployerAddress,
      balanceBot,
      requiredBot: estimatedCostBot,
      contractAddress: 'NOT DEPLOYED',
      txHash: 'NOT DEPLOYED',
      blockNumber: 'NOT DEPLOYED'
    };
  }

  console.log('Deployer has sufficient balance. Broadcasting deployment transaction...');
  const contract = await factory.deploy({ gasLimit: 2500000n, gasPrice });
  console.log(`Broadcasted tx hash: ${contract.deploymentTransaction().hash}`);
  console.log('Waiting for confirmation on BOT Chain Mainnet...');

  await contract.waitForDeployment();
  const deployedAddress = await contract.getAddress();
  const receipt = await provider.getTransactionReceipt(contract.deploymentTransaction().hash);

  console.log('\n====================================================');
  console.log('✅ MAINNET DEPLOYMENT SUCCESSFUL!');
  console.log('====================================================');
  console.log(`Deployed Address: ${deployedAddress}`);
  console.log(`Tx Hash: ${receipt.hash}`);
  console.log(`Block Number: ${receipt.blockNumber}`);
  console.log(`Gas Used: ${receipt.gasUsed.toString()}`);
  console.log(`BOTScan URL: https://scan.botchain.ai/address/${deployedAddress}`);
  console.log(`Tx Explorer URL: https://scan.botchain.ai/tx/${receipt.hash}`);

  // Write deployment evidence
  const deploymentInfo = {
    network: 'BOT Chain Mainnet',
    chainId: 677,
    contractAddress: deployedAddress,
    deployerAddress,
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.gasPrice ? receipt.gasPrice.toString() : gasPrice.toString(),
    deployedAt: new Date().toISOString(),
    explorerUrl: `https://scan.botchain.ai/address/${deployedAddress}`,
    compiler: '0.8.24',
    optimizerRuns: 1000
  };

  fs.writeFileSync(
    path.join(__dirname, '..', 'deployment_receipt.json'),
    JSON.stringify(deploymentInfo, null, 2)
  );

  // Update frontend contracts config
  const frontendConfigDir = path.join(__dirname, '..', 'DecisionX Frontend', 'src', 'contracts');
  if (!fs.existsSync(frontendConfigDir)) fs.mkdirSync(frontendConfigDir, { recursive: true });
  fs.writeFileSync(
    path.join(frontendConfigDir, 'config.json'),
    JSON.stringify({
      network: 'BOT Chain Mainnet',
      chainId: 677,
      rpcUrl: 'https://rpc.botchain.ai',
      explorerUrl: 'https://scan.botchain.ai',
      contractAddress: deployedAddress
    }, null, 2)
  );

  // Update .env with mainnet contract address
  let updatedEnv = fs.readFileSync(envPath, 'utf8');
  if (updatedEnv.includes('MAINNET_CONTRACT_ADDRESS=')) {
    updatedEnv = updatedEnv.replace(/MAINNET_CONTRACT_ADDRESS=.*/, `MAINNET_CONTRACT_ADDRESS=${deployedAddress}`);
  } else {
    updatedEnv += `\nMAINNET_CONTRACT_ADDRESS=${deployedAddress}\n`;
  }
  fs.writeFileSync(envPath, updatedEnv);
  console.log(`Updated .env with MAINNET_CONTRACT_ADDRESS=${deployedAddress}`);

  return {
    status: 'SUCCESS',
    ...deploymentInfo
  };
}

if (require.main === module) {
  main().then(result => {
    if (result && result.status === 'BLOCKED') {
      process.exit(0);
    }
  }).catch(err => {
    console.error('Deployment error:', err);
    process.exit(1);
  });
}

module.exports = { main };
