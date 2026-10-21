const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const cleanupScript = path.join(__dirname, 'cleanup_scratch.js');
if (fs.existsSync(cleanupScript)) fs.unlinkSync(cleanupScript);

function run(cmd) {
  console.log(`> ${cmd}`);
  try {
    const out = cp.execSync(cmd, { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' });
    if (out.trim()) console.log(out.trim());
    return { success: true, output: out };
  } catch (err) {
    console.error(`Error in "${cmd}":`, err.stdout || err.message);
    if (err.stderr) console.error('Stderr:', err.stderr);
    return { success: false, error: err };
  }
}

// Ensure branch is main
run('git branch -M main');

// Add all files
run('git add .');

// Verify staged files
const status = run('git status');

// Check that .env is NOT staged
if (status.output && status.output.includes('new file:   .env\n')) {
  console.error('FATAL: .env would be committed! Aborting commit.');
  process.exit(1);
}

// Commit
run('git commit -m "feat: DecisionX parimutuel protocol, BOT Chain mainnet deployment, and Vercel configuration"');

// Push to origin main
console.log('Pushing to https://github.com/GoodnessTech/DecisionX.git...');
run('git push -u origin main');
