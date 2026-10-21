const fs = require('fs');
const path = require('path');

function compile() {
  const solc = require('solc');
  const sourcePath = path.join(__dirname, '..', 'contracts', 'DecisionX.sol');
  const source = fs.readFileSync(sourcePath, 'utf8');

  console.log('Compiling DecisionX.sol with solc 0.8.24 (optimizer: 1000 runs)...');

  const input = {
    language: 'Solidity',
    sources: {
      'DecisionX.sol': {
        content: source
      }
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000
      },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'evm.gasEstimates']
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    let hasError = false;
    for (const error of output.errors) {
      if (error.severity === 'error') {
        hasError = true;
        console.error('Compilation ERROR:', error.formattedMessage);
      } else {
        console.warn('Compilation WARNING:', error.formattedMessage);
      }
    }
    if (hasError) {
      process.exit(1);
    }
  }

  const contract = output.contracts['DecisionX.sol']['DecisionX'];
  const bytecode = contract.evm.bytecode.object;
  const deployedBytecode = contract.evm.deployedBytecode.object;
  const abi = contract.abi;

  console.log('Bytecode size (bytes):', bytecode.length / 2);
  console.log('Deployed bytecode size (bytes):', deployedBytecode.length / 2);

  // Write artifact
  const artifactsDir = path.join(__dirname, '..', 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const artifactPath = path.join(artifactsDir, 'DecisionX.json');
  fs.writeFileSync(artifactPath, JSON.stringify({
    contractName: 'DecisionX',
    abi,
    bytecode: '0x' + bytecode,
    deployedBytecode: '0x' + deployedBytecode,
    compiler: '0.8.24',
    optimizerRuns: 1000
  }, null, 2));
  console.log('Artifact saved to:', artifactPath);

  // Also write ABI to Frontend
  const frontendContractsDir = path.join(__dirname, '..', 'DecisionX Frontend', 'src', 'contracts');
  if (!fs.existsSync(frontendContractsDir)) {
    fs.mkdirSync(frontendContractsDir, { recursive: true });
  }
  const frontendAbiPath = path.join(frontendContractsDir, 'DecisionX.json');
  fs.writeFileSync(frontendAbiPath, JSON.stringify({
    abi,
    contractName: 'DecisionX',
    compiler: '0.8.24'
  }, null, 2));
  console.log('Frontend contract ABI updated at:', frontendAbiPath);

  return { abi, bytecode, deployedBytecode };
}

if (require.main === module) {
  compile();
}

module.exports = { compile };
