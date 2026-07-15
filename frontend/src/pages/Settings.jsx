import { Bot, Database, GitBranch, Info, Laptop, Moon, Sun } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, ErrorState, PageHeader, PageSkeleton, cx } from '../components/ui'

const themes = [['light','Light',Sun],['dark','Dark',Moon],['system','System',Laptop]]
export default function Settings() {
  const { systemInfo, loading, dataError, refresh, theme, setTheme } = useApp()
  if (loading) return <PageSkeleton />
  if (dataError) return <ErrorState message={dataError} onRetry={refresh}/>
  return <div className="page settings-page"><PageHeader eyebrow="Preferences" title="Settings & about" description="Personalize the interface and review the local AI configuration."/><Card><div className="setting-heading"><span><Sun/></span><div><h2>Appearance</h2><p>Choose how RecomAI looks on this browser.</p></div></div><div className="theme-grid">{themes.map(([value,label,Icon])=><button key={value} className={cx('theme-option',theme===value&&'active')} aria-pressed={theme===value} onClick={()=>setTheme(value)}><Icon/><strong>{label}</strong><span>{value==='system'?'Follow device preference':`${label} interface`}</span></button>)}</div></Card><Card><div className="setting-heading"><span><Bot/></span><div><h2>Local AI configuration</h2><p>Core services used by the assignment workflow.</p></div></div><dl className="details-list"><div><dt><Bot/>Ollama model</dt><dd>{systemInfo?.ollama_model}</dd></div><div><dt><Database/>Memory</dt><dd>{systemInfo?.memory_type}<small>{systemInfo?.memory_location}</small></dd></div><div><dt><Info/>Application version</dt><dd>v{systemInfo?.version}</dd></div></dl></Card><Card className="about-card"><div><p className="eyebrow">About</p><h2>Built for explainable local recommendations.</h2><p>RecomAI is a portfolio-quality presentation of a modular agent assignment. Buyer data, recommendations, simulated transactions, and memory remain on your machine.</p></div><a className="btn btn-secondary" href="https://github.com" target="_blank" rel="noreferrer"><GitBranch size={17}/>GitHub portfolio</a></Card></div>
}
