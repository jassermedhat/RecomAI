import { ArrowRight, Bot, DollarSign, ShoppingBag, Sparkles, Tags, Users } from 'lucide-react'
import { motion } from 'framer-motion'
import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Badge, Card, dateTime, EmptyState, ErrorState, formatCategory, money, PageHeader, PageSkeleton } from '../components/ui'

const workflowSteps = ['Buyer input', 'AI recommendation', 'Catalog search', 'Ranked products', 'Manual purchase', 'Memory update']

export default function Dashboard() {
  const { buyers, history, loading, dataError, refresh } = useApp()
  if (loading) return <PageSkeleton />
  if (dataError) return <ErrorState message={dataError} onRetry={refresh} />
  const knownPurchases = buyers.flatMap((buyer) => buyer.purchase_history || [])
  const spend = knownPurchases.map((item) => item.price || 0)
  const categories = knownPurchases.reduce((all, item) => { const key = item.category; if (key) all[key] = (all[key] || 0) + 1; return all }, {})
  const favorite = Object.entries(categories).sort((a, b) => b[1] - a[1])[0]?.[0]
  const latest = history[0]
  const kpis = [
    ['Total purchases', knownPurchases.length, ShoppingBag, 'Known across buyer histories'],
    ['Average spending', money(spend.length ? spend.reduce((a,b) => a+b, 0) / spend.length : 0), DollarSign, 'Across known purchases'],
    ['Favorite category', favorite ? formatCategory(favorite) : 'No data', Tags, 'Most purchased'],
    ['Active buyers', buyers.filter((buyer) => buyer.interaction_count > 0).length, Users, `${buyers.length} profiles available`],
  ]
  return <div className="page"><PageHeader eyebrow="Local AI workspace" title="Welcome back" description="Turn buyer history into explainable recommendations and track every simulated purchase." action={<Link className="btn btn-primary" to="/recommend"><Sparkles size={17}/>New recommendation</Link>} />
    <motion.section initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: .06 } } }} className="kpi-grid">{kpis.map(([label, value, Icon, note]) => <motion.div variants={{ hidden:{opacity:0,y:8},show:{opacity:1,y:0} }} key={label}><Card className="kpi-card"><span className="kpi-icon"><Icon/></span><p>{label}</p><strong>{value}</strong><small>{note}</small></Card></motion.div>)}</motion.section>
    <div className="dashboard-grid"><Card className="hero-card"><div className="hero-glow"/><Badge tone="accent"><Bot size={14}/>Powered by Ollama</Badge><h2>Personalized shopping,<br/>with reasoning you can inspect.</h2><p>Submit buyer history, review the ranked choices, then manually purchase the product you want.</p><Link className="text-link" to="/recommend">Open AI workspace <ArrowRight size={16}/></Link></Card>
      <Card><div className="section-heading"><div><p className="eyebrow">Recent activity</p><h2>Latest purchase</h2></div><Link className="text-link" to="/history">View all</Link></div>{latest ? <div className="recent-purchase"><span className="product-avatar">{latest.purchased_product.product.slice(0,1)}</span><div><strong>{latest.purchased_product.product}</strong><p>{latest.user_id} · {formatCategory(latest.purchased_product.category)}</p><small>{dateTime(latest.transaction.purchased_at)}</small></div><strong>{money(latest.purchased_product.price)}</strong></div> : <EmptyState title="No purchases yet" description="Run the first recommendation to populate your dashboard." />}</Card>
    </div>
    <Card><div className="section-heading"><div><p className="eyebrow">Quick start</p><h2>From buyer input to remembered purchase</h2></div></div><div className="workflow-strip">{workflowSteps.map((item, index) => <Fragment key={item}><div><span>{index + 1}</span><p>{item}</p></div>{index < workflowSteps.length - 1 && <ArrowRight className="workflow-arrow" aria-hidden="true"/>}</Fragment>)}</div></Card>
  </div>
}
