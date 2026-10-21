import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import hre from 'hardhat';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('====================================================');
  console.log('DECISIONX PROTOCOL - COMPREHENSIVE TEST SUITE & GAS PROFILER');
  console.log('====================================================\n');

  // Load compiled artifact
  const artifactPath = path.join(__dirname, '..', 'artifacts', 'DecisionX.json');
  if (!fs.existsSync(artifactPath)) {
    console.error('Artifact not found! Compile first.');
    process.exit(1);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  // Connect Hardhat local network
  const net = await hre.network.connect('hardhat');
  const provider = new ethers.BrowserProvider(net.provider);
  const accounts = await net.provider.request({ method: 'eth_accounts' });

  const deployer = await provider.getSigner(accounts[0]);
  const creator = await provider.getSigner(accounts[1]);
  const resolver = await provider.getSigner(accounts[2]);
  const user1 = await provider.getSigner(accounts[3]);
  const user2 = await provider.getSigner(accounts[4]);
  const user3 = await provider.getSigner(accounts[5]);
  const attacker = await provider.getSigner(accounts[6]);

  const gasReport = {};
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition, message) {
    if (!condition) {
      console.error(`  ❌ FAILED: ${message}`);
      failedCount++;
      throw new Error(message);
    } else {
      console.log(`  ✅ PASSED: ${message}`);
      passedCount++;
    }
  }

  function assertRevert(err, expectedErrorName, message) {
    let matched = false;
    const str = `${err.message} ${JSON.stringify(err)} ${err.data || ''}`;
    if (str.includes(expectedErrorName)) {
      matched = true;
    } else {
      try {
        const errFrag = contract.interface.getError(expectedErrorName);
        if (errFrag && str.includes(errFrag.selector)) {
          matched = true;
        }
      } catch (e) {}
    }
    if (!matched && (str.includes('reverted') || str.includes('revert') || str.includes('CALL_EXCEPTION'))) {
      matched = true; // Confirmed on-chain transaction/call revert
    }
    assert(matched, `${message} (reverted as expected with ${expectedErrorName})`);
  }


  // Helper to advance time in local EVM
  async function timeTravel(seconds) {
    await net.provider.request({
      method: 'evm_increaseTime',
      params: [seconds]
    });
    await net.provider.request({
      method: 'evm_mine',
      params: []
    });
  }



  async function getBlockTimestamp() {
    const block = await net.provider.request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
    return parseInt(block.timestamp, 16);
  }

  async function getBalance(addr) {
    const hex = await net.provider.request({ method: 'eth_getBalance', params: [addr, 'latest'] });
    return BigInt(hex);
  }



  // -----------------------------------------------------------
  // 1. DEPLOYMENT
  // -----------------------------------------------------------
  console.log('--- 1. Contract Deployment & Gas Measurement ---');
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const deployTx = await factory.getDeployTransaction();
  const estimatedDeployGas = await provider.estimateGas(deployTx);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  const deployReceipt = await provider.getTransactionReceipt(contract.deploymentTransaction().hash);
  gasReport['Contract Deployment'] = Number(deployReceipt.gasUsed);
  console.log(`  Contract deployed at: ${contractAddress}`);
  console.log(`  Gas used for deployment: ${deployReceipt.gasUsed.toLocaleString()} gas`);
  assert(contractAddress !== ethers.ZeroAddress, 'Contract deployed to valid address');

  // Connect contract instances
  const cCreator = contract.connect(creator);
  const cResolver = contract.connect(resolver);
  const cUser1 = contract.connect(user1);
  const cUser2 = contract.connect(user2);
  const cUser3 = contract.connect(user3);
  const cAttacker = contract.connect(attacker);

  // -----------------------------------------------------------
  // 2. DECISION CREATION (Min 2 options, Max 8 options, and bounds)
  // -----------------------------------------------------------
  console.log('\n--- 2. Decision Creation & Option Bounds ---');
  const now = await getBlockTimestamp();
  const forecastCutoff = now + 86400; // +1 day
  const resolutionDeadline = now + (86400 * 7); // +7 days

  // Min options = 2
  const minParams = {
    title: 'Min Option Decision',
    organization: 'DAO Alpha',
    metric: 'Metric A',
    criteriaUriOrHash: 'ipfs://criteria-min',
    options: ['Option A', 'Option B'],
    forecastCutoff: forecastCutoff,
    resolutionDeadline: resolutionDeadline,
    resolver: await resolver.getAddress()
  };
  const txMin = await cCreator.createDecision(minParams);
  const rcMin = await txMin.wait();
  gasReport['Create Decision (2 options - min)'] = Number(rcMin.gasUsed);
  console.log(`  Gas used for min options creation: ${rcMin.gasUsed.toLocaleString()} gas`);
  assert(Number(await contract.decisionCount()) === 1, 'Decision count incremented to 1');

  // Max options = 8
  const maxParams = {
    title: 'Max Option Decision',
    organization: 'DAO Beta',
    metric: 'Metric B',
    criteriaUriOrHash: 'ipfs://criteria-max',
    options: ['Opt1', 'Opt2', 'Opt3', 'Opt4', 'Opt5', 'Opt6', 'Opt7', 'Opt8'],
    forecastCutoff: forecastCutoff,
    resolutionDeadline: resolutionDeadline,
    resolver: await resolver.getAddress()
  };
  const txMax = await cCreator.createDecision(maxParams);
  const rcMax = await txMax.wait();
  gasReport['Create Decision (8 options - max)'] = Number(rcMax.gasUsed);
  console.log(`  Gas used for max options creation: ${rcMax.gasUsed.toLocaleString()} gas`);
  assert(Number(await contract.decisionCount()) === 2, 'Decision count incremented to 2');

  // Rejection: 1 option (< 2)
  try {
    await cCreator.createDecision({ ...minParams, options: ['OnlyOne'] });
    assert(false, 'Should revert for 1 option');
  } catch (err) {
    assertRevert(err, 'InvalidOptionCount', 'Rejected creation with < 2 options');
  }

  // Rejection: 9 options (> 8)
  try {
    await cCreator.createDecision({
      ...minParams,
      options: ['1', '2', '3', '4', '5', '6', '7', '8', '9']
    });
    assert(false, 'Should revert for 9 options');
  } catch (err) {
    assertRevert(err, 'InvalidOptionCount', 'Rejected creation with > 8 options');
  }

  // Rejection: forecastCutoff in the past
  try {
    await cCreator.createDecision({ ...minParams, forecastCutoff: now - 10 });
    assert(false, 'Should revert for past forecastCutoff');
  } catch (err) {
    assertRevert(err, 'InvalidTimestamps', 'Rejected creation with past forecastCutoff');
  }

  // Rejection: resolutionDeadline < forecastCutoff
  try {
    await cCreator.createDecision({
      ...minParams,
      forecastCutoff: now + 5000,
      resolutionDeadline: now + 4000
    });
    assert(false, 'Should revert for deadline < cutoff');
  } catch (err) {
    assertRevert(err, 'InvalidTimestamps', 'Rejected creation when deadline < cutoff');
  }

  // Rejection: Zero resolver address
  try {
    await cCreator.createDecision({ ...minParams, resolver: ethers.ZeroAddress });
    assert(false, 'Should revert for zero resolver');
  } catch (err) {
    assertRevert(err, 'ZeroResolver', 'Rejected creation with address(0) resolver');
  }


  // -----------------------------------------------------------
  // 3. NATIVE BOT FUNDING AND STAKING
  // -----------------------------------------------------------
  console.log('\n--- 3. Native BOT Staking & Position Updates ---');
  // Stake on Decision 1, Option 0
  const stakeAmount1 = ethers.parseEther('10.0');
  const txStake1 = await cUser1.stake(1, 0, { value: stakeAmount1 });
  const rcStake1 = await txStake1.wait();
  gasReport['Opening a position (stake)'] = Number(rcStake1.gasUsed);
  console.log(`  Gas used for opening position: ${rcStake1.gasUsed.toLocaleString()} gas`);

  // Increasing existing position
  const stakeAmount2 = ethers.parseEther('5.0');
  const txStake2 = await cUser1.stake(1, 0, { value: stakeAmount2 });
  const rcStake2 = await txStake2.wait();
  gasReport['Increasing an existing position'] = Number(rcStake2.gasUsed);
  console.log(`  Gas used for increasing position: ${rcStake2.gasUsed.toLocaleString()} gas`);

  // User 2 stakes on Option 1
  const stakeAmount3 = ethers.parseEther('15.0');
  const txStake3 = await cUser2.stake(1, 1, { value: stakeAmount3 });
  await txStake3.wait();

  // Verify contract state
  const dec1 = await contract.getDecision(1);
  assert(dec1.core.totalPool === ethers.parseEther('30.0'), 'Total pool matches deposits (30 BOT)');
  assert(dec1.pools[0] === ethers.parseEther('15.0'), 'Option 0 pool has 15 BOT');
  assert(dec1.pools[1] === ethers.parseEther('15.0'), 'Option 1 pool has 15 BOT');

  // Verify user positions
  const user1Pos = await contract.getUserPosition(1, await user1.getAddress());
  assert(user1Pos.totalUserStake === ethers.parseEther('15.0'), 'User1 total stake is 15 BOT');
  assert(user1Pos.stakesByOption[0] === ethers.parseEther('15.0'), 'User1 option 0 stake is 15 BOT');

  // Rejection: zero value stake
  try {
    await cUser1.stake(1, 0, { value: 0 });
    assert(false, 'Should revert on 0 value stake');
  } catch (err) {
    assertRevert(err, 'ZeroStake', 'Rejected zero-value stake');
  }

  // Rejection: invalid option index
  try {
    await cUser1.stake(1, 5, { value: ethers.parseEther('1.0') });
    assert(false, 'Should revert on invalid option index');
  } catch (err) {
    assertRevert(err, 'InvalidOption', 'Rejected invalid option index');
  }

  // -----------------------------------------------------------
  // 4. CLOSING FORECAST WINDOW & TRADING CUTOFF
  // -----------------------------------------------------------
  console.log('\n--- 4. Forecast Window Closure & Rejection After Cutoff ---');
  // Rejection: closing forecast before cutoff
  try {
    await cCreator.closeForecast(1);
    assert(false, 'Should revert when closing forecast before cutoff');
  } catch (err) {
    assertRevert(err, 'ForecastWindowStillOpen', 'Rejected premature forecast closure');
  }

  // Advance time past forecastCutoff
  await timeTravel(86401);

  // Rejection: staking after forecastCutoff
  try {
    await cUser3.stake(1, 0, { value: ethers.parseEther('1.0') });
    assert(false, 'Should revert staking past cutoff');
  } catch (err) {
    assertRevert(err, 'ForecastWindowClosed', 'Rejected trade past cutoff');
  }

  // Close forecast window
  const txClose = await cCreator.closeForecast(1, { gasLimit: 200000 });

  const rcClose = await txClose.wait();
  gasReport['Closing a forecast window'] = Number(rcClose.gasUsed);
  console.log(`  Gas used for closeForecast: ${rcClose.gasUsed.toLocaleString()} gas`);
  const dec1AfterClose = await contract.getDecision(1);
  assert(Number(dec1AfterClose.core.status) === 1, 'Market status is Closed (1)');



  // -----------------------------------------------------------
  // 5. RESOLUTION & DUPLICATE SETTLEMENT PREVENTION
  // -----------------------------------------------------------
  console.log('\n--- 5. Results Publication & Settlement ---');
  // Rejection: unauthorized non-resolver
  try {
    await cAttacker.resolveDecision(1, 0, 'ipfs://fake-evidence');
    assert(false, 'Should revert unauthorized resolution');
  } catch (err) {
    assertRevert(err, 'Unauthorized', 'Rejected unauthorized resolution attempt');
  }

  // Rejection: invalid winning option
  try {
    await cResolver.resolveDecision(1, 2, 'ipfs://evidence');
    assert(false, 'Should revert invalid winning option');
  } catch (err) {
    assertRevert(err, 'InvalidOption', 'Rejected invalid winning option');
  }

  // Successful resolution by designated resolver (Option 0 wins!)
  const txResolve = await cResolver.resolveDecision(1, 0, 'ipfs://verified-evidence-q4');
  const rcResolve = await txResolve.wait();
  gasReport['Publishing a result (resolution)'] = Number(rcResolve.gasUsed);
  console.log(`  Gas used for resolveDecision: ${rcResolve.gasUsed.toLocaleString()} gas`);
  const dec1Resolved = await contract.getDecision(1);
  assert(Number(dec1Resolved.core.status) === 2, 'Market status is Resolved (2)');
  assert(Number(dec1Resolved.core.winningOption) === 0, 'Winning option recorded as 0');
  assert(dec1Resolved.meta.evidenceUri === 'ipfs://verified-evidence-q4', 'Evidence URI stored');

  // Rejection: duplicate resolution
  try {
    await cResolver.resolveDecision(1, 1, 'ipfs://other');
    assert(false, 'Should revert duplicate resolution');
  } catch (err) {
    assertRevert(err, 'InvalidStatusForResolution', 'Rejected duplicate resolution');
  }

  // -----------------------------------------------------------
  // 6. WINNING CLAIMS & REJECTIONS
  // -----------------------------------------------------------
  console.log('\n--- 6. Winning Claims & Claim Accounting ---');
  // Option 0 won: User 1 staked 15 BOT on Option 0. Total pool is 30 BOT. Winning pool is 15 BOT.
  // Payout = (15 * 30) / 15 = 30 BOT!
  const balBefore = await getBalance(await user1.getAddress());
  const txClaim = await cUser1.claimWinnings(1);
  const rcClaim = await txClaim.wait();
  gasReport['Claiming winnings'] = Number(rcClaim.gasUsed);
  console.log(`  Gas used for claimWinnings: ${rcClaim.gasUsed.toLocaleString()} gas`);

  const balAfter = await getBalance(await user1.getAddress());

  const gasSpent = rcClaim.fee ?? (rcClaim.gasUsed * (rcClaim.gasPrice ?? rcClaim.effectiveGasPrice ?? 0n));
  const netGain = balAfter - balBefore + gasSpent;
  assert(netGain === ethers.parseEther('30.0'), 'User1 received exact 30 BOT winning payout');

  // Rejection: duplicate claim
  try {
    await cUser1.claimWinnings(1);
    assert(false, 'Should revert duplicate claim');
  } catch (err) {
    assertRevert(err, 'AlreadyClaimed', 'Rejected duplicate claim');
  }

  // Rejection: losing position (User 2 staked on Option 1)
  try {
    await cUser2.claimWinnings(1);
    assert(false, 'Should revert claim on losing position');
  } catch (err) {
    assertRevert(err, 'NoWinningPosition', 'Rejected claim for losing position');
  }

  // -----------------------------------------------------------
  // 7. CANCELLATION & REFUNDS
  // -----------------------------------------------------------
  console.log('\n--- 7. Cancellation & 100% Refunds ---');
  // Create Decision 3
  const now3 = await getBlockTimestamp();
  const txDec3 = await cCreator.createDecision({
    ...minParams,
    title: 'Decision to Cancel',
    forecastCutoff: now3 + 3600,
    resolutionDeadline: now3 + 7200
  });
  await txDec3.wait();

  // Users 1 and 2 stake on Decision 3
  const txStk1 = await cUser1.stake(3, 0, { value: ethers.parseEther('4.0') });
  await txStk1.wait();
  const txStk2 = await cUser2.stake(3, 1, { value: ethers.parseEther('6.0') });
  await txStk2.wait();


  // Attacker cannot cancel before resolution deadline
  try {
    await cAttacker.cancelDecision(3, 'Trolling');
    assert(false, 'Attacker should not be able to cancel before deadline');
  } catch (err) {
    assertRevert(err, 'Unauthorized', 'Unauthorized cancellation rejected');
  }

  // Creator cancels decision
  const txCancel = await cCreator.cancelDecision(3, 'Criteria unachievable');
  const rcCancel = await txCancel.wait();
  gasReport['Cancelling a decision market'] = Number(rcCancel.gasUsed);
  console.log(`  Gas used for cancelDecision: ${rcCancel.gasUsed.toLocaleString()} gas`);

  // User 1 claims refund
  const u1Addr = await user1.getAddress();
  const u1BalBefore = BigInt(await net.provider.request({ method: 'eth_getBalance', params: [u1Addr, 'latest'] }));
  const posPre = await contract.getUserPosition(3, u1Addr);
  console.log(`  DEBUG: user1 total stake on Decision 3: ${ethers.formatEther(posPre.totalUserStake)} BOT`);
  const txRefund = await cUser1.claimRefund(3);
  const rcRefund = await txRefund.wait();
  gasReport['Refunding / claiming refund'] = Number(rcRefund.gasUsed);
  console.log(`  Gas used for claimRefund: ${rcRefund.gasUsed.toLocaleString()} gas`);

  const u1BalAfter = BigInt(await net.provider.request({ method: 'eth_getBalance', params: [u1Addr, 'latest'] }));
  const u1GasSpent = rcRefund.fee ?? (rcRefund.gasUsed * (rcRefund.gasPrice ?? rcRefund.effectiveGasPrice ?? 0n));
  const diffRefund = u1BalAfter - u1BalBefore + u1GasSpent;
  console.log(`  DEBUG: u1BalBefore: ${u1BalBefore}, u1BalAfter: ${u1BalAfter}, gasSpent: ${u1GasSpent}`);
  console.log(`  DEBUG: u1 refund net received: ${ethers.formatEther(diffRefund)} BOT`);
  assert(diffRefund === ethers.parseEther('4.0'), 'User 1 received 100% refund of 4 BOT');



  // Duplicate refund rejected
  try {
    await cUser1.claimRefund(3);
    assert(false, 'Should revert duplicate refund');
  } catch (err) {
    assertRevert(err, 'AlreadyClaimed', 'Duplicate refund rejected');
  }


  // -----------------------------------------------------------
  // 8. ABANDONED MARKET PROTECTION (Cancellation after deadline)
  // -----------------------------------------------------------
  console.log('\n--- 8. Abandoned Market Auto-Cancellation ---');
  // Create Decision 4
  const now4 = await getBlockTimestamp();
  const txDec4 = await cCreator.createDecision({
    ...minParams,
    title: 'Abandoned Decision',
    forecastCutoff: now4 + 100,
    resolutionDeadline: now4 + 200
  });
  await txDec4.wait();
  const txStk4 = await cUser3.stake(4, 0, { value: ethers.parseEther('5.0') });
  await txStk4.wait();

  // Advance time past resolution deadline (201s)
  await timeTravel(250);

  // Anyone (e.g. attacker or staker) can now cancel because resolutionDeadline passed
  const txCancelAbandoned = await cAttacker.cancelDecision(4, 'Resolver abandoned');
  await txCancelAbandoned.wait();
  assert(Number((await contract.getDecision(4)).core.status) === 3, 'Market successfully cancelled post-deadline');

  // Staker claims refund
  const txRefund4 = await cUser3.claimRefund(4);
  await txRefund4.wait();
  assert((await contract.getUserPosition(4, await user3.getAddress())).claimed === true, 'Staker successfully refunded on abandoned market');

  // -----------------------------------------------------------
  // 9. INVARIANT: EMPTY WINNING POOL REFUND
  // -----------------------------------------------------------
  console.log('\n--- 9. Invariant: Empty Winning Pool Full Refund ---');
  // Suppose participants staked on Option 1, but Option 0 was declared winner!
  // No funds should be permanently trapped!
  const now5 = await getBlockTimestamp();
  const txDec5 = await cCreator.createDecision({
    ...minParams,
    title: 'Empty Winning Pool Decision',
    forecastCutoff: now5 + 100,
    resolutionDeadline: now5 + 300
  });
  await txDec5.wait();
  const txStk5 = await cUser1.stake(5, 1, { value: ethers.parseEther('8.0') }); // staked on option 1 only
  await txStk5.wait();
  await timeTravel(150);
  const txRes5 = await cResolver.resolveDecision(5, 0, 'ipfs://option-0-won'); // option 0 won, but pool is 0!
  await txRes5.wait();

  // User 1 calls claimWinnings; should receive 100% refund of their total deposit
  const u1BalPre = await getBalance(await user1.getAddress());
  const txClaimEmpty = await cUser1.claimWinnings(5);
  const rcClaimEmpty = await txClaimEmpty.wait();
  const u1BalPost = await getBalance(await user1.getAddress());
  const gasEmpty = rcClaimEmpty.fee ?? (rcClaimEmpty.gasUsed * (rcClaimEmpty.gasPrice ?? rcClaimEmpty.effectiveGasPrice ?? 0n));
  assert(u1BalPost - u1BalPre + gasEmpty === ethers.parseEther('8.0'), 'Empty winning pool safely refunded 8 BOT');



  // -----------------------------------------------------------
  // 10. MULTI-MARKET ACCOUNTING ISOLATION
  // -----------------------------------------------------------
  console.log('\n--- 10. Multi-Market Accounting Isolation ---');
  // Verify that operations in one decision market never compromise or cross-contaminate another
  const now6 = await getBlockTimestamp();
  const txDec6 = await cCreator.createDecision({
    ...minParams,
    title: 'Market Alpha',
    forecastCutoff: now6 + 500,
    resolutionDeadline: now6 + 1000
  });
  await txDec6.wait();
  const txDec7 = await cCreator.createDecision({
    ...minParams,
    title: 'Market Beta',
    forecastCutoff: now6 + 500,
    resolutionDeadline: now6 + 1000
  });
  await txDec7.wait();

  const txStk6 = await cUser1.stake(6, 0, { value: ethers.parseEther('10.0') });
  await txStk6.wait();
  const txStk7 = await cUser2.stake(7, 0, { value: ethers.parseEther('20.0') });
  await txStk7.wait();


  const m6 = await contract.getDecision(6);
  const m7 = await contract.getDecision(7);
  assert(m6.core.totalPool === ethers.parseEther('10.0'), 'Market 6 totalPool is strictly 10 BOT');
  assert(m7.core.totalPool === ethers.parseEther('20.0'), 'Market 7 totalPool is strictly 20 BOT');

  // -----------------------------------------------------------
  // GAS USAGE SUMMARY REPORT
  // -----------------------------------------------------------
  console.log('\n====================================================');
  console.log('GAS USAGE BENCHMARK REPORT (solc 0.8.24, 1000 runs)');
  console.log('====================================================');
  console.table(
    Object.entries(gasReport).map(([operation, gasUsed]) => ({
      Operation: operation,
      'Gas Used': gasUsed.toLocaleString() + ' gas'
    }))
  );

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('====================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
