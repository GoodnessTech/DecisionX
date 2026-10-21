const cp = require('child_process');
const path = require('path');

const frontendDir = path.join(__dirname, '..', 'DecisionX Frontend');
console.log('Running vite build in:', frontendDir);

try {
  const cliPath = path.join(frontendDir, 'node_modules', 'vite', 'dist', 'node', 'cli.js');
  const out = cp.execFileSync('C:\\Program Files\\nodejs\\node.exe', [
    cliPath,
    'build'
  ], {
    cwd: frontendDir,
    encoding: 'utf8',
    timeout: 180000 // 3 minutes
  });
  console.log('Build Output:\n', out);
} catch (e) {
  console.log('Build Error:\n', e.stdout || e.message);
  if (e.stderr) console.log('Build Stderr:\n', e.stderr);
}
