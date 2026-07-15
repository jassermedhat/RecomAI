import { Pin, Search, ShoppingBag, Sparkles, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Badge, Card, ErrorState, formatCategory, money, PageHeader, PageSkeleton } from '../components/ui'

export default function Buyers() {
  const { buyers, loading, dataError, refresh, pins, togglePin } = useApp()
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => buyers.filter((buyer) => buyer.user_id.toLowerCase().includes(query.toLowerCase())).sort((a,b) => Number(pins.includes(b.user_id))-Number(pins.includes(a.user_id))), [buyers, query, pins])
  if (loading) return <PageSkeleton />
  if (dataError) return <ErrorState message={dataError} onRetry={refresh}/>
  return <div className="page"><PageHeader eyebrow="Buyer management" title="Buyer profiles" description="Search sample and returning buyers, pin frequent profiles, and understand their spending patterns." action={<Link className="btn btn-primary" to="/recommend"><Sparkles size={17}/>Recommend</Link>}/><label className="search-box"><Search/><span className="sr-only">Search buyers</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by buyer ID…"/></label><div className="buyer-grid">{filtered.map((buyer) => <Card className="buyer-card" key={buyer.user_id}><div className="buyer-head"><span className="buyer-avatar"><UserRound/></span><div><h2>{buyer.user_id}</h2><div>{buyer.is_sample && <Badge>Sample</Badge>}{buyer.interaction_count > 0 && <Badge tone="success">Returning</Badge>}</div></div><button className="btn-icon" aria-label={`${pins.includes(buyer.user_id) ? 'Unpin' : 'Pin'} ${buyer.user_id}`} aria-pressed={pins.includes(buyer.user_id)} onClick={() => togglePin(buyer.user_id)}><Pin className={pins.includes(buyer.user_id) ? 'filled' : ''}/></button></div><div className="buyer-stats"><div><span>Purchases</span><strong>{buyer.purchase_count}</strong></div><div><span>Average spend</span><strong>{money(buyer.average_spending)}</strong></div></div><div className="buyer-favorite"><ShoppingBag/><div><span>Favorite category</span><strong>{buyer.favorite_category ? formatCategory(buyer.favorite_category) : 'Still discovering'}</strong></div></div></Card>)}</div>{!filtered.length && <Card className="empty-state"><Search/><h2>No buyers found</h2><p>Try a different buyer ID.</p></Card>}</div>
}
