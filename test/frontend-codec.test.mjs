/**
 * Frontend <-> contract integration test.
 *
 * Exercises the exact code path the "Create Decision" wizard uses
 * (DecisionX Frontend/src/lib/decisionCodec.ts) against a freshly deployed
 * DecisionX contract on the local Hardhat network, using the ABI bundled with
 * the frontend. Guards against the "missing value for component organization"
 * regression where the UI sent stale struct field names.
 *
 * Run: node test/frontend-codec.test.mjs   (Node >= 22.18 / 23.6 for native TS)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import hre from 'hardhat';
import { ethers } from 'ethers';
import {
  buildCreateDecisionParams,
  decodeCriteria,
  encodeCriteria,
  parseDecisionResult,
  parseUserPositionResult,
  validateCreateDecisionForm,
} from '../DecisionX Frontend/src/lib/decisionCodec.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASSED: ${message}`);
  } else {
    failed++;
    console.error(`  ❌ FAILED: ${message}`);
  }
}

const baseForm = () => ({
  title: 'Q4 Strategic Growth Direction',
  org: 'Northstar DAO',
  description: 'Choose where to allocate Q4 treasury budget.',
  options: ['Expand into a new market', 'Develop a new product'],
  metricName: 'Verified 90-Day ARR Growth',
  metricMethod: 'Audited ARR from treasury dashboard; highest growth wins.',
  forecastDays: '7',
  resolutionDays: '30',
  resolverAddress: '',
});

async function main() {
  console.log('====================================================');
  console.log('DECISIONX FRONTEND CODEC <-> CONTRACT INTEGRATION TEST');
  console.log('====================================================\n');

  const frontendAbi = JSON.parse(
    fs.readFileSync(path.join(root, 'DecisionX Frontend', 'src', 'contracts', 'DecisionX.json'), 'utf8'),
  ).abi;
  const compiled = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'DecisionX.json'), 'utf8'));

  // --- 1. ABI parity --------------------------------------------------------
  console.log('--- 1. ABI parity (frontend bundle vs compiled artifact) ---');
  const sigs = (abi) =>
    new ethers.Interface(abi).fragments
      .filter((f) => f.type === 'function')
      .map((f) => f.format('full'))
      .sort();
  assert(
    JSON.stringify(sigs(frontendAbi)) === JSON.stringify(sigs(compiled.abi)),
    'Frontend ABI function signatures match compiled contract',
  );

  // --- 2. Form validation ---------------------------------------------------
  console.log('\n--- 2. Wizard form validation ---');
  const resolverFallback = '0x34a19B30d9edD62424802d323E81c25599A9f02e';
  assert(validateCreateDecisionForm(baseForm(), resolverFallback) === null, 'Valid form passes');
  assert(validateCreateDecisionForm({ ...baseForm(), title: '  ' }, resolverFallback)?.step === 1, 'Empty title -> step 1');
  assert(validateCreateDecisionForm({ ...baseForm(), org: '' }, resolverFallback)?.step === 1, 'Empty organization -> step 1');
  assert(validateCreateDecisionForm({ ...baseForm(), options: ['A'] }, resolverFallback)?.step === 2, '1 option rejected');
  assert(validateCreateDecisionForm({ ...baseForm(), options: Array(9).fill(0).map((_, i) => `O${i}`) }, resolverFallback)?.step === 2, '9 options rejected');
  assert(validateCreateDecisionForm({ ...baseForm(), options: ['A', ' '] }, resolverFallback)?.step === 2, 'Blank option rejected');
  assert(validateCreateDecisionForm({ ...baseForm(), options: ['Yes', ' yes '] }, resolverFallback)?.step === 2, 'Duplicate options rejected');
  assert(validateCreateDecisionForm({ ...baseForm(), forecastDays: '0' }, resolverFallback)?.step === 4, 'Zero-day forecast rejected');
  assert(validateCreateDecisionForm({ ...baseForm(), forecastDays: '10', resolutionDays: '5' }, resolverFallback)?.step === 4, 'Deadline before cutoff rejected');
  assert(validateCreateDecisionForm({ ...baseForm(), resolverAddress: '0x123' }, resolverFallback)?.step === 4, 'Invalid resolver rejected');
  assert(validateCreateDecisionForm({ ...baseForm(), resolverAddress: ethers.ZeroAddress }, resolverFallback)?.step === 4, 'Zero resolver rejected');
  assert(validateCreateDecisionForm(baseForm(), null)?.step === 4, 'Missing resolver and no wallet rejected');

  // --- 3. Criteria encoding -------------------------------------------------
  console.log('\n--- 3. Criteria encoding ---');
  const enc = encodeCriteria('desc', 'crit');
  const dec = decodeCriteria(enc);
  assert(dec.description === 'desc' && dec.criteria === 'crit', 'encode/decode round-trips');
  assert(encodeCriteria('', '  ') === '', 'Empty description+criteria encodes to empty string');
  const uri = decodeCriteria('https://scan.botchain.ai/metrics/expansion-2027');
  assert(uri.description === '' && uri.criteria.startsWith('https://'), 'Plain URI (script-created decisions) decoded as criteria');
  assert(decodeCriteria('{not json').criteria === '{not json', 'Malformed JSON falls back to raw string');

  // --- 4. On-chain round trip with the frontend ABI -------------------------
  console.log('\n--- 4. createDecision / getDecision / getUserPosition round trip ---');
  const net = await hre.network.connect('hardhat');
  const provider = new ethers.BrowserProvider(net.provider);
  const accounts = await net.provider.request({ method: 'eth_accounts' });
  const deployer = await provider.getSigner(accounts[0]);
  const creator = await provider.getSigner(accounts[1]);
  const staker = await provider.getSigner(accounts[2]);

  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, deployer);
  const deployed = await factory.deploy();
  await deployed.waitForDeployment();
  const address = await deployed.getAddress();

  // Same construction as App.tsx: new Contract(address, DecisionXArtifact.abi, signer)
  const ui = new ethers.Contract(address, frontendAbi, creator);

  // Regression: the old payload must fail with the reported error.
  const block = await provider.getBlock('latest');
  try {
    await ui.createDecision({
      title: 'x',
      metadataUri: '{}',
      optionNames: ['A', 'B'],
      forecastCutoff: block.timestamp + 86400,
      resolutionDeadline: block.timestamp + 86400 * 2,
      resolver: accounts[1],
    });
    assert(false, 'Legacy payload should not encode');
  } catch (err) {
    assert(/missing value for component organization/i.test(err.message), 'Legacy payload reproduces "missing value for component organization"');
  }

  const form = { ...baseForm(), options: ['  Expand into a new market ', 'Develop a new product', 'Do nothing'] };
  const params = buildCreateDecisionParams(form, accounts[1], block.timestamp);
  const expectedKeys = frontendAbi
    .find((f) => f.name === 'createDecision')
    .inputs[0].components.map((c) => c.name)
    .sort();
  assert(JSON.stringify(Object.keys(params).sort()) === JSON.stringify(expectedKeys), 'Built params have exactly the CreateDecisionParams fields');
  assert(params.resolver === accounts[1], 'Resolver defaults to connected wallet when field empty');

  const tx = await ui.createDecision(params);
  const rc = await tx.wait();
  assert(rc.status === 1, `createDecision succeeded (gas ${rc.gasUsed})`);
  assert(Number(await ui.decisionCount()) === 1, 'decisionCount is 1');

  const parsed = parseDecisionResult(1, await ui.getDecision(1));
  assert(parsed.title === form.title, 'Title stored');
  assert(parsed.org === 'Northstar DAO', 'Organization stored');
  assert(parsed.metric === form.metricName, 'Metric stored');
  assert(parsed.description === form.description, 'Description recovered from criteriaUriOrHash');
  assert(parsed.criteria === form.metricMethod, 'Resolution criteria recovered');
  assert(parsed.options.length === 3 && parsed.options[0].name === 'Expand into a new market', 'Options stored and trimmed');
  assert(parsed.resolver.toLowerCase() === accounts[1].toLowerCase(), 'Resolver stored');
  assert(parsed.forecastCutoff === block.timestamp + 7 * 86400, 'Forecast cutoff = now + 7d');
  assert(parsed.resolutionDeadline === block.timestamp + 30 * 86400, 'Resolution deadline = now + 30d');
  assert(parsed.statusCode === 0 && parsed.totalPoolRaw === 0n, 'Market open with empty pool');

  const stakeTx = await ui.connect(staker).stake(1, 1, { value: ethers.parseEther('2') });
  await stakeTx.wait();
  const afterStake = parseDecisionResult(1, await ui.getDecision(1));
  assert(afterStake.totalPoolRaw === ethers.parseEther('2'), 'Total pool reflects stake');
  assert(afterStake.options[1].percent === 100 && afterStake.options[0].percent === 0, 'Option percentages computed');

  const pos = parseUserPositionResult(await ui.getUserPosition(1, accounts[2]));
  assert(pos.totalUserStake === ethers.parseEther('2'), 'User total stake parsed');
  assert(pos.stakesByOption[1] === ethers.parseEther('2') && pos.stakesByOption.length === 3, 'Per-option stakes parsed');
  assert(pos.claimed === false, 'Claimed flag parsed');

  console.log('\n====================================================');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log('====================================================');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
