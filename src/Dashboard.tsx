import { useEffect, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react'
import { BrowserProvider, Contract, JsonRpcProvider, formatUnits, getAddress, isAddress } from 'ethers'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  ExternalLink,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Network,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Star,
  TriangleAlert,
  Wallet,
  X,
  Zap,
} from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'
import Aurora from './components/Aurora'
import ClickSpark from './components/ClickSpark'
import CountUp from './components/CountUp'


type NetworkKey = 'sepolia' | 'mainnet' | 'base'
type GraphNode = { address: string; score: number }
type GraphEdge = { issuer: string; subject: string }
type Attestation = { issuer: string; subject: string; rating: number; jobRef: string; timestamp: number }
type InjectedWindow = Window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }

const CONTRACT_ABI = [
  'function addAnchor(address a) external',
  'function issueAttestation(address subject, uint8 rating, string calldata jobRef) external',
  'function getReputation(address w) external view returns (uint256)',
  'function getAttestationsOf(address s) external view returns (tuple(address issuer,address subject,uint8 rating,string jobRef,uint256 timestamp)[])',
  'function owner() external view returns (address)',
  'function totalAttestations() external view returns (uint256)',
  'function totalKnownWallets() external view returns (uint256)',
] as const

const NETWORKS: Record<NetworkKey, { label: string; chainId: number; rpc: string }> = {
  sepolia: { label: 'Sepolia', chainId: 11155111, rpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
  mainnet: { label: 'Ethereum', chainId: 1, rpc: 'https://ethereum-rpc.publicnode.com' },
  base: { label: 'Base', chainId: 8453, rpc: 'https://base-rpc.publicnode.com' },
}
const NETWORK_BY_ID: Record<number, NetworkKey> = { 1: 'mainnet', 11155111: 'sepolia', 8453: 'base' }
const SIM_WALLETS = ['0xb100000000000000000000000000000000000001', '0xb100000000000000000000000000000000000002', '0xb100000000000000000000000000000000000003', '0xb100000000000000000000000000000000000004', '0xb100000000000000000000000000000000000005']
const PREVIEW_WALLETS = ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333', '0x4444444444444444444444444444444444444444', '0x5555555555555555555555555555555555555555', '0x6666666666666666666666666666666666666666', '0x7777777777777777777777777777777777777777']
const INITIAL_NODES: GraphNode[] = PREVIEW_WALLETS.map((address, index) => ({ address, score: [4.8, 3.9, 0, 4.2, 2.7, 0, 3.5][index] }))
const INITIAL_EDGES: GraphEdge[] = [
  { issuer: PREVIEW_WALLETS[0], subject: PREVIEW_WALLETS[1] },
  { issuer: PREVIEW_WALLETS[1], subject: PREVIEW_WALLETS[2] },
  { issuer: PREVIEW_WALLETS[3], subject: PREVIEW_WALLETS[1] },
  { issuer: PREVIEW_WALLETS[4], subject: PREVIEW_WALLETS[0] },
  { issuer: PREVIEW_WALLETS[5], subject: PREVIEW_WALLETS[3] },
  { issuer: PREVIEW_WALLETS[6], subject: PREVIEW_WALLETS[4] },
]

function createProvider(connected: boolean, network: NetworkKey) {
  const injected = (window as InjectedWindow).ethereum
  if (connected && injected) return new BrowserProvider(injected as never)
  return new JsonRpcProvider(NETWORKS[network].rpc, NETWORKS[network].chainId)
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function errorMessage(error: unknown) {
  const detail = error as { code?: string | number; shortMessage?: string; reason?: string; message?: string }
  if (detail?.code === 4001 || detail?.code === 'ACTION_REJECTED') return 'Request rejected in your wallet.'
  return detail?.shortMessage ?? detail?.reason ?? detail?.message ?? 'The request could not be completed.'
}

function formatScore(value: bigint) {
  return Number(formatUnits(value, 18))
}

function CopyAddress({ address, className = '' }: { address: string; className?: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      toast.success('Address copied')
    } catch {
      toast.error('Clipboard access is unavailable in this browser.')
    }
  }

  return (
    <button className={`address-copy ${className}`} type="button" onClick={() => void copy()} title={`Copy ${shortAddress(address)}`}>
      <span>{shortAddress(address)}</span>
      <Copy size={13} aria-hidden="true" />
    </button>
  )
}

function ActionButton({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <ClickSpark sparkColor="#f5a623" sparkCount={7} sparkRadius={22} sparkSize={7} duration={360}>
      <button className={`action-button ${className}`} {...props}>
        {children}
      </button>
    </ClickSpark>
  )
}

function RatingStars({ value, onChange, disabled = false }: { value: number; onChange?: (rating: number) => void; disabled?: boolean }) {
  return (
    <div className={`rating-stars ${disabled ? 'is-disabled' : ''}`} role="group" aria-label={`Rating: ${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((rating) => (
        <button
          aria-label={`${rating} star${rating === 1 ? '' : 's'}`}
          aria-pressed={rating === value}
          className={rating <= value ? 'star-button is-selected' : 'star-button'}
          disabled={disabled}
          key={rating}
          onClick={() => onChange?.(rating)}
          type="button"
        >
          <Star size={21} fill={rating <= value ? 'currentColor' : 'none'} strokeWidth={1.7} />
        </button>
      ))}
      <span className="rating-value">{value}.0</span>
    </div>
  )
}

function NetworkGraph({ nodes, edges, simulationStep, onSelect }: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  simulationStep: number
  onSelect: (address: string) => void
}) {
  const isSimulating = simulationStep > 0
  const visibleSimNodes = Math.min(5, Math.max(1, simulationStep))
  const visibleNodes = isSimulating
    ? SIM_WALLETS.slice(0, visibleSimNodes).map((address) => ({ address, score: 0 }))
    : nodes.slice(0, 12)
  const visibleEdges = isSimulating
    ? Array.from({ length: Math.max(0, simulationStep - 5) }, (_, index) => ({
        issuer: SIM_WALLETS[index % 5],
        subject: SIM_WALLETS[(index + 1) % 5],
      }))
    : edges.filter((edge) => visibleNodes.some((node) => node.address.toLowerCase() === edge.issuer.toLowerCase()) && visibleNodes.some((node) => node.address.toLowerCase() === edge.subject.toLowerCase())).slice(-20)
  const positions = visibleNodes.map((_, index) => {
    if (isSimulating) {
      const angle = -Math.PI / 2 + (index / 5) * Math.PI * 2
      return { x: 460 + Math.cos(angle) * 145, y: 184 + Math.sin(angle) * 112 }
    }
    if (index === 0) return { x: 460, y: 184 }
    const angle = -Math.PI / 2 + ((index - 1) / Math.max(visibleNodes.length - 1, 1)) * Math.PI * 2
    return { x: 460 + Math.cos(angle) * 315, y: 184 + Math.sin(angle) * 128 }
  })
  const nodeIndex = new Map(visibleNodes.map((node, index) => [node.address.toLowerCase(), index]))

  return (
    <svg className="network-svg" viewBox="0 0 920 368" role="img" aria-label={isSimulating ? 'Offline five-wallet sybil simulation' : 'Wallet reputation network graph'}>
      <defs>
        <marker id="graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
        <radialGradient id="graph-glow"><stop offset="0" stopColor="#f5a623" stopOpacity=".12" /><stop offset="1" stopColor="#f5a623" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="460" cy="184" rx="300" ry="148" fill="url(#graph-glow)" />
      <g className="graph-lines">
        {visibleEdges.map((edge, index) => {
          const from = nodeIndex.get(edge.issuer.toLowerCase())
          const to = nodeIndex.get(edge.subject.toLowerCase())
          if (from === undefined || to === undefined) return null
          return <line key={`${edge.issuer}-${edge.subject}-${index}`} x1={positions[from].x} y1={positions[from].y} x2={positions[to].x} y2={positions[to].y} markerEnd="url(#graph-arrow)" />
        })}
      </g>
      {visibleNodes.map((node, index) => {
        const point = positions[index]
        const trusted = node.score > 0
        return (
          <g className={`graph-node ${trusted ? 'is-trusted' : 'is-zero'}`} key={node.address} onClick={() => !isSimulating && onSelect(node.address)} role="button" tabIndex={isSimulating ? -1 : 0} aria-label={`${trusted ? 'Trusted' : 'Zero score'} wallet node ${index + 1}`} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && !isSimulating) onSelect(node.address) }}>
            <circle className="node-halo" cx={point.x} cy={point.y} r="25" />
            <circle className="node-core" cx={point.x} cy={point.y} r="11" />
            <text x={point.x} y={point.y + 34} textAnchor="middle">W{String(index + 1).padStart(2, '0')}</text>
            <title>{trusted ? 'Trusted reputation node' : 'Zero-score node'}</title>
          </g>
        )
      })}
      {isSimulating && <text className="graph-sim-label" x="460" y="184" textAnchor="middle">MUTUAL 5-STAR RATING</text>}
    </svg>
  )
}

function App() {
  const { address, isConnected, chainId } = useAccount()
  const { connect, connectors, isPending: isConnecting } = useConnect({ mutation: { onError: (error) => toast.error(errorMessage(error)) } })
  const { disconnect } = useDisconnect()
  const [network, setNetwork] = useState<NetworkKey>('sepolia')
  const [contractInput, setContractInput] = useState(() => localStorage.getItem('trustgraph.contractAddress') ?? '')
  const [contractAddress, setContractAddress] = useState(() => localStorage.getItem('trustgraph.contractAddress') ?? '')
  const [contractOwner, setContractOwner] = useState('')
  const [totalAttestations, setTotalAttestations] = useState(0)
  const [totalWallets, setTotalWallets] = useState(0)
  const [contractIssue, setContractIssue] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [anchorAddress, setAnchorAddress] = useState('')
  const [subjectAddress, setSubjectAddress] = useState('')
  const [jobRef, setJobRef] = useState('')
  const [rating, setRating] = useState(5)
  const [pendingAction, setPendingAction] = useState<'anchor' | 'attestation' | null>(null)
  const [lookupAddress, setLookupAddress] = useState('')
  const [profile, setProfile] = useState<{ address: string; score: number } | null>(null)
  const [history, setHistory] = useState<Attestation[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [readingProfile, setReadingProfile] = useState(false)
  const [graphNodes, setGraphNodes] = useState(INITIAL_NODES)
  const [graphEdges, setGraphEdges] = useState(INITIAL_EDGES)
  const [graphHasLiveData, setGraphHasLiveData] = useState(false)
  const [simulationStep, setSimulationStep] = useState(0)

  const activeNetwork = isConnected && chainId && NETWORK_BY_ID[chainId] ? NETWORK_BY_ID[chainId] : network
  const ownerIsConnected = Boolean(contractOwner && address && contractOwner.toLowerCase() === address.toLowerCase())
  const metaMaskConnector = connectors.find((connector) => connector.id === 'io.metamask') ?? connectors[0]


  useEffect(() => {
    if (simulationStep === 0 || simulationStep >= 10) return
    const timer = window.setTimeout(() => setSimulationStep((step) => Math.min(step + 1, 10)), 430)
    return () => window.clearTimeout(timer)
  }, [simulationStep])

  useEffect(() => {
    let cancelled = false
    if (!contractAddress || !isAddress(contractAddress)) return

    const readContract = async () => {
      try {
        const contract = new Contract(contractAddress, CONTRACT_ABI, createProvider(isConnected, activeNetwork))
        const [owner, attestations, wallets] = await Promise.all([
          contract.owner(),
          contract.totalAttestations(),
          contract.totalKnownWallets(),
        ])
        if (cancelled) return
        setContractOwner(String(owner))
        setTotalAttestations(Number(attestations))
        setTotalWallets(Number(wallets))
        setContractIssue('')
      } catch (error) {
        if (cancelled) return
        setContractOwner('')
        setContractIssue(errorMessage(error))
      }
    }
    void readContract()
    return () => { cancelled = true }
  }, [contractAddress, isConnected, activeNetwork, refreshVersion])

  const saveContractAddress = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isAddress(contractInput.trim())) {
      toast.error('Enter a valid deployed contract address.')
      return
    }
    const normalized = getAddress(contractInput.trim())
    localStorage.setItem('trustgraph.contractAddress', normalized)
    setContractInput(normalized)
    setContractAddress(normalized)
    setContractIssue('')
    toast.success('Contract address saved')
  }

  const connectWallet = () => {
    if (!(window as InjectedWindow).ethereum) {
      toast.error('MetaMask is not installed. Install it to connect a wallet.')
      window.open('https://metamask.io/download/', '_blank', 'noopener,noreferrer')
      return
    }
    if (metaMaskConnector) connect({ connector: metaMaskConnector })
  }

  const withSigner = async () => {
    const injected = (window as InjectedWindow).ethereum
    if (!isConnected || !injected) throw new Error('Connect MetaMask before submitting a transaction.')
    if (!contractAddress || !isAddress(contractAddress)) throw new Error('Save a valid contract address first.')
    const provider = new BrowserProvider(injected as never)
    return new Contract(contractAddress, CONTRACT_ABI, await provider.getSigner())
  }

  const refreshContract = () => setRefreshVersion((version) => version + 1)

  const updateGraph = (subject: string, attestations: Attestation[], score: number) => {
    setGraphHasLiveData(true)
    setGraphNodes((current) => {
      const next = new Map(current.map((node) => [node.address.toLowerCase(), node]))
      next.set(subject.toLowerCase(), { address: subject, score })
      for (const attestation of attestations) {
        if (!next.has(attestation.issuer.toLowerCase())) next.set(attestation.issuer.toLowerCase(), { address: attestation.issuer, score: 0 })
      }
      return [...next.values()]
    })
    setGraphEdges((current) => {
      const next = [...current]
      for (const attestation of attestations) {
        if (!next.some((edge) => edge.issuer.toLowerCase() === attestation.issuer.toLowerCase() && edge.subject.toLowerCase() === attestation.subject.toLowerCase())) {
          next.push({ issuer: attestation.issuer, subject: attestation.subject })
        }
      }
      return next.slice(-40)
    })
  }

  const loadProfile = async (subject: string, showHistory: boolean) => {
    const normalized = subject.trim()
    if (!isAddress(normalized)) {
      toast.error('Enter a valid wallet address.')
      return
    }
    if (!contractAddress || !isAddress(contractAddress)) {
      toast.error('Save a deployed contract address first.')
      return
    }
    setReadingProfile(true)
    try {
      const contract = new Contract(contractAddress, CONTRACT_ABI, createProvider(isConnected, activeNetwork))
      const [rawScore, rawHistory] = await Promise.all([
        contract.getReputation(normalized),
        contract.getAttestationsOf(normalized),
      ])
      const score = formatScore(BigInt(rawScore.toString()))
      const parsedHistory = Array.from(rawHistory as Iterable<{ issuer: string; subject: string; rating: bigint; jobRef: string; timestamp: bigint }>).map((entry) => ({
        issuer: String(entry.issuer),
        subject: String(entry.subject),
        rating: Number(entry.rating),
        jobRef: String(entry.jobRef),
        timestamp: Number(entry.timestamp),
      }))
      setProfile({ address: getAddress(normalized), score })
      setHistory(parsedHistory)
      setHistoryOpen(showHistory)
      updateGraph(getAddress(normalized), parsedHistory, score)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setReadingProfile(false)
    }
  }

  const handleAnchor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isAddress(anchorAddress.trim())) {
      toast.error('Enter a valid wallet address.')
      return
    }
    if (!ownerIsConnected) {
      toast.error('Only the connected contract owner can add anchors.')
      return
    }
    setPendingAction('anchor')
    try {
      const contract = await withSigner()
      const transaction = await contract.addAnchor(getAddress(anchorAddress.trim()))
      await transaction.wait()
      toast.success('Anchor added to the trust graph')
      setAnchorAddress('')
      refreshContract()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPendingAction(null)
    }
  }

  const handleAttestation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isAddress(subjectAddress.trim())) {
      toast.error('Enter a valid subject wallet address.')
      return
    }
    if (!jobRef.trim()) {
      toast.error('Add a job reference so this attestation has context.')
      return
    }
    setPendingAction('attestation')
    try {
      const contract = await withSigner()
      const transaction = await contract.issueAttestation(getAddress(subjectAddress.trim()), rating, jobRef.trim())
      await transaction.wait()
      toast.success('Attestation added to the graph')
      const subject = getAddress(subjectAddress.trim())
      const issuer = address ? getAddress(address) : ''
      setGraphHasLiveData(true)
      setGraphNodes((current) => {
        const next = new Map(current.map((node) => [node.address.toLowerCase(), node]))
        next.set(subject.toLowerCase(), { address: subject, score: 0 })
        if (issuer) next.set(issuer.toLowerCase(), next.get(issuer.toLowerCase()) ?? { address: issuer, score: 0 })
        return [...next.values()]
      })
      if (issuer) setGraphEdges((current) => [...current, { issuer, subject }].slice(-40))
      setSubjectAddress('')
      setJobRef('')
      refreshContract()
      const readContract = new Contract(contractAddress, CONTRACT_ABI, createProvider(isConnected, activeNetwork))
      const rawScore = await readContract.getReputation(subject)
      const score = formatScore(BigInt(rawScore.toString()))
      setGraphNodes((current) => current.map((node) => node.address.toLowerCase() === subject.toLowerCase() ? { ...node, score } : node))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPendingAction(null)
    }
  }

  const runProfileCheck = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void loadProfile(lookupAddress, false)
  }

  const toggleHistory = () => {
    if (historyOpen && profile?.address.toLowerCase() === lookupAddress.trim().toLowerCase()) {
      setHistoryOpen(false)
      return
    }
    void loadProfile(lookupAddress, true)
  }

  const openMetaMask = () => window.open('https://metamask.io/download/', '_blank', 'noopener,noreferrer')

  return (
    <div className="app-shell">
      <Toaster position="top-right" toastOptions={{ duration: 4200, style: { background: 'rgba(20, 26, 39, .94)', color: '#eef0f3', border: '1px solid rgba(255,255,255,.12)', backdropFilter: 'blur(14px)' } }} />
      <header className="topbar page-width">
        <a className="brand-mark" href="#top" aria-label="TrustGraph home">
          <span className="brand-icon"><ShieldCheck size={19} /></span>
          <span>trust<span>graph</span></span>
          <span className="brand-version">PROTOCOL UI</span>
        </a>
        <nav className="top-nav" aria-label="Main navigation">
          <a href="#network">Network</a>
          <a href="#reputation">Reputation</a>
          <a href="#simulator">Simulator</a>
        </nav>
        <div className="wallet-status" aria-live="polite">
          {isConnected && address ? (
            <>
              <span className="status-dot is-online" />
              <span className="wallet-label">WALLET</span>
              <CopyAddress address={address} />
              <button className="icon-button disconnect-button" type="button" onClick={() => disconnect()} title="Disconnect wallet" aria-label="Disconnect wallet"><X size={14} /></button>
            </>
          ) : (
            <>
              <span className="status-dot" />
              <span className="wallet-label">NOT CONNECTED</span>
              <button className="install-link" type="button" onClick={openMetaMask}>MetaMask <ExternalLink size={12} /></button>
            </>
          )}
        </div>
      </header>

      <main className="page-width">
        <section className="hero-section" id="top">
          <div className="hero-aurora" aria-hidden="true">
            <Aurora colorStops={['#f5a623', '#e85d75', '#70b8aa']} amplitude={0.8} blend={0.34} speed={0.55} />
          </div>
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> DECENTRALIZED WORK, VERIFIED <span className="eyebrow-index">01 / TRUST LAYER</span></div>
            <h1>Reputation that<br /><em>travels with you.</em></h1>
            <p className="hero-description">A weighted trust graph for independent work. Verifiable references, portable credibility, no platform lock-in.</p>
            <div className="hero-actions">
              <ActionButton className="button-primary" onClick={connectWallet} disabled={isConnecting} type="button">
                {isConnecting ? <LoaderCircle className="spin" size={16} /> : <Wallet size={16} />}
                {isConnecting ? 'Connecting...' : isConnected ? 'Wallet connected' : (window as InjectedWindow).ethereum ? 'Connect wallet' : 'Install MetaMask'}
                {!isConnecting && <ArrowRight size={15} />}
              </ActionButton>
              <a className="text-link" href="#network">Explore the network <ArrowDownRight size={14} /></a>
            </div>
            {!((window as InjectedWindow).ethereum) && <button className="metamask-note" onClick={openMetaMask} type="button"><TriangleAlert size={13} /> MetaMask not detected. Install to submit transactions.</button>}
          </div>
          <div className="hero-aside">
            <div className="hero-metric">
              <span className="metric-index">01</span>
              <span className="metric-icon"><Fingerprint size={19} /></span>
              <span className="metric-title">Sybil resistant</span>
              <span className="metric-copy">Trust weighted by the network, not by volume.</span>
            </div>
            <div className="hero-metric">
              <span className="metric-index">02</span>
              <span className="metric-icon"><Network size={19} /></span>
              <span className="metric-title">Wallet native</span>
              <span className="metric-copy">Your work history moves with your address.</span>
            </div>
          </div>
          <div className="hero-footline"><span>ON-CHAIN REPUTATION / ETHEREUM COMPATIBLE</span><span>SCROLL TO EXPLORE <ChevronDown size={13} /></span></div>
        </section>

        <section className="section-block graph-section" id="network">
          <div className="section-heading">
            <div><span className="section-kicker">01 / NETWORK TOPOLOGY</span><h2>Trust, in motion.</h2></div>
            <div className="graph-status"><span className={`status-dot ${graphHasLiveData ? 'is-online' : ''}`} />{graphHasLiveData ? 'LIVE CONTRACT DATA' : 'ILLUSTRATIVE PREVIEW'}</div>
          </div>
          <div className="glass-panel graph-panel">
            <div className="graph-topline"><div><Activity size={15} /><span>{simulationStep > 0 ? 'OFFLINE SYBIL SIMULATION' : graphHasLiveData ? 'ATTESTATION FLOW' : 'SAMPLE NETWORK'}</span></div><span className="graph-count">{simulationStep > 0 ? '5 WALLETS / 0 TRUST' : `${graphNodes.length} NODES / ${graphEdges.length} EDGES`}</span></div>
            <NetworkGraph nodes={graphNodes} edges={graphEdges} simulationStep={simulationStep} onSelect={(selected) => { setLookupAddress(selected); document.querySelector('#reputation')?.scrollIntoView({ behavior: 'smooth' }); void loadProfile(selected, false) }} />
            <div className="graph-legend"><span><i className="legend-dot trusted-dot" /> TRUSTED WALLET</span><span><i className="legend-dot zero-dot" /> ZERO SCORE / UNANCHORED</span><span><i className="legend-line" /> ATTESTATION</span><span className="graph-source-note">{graphHasLiveData ? 'Contract history loaded from wallet lookup' : 'Illustrative sample, not on-chain data'}</span></div>
          </div>
        </section>

        <section className="section-block contract-section" aria-label="Contract actions">
          <div className="section-heading section-heading-compact">
            <div><span className="section-kicker">02 / PARTICIPATE</span><h2>Build the signal.</h2></div>
            <div className="network-select-wrap"><span>READ NETWORK</span><select aria-label="Read network" value={activeNetwork} onChange={(event) => setNetwork(event.target.value as NetworkKey)} disabled={isConnected}><option value="sepolia">Sepolia</option><option value="mainnet">Ethereum</option><option value="base">Base</option></select><ChevronDown size={13} /></div>
          </div>
          <form className="glass-panel contract-address-form" onSubmit={saveContractAddress}>
            <div className="contract-address-copy">
              <span className="panel-icon"><Network size={16} /></span>
              <div><span className="field-label">DEPLOYED CONTRACT</span><span className="contract-help">Paste the deployed address to activate reads and writes.</span></div>
            </div>
            <div className="contract-address-control">
              <input aria-label="Contract address" className="text-input" value={contractInput} onChange={(event) => setContractInput(event.target.value)} placeholder="0x contract address" autoComplete="off" spellCheck={false} />
              <button className="action-button button-secondary" type="submit"><Check size={14} />Save address</button>
            </div>
            {contractAddress && <div className="saved-address"><span>{contractIssue ? 'READ ERROR' : 'SAVED CONTRACT'}</span><CopyAddress address={contractAddress} />{contractIssue && <span className="contract-error-text">{contractIssue}</span>}</div>}
          </form>
          <div className="contract-grid">
            <article className="glass-panel action-panel">
              <div className="panel-topline"><span className="panel-number">A</span><span className="panel-icon"><KeyRound size={17} /></span><span className="panel-state">OWNER CONTROL</span></div>
              <h3>Add an anchor</h3>
              <p className="panel-description">Anchor trusted wallets to raise the cost of fabricated reputation.</p>
              {contractOwner && <div className="owner-line"><span>CONTRACT OWNER</span><CopyAddress address={contractOwner} /></div>}
              {!ownerIsConnected && <div className="permission-note"><LockKeyhole size={14} /><span>{contractOwner ? 'Owner wallet required to add anchors.' : 'Connect the contract owner and save a contract address.'}</span></div>}
              <form className="form-stack" onSubmit={(event) => void handleAnchor(event)}>
                <label className="field-label" htmlFor="anchor-address">WALLET ADDRESS</label>
                <input id="anchor-address" className="text-input" value={anchorAddress} onChange={(event) => setAnchorAddress(event.target.value)} placeholder="0x..." autoComplete="off" spellCheck={false} disabled={!ownerIsConnected || pendingAction !== null} />
                <ActionButton className="button-secondary" disabled={!ownerIsConnected || pendingAction !== null} type="submit">
                  {pendingAction === 'anchor' ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}
                  {pendingAction === 'anchor' ? 'Confirming transaction...' : 'Add anchor'}
                  {pendingAction !== 'anchor' && <ArrowRight size={14} />}
                </ActionButton>
              </form>
            </article>

            <article className="glass-panel action-panel">
              <div className="panel-topline"><span className="panel-number">B</span><span className="panel-icon"><Sparkles size={17} /></span><span className="panel-state">ISSUER SIGNED</span></div>
              <h3>Issue an attestation</h3>
              <p className="panel-description">Leave a weighted, wallet-native reference for completed work.</p>
              <form className="form-stack" onSubmit={(event) => void handleAttestation(event)}>
                <label className="field-label" htmlFor="subject-address">FREELANCER WALLET</label>
                <input id="subject-address" className="text-input" value={subjectAddress} onChange={(event) => setSubjectAddress(event.target.value)} placeholder="0x..." autoComplete="off" spellCheck={false} disabled={!isConnected || !contractAddress || pendingAction !== null} />
                <div className="rating-row"><span className="field-label">WORK QUALITY</span><RatingStars value={rating} onChange={setRating} disabled={!isConnected || !contractAddress || pendingAction !== null} /></div>
                <label className="field-label" htmlFor="job-reference">JOB REFERENCE</label>
                <input id="job-reference" className="text-input" value={jobRef} onChange={(event) => setJobRef(event.target.value)} placeholder="Project, milestone, or invoice ID" maxLength={120} disabled={!isConnected || !contractAddress || pendingAction !== null} />
                <ActionButton className="button-primary" disabled={!isConnected || !contractAddress || pendingAction !== null} type="submit">
                  {pendingAction === 'attestation' ? <LoaderCircle className="spin" size={15} /> : <Zap size={15} />}
                  {pendingAction === 'attestation' ? 'Confirming transaction...' : 'Submit attestation'}
                  {pendingAction !== 'attestation' && <ArrowRight size={14} />}
                </ActionButton>
                {!isConnected && <span className="form-hint">Connect a wallet to issue an attestation.</span>}
              </form>
            </article>
          </div>
        </section>

        <section className="section-block reputation-section" id="reputation">
          <div className="section-heading">
            <div><span className="section-kicker">03 / PROFILE LOOKUP</span><h2>Reputation, earned.</h2></div>
            <span className="score-scale"><span className="scale-dot" /> SCORES RETURNED AT 1e18 SCALE</span>
          </div>
          <article className="glass-panel reputation-panel">
            <div className="lookup-column">
              <div className="panel-topline"><span className="panel-number">C</span><span className="panel-icon"><Fingerprint size={17} /></span><span className="panel-state">PUBLIC PROFILE</span></div>
              <h3>Check a wallet</h3>
              <p className="panel-description">Inspect a freelancer's score and the references behind it.</p>
              <form className="form-stack" onSubmit={runProfileCheck}>
                <label className="field-label" htmlFor="lookup-address">WALLET ADDRESS</label>
                <input id="lookup-address" className="text-input" value={lookupAddress} onChange={(event) => { setLookupAddress(event.target.value); setHistoryOpen(false) }} placeholder="0x..." autoComplete="off" spellCheck={false} />
                <div className="lookup-actions">
                  <ActionButton className="button-secondary" disabled={readingProfile} type="submit">
                    {readingProfile ? <LoaderCircle className="spin" size={15} /> : <Activity size={15} />}
                    {readingProfile ? 'Reading...' : 'Check reputation'}
                  </ActionButton>
                  <button className="history-toggle" type="button" onClick={toggleHistory} disabled={readingProfile} aria-expanded={historyOpen}>
                    {historyOpen ? 'Hide history' : 'View history'} <ChevronDown className={historyOpen ? 'rotate-up' : ''} size={14} />
                  </button>
                </div>
              </form>
            </div>
            <div className="score-column">
              <div className="score-label"><span>WEIGHTED REPUTATION</span><span title="The contract returns a uint256 scaled by 1e18."><CircleHelp size={14} /></span></div>
              {profile ? (
                <>
                  <div className="score-value"><CountUp to={profile.score} from={0} duration={1.35} separator="," /><span className="score-unit">TRUST</span></div>
                  <div className="score-address"><span>WALLET</span><CopyAddress address={profile.address} /></div>
                  <div className="score-bar"><span style={{ width: `${Math.max(0, Math.min(100, profile.score * 10))}%` }} /></div>
                  <span className="score-caption">{profile.score > 0 ? 'Verified signal found in the network.' : 'No weighted reputation recorded.'}</span>
                </>
              ) : (
                <div className="score-empty"><span className="score-placeholder">--</span><span>Enter a wallet to read its score</span></div>
              )}
            </div>
            {historyOpen && <div className="history-section">
              <div className="history-heading"><div><span className="section-kicker">ATTESTATION RECORD</span><h4>Received references <span>{history.length.toString().padStart(2, '0')}</span></h4></div><span className="history-network">READ FROM {NETWORKS[activeNetwork].label.toUpperCase()}</span></div>
              {history.length > 0 ? <div className="table-scroll"><table><thead><tr><th>ISSUER</th><th>RATING</th><th>JOB REFERENCE</th><th>RECORDED</th></tr></thead><tbody>
                {history.map((entry, index) => <tr key={`${entry.issuer}-${entry.timestamp}-${index}`}><td><CopyAddress address={entry.issuer} /></td><td><span className="table-rating">{Array.from({ length: entry.rating }, (_, starIndex) => <Star key={starIndex} size={12} fill="currentColor" />)}</span></td><td className="job-ref-cell">{entry.jobRef || 'No reference'}</td><td>{new Date(entry.timestamp * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>)}
              </tbody></table></div> : <div className="empty-history"><Network size={17} />No attestations found for this wallet.</div>}
            </div>}
          </article>
        </section>

        <section className="section-block simulator-section" id="simulator">
          <div className="section-heading">
            <div><span className="section-kicker">04 / THREAT MODEL</span><h2>Volume is not trust.</h2></div>
            <span className="offline-badge"><span /> OFFLINE DEMO</span>
          </div>
          <article className="glass-panel simulator-panel">
            <div className="sim-copy">
              <div className="sim-icon"><TriangleAlert size={19} /></div>
              <span className="sim-overline">SYBIL ATTACK SIMULATOR</span>
              <h3>Five wallets.<br /><em>Zero reputation.</em></h3>
              <p>Watch a ring of fresh wallets trade perfect ratings. Without trusted anchors, the offline model keeps their score at zero.</p>
              <div className="sim-proof"><span className="proof-mark"><Check size={13} /></span><span>No wallet required</span><span className="proof-divider" /><span>No chain calls</span></div>
              <ActionButton className="button-danger" onClick={() => setSimulationStep(1)} type="button">
                {simulationStep > 0 && simulationStep < 10 ? <LoaderCircle className="spin" size={15} /> : simulationStep === 10 ? <RotateCcw size={15} /> : <Zap size={15} />}
                {simulationStep > 0 && simulationStep < 10 ? 'Simulating ring...' : simulationStep === 10 ? 'Replay simulation' : 'Run offline demo'}
                {simulationStep === 0 && <ArrowRight size={14} />}
              </ActionButton>
            </div>
            <div className={`sim-visual ${simulationStep > 0 ? 'is-running' : ''}`}>
              <div className="sim-visual-head"><span><span className="live-pulse" /> SIMULATION OUTPUT</span><span>{simulationStep > 0 ? `${Math.min(simulationStep, 5)} / 5 NODES` : 'READY'}</span></div>
              <div className="sim-graph-wrap"><NetworkGraph nodes={graphNodes} edges={graphEdges} simulationStep={simulationStep} onSelect={() => undefined} /></div>
              <div className="sim-result"><div><span className="result-label">NETWORK REPUTATION</span><span className="result-value">{simulationStep === 10 ? '0.00' : simulationStep > 0 ? '...' : '--'}</span></div><span className="result-state">{simulationStep === 10 ? 'UNANCHORED' : simulationStep > 0 ? 'MUTUAL RATINGS' : 'AWAITING RUN'}</span></div>
            </div>
          </article>
        </section>
      </main>

      <footer className="stats-footer">
        <div className="page-width footer-inner">
          <div className="footer-brand"><span className="brand-icon"><ShieldCheck size={17} /></span><span>TRUSTGRAPH <i>REPUTATION PROTOCOL</i></span></div>
          <div className="footer-stats">
            <div className="footer-stat"><span className="footer-stat-label">TOTAL ATTESTATIONS</span><span className="footer-stat-value"><CountUp to={totalAttestations} from={0} duration={1} separator="," /></span></div>
            <div className="footer-stat"><span className="footer-stat-label">KNOWN WALLETS</span><span className="footer-stat-value"><CountUp to={totalWallets} from={0} duration={1} separator="," /></span></div>
          </div>
          <div className="footer-network">
            <span className={`status-dot ${contractAddress && !contractIssue ? 'is-online' : ''}`} />
            <span>{contractAddress ? contractIssue ? 'CONTRACT READ ERROR' : NETWORKS[activeNetwork].label.toUpperCase() : 'CONTRACT NOT SET'}</span>
            {contractIssue && <span className="footer-error" title={contractIssue}><CircleHelp size={13} /></span>}
          </div>
        </div>
        <div className="page-width footer-bottom"><span>TRUST IS A GRAPH, NOT A SCORECARD.</span><span>BUILT FOR PEOPLE WHO SHIP.</span></div>
      </footer>
    </div>
  )
}

export default App
