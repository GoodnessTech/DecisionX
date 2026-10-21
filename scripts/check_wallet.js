const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Standard Keccak-256 in pure JS
function keccak256(data) {
  const R = 1088 / 32;
  const state = new Uint32Array(50);
  const RC = [
    0x00000001, 0x00008082, 0x0000808a, 0x80008000, 0x0000808b, 0x80000001,
    0x80008081, 0x00008009, 0x0000008a, 0x00000088, 0x80008009, 0x8000000a,
    0x8000808b, 0x0000008b, 0x00008089, 0x00008003, 0x00008002, 0x00000080,
    0x0000800a, 0x8000000a, 0x80008081, 0x00008080, 0x80000001, 0x80008008
  ];
  const RCH = [
    0x00000000, 0x00000000, 0x80000000, 0x80000000, 0x00000000, 0x00000000,
    0x80000000, 0x80000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
    0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000,
    0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000
  ];
  const RHO = [
    0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15,
    21, 8, 18, 2, 61, 56, 14
  ];
  const PI = [
    0, 10, 20, 5, 15, 16, 1, 11, 21, 6, 7, 17, 2, 12, 22, 23, 8, 18, 3,
    13, 14, 24, 9, 19, 4
  ];

  let bytes = Buffer.from(data);
  let rateInBytes = 136;
  let padding = rateInBytes - (bytes.length % rateInBytes);
  let padded = Buffer.alloc(bytes.length + padding);
  bytes.copy(padded);
  padded[bytes.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  for (let b = 0; b < padded.length; b += rateInBytes) {
    for (let i = 0; i < rateInBytes; i += 4) {
      let idx = (i / 4) * 2;
      let val = padded.readUInt32LE(b + i);
      state[idx] ^= val;
    }

    // 24 rounds of Keccak-f[1600]
    for (let round = 0; round < 24; round++) {
      // Theta
      let C = new Uint32Array(10);
      for (let x = 0; x < 5; x++) {
        C[x * 2] = state[x * 2] ^ state[(x + 5) * 2] ^ state[(x + 10) * 2] ^ state[(x + 15) * 2] ^ state[(x + 20) * 2];
        C[x * 2 + 1] = state[x * 2 + 1] ^ state[(x + 5) * 2 + 1] ^ state[(x + 10) * 2 + 1] ^ state[(x + 15) * 2 + 1] ^ state[(x + 20) * 2 + 1];
      }
      let D = new Uint32Array(10);
      for (let x = 0; x < 5; x++) {
        let x4 = (x + 4) % 5;
        let x1 = (x + 1) % 5;
        // rotl 1
        let rL = (C[x1 * 2] << 1) | (C[x1 * 2 + 1] >>> 31);
        let rH = (C[x1 * 2 + 1] << 1) | (C[x1 * 2] >>> 31);
        D[x * 2] = C[x4 * 2] ^ rL;
        D[x * 2 + 1] = C[x4 * 2 + 1] ^ rH;
      }
      for (let i = 0; i < 25; i++) {
        let x = i % 5;
        state[i * 2] ^= D[x * 2];
        state[i * 2 + 1] ^= D[x * 2 + 1];
      }

      // Rho and Pi
      let B = new Uint32Array(50);
      for (let i = 0; i < 25; i++) {
        let r = RHO[i];
        let pi = PI[i];
        let low = state[i * 2];
        let high = state[i * 2 + 1];
        if (r === 0) {
          B[pi * 2] = low;
          B[pi * 2 + 1] = high;
        } else if (r < 32) {
          B[pi * 2] = (low << r) | (high >>> (32 - r));
          B[pi * 2 + 1] = (high << r) | (low >>> (32 - r));
        } else {
          let r2 = r - 32;
          B[pi * 2] = (high << r2) | (low >>> (32 - r2));
          B[pi * 2 + 1] = (low << r2) | (high >>> (32 - r2));
        }
      }

      // Chi
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          let x1 = (x + 1) % 5;
          let x2 = (x + 2) % 5;
          let idx = y * 5 + x;
          let idx1 = y * 5 + x1;
          let idx2 = y * 5 + x2;
          state[idx * 2] = B[idx * 2] ^ ((~B[idx1 * 2]) & B[idx2 * 2]);
          state[idx * 2 + 1] = B[idx * 2 + 1] ^ ((~B[idx1 * 2 + 1]) & B[idx2 * 2 + 1]);
        }
      }

      // Iota
      state[0] ^= RC[round];
      state[1] ^= RCH[round];
    }
  }

  let out = Buffer.alloc(32);
  for (let i = 0; i < 32; i += 4) {
    let idx = (i / 4) * 2;
    out.writeUInt32LE(state[idx], i);
  }
  return out;
}

// Derive address from private key
function privateKeyToAddress(privateKeyHex) {
  const cleanKey = privateKeyHex.replace(/^0x/, '');
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(cleanKey, 'hex'));
  const pubKey = ecdh.getPublicKey(); // 0x04 + 64 bytes
  const uncompressed = pubKey.subarray(1); // 64 bytes
  const hash = keccak256(uncompressed);
  const address = '0x' + hash.subarray(12).toString('hex');
  return toChecksumAddress(address);
}

function toChecksumAddress(address) {
  const addr = address.toLowerCase().replace(/^0x/, '');
  const hash = keccak256(Buffer.from(addr, 'ascii')).toString('hex');
  let ret = '0x';
  for (let i = 0; i < addr.length; i++) {
    if (parseInt(hash[i], 16) >= 8) {
      ret += addr[i].toUpperCase();
    } else {
      ret += addr[i];
    }
  }
  return ret;
}

async function main() {
  const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const match = envContent.match(/DEPLOYER_PRIVATE_KEY=([a-fA-F0-9x]+)/);
  if (!match) {
    console.error('DEPLOYER_PRIVATE_KEY not found in .env');
    process.exit(1);
  }
  const privKey = match[1];
  const address = privateKeyToAddress(privKey);
  console.log('Deployer Address:', address);

  const rpcUrl = 'https://rpc.botchain.ai';
  console.log('Querying RPC:', rpcUrl);

  const resChain = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] })
  }).then(r => r.json());
  console.log('Chain ID:', parseInt(resChain.result, 16));

  const resBal = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_getBalance', params: [address, 'latest'] })
  }).then(r => r.json());

  const balWei = BigInt(resBal.result);
  const balBot = Number(balWei) / 1e18;
  console.log('Deployer Balance (Wei):', balWei.toString());
  console.log('Deployer Balance (BOT):', balBot);

  const resGasPrice = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'eth_gasPrice', params: [] })
  }).then(r => r.json());
  console.log('Current Gas Price (Wei):', BigInt(resGasPrice.result).toString());
  console.log('Current Gas Price (Gwei):', Number(BigInt(resGasPrice.result)) / 1e9);

  const resNonce = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'eth_getTransactionCount', params: [address, 'latest'] })
  }).then(r => r.json());
  console.log('Deployer Nonce:', parseInt(resNonce.result, 16));
}

main().catch(console.error);
