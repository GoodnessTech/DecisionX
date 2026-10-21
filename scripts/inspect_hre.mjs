import hre from 'hardhat';

async function main() {
  const net = await hre.network.connect('hardhat');
  console.log('Connected net keys:', Object.keys(net));
  console.log('provider:', typeof net.provider);
  if (net.provider) {
    const res = await net.provider.request({ method: 'eth_blockNumber' });
    console.log('Block number from provider:', res);
  }
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
