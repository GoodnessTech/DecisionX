const cp = require('child_process');
const path = require('path');

const frontendDir = path.join(__dirname, '..', 'DecisionX Frontend');
console.log('Installing @rollup/rollup-win32-x64-msvc@4.24.0 in:', frontendDir);

try {
  const out = cp.execFileSync('C:\\Program Files\\nodejs\\node.exe', [
    'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
    'install',
    '--no-save',
    '--no-audit',
    '--no-fund',
    '@rollup/rollup-win32-x64-msvc@4.24.0'
  ], {
    cwd: frontendDir,
    encoding: 'utf8',
    timeout: 60000
  });
  console.log('Install Output:\n', out);
} catch (e) {
  console.log('Install Error:\n', e.stdout || e.message);
  if (e.stderr) console.log('Install Stderr:\n', e.stderr);
}
