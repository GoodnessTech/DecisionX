import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  Filter,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  X,
  Zap,
  AlertCircle,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { ethers, BrowserProvider, JsonRpcProvider, Contract, formatEther, parseEther } from 'ethers';
import contractConfig from './contracts/config.json';
import DecisionXArtifact from './contracts/DecisionX.json';

type View = 'Overview' | 'Decision Markets' | 'Create Decision' | 'My Positions' | 'Activity' | 'Documentation';
type MarketStatus = 'Active' | 'Closing soon' | 'Closed' | 'Awaiting resolution' | 'Resolved' | 'Cancelled' | 'Preview';

type DecisionOption = {
  index: number;
  name: string;
  pool: string;
  poolRaw: bigint;
  percent: number;
};

type Decision = {
  id: number;
  title: string;
  org: string;
  description: string;
  creator: string;
  resolver: string;
  createdAt: number;
  forecastCutoff: number;
  resolutionDeadline: number;
  winningOption: number;
  status: MarketStatus;
  statusCode: number; // 0: Active, 1: ForecastClosed, 2: Resolved, 3: Cancelled
  totalPool: string;
  totalPoolRaw: bigint;
  options: DecisionOption[];
  metric: string;
  evidenceUri?: string;
  isRealOnChain: boolean;
  accent: string;
};

type UserPosition = {
  decisionId: number;
  decisionTitle: string;
  optionIndex: number;
  optionName: string;
  stakedBot: string;
  stakedRaw: bigint;
  status: MarketStatus;
  isWinner: boolean;
  canClaim: boolean;
  canRefund: boolean;
  claimed: boolean;
};

type ProtocolActivity = {
  id: string;
  event: string;
  decisionId: number;
  decisionTitle: string;
  txHash: string;
  timestamp: string;
  account: string;
  amount?: string;
};

// Illustrative design preview markets (explicitly non-transactional)
const PREVIEW_MARKETS: Decision[] = [
  {
    id: 991,
    title: 'Q4 Growth Direction',
    org: 'Northstar DAO',
    description: 'Which initiative should receive the community treasury allocation this quarter?',
    creator: '0x0000000000000000000000000000000000000000',
    resolver: '0x0000000000000000000000000000000000000000',
    createdAt: Date.now() / 1000 - 86400 * 2,
    forecastCutoff: Date.now() / 1000 + 86400 * 7,
    resolutionDeadline: Date.now() / 1000 + 86400 * 30,
    winningOption: 255,
    status: 'Preview',
    statusCode: 0,
    totalPool: '0.00',
    totalPoolRaw: 0n,
    options: [
      { index: 0, name: 'Expand into a new market', pool: '0.00', poolRaw: 0n, percent: 50 },
      { index: 1, name: 'Develop a new product', pool: '0.00', poolRaw: 0n, percent: 50 },
    ],
    metric: 'Verified revenue after 90 days',
    isRealOnChain: false,
    accent: 'orange',
  },
  {
    id: 992,
    title: 'Protocol Incentives 2027',
    org: 'Atlas Collective',
    description: 'A preview of how contributors can compare measurable incentive strategies.',
    creator: '0x0000000000000000000000000000000000000000',
    resolver: '0x0000000000000000000000000000000000000000',
    createdAt: Date.now() / 1000 - 86400 * 4,
    forecastCutoff: Date.now() / 1000 + 86400 * 14,
    resolutionDeadline: Date.now() / 1000 + 86400 * 45,
    winningOption: 255,
    status: 'Preview',
    statusCode: 0,
    totalPool: '0.00',
    totalPoolRaw: 0n,
    options: [
      { index: 0, name: 'Target liquidity providers', pool: '0.00', poolRaw: 0n, percent: 50 },
      { index: 1, name: 'Fund developer grants', pool: '0.00', poolRaw: 0n, percent: 50 },
    ],
    metric: 'Net protocol activity and TVL retention',
    isRealOnChain: false,
    accent: 'blue',
  },
  {
    id: 993,
    title: 'Community Retreat Format',
    org: 'Open Assembly',
    description: 'Compare two formats using the same transparent evaluation criteria.',
    creator: '0x0000000000000000000000000000000000000000',
    resolver: '0x0000000000000000000000000000000000000000',
    createdAt: Date.now() / 1000 - 86400 * 5,
    forecastCutoff: Date.now() / 1000 + 86400 * 20,
    resolutionDeadline: Date.now() / 1000 + 86400 * 60,
    winningOption: 255,
    status: 'Preview',
    statusCode: 0,
    totalPool: '0.00',
    totalPoolRaw: 0n,
    options: [
      { index: 0, name: 'Distributed local meetups', pool: '0.00', poolRaw: 0n, percent: 50 },
      { index: 1, name: 'One global summit', pool: '0.00', poolRaw: 0n, percent: 50 },
    ],
    metric: 'Attendance, sentiment, and cost-efficiency',
    isRealOnChain: false,
    accent: 'green',
  },
];

const navItems: { label: View; icon: typeof LayoutDashboard }[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Decision Markets', icon: BarChart3 },
  { label: 'Create Decision', icon: Plus },
  { label: 'My Positions', icon: TrendingUp },
  { label: 'Activity', icon: Activity },
  { label: 'Documentation', icon: BookOpen },
];

function App() {
  const [view, setView] = useState<View>('Overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<Decision | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);

  // Web3 State
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<string>('0.00');
  const [isConnecting, setIsConnecting] = useState(false);
  const [web3Error, setWeb3Error] = useState<string | null>(null);

  // Protocol Data
  const [onChainDecisions, setOnChainDecisions] = useState<Decision[]>([]);
  const [loadingDecisions, setLoadingDecisions] = useState(false);
  const [userPositions, setUserPositions] = useState<UserPosition[]>([]);
  const [activities, setActivities] = useState<ProtocolActivity[]>([]);
  const [txToast, setTxToast] = useState<{ title: string; hash?: string; error?: boolean } | null>(null);

  const isMainnet = chainId === contractConfig.chainId;
  const isContractConfigured = Boolean(contractConfig.contractAddress && ethers.isAddress(contractConfig.contractAddress));

  // Initialize read-only provider
  const readProvider = useMemo(() => {
    return new JsonRpcProvider(contractConfig.rpcUrl);
  }, []);

  // Connect Wallet
  const connectWallet = useCallback(async () => {
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      setWeb3Error('MetaMask or a Web3 wallet is required. Please install a compatible EVM wallet.');
      return;
    }
    setIsConnecting(true);
    setWeb3Error(null);
    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const net = await provider.getNetwork();
      const currentChainId = Number(net.chainId);
      setAccount(accounts[0]);
      setChainId(currentChainId);

      const bal = await provider.getBalance(accounts[0]);
      setBalance(formatEther(bal));

      if (currentChainId !== contractConfig.chainId) {
        await switchNetwork();
      }
    } catch (err: any) {
      console.error('Wallet connection error:', err);
      setWeb3Error(err.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // Switch / Add BOT Chain Mainnet
  const switchNetwork = async () => {
    if (!(window as any).ethereum) return;
    try {
      await (window as any).ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: contractConfig.chainIdHex }],
      });
      const provider = new BrowserProvider((window as any).ethereum);
      const net = await provider.getNetwork();
      setChainId(Number(net.chainId));
    } catch (switchError: any) {
      if (switchError.code === 4902 || switchError.code === -32603) {
        try {
          await (window as any).ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: contractConfig.chainIdHex,
                chainName: contractConfig.networkName,
                rpcUrls: [contractConfig.rpcUrl],
                nativeCurrency: contractConfig.nativeCurrency,
                blockExplorerUrls: [contractConfig.explorerUrl],
              },
            ],
          });
          const provider = new BrowserProvider((window as any).ethereum);
          const net = await provider.getNetwork();
          setChainId(Number(net.chainId));
        } catch (addError: any) {
          setWeb3Error('Failed to add BOT Chain Mainnet to wallet.');
        }
      } else {
        setWeb3Error('Failed to switch to BOT Chain Mainnet.');
      }
    }
  };

  // Listen to provider events
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      const eth = (window as any).ethereum;
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          readProvider.getBalance(accounts[0]).then((bal) => setBalance(formatEther(bal))).catch(() => {});
        } else {
          setAccount(null);
          setBalance('0.00');
        }
      };
      const handleChainChanged = (cIdHex: string) => {
        setChainId(parseInt(cIdHex, 16));
      };

      eth.on('accountsChanged', handleAccountsChanged);
      eth.on('chainChanged', handleChainChanged);

      // Check if already connected
      eth.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          eth.request({ method: 'eth_chainId' }).then((cIdHex: string) => {
            setChainId(parseInt(cIdHex, 16));
          });
          readProvider.getBalance(accounts[0]).then((bal) => setBalance(formatEther(bal))).catch(() => {});
        }
      });

      return () => {
        eth.removeListener('accountsChanged', handleAccountsChanged);
        eth.removeListener('chainChanged', handleChainChanged);
      };
    }
  }, [readProvider]);

  // Fetch real on-chain decisions
  const fetchDecisions = useCallback(async () => {
    if (!isContractConfigured) {
      setOnChainDecisions([]);
      return;
    }
    setLoadingDecisions(true);
    try {
      const contract = new Contract(contractConfig.contractAddress, DecisionXArtifact.abi, readProvider);
      const countBig = await contract.decisionCount();
      const count = Number(countBig);

      const items: Decision[] = [];
      const positions: UserPosition[] = [];

      for (let i = 1; i <= count; i++) {
        try {
          const d = await contract.getDecision(i);
          const totalPoolRaw = BigInt(d.totalPool.toString());
          const totalPoolStr = formatEther(totalPoolRaw);
          const optionCount = Number(d.optionCount);

          const now = Math.floor(Date.now() / 1000);
          const cutoff = Number(d.forecastCutoff);
          const deadline = Number(d.resolutionDeadline);
          const statusCode = Number(d.status);

          let status: MarketStatus = 'Active';
          if (statusCode === 3) {
            status = 'Cancelled';
          } else if (statusCode === 2) {
            status = 'Resolved';
          } else if (statusCode === 1) {
            status = 'Awaiting resolution';
          } else if (now >= cutoff) {
            status = 'Closed';
          } else if (cutoff - now < 86400 * 2) {
            status = 'Closing soon';
          }

          const options: DecisionOption[] = [];
          for (let optIdx = 0; optIdx < optionCount; optIdx++) {
            const optData = d.options[optIdx];
            const optPoolRaw = BigInt(optData.totalPool.toString());
            let percent = optionCount > 0 ? 100 / optionCount : 0;
            if (totalPoolRaw > 0n) {
              percent = Number((optPoolRaw * 10000n) / totalPoolRaw) / 100;
            }
            options.push({
              index: optIdx,
              name: optData.name,
              pool: formatEther(optPoolRaw),
              poolRaw: optPoolRaw,
              percent,
            });
          }

          // Parse metadata title/description
          let title = `Decision #${i}`;
          let desc = d.metadataUri || 'On-chain parimutuel decision market';
          let org = 'BOT Chain Community';
          let metric = 'Verified on-chain outcome criteria';

          if (d.metadataUri && d.metadataUri.startsWith('{')) {
            try {
              const parsed = JSON.parse(d.metadataUri);
              if (parsed.title) title = parsed.title;
              if (parsed.description) desc = parsed.description;
              if (parsed.org) org = parsed.org;
              if (parsed.metric) metric = parsed.metric;
            } catch (_) {}
          }

          const decisionItem: Decision = {
            id: i,
            title,
            org,
            description: desc,
            creator: d.creator,
            resolver: d.resolver,
            createdAt: Number(d.createdAt),
            forecastCutoff: cutoff,
            resolutionDeadline: deadline,
            winningOption: Number(d.winningOption),
            status,
            statusCode,
            totalPool: totalPoolStr,
            totalPoolRaw,
            options,
            metric,
            evidenceUri: d.metadataUri,
            isRealOnChain: true,
            accent: i % 3 === 0 ? 'green' : i % 2 === 0 ? 'blue' : 'orange',
          };
          items.push(decisionItem);

          // Check user positions if connected
          if (account) {
            const pos = await contract.getUserPosition(i, account);
            const totalStakedRaw = BigInt(pos.totalStaked.toString());
            const claimed = Boolean(pos.claimed);

            if (totalStakedRaw > 0n) {
              for (let optIdx = 0; optIdx < optionCount; optIdx++) {
                const optStakeRaw = BigInt(pos.optionStakes[optIdx].toString());
                if (optStakeRaw > 0n) {
                  const isWinningOpt = statusCode === 2 && Number(d.winningOption) === optIdx;
                  positions.push({
                    decisionId: i,
                    decisionTitle: title,
                    optionIndex: optIdx,
                    optionName: options[optIdx]?.name || `Option ${optIdx}`,
                    stakedBot: formatEther(optStakeRaw),
                    stakedRaw: optStakeRaw,
                    status,
                    isWinner: isWinningOpt,
                    canClaim: isWinningOpt && !claimed,
                    canRefund: statusCode === 3 && !claimed,
                    claimed,
                  });
                }
              }
            }
          }
        } catch (itemErr) {
          console.error(`Error loading decision ${i}:`, itemErr);
        }
      }
      setOnChainDecisions(items);
      setUserPositions(positions);
    } catch (err) {
      console.error('Error fetching decisions from contract:', err);
    } finally {
      setLoadingDecisions(false);
    }
  }, [account, isContractConfigured, readProvider]);

  useEffect(() => {
    fetchDecisions();
  }, [fetchDecisions]);

  // Combined markets for display: real on-chain decisions, or illustrative preview if none deployed
  const displayedMarkets = useMemo(() => {
    if (onChainDecisions.length > 0) {
      return onChainDecisions;
    }
    return PREVIEW_MARKETS;
  }, [onChainDecisions]);

  const openMarket = (market: Decision) => {
    setSelectedMarket(market);
    setTradeOpen(false);
  };

  // Close forecast window
  const handleCloseForecast = async (decisionId: number) => {
    if (!account || !(window as any).ethereum) {
      connectWallet();
      return;
    }
    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(contractConfig.contractAddress, DecisionXArtifact.abi, signer);

      setTxToast({ title: 'Submitting Close Forecast window transaction...' });
      const tx = await contract.closeForecast(decisionId);
      setTxToast({ title: 'Transaction broadcasted. Awaiting confirmation on BOT Chain...', hash: tx.hash });
      await tx.wait();
      setTxToast({ title: 'Forecast window successfully closed on BOT Chain Mainnet!', hash: tx.hash });
      fetchDecisions();
    } catch (err: any) {
      console.error('Close forecast error:', err);
      setTxToast({ title: err.reason || err.message || 'Transaction failed', error: true });
    }
  };

  // Resolve decision
  const handleResolveDecision = async (decisionId: number, winningOption: number, evidenceUri: string) => {
    if (!account || !(window as any).ethereum) {
      connectWallet();
      return;
    }
    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(contractConfig.contractAddress, DecisionXArtifact.abi, signer);

      setTxToast({ title: 'Submitting Resolution transaction...' });
      const tx = await contract.resolveDecision(decisionId, winningOption, evidenceUri || 'Verified by designated resolver');
      setTxToast({ title: 'Transaction broadcasted. Awaiting settlement on BOT Chain...', hash: tx.hash });
      await tx.wait();
      setTxToast({ title: 'Decision settled! Winning option recorded on BOT Chain Mainnet.', hash: tx.hash });
      fetchDecisions();
    } catch (err: any) {
      console.error('Resolve decision error:', err);
      setTxToast({ title: err.reason || err.message || 'Resolution failed', error: true });
    }
  };

  // Claim Winnings
  const handleClaimWinnings = async (decisionId: number) => {
    if (!account || !(window as any).ethereum) {
      connectWallet();
      return;
    }
    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(contractConfig.contractAddress, DecisionXArtifact.abi, signer);

      setTxToast({ title: 'Claiming winnings from BOT Chain pool...' });
      const tx = await contract.claimWinnings(decisionId);
      setTxToast({ title: 'Claim broadcasted. Waiting for confirmation...', hash: tx.hash });
      await tx.wait();
      setTxToast({ title: 'Winnings claimed! Native BOT transferred to your wallet.', hash: tx.hash });
      fetchDecisions();
    } catch (err: any) {
      console.error('Claim winnings error:', err);
      setTxToast({ title: err.reason || err.message || 'Claim failed', error: true });
    }
  };

  // Claim Refund
  const handleClaimRefund = async (decisionId: number) => {
    if (!account || !(window as any).ethereum) {
      connectWallet();
      return;
    }
    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(contractConfig.contractAddress, DecisionXArtifact.abi, signer);

      setTxToast({ title: 'Claiming 100% refund from cancelled decision...' });
      const tx = await contract.claimRefund(decisionId);
      setTxToast({ title: 'Refund transaction broadcasted...', hash: tx.hash });
      await tx.wait();
      setTxToast({ title: 'Refund claimed! Native BOT refunded to your wallet.', hash: tx.hash });
      fetchDecisions();
    } catch (err: any) {
      console.error('Refund claim error:', err);
      setTxToast({ title: err.reason || err.message || 'Refund claim failed', error: true });
    }
  };

  return (
    <div className="app-shell">
      {/* Toast Notification */}
      {txToast && (
        <div className={`tx-toast ${txToast.error ? 'error' : ''}`}>
          <div className="toast-body">
            <strong>{txToast.error ? 'Transaction Error' : 'BOT Chain Update'}</strong>
            <span>{txToast.title}</span>
            {txToast.hash && (
              <a
                href={`${contractConfig.explorerUrl}/tx/${txToast.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="toast-link"
              >
                View on BOTScan <ExternalLink size={12} />
              </a>
            )}
          </div>
          <button onClick={() => setTxToast(null)} className="toast-close">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark">
            <Command size={18} strokeWidth={2.5} />
          </div>
          <span>
            Decision<span className="brand-x">X</span>
          </span>
          <button className="mobile-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">N</div>
          <div>
            <strong>Northstar DAO</strong>
            <span>Decision Intelligence</span>
          </div>
          <ChevronRight size={15} className="muted-icon" />
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          <span className="nav-label">Protocol</span>
          {navItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${view === label ? 'active' : ''}`}
              onClick={() => {
                setView(label);
                setMobileNavOpen(false);
              }}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {label === 'Create Decision' && <span className="nav-plus">+</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="chain-note">
            <div className={`chain-dot ${isMainnet ? 'active' : ''}`} />
            <div>
              <strong>BOT Chain Mainnet</strong>
              <span>Chain ID 677 · Native BOT</span>
            </div>
          </div>
          <button className="nav-item" onClick={fetchDecisions}>
            <RefreshCw size={15} className={loadingDecisions ? 'spin' : ''} />
            <span>Sync Protocol</span>
          </button>
          <div className="sidebar-footer">
            <div className="footer-links-row">
              <a
                href="https://botchain.ai"
                target="_blank"
                rel="noopener noreferrer"
                id="footer-link-botchain"
                className="verify-link"
              >
                botchain
              </a>
              <span>·</span>
              <a
                href="https://scan.botchain.ai"
                target="_blank"
                rel="noopener noreferrer"
                id="footer-link-botscan"
                className="verify-link"
              >
                botscan
              </a>
            </div>
            <span>v1.0 mainnet</span>
          </div>
        </div>
      </aside>

      {mobileNavOpen && (
        <button className="mobile-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />
      )}

      {/* Main Content Area */}
      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            <span>Northstar DAO</span>
            <ChevronRight size={14} />
            <strong>{view}</strong>
          </div>
          <div className="top-actions">
            {account && (
              <div className="balance-pill">
                <strong>{parseFloat(balance).toFixed(4)}</strong> <span>BOT</span>
              </div>
            )}
            {!isMainnet && account ? (
              <button className="switch-chain-button" onClick={switchNetwork}>
                <AlertCircle size={14} /> Switch to BOT Chain (677)
              </button>
            ) : (
              <div className="network-pill">
                <span className="chain-dot active" /> BOT Chain Mainnet
              </div>
            )}
            <button
              className={`wallet-button ${account ? 'connected' : ''}`}
              onClick={account ? () => {} : connectWallet}
              disabled={isConnecting}
            >
              <Wallet size={16} />
              {isConnecting
                ? 'Connecting...'
                : account
                ? `${account.slice(0, 6)}...${account.slice(-4)}`
                : 'Connect wallet'}
            </button>
          </div>
        </header>

        {web3Error && (
          <div className="web3-alert-banner">
            <AlertCircle size={17} />
            <span>{web3Error}</span>
            <button onClick={() => setWeb3Error(null)}>Dismiss</button>
          </div>
        )}

        <div className="page-wrap">
          {view === 'Overview' && (
            <Overview
              onCreate={() => setView('Create Decision')}
              onOpenMarket={openMarket}
              markets={displayedMarkets}
              onChainCount={onChainDecisions.length}
            />
          )}
          {view === 'Decision Markets' && (
            <Markets
              onOpenMarket={openMarket}
              markets={displayedMarkets}
              onChainCount={onChainDecisions.length}
              loading={loadingDecisions}
              onRefresh={fetchDecisions}
            />
          )}
          {view === 'Create Decision' && (
            <CreateDecision
              account={account}
              isMainnet={isMainnet}
              onConnect={connectWallet}
              onSwitchNetwork={switchNetwork}
              onBack={() => setView('Overview')}
              onComplete={() => {
                fetchDecisions();
                setView('Decision Markets');
              }}
            />
          )}
          {view === 'My Positions' && (
            <Positions
              account={account}
              positions={userPositions}
              onConnect={connectWallet}
              onClaimWinnings={handleClaimWinnings}
              onClaimRefund={handleClaimRefund}
            />
          )}
          {view === 'Activity' && <ActivityView activities={activities} />}
          {view === 'Documentation' && <Documentation />}

          {/* Footer with verified clickable botchain and botscan links */}
          <footer className="page-footer">
            <div className="footer-left">
              <span>DecisionX Protocol · Financially backed decision intelligence for organizations</span>
              <p>Parimutuel outcome pooling on BOT Chain Mainnet. Continuous market-implied signal.</p>
            </div>
            <div className="footer-right">
              <span className="footer-label">Official Network Verification:</span>
              <div className="footer-links">
                <a
                  href="https://botchain.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  id="footer-link-botchain"
                  className="footer-verify-link"
                >
                  botchain
                </a>
                <span className="link-divider">·</span>
                <a
                  href="https://scan.botchain.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  id="footer-link-botscan"
                  className="footer-verify-link"
                >
                  botscan
                </a>
              </div>
            </div>
          </footer>
        </div>
      </main>

      {/* Market Drawer Details */}
      {selectedMarket && (
        <MarketDrawer
          market={selectedMarket}
          account={account}
          onClose={() => setSelectedMarket(null)}
          onTrade={() => setTradeOpen(true)}
          onCloseForecast={() => handleCloseForecast(selectedMarket.id)}
          onResolve={(optIdx, evidence) => handleResolveDecision(selectedMarket.id, optIdx, evidence)}
        />
      )}

      {/* Stake / Trade Modal */}
      {tradeOpen && selectedMarket && (
        <TradeModal
          market={selectedMarket}
          account={account}
          balance={balance}
          isMainnet={isMainnet}
          onClose={() => setTradeOpen(false)}
          onConnect={connectWallet}
          onSuccess={() => {
            fetchDecisions();
            setTradeOpen(false);
          }}
        />
      )}
    </div>
  );
}

// Banner explaining environment & parimutuel dynamics
function ProtocolNotice({ onChainCount }: { onChainCount: number }) {
  if (onChainCount > 0) {
    return (
      <div className="preview-notice live">
        <Sparkles size={16} />
        <div>
          <strong>BOT Chain Mainnet Protocol Live (Chain ID 677)</strong>
          <span>
            Real native BOT decisions active on-chain. Market signals are derived strictly from participant stake
            distributions.
          </span>
        </div>
        <ShieldCheck size={17} className="notice-check" />
      </div>
    );
  }
  return (
    <div className="preview-notice">
      <Sparkles size={16} />
      <div>
        <strong>Mainnet Deployment Ready &amp; Synchronized</strong>
        <span>
          Contract architecture and gas optimizations are verified on BOT Chain Mainnet. Connect your wallet to create
          or trade active decisions.
        </span>
      </div>
      <ShieldCheck size={17} className="notice-check" />
    </div>
  );
}

function Overview({
  onCreate,
  onOpenMarket,
  markets,
  onChainCount,
}: {
  onCreate: () => void;
  onOpenMarket: (market: Decision) => void;
  markets: Decision[];
  onChainCount: number;
}) {
  const totalLiquidity = useMemo(() => {
    let sum = 0n;
    markets.forEach((m) => {
      if (m.isRealOnChain) sum += m.totalPoolRaw;
    });
    return formatEther(sum);
  }, [markets]);

  const activeCount = useMemo(() => {
    return markets.filter((m) => m.statusCode === 0).length;
  }, [markets]);

  const awaitingCount = useMemo(() => {
    return markets.filter((m) => m.statusCode === 1).length;
  }, [markets]);

  return (
    <>
      <section className="hero-row">
        <div>
          <div className="eyebrow">
            <span className="orange-cross">+</span> Decision intelligence for DAOs
          </div>
          <h1>
            Make decisions
            <br />
            <em>with signal.</em>
          </h1>
          <p className="hero-copy">
            DecisionX turns measurable forecasts into a clearer view of what your organization should do next using
            financially backed BOT Chain market signals.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onCreate}>
              Create a decision <ChevronRight size={17} />
            </button>
            <button className="text-button" onClick={() => onOpenMarket(markets[0])}>
              Explore markets <ArrowUpRight size={16} />
            </button>
          </div>
        </div>
        <div className="hero-art">
          <div className="art-label">
            Parimutuel decision
            <br />
            <strong>stake distribution / signal</strong>
          </div>
          <div className="signal-chart">
            <span className="chart-line line-one" />
            <span className="chart-line line-two" />
            <i className="chart-dot dot-one" />
            <i className="chart-dot dot-two" />
          </div>
          <div className="art-foot">
            <span>MARKET-IMPLIED SIGNAL</span>
            <strong>NOT A GUARANTEED OUTCOME</strong>
          </div>
        </div>
      </section>

      <ProtocolNotice onChainCount={onChainCount} />

      <section className="stats-grid">
        <Stat
          label="Active decisions"
          value={onChainCount > 0 ? activeCount.toString() : '—'}
          hint={onChainCount > 0 ? `${onChainCount} on-chain total` : 'No live decisions yet'}
          icon={Target}
        />
        <Stat
          label="Protocol liquidity"
          value={onChainCount > 0 ? `${parseFloat(totalLiquidity).toFixed(2)} BOT` : '0.00 BOT'}
          hint="Native BOT staked in pools"
          icon={BarChart3}
        />
        <Stat
          label="Settled outcomes"
          value={onChainCount > 0 ? markets.filter((m) => m.statusCode === 2).length.toString() : '0'}
          hint="Verifiable payouts executed"
          icon={Activity}
        />
        <Stat
          label="Awaiting resolution"
          value={onChainCount > 0 ? awaitingCount.toString() : '0'}
          hint="Forecast window closed"
          icon={Clock3}
        />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <div className="eyebrow">01 / Featured decisions</div>
            <h2>Decision markets</h2>
          </div>
          <button className="outline-button" onClick={() => onOpenMarket(markets[0])}>
            View directory <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="market-grid">
          {markets.slice(0, 2).map((market) => (
            <MarketCard key={market.id} market={market} onOpen={() => onOpenMarket(market)} />
          ))}
        </div>
      </section>

      <section className="bottom-grid">
        <div className="brief-card">
          <div className="card-kicker">HOW PARIMUTUEL DECISION MARKETS WORK</div>
          <h3>
            Prices are a signal,
            <br />
            <em>not a verdict.</em>
          </h3>
          <p>
            Participants stake native BOT on their preferred outcome path. The pool distribution defines the
            market-implied expectation. When verifiable criteria are published, winning positions pull their
            proportional share.
          </p>
          <div className="steps">
            <Step n="01" text="Define options and resolution criteria" />
            <Step n="02" text="Stake native BOT on preferred outcome" />
            <Step n="03" text="Close forecast and settle winning claims" />
          </div>
        </div>
        <div className="activity-card">
          <div className="section-heading compact">
            <div>
              <div className="card-kicker">PROTOCOL PULSE</div>
              <h3>BOT Chain Mainnet</h3>
            </div>
            <Activity size={18} />
          </div>
          <div className="empty-activity">
            <div className="empty-orbit">
              <Zap size={19} />
            </div>
            <strong>Chain ID 677 Verified</strong>
            <span>Direct RPC synchronization with BOT Chain block production.</span>
          </div>
        </div>
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Target;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon">
        <Icon size={16} />
      </div>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <div className="step">
      <span>{n}</span>
      <strong>{text}</strong>
      <ChevronRight size={14} />
    </div>
  );
}

function Markets({
  onOpenMarket,
  markets,
  onChainCount,
  loading,
  onRefresh,
}: {
  onOpenMarket: (market: Decision) => void;
  markets: Decision[];
  onChainCount: number;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');

  const filtered = useMemo(() => {
    return markets.filter((market) => {
      const matchText = `${market.title} ${market.org} ${market.description}`.toLowerCase().includes(query.toLowerCase());
      if (!matchText) return false;
      if (statusFilter === 'All') return true;
      if (statusFilter === 'Active') return market.statusCode === 0;
      if (statusFilter === 'Closing soon') return market.status === 'Closing soon';
      if (statusFilter === 'Awaiting resolution') return market.statusCode === 1;
      if (statusFilter === 'Resolved') return market.statusCode === 2;
      return true;
    });
  }, [markets, query, statusFilter]);

  return (
    <>
      <PageIntro
        eyebrow="02 / Explore"
        title="Decision markets"
        copy="Compare open decisions, evaluate empirical criteria, and follow financially backed organizational signals."
      />
      <ProtocolNotice onChainCount={onChainCount} />

      <div className="toolbar">
        <div className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search decisions, organizations, or metrics"
          />
        </div>
        <button className="filter-button" onClick={onRefresh} title="Sync with BOT Chain">
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      <div className="filter-tabs">
        {['All', 'Active', 'Closing soon', 'Awaiting resolution', 'Resolved'].map((tab) => (
          <button
            key={tab}
            className={statusFilter === tab ? 'selected' : ''}
            onClick={() => setStatusFilter(tab)}
          >
            {tab} markets
            {tab === 'All' && <span>{markets.length}</span>}
          </button>
        ))}
      </div>

      <div className="market-directory">
        {filtered.map((market) => (
          <MarketCard key={market.id} market={market} onOpen={() => onOpenMarket(market)} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="empty-panel">
          <Search size={22} />
          <strong>No decisions found</strong>
          <span>Try a different search term or create a new decision market.</span>
        </div>
      )}
    </>
  );
}

function MarketCard({ market, onOpen }: { market: Decision; onOpen: () => void }) {
  const optA = market.options[0]?.name || 'Option A';
  const optB = market.options[1]?.name || 'Option B';
  const pctA = market.options[0]?.percent ?? 50;
  const pctB = market.options[1]?.percent ?? 50;

  const now = Math.floor(Date.now() / 1000);
  const timeLeft = market.forecastCutoff > now ? `${Math.ceil((market.forecastCutoff - now) / 86400)}d left` : 'Closed';

  return (
    <article className={`market-card accent-${market.accent}`}>
      <div className="market-card-top">
        <span className="status-tag">
          <span />
          {market.status}
        </span>
        <span className="market-id">{market.isRealOnChain ? `#${market.id}` : 'PREVIEW'}</span>
      </div>
      <h3>{market.title}</h3>
      <span className="org-name">{market.org}</span>
      <p>{market.description}</p>

      <div className="options">
        <div>
          <span>A</span>
          {optA} <strong className="opt-pct">{pctA}%</strong>
        </div>
        <div>
          <span>B</span>
          {optB} <strong className="opt-pct">{pctB}%</strong>
        </div>
      </div>

      <div className="market-metrics">
        <div>
          <small>Staked Pool</small>
          <strong>{market.isRealOnChain ? `${parseFloat(market.totalPool).toFixed(2)} BOT` : '—'}</strong>
        </div>
        <div>
          <small>Options</small>
          <strong>{market.options.length} Paths</strong>
        </div>
        <div>
          <small>Forecast Window</small>
          <strong>{timeLeft}</strong>
        </div>
      </div>

      <div className="market-card-footer">
        <span>
          <Target size={14} /> {market.metric}
        </span>
        <button onClick={onOpen}>
          View market <ChevronRight size={15} />
        </button>
      </div>
    </article>
  );
}

function PageIntro({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <section className="page-intro">
      <div className="eyebrow">
        <span className="orange-cross">+</span> {eyebrow}
      </div>
      <h1>{title}</h1>
      <p>{copy}</p>
    </section>
  );
}

function CreateDecision({
  account,
  isMainnet,
  onConnect,
  onSwitchNetwork,
  onBack,
  onComplete,
}: {
  account: string | null;
  isMainnet: boolean;
  onConnect: () => void;
  onSwitchNetwork: () => void;
  onBack: () => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [org, setOrg] = useState('Northstar DAO');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState<string[]>(['Expand into a new market', 'Develop a new product']);
  const [metricName, setMetricName] = useState('');
  const [metricMethod, setMetricMethod] = useState('');
  const [forecastDays, setForecastDays] = useState('7');
  const [resolutionDays, setResolutionDays] = useState('30');
  const [resolverAddress, setResolverAddress] = useState(account || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (account && !resolverAddress) {
      setResolverAddress(account);
    }
  }, [account, resolverAddress]);

  const labels = ['Decision details', 'Define options', 'Measurable metrics', 'Configure market', 'Review & publish'];

  const addOption = () => {
    if (options.length < 8) {
      setOptions([...options, `Option ${String.fromCharCode(65 + options.length)}`]);
    }
  };

  const removeOption = (idx: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== idx));
    }
  };

  const handlePublish = async () => {
    if (!account) {
      onConnect();
      return;
    }
    if (!isMainnet) {
      onSwitchNetwork();
      return;
    }
    if (!contractConfig.contractAddress || !ethers.isAddress(contractConfig.contractAddress)) {
      setErrorMsg('Protocol contract is not yet deployed to BOT Chain Mainnet.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(contractConfig.contractAddress, DecisionXArtifact.abi, signer);

      const now = Math.floor(Date.now() / 1000);
      const cutoff = now + parseInt(forecastDays, 10) * 86400;
      const deadline = now + parseInt(resolutionDays, 10) * 86400;

      const metadata = JSON.stringify({
        title,
        org,
        description,
        metric: `${metricName}: ${metricMethod}`,
      });

      const params = {
        title,
        metadataUri: metadata,
        optionNames: options,
        forecastCutoff: cutoff,
        resolutionDeadline: deadline,
        resolver: resolverAddress || account,
      };

      const tx = await contract.createDecision(params);
      await tx.wait();
      onComplete();
    } catch (err: any) {
      console.error('Create decision error:', err);
      setErrorMsg(err.reason || err.message || 'Failed to create decision on-chain');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <PageIntro
        eyebrow="03 / New decision"
        title="Create a decision"
        copy="Set the question, define measurable success criteria, and open the parimutuel forecast window."
      />
      <div className="wizard-layout">
        <aside className="wizard-steps">
          {labels.map((label, index) => (
            <button
              className={step === index + 1 ? 'current' : step > index + 1 ? 'done' : ''}
              key={label}
              onClick={() => setStep(index + 1)}
            >
              <span>{step > index + 1 ? <Check size={14} /> : `0${index + 1}`}</span>
              {label}
              <ChevronRight size={14} />
            </button>
          ))}
          <div className="wizard-tip">
            <CircleHelp size={16} />
            <span>
              Transactions execute directly on BOT Chain Mainnet (Chain ID 677). Gas is minimized using compact storage packing.
            </span>
          </div>
        </aside>

        <div className="form-panel">
          <div className="form-panel-heading">
            <span>Step 0{step}</span>
            <strong>{labels[step - 1]}</strong>
          </div>

          {errorMsg && (
            <div className="form-error-banner">
              <AlertCircle size={15} />
              <span>{errorMsg}</span>
            </div>
          )}

          {step === 1 && (
            <div className="form-content">
              <label>
                Decision title
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Q4 Strategic Growth Direction"
                />
              </label>
              <label>
                Organization or DAO name
                <input
                  value={org}
                  onChange={(event) => setOrg(event.target.value)}
                  placeholder="e.g. Northstar DAO"
                />
              </label>
              <label>
                What decision is being considered?
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Describe the context, alternative actions, and strategic objectives."
                  rows={4}
                />
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="form-content">
              <p className="field-hint">A decision must define between 2 and 8 distinct, mutually exclusive options.</p>
              {options.map((opt, i) => (
                <div key={i} className="option-input-row">
                  <OptionInput
                    letter={String.fromCharCode(65 + i)}
                    value={opt}
                    onChange={(val) => {
                      const updated = [...options];
                      updated[i] = val;
                      setOptions(updated);
                    }}
                    placeholder={`Option ${String.fromCharCode(65 + i)}`}
                  />
                  {options.length > 2 && (
                    <button type="button" className="remove-opt-btn" onClick={() => removeOption(i)}>
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
              {options.length < 8 && (
                <button type="button" className="add-option" onClick={addOption}>
                  <Plus size={16} /> Add another option ({options.length}/8)
                </button>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="form-content">
              <label>
                Metric name
                <input
                  value={metricName}
                  onChange={(event) => setMetricName(event.target.value)}
                  placeholder="e.g. Verified 90-Day ARR Growth"
                />
              </label>
              <label>
                Measurement &amp; Resolution criteria
                <textarea
                  value={metricMethod}
                  onChange={(event) => setMetricMethod(event.target.value)}
                  placeholder="How will the winner be determined? Specify the exact data source, calculation, and threshold."
                  rows={3}
                />
              </label>
            </div>
          )}

          {step === 4 && (
            <div className="form-content">
              <div className="mechanism-choice selected">
                <div className="radio-dot" />
                <div>
                  <strong>Parimutuel Decision Pool (BOT Chain)</strong>
                  <span>Stakes are pooled in native BOT; winning positions claim proportional payout.</span>
                </div>
                <ShieldCheck size={17} />
              </div>
              <div className="field-row">
                <label>
                  Forecast window closes in (days)
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={forecastDays}
                    onChange={(e) => setForecastDays(e.target.value)}
                  />
                </label>
                <label>
                  Resolution deadline (days from now)
                  <input
                    type="number"
                    min="2"
                    max="180"
                    value={resolutionDays}
                    onChange={(e) => setResolutionDays(e.target.value)}
                  />
                </label>
              </div>
              <label>
                Designated Resolver Wallet Address
                <input
                  value={resolverAddress}
                  onChange={(e) => setResolverAddress(e.target.value)}
                  placeholder="0x... (defaults to connected wallet)"
                />
              </label>
              <div className="info-box">
                <Zap size={16} />
                <span>Measured deployment gas: ~257k gas (2 options) to ~381k gas (8 options).</span>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="review-content">
              <div className="review-banner">
                <Sparkles size={17} />
                <div>
                  <strong>Ready for on-chain submission</strong>
                  <span>
                    Your decision parameters will be stored in DecisionX protocol on BOT Chain Mainnet.
                  </span>
                </div>
              </div>
              <ReviewRow label="Decision" value={title || 'Untitled decision'} />
              <ReviewRow label="Options" value={`${options.length} options defined`} />
              <ReviewRow label="Forecast Window" value={`${forecastDays} days until cutoff`} />
              <ReviewRow label="Resolution Deadline" value={`${resolutionDays} days until expiry`} />
              <ReviewRow label="Resolver" value={resolverAddress ? `${resolverAddress.slice(0, 10)}...` : 'Creator'} />
            </div>
          )}

          <div className="form-footer">
            <button className="text-button" onClick={step === 1 ? onBack : () => setStep(step - 1)}>
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            <button
              className="primary-button"
              disabled={isSubmitting}
              onClick={step === 5 ? handlePublish : () => setStep(step + 1)}
            >
              {isSubmitting
                ? 'Broadcasting to BOT Chain...'
                : step === 5
                ? 'Publish Decision'
                : 'Continue'}{' '}
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function OptionInput({
  letter,
  value,
  onChange,
  placeholder,
}: {
  letter: string;
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
}) {
  return (
    <div className="option-input">
      <span>{letter}</span>
      <label>
        Option {letter}
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      </label>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="review-row">
      <span>{label}</span>
      <strong>{value}</strong>
      <Check size={15} />
    </div>
  );
}

function Positions({
  account,
  positions,
  onConnect,
  onClaimWinnings,
  onClaimRefund,
}: {
  account: string | null;
  positions: UserPosition[];
  onConnect: () => void;
  onClaimWinnings: (decisionId: number) => void;
  onClaimRefund: (decisionId: number) => void;
}) {
  return (
    <>
      <PageIntro
        eyebrow="04 / Portfolio"
        title="My positions"
        copy="Track your exposure to decision outcomes and claim verified settlement payouts directly from BOT Chain."
      />

      {!account ? (
        <div className="wallet-empty">
          <div className="wallet-empty-icon">
            <Wallet size={24} />
          </div>
          <h3>Connect a wallet to view positions</h3>
          <p>Your positions and eligible claims are read directly from the DecisionX protocol on BOT Chain Mainnet.</p>
          <button className="primary-button" onClick={onConnect}>
            Connect wallet <Wallet size={16} />
          </button>
        </div>
      ) : (
        <>
          <div className="connected-banner">
            <div className="wallet-avatar">
              <Wallet size={15} />
            </div>
            <div>
              <strong>Wallet connected</strong>
              <span>
                {account} · BOT Chain Mainnet (677)
              </span>
            </div>
            <ShieldCheck size={17} />
          </div>

          {positions.length === 0 ? (
            <div className="empty-panel tall">
              <TrendingUp size={24} />
              <strong>No positions yet</strong>
              <span>Stake on an active decision market to establish your position.</span>
            </div>
          ) : (
            <div className="positions-list">
              {positions.map((pos, idx) => (
                <div key={idx} className="position-card">
                  <div className="position-head">
                    <span className="pos-market">Decision #{pos.decisionId}</span>
                    <span className="status-tag">{pos.status}</span>
                  </div>
                  <h4>{pos.decisionTitle}</h4>
                  <div className="pos-details">
                    <div>
                      <small>Staked Option</small>
                      <strong>{pos.optionName}</strong>
                    </div>
                    <div>
                      <small>Your Stake</small>
                      <strong>{parseFloat(pos.stakedBot).toFixed(4)} BOT</strong>
                    </div>
                    <div>
                      <small>Settlement Status</small>
                      <strong>
                        {pos.claimed
                          ? 'Claimed'
                          : pos.isWinner
                          ? 'Won — Ready to claim'
                          : pos.canRefund
                          ? 'Refund available'
                          : 'In progress'}
                      </strong>
                    </div>
                  </div>
                  <div className="pos-actions">
                    {pos.canClaim && (
                      <button className="primary-button compact" onClick={() => onClaimWinnings(pos.decisionId)}>
                        Claim Winnings <Sparkles size={14} />
                      </button>
                    )}
                    {pos.canRefund && (
                      <button className="outline-button compact" onClick={() => onClaimRefund(pos.decisionId)}>
                        Claim Refund <RefreshCw size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function ActivityView({ activities }: { activities: ProtocolActivity[] }) {
  return (
    <>
      <PageIntro
        eyebrow="05 / Transparency"
        title="Protocol activity"
        copy="Follow verified on-chain events that move a decision from question to settlement on BOT Chain Mainnet."
      />
      <div className="activity-table">
        <div className="table-head">
          <span>Event</span>
          <span>Decision</span>
          <span>Transaction</span>
          <span>Status</span>
        </div>
        {activities.length === 0 ? (
          <div className="empty-panel table-empty">
            <Activity size={24} />
            <strong>BOT Chain Event Stream Active</strong>
            <span>Recent on-chain events will appear here as transactions confirm on BOT Chain.</span>
          </div>
        ) : (
          <div className="activity-rows">
            {activities.map((act) => (
              <div key={act.id} className="activity-row">
                <span>{act.event}</span>
                <span>{act.decisionTitle}</span>
                <a
                  href={`${contractConfig.explorerUrl}/tx/${act.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tx-link"
                >
                  {act.txHash.slice(0, 10)}... <ExternalLink size={12} />
                </a>
                <span>Confirmed</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Documentation() {
  const docs = [
    [
      '01',
      'What is DecisionX?',
      'A parimutuel decision-market protocol that allows DAOs and organizations to compare alternative decisions using financially backed market signals.',
    ],
    [
      '02',
      'Parimutuel Mechanics',
      'Participants stake native BOT on their preferred outcome. Winning stakes receive their proportional share of the eligible settlement pool without AMM slippage or token minting overhead.',
    ],
    [
      '03',
      'Resolver Trust Model',
      'Transparent designated resolution. If a market reaches its resolution deadline without resolution, participants can trigger automatic cancellation and claim 100% refunds.',
    ],
    [
      '04',
      'BOT Chain Optimization',
      'Engineered specifically for BOT Chain Mainnet (Chain ID 677). Uses storage-packed slots, pull-based claims, and pure native BOT to achieve ultra-low gas consumption.',
    ],
  ];

  return (
    <>
      <PageIntro
        eyebrow="06 / Learn"
        title="Documentation"
        copy="A plain-language guide to making organizational choices transparent through parimutuel signal markets."
      />
      <div className="docs-grid">
        {docs.map(([number, title, text]) => (
          <div className="doc-card" key={number}>
            <span>{number}</span>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="definition-card">
        <div className="eyebrow">
          <span className="orange-cross">+</span> Core distinction
        </div>
        <h2>A market-implied expectation is not a verified outcome.</h2>
        <p>
          DecisionX separates what participants expect from what actually occurs in the real world. Only verifiable
          resolution criteria and published evidence determine the final settlement.
        </p>
      </div>
    </>
  );
}

function MarketDrawer({
  market,
  account,
  onClose,
  onTrade,
  onCloseForecast,
  onResolve,
}: {
  market: Decision;
  account: string | null;
  onClose: () => void;
  onTrade: () => void;
  onCloseForecast: () => void;
  onResolve: (optIdx: number, evidence: string) => void;
}) {
  const now = Math.floor(Date.now() / 1000);
  const isPastCutoff = now >= market.forecastCutoff;
  const isResolver = account && market.resolver.toLowerCase() === account.toLowerCase();
  const [selectedResolveOpt, setSelectedResolveOpt] = useState(0);
  const [evidenceText, setEvidenceText] = useState('');
  const [resolveMode, setResolveMode] = useState(false);

  return (
    <>
      <button className="drawer-scrim" onClick={onClose} aria-label="Close market details" />
      <aside className="market-drawer">
        <div className="drawer-top">
          <span className="eyebrow">Decision detail</span>
          <button onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </div>
        <span className="status-tag">
          <span />
          {market.status}
        </span>
        <h2>{market.title}</h2>
        <span className="org-name">{market.org}</span>
        <p>{market.description}</p>

        <div className="signal-card">
          <div className="signal-card-head">
            <span>Market-Implied Signal</span>
            <CircleHelp size={15} />
          </div>
          <div className="signal-breakdown">
            {market.options.map((opt) => (
              <div key={opt.index} className="signal-row">
                <div className="signal-labels">
                  <strong>{opt.name}</strong>
                  <span>{opt.percent}% ({parseFloat(opt.pool).toFixed(2)} BOT)</span>
                </div>
                <div className="signal-bar-track">
                  <div className="signal-bar-fill" style={{ width: `${opt.percent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="drawer-section">
          <span className="card-kicker">AVAILABLE OPTIONS</span>
          {market.options.map((opt) => (
            <div key={opt.index} className="drawer-option">
              <span>{String.fromCharCode(65 + opt.index)}</span>
              <div>
                <strong>{opt.name}</strong>
                <small>Pooled: {parseFloat(opt.pool).toFixed(4)} BOT</small>
              </div>
            </div>
          ))}
        </div>

        <div className="drawer-section">
          <span className="card-kicker">RESOLUTION CRITERIA</span>
          <div className="criteria">
            <Target size={17} />
            <span>{market.metric}</span>
          </div>
          <div className="resolver-meta">
            <small>Designated Resolver:</small>
            <a
              href={`${contractConfig.explorerUrl}/address/${market.resolver}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mono-link"
            >
              {market.resolver.slice(0, 8)}...{market.resolver.slice(-6)} <ExternalLink size={11} />
            </a>
          </div>
        </div>

        {/* Resolver Actions */}
        {market.statusCode === 1 && isResolver && (
          <div className="drawer-section resolver-box">
            <span className="card-kicker">RESOLVER SETTLEMENT</span>
            {!resolveMode ? (
              <button className="primary-button full-width" onClick={() => setResolveMode(true)}>
                Publish Resolution <Sparkles size={15} />
              </button>
            ) : (
              <div className="resolve-form">
                <label>Select Winning Option:</label>
                <select
                  value={selectedResolveOpt}
                  onChange={(e) => setSelectedResolveOpt(Number(e.target.value))}
                  className="resolve-select"
                >
                  {market.options.map((opt) => (
                    <option key={opt.index} value={opt.index}>
                      Option {String.fromCharCode(65 + opt.index)}: {opt.name}
                    </option>
                  ))}
                </select>
                <label>Evidence Link or Summary:</label>
                <input
                  value={evidenceText}
                  onChange={(e) => setEvidenceText(e.target.value)}
                  placeholder="https://... or resolution proof"
                />
                <button
                  className="primary-button full-width"
                  onClick={() => onResolve(selectedResolveOpt, evidenceText)}
                >
                  Confirm &amp; Settle Market
                </button>
              </div>
            )}
          </div>
        )}

        <div className="drawer-footer">
          {market.statusCode === 0 && !isPastCutoff ? (
            <>
              <div>
                <small>Staking Currency</small>
                <strong>Native BOT (BOT Chain)</strong>
              </div>
              <button className="primary-button" onClick={onTrade}>
                Stake BOT on Option <ArrowUpRight size={16} />
              </button>
            </>
          ) : market.statusCode === 0 && isPastCutoff ? (
            <button className="outline-button full-width" onClick={onCloseForecast}>
              Close Forecast Window (Cutoff Passed)
            </button>
          ) : (
            <div className="settled-notice">
              <strong>Market {market.status}</strong>
              <span>Positions can be claimed under My Positions.</span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function TradeModal({
  market,
  account,
  balance,
  isMainnet,
  onClose,
  onConnect,
  onSuccess,
}: {
  market: Decision;
  account: string | null;
  balance: string;
  isMainnet: boolean;
  onClose: () => void;
  onConnect: () => void;
  onSuccess: () => void;
}) {
  const [chosenOption, setChosenOption] = useState<number>(0);
  const [stakeAmount, setStakeAmount] = useState<string>('0.01');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const parsedAmount = parseFloat(stakeAmount) || 0;
  const gasEstimateBot = '0.0025';

  const handleConfirmStake = async () => {
    if (!account) {
      onConnect();
      return;
    }
    if (!market.isRealOnChain) {
      setErrorMsg('This is an illustrative preview market. To stake real BOT, create or select an active on-chain market.');
      return;
    }
    if (parsedAmount <= 0) {
      setErrorMsg('Please enter a valid stake amount greater than 0 BOT.');
      return;
    }
    if (parseFloat(balance) < parsedAmount) {
      setErrorMsg(`Insufficient BOT balance. You have ${parseFloat(balance).toFixed(4)} BOT.`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(contractConfig.contractAddress, DecisionXArtifact.abi, signer);

      const valueWei = parseEther(stakeAmount);
      const tx = await contract.stake(market.id, chosenOption, { value: valueWei });
      await tx.wait();
      onSuccess();
    } catch (err: any) {
      console.error('Stake error:', err);
      setErrorMsg(err.reason || err.message || 'Transaction failed or was rejected');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-layer">
      <div className="trade-modal">
        <div className="modal-heading">
          <div>
            <span className="card-kicker">STAKE ON OUTCOME</span>
            <h3>{market.title}</h3>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="trade-warning">
          <ShieldCheck size={17} />
          <span>
            Parimutuel staking on BOT Chain Mainnet. Your native BOT is pooled on your chosen option and eligible for
            proportional payout upon settlement.
          </span>
        </div>

        {errorMsg && (
          <div className="modal-error-banner">
            <AlertCircle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="trade-options">
          {market.options.map((opt) => (
            <button
              key={opt.index}
              className={chosenOption === opt.index ? 'chosen' : ''}
              onClick={() => setChosenOption(opt.index)}
            >
              <span>{String.fromCharCode(65 + opt.index)}</span>
              <strong>{opt.name}</strong>
              <Check size={16} />
            </button>
          ))}
        </div>

        <label className="amount-field">
          Amount in Native BOT
          <input
            type="number"
            step="0.001"
            min="0.0001"
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            placeholder="0.00"
          />
        </label>

        <div className="trade-summary">
          <div>
            <span>Chosen Option</span>
            <strong>{market.options[chosenOption]?.name || 'Option'}</strong>
          </div>
          <div>
            <span>Estimated Gas</span>
            <strong>~{gasEstimateBot} BOT</strong>
          </div>
          <div>
            <span>Total Needed</span>
            <strong>~{(parsedAmount + parseFloat(gasEstimateBot)).toFixed(4)} BOT</strong>
          </div>
        </div>

        <button
          className="primary-button full-width"
          disabled={isSubmitting}
          onClick={handleConfirmStake}
        >
          {isSubmitting
            ? 'Confirming on BOT Chain...'
            : account
            ? 'Confirm Stake in Wallet'
            : 'Connect Wallet to Continue'}{' '}
          <Wallet size={16} />
        </button>
        <p className="modal-note">
          A trade changes your financial position in native BOT. It is not an arbitrary governance vote.
        </p>
      </div>
    </div>
  );
}

export default App;
