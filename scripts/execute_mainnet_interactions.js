const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

async function main() {
  console.log('================================================================');
  console.log('DECISIONX PROTOCOL — MAINNET MULTI-WALLET INTERACTION OPERATOR');
  console.log('================================================================\n');

  // 1. Load Environment & Configuration
  const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const match = envContent.match(/DEPLOYER_PRIVATE_KEY=([a-fA-F0-9x]+)/);
  if (!match) throw new Error('DEPLOYER_PRIVATE_KEY not found in .env');
  const rawKey = match[1];
  const deployerKey = rawKey.startsWith('0x') ? rawKey : '0x' + rawKey;

  const configPath = path.join(__dirname, '..', 'DecisionX Frontend', 'src', 'contracts', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const artifactPath = path.join(__dirname, '..', 'DecisionX Frontend', 'src', 'contracts', 'DecisionX.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  // Configure FetchRequest with 60s timeout and static network for rock-solid RPC communication
  const fetchReq = new ethers.FetchRequest(config.rpcUrl);
  fetchReq.timeout = 60000;
  const network = ethers.Network.from({
    chainId: 677,
    name: 'botchain'
  });
  const provider = new ethers.JsonRpcProvider(fetchReq, network, { staticNetwork: network });

  console.log(`Connected to BOT Chain Mainnet: RPC=${config.rpcUrl}, ChainID=677`);

  const deployer = new ethers.Wallet(deployerKey, provider);
  const deployerBalance = await provider.getBalance(deployer.address);
  console.log(`Deployer Address: ${deployer.address}`);
  console.log(`Deployer Initial Balance: ${ethers.formatEther(deployerBalance)} BOT\n`);

  let gasPrice = 20000000000n; // 20 Gwei minimum
  try {
    const feeData = await provider.getFeeData();
    if (feeData.gasPrice && feeData.gasPrice > gasPrice) {
      gasPrice = feeData.gasPrice;
    }
  } catch (err) {
    console.log('Using default minimum gas price: 20 Gwei');
  }
  console.log(`Execution Gas Price: ${gasPrice.toString()} Wei (${Number(gasPrice) / 1e9} Gwei)\n`);

  // Helper with retries
  async function callWithRetry(fn, retries = 3, delayMs = 3000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        console.warn(`  [Warning] Attempt ${attempt} failed: ${err.message}`);
        if (attempt === retries) throw err;
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  // 2. Generate 6 Unique Wallets
  console.log('----------------------------------------------------------------');
  console.log('GENERATING 6 UNIQUE WALLETS');
  console.log('----------------------------------------------------------------');
  const wallets = [];
  const walletMetadata = [];

  for (let i = 1; i <= 6; i++) {
    const w = ethers.Wallet.createRandom().connect(provider);
    wallets.push(w);
    walletMetadata.push({
      walletNumber: i,
      address: w.address,
      privateKey: w.privateKey
    });
    console.log(`Wallet #${i}: ${w.address}`);
  }

  // Save wallets for record
  fs.writeFileSync(
    path.join(__dirname, '..', 'generated_wallets.json'),
    JSON.stringify(walletMetadata, null, 2)
  );
  console.log('Saved 6 wallet credentials to generated_wallets.json\n');

  // 3. Fund Wallets from Deployer
  console.log('----------------------------------------------------------------');
  console.log('FUNDING 6 WALLETS FROM DEPLOYER ACCOUNT');
  console.log('----------------------------------------------------------------');
  const fundingAmounts = [
    '0.018', // Wallet 1: creates Decision 1 + stakes
    '0.018', // Wallet 2: creates Decision 2 + stakes
    '0.012', // Wallet 3: stakes
    '0.012', // Wallet 4: stakes
    '0.012', // Wallet 5: stakes
    '0.012'  // Wallet 6: stakes
  ];

  const fundingReceipts = [];
  for (let i = 0; i < 6; i++) {
    const recipient = wallets[i].address;
    const amountStr = fundingAmounts[i];
    const amountWei = ethers.parseEther(amountStr);

    console.log(`Sending ${amountStr} BOT to Wallet #${i + 1} (${recipient})...`);
    const receipt = await callWithRetry(async () => {
      const tx = await deployer.sendTransaction({
        to: recipient,
        value: amountWei,
        gasPrice
      });
      return await tx.wait();
    });

    console.log(`  ✓ Confirmed in Block #${receipt.blockNumber} (Tx: ${receipt.hash}) Gas used: ${receipt.gasUsed.toString()}`);
    fundingReceipts.push({
      walletNumber: i + 1,
      address: recipient,
      amountSent: `${amountStr} BOT`,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString()
    });
  }
  console.log('All 6 wallets funded successfully!\n');

  // 4. Contract Setup
  const contractAddress = config.contractAddress;
  console.log(`Target DecisionX Contract: ${contractAddress}\n`);

  const txRecords = [];

  async function recordTx(name, callerWallet, sendTxFn) {
    console.log(`[Tx ${txRecords.length + 1}/12] Executing: ${name}...`);
    console.log(`  Caller: ${callerWallet.address}`);
    
    const receipt = await callWithRetry(async () => {
      const tx = await sendTxFn();
      console.log(`  Broadcasted Hash: ${tx.hash}`);
      return await tx.wait();
    });

    const gasUsed = receipt.gasUsed;
    const effectiveGasPrice = receipt.gasPrice || gasPrice;
    const gasFeeWei = gasUsed * effectiveGasPrice;
    const gasFeeBot = ethers.formatEther(gasFeeWei);

    console.log(`  ✓ Confirmed in Block #${receipt.blockNumber}`);
    console.log(`  ✓ Gas Used: ${gasUsed.toString()} gas`);
    console.log(`  ✓ Gas Cost: ${gasFeeBot} BOT\n`);

    txRecords.push({
      txNumber: txRecords.length + 1,
      description: name,
      caller: callerWallet.address,
      contract: contractAddress,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: gasUsed.toString(),
      gasPriceGwei: (Number(effectiveGasPrice) / 1e9).toString(),
      gasFeeBot: gasFeeBot,
      explorerUrl: `https://scan.botchain.ai/tx/${receipt.hash}`
    });

    return receipt;
  }

  const now = Math.floor(Date.now() / 1000);

  // ----------------------------------------------------------------
  // 12 PROJECT TRANSACTIONS ON DECISIONX PROTOCOL
  // ----------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('EXECUTING 12 PROJECT TRANSACTIONS ON BOT CHAIN MAINNET');
  console.log('----------------------------------------------------------------');

  const c1 = new ethers.Contract(contractAddress, artifact.abi, wallets[0]);
  const c2 = new ethers.Contract(contractAddress, artifact.abi, wallets[1]);
  const c3 = new ethers.Contract(contractAddress, artifact.abi, wallets[2]);
  const c4 = new ethers.Contract(contractAddress, artifact.abi, wallets[3]);
  const c5 = new ethers.Contract(contractAddress, artifact.abi, wallets[4]);
  const c6 = new ethers.Contract(contractAddress, artifact.abi, wallets[5]);

  // Tx 1: Wallet 1 creates Decision 1
  const decision1Params = {
    title: 'BOT Chain Expansion: AI Agent Compute Subnets vs DeFi Ecosystem',
    organization: 'BOT Chain Governance DAO',
    metric: 'Verified On-Chain TVL & Active Address Growth in 90 Days',
    criteriaUriOrHash: 'https://scan.botchain.ai/metrics/expansion-2027',
    options: ['AI Agent Compute Subnets', 'DeFi Prediction & Lending Protocols'],
    forecastCutoff: now + 86400 * 7,      // 7 days
    resolutionDeadline: now + 86400 * 30, // 30 days
    resolver: wallets[0].address
  };
  await recordTx('Create Decision #1 (AI Compute vs DeFi Ecosystem)', wallets[0], () => 
    c1.createDecision(decision1Params, { gasPrice })
  );

  const dec1Id = await c1.decisionCount();
  console.log(`Decision #1 ID on-chain is: ${dec1Id.toString()}\n`);

  // Tx 2: Wallet 1 stakes on Decision 1, Option 0 (AI Subnets)
  await recordTx('Wallet 1 Stakes 0.001 BOT on Decision #1, Option 0 (AI Subnets)', wallets[0], () =>
    c1.stake(dec1Id, 0, { value: ethers.parseEther('0.001'), gasPrice })
  );

  // Tx 3: Wallet 2 stakes on Decision 1, Option 1 (DeFi Ecosystem)
  await recordTx('Wallet 2 Stakes 0.0015 BOT on Decision #1, Option 1 (DeFi Ecosystem)', wallets[1], () =>
    c2.stake(dec1Id, 1, { value: ethers.parseEther('0.0015'), gasPrice })
  );

  // Tx 4: Wallet 3 stakes on Decision 1, Option 0 (AI Subnets)
  await recordTx('Wallet 3 Stakes 0.001 BOT on Decision #1, Option 0 (AI Subnets)', wallets[2], () =>
    c3.stake(dec1Id, 0, { value: ethers.parseEther('0.001'), gasPrice })
  );

  // Tx 5: Wallet 4 stakes on Decision 1, Option 1 (DeFi Ecosystem)
  await recordTx('Wallet 4 Stakes 0.0012 BOT on Decision #1, Option 1 (DeFi Ecosystem)', wallets[3], () =>
    c4.stake(dec1Id, 1, { value: ethers.parseEther('0.0012'), gasPrice })
  );

  // Tx 6: Wallet 5 stakes on Decision 1, Option 0 (AI Subnets)
  await recordTx('Wallet 5 Stakes 0.0008 BOT on Decision #1, Option 0 (AI Subnets)', wallets[4], () =>
    c5.stake(dec1Id, 0, { value: ethers.parseEther('0.0008'), gasPrice })
  );

  // Tx 7: Wallet 6 stakes on Decision 1, Option 1 (DeFi Ecosystem)
  await recordTx('Wallet 6 Stakes 0.0014 BOT on Decision #1, Option 1 (DeFi Ecosystem)', wallets[5], () =>
    c6.stake(dec1Id, 1, { value: ethers.parseEther('0.0014'), gasPrice })
  );

  // Tx 8: Wallet 2 creates Decision 2
  const decision2Params = {
    title: 'DecisionX Protocol Treasury Allocation: LP Rewards vs Developer Grants',
    organization: 'DecisionX Core Council',
    metric: 'Monthly Protocol Trading Volume & Retained Liquidity Ratio',
    criteriaUriOrHash: 'https://scan.botchain.ai/metrics/treasury-q1',
    options: ['Target Protocol Liquidity & Staker Rewards', 'Fund Ecosystem Developer Grants'],
    forecastCutoff: now + 86400 * 14,     // 14 days
    resolutionDeadline: now + 86400 * 45, // 45 days
    resolver: wallets[1].address
  };
  await recordTx('Create Decision #2 (LP Rewards vs Dev Grants)', wallets[1], () =>
    c2.createDecision(decision2Params, { gasPrice })
  );

  const dec2Id = await c2.decisionCount();
  console.log(`Decision #2 ID on-chain is: ${dec2Id.toString()}\n`);

  // Tx 9: Wallet 1 stakes on Decision 2, Option 0 (LP Rewards)
  await recordTx('Wallet 1 Stakes 0.001 BOT on Decision #2, Option 0 (LP Rewards)', wallets[0], () =>
    c1.stake(dec2Id, 0, { value: ethers.parseEther('0.001'), gasPrice })
  );

  // Tx 10: Wallet 3 stakes on Decision 2, Option 1 (Dev Grants)
  await recordTx('Wallet 3 Stakes 0.001 BOT on Decision #2, Option 1 (Dev Grants)', wallets[2], () =>
    c3.stake(dec2Id, 1, { value: ethers.parseEther('0.001'), gasPrice })
  );

  // Tx 11: Wallet 4 stakes on Decision 2, Option 0 (LP Rewards)
  await recordTx('Wallet 4 Stakes 0.0015 BOT on Decision #2, Option 0 (LP Rewards)', wallets[3], () =>
    c4.stake(dec2Id, 0, { value: ethers.parseEther('0.0015'), gasPrice })
  );

  // Tx 12: Wallet 6 stakes on Decision 2, Option 1 (Dev Grants)
  await recordTx('Wallet 6 Stakes 0.001 BOT on Decision #2, Option 1 (Dev Grants)', wallets[5], () =>
    c6.stake(dec2Id, 1, { value: ethers.parseEther('0.001'), gasPrice })
  );

  console.log('================================================================');
  console.log('ALL 12 MAINNET TRANSACTIONS CONFIRMED SUCCESSFULLY!');
  console.log('================================================================\n');

  // Calculate totals
  let totalGasUsed = 0n;
  let totalGasCostWei = 0n;
  txRecords.forEach(r => {
    totalGasUsed += BigInt(r.gasUsed);
    totalGasCostWei += BigInt(r.gasUsed) * BigInt(Math.round(Number(r.gasPriceGwei) * 1e9));
  });

  const finalDeployerBal = await provider.getBalance(deployer.address);

  const finalReport = {
    network: 'BOT Chain Mainnet',
    chainId: 677,
    contractAddress,
    deployerAddress: deployer.address,
    initialDeployerBalance: ethers.formatEther(deployerBalance) + ' BOT',
    finalDeployerBalance: ethers.formatEther(finalDeployerBal) + ' BOT',
    walletsCreatedCount: 6,
    wallets: walletMetadata.map(w => ({
      walletNumber: w.walletNumber,
      address: w.address,
      explorerUrl: `https://scan.botchain.ai/address/${w.address}`
    })),
    fundingTransactions: fundingReceipts,
    projectTransactionsCount: txRecords.length,
    projectTransactions: txRecords,
    summary: {
      totalGasUsed: totalGasUsed.toString(),
      totalGasCostBot: ethers.formatEther(totalGasCostWei) + ' BOT',
      gasPriceUsed: (Number(gasPrice) / 1e9) + ' Gwei'
    }
  };

  fs.writeFileSync(
    path.join(__dirname, '..', 'mainnet_transactions_report.json'),
    JSON.stringify(finalReport, null, 2)
  );
  console.log('Report saved to mainnet_transactions_report.json\n');
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
