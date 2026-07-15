import { Download, FileJson, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { shoppingApi } from '../api'
import { useApp } from '../context/AppContext'
import { Badge, Card, dateTime, EmptyState, ErrorState, formatCategory, money, PageHeader, PageSkeleton } from '../components/ui'

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url)
  toast.success('Export complete', { description: name })
}

export default function History() {
  const { history, loading, dataError, refresh } = useApp()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('newest')
  const [deleting, setDeleting] = useState(null)
  const categories = [...new Set(history.map((item) => item.purchased_product.category))]
  const filtered = useMemo(() => history.filter((item) => {
    const haystack = `${item.user_id} ${item.purchased_product.product} ${item.recommendation.category}`.toLowerCase()
    return haystack.includes(query.toLowerCase()) && (category === 'all' || item.purchased_product.category === category)
  }).sort((a,b) => (sort === 'newest' ? -1 : 1) * a.transaction.purchased_at.localeCompare(b.transaction.purchased_at)), [history, query, category, sort])
  if (loading) return <PageSkeleton />
  if (dataError) return <ErrorState message={dataError} onRetry={refresh}/>
  const exportJson = () => download('recommendation-history.json', JSON.stringify(filtered, null, 2), 'application/json')
  const exportCsv = () => {
    const rows = [['transaction_id','buyer','product','category','price','purchased_at'], ...filtered.map((item) => [item.transaction.transaction_id,item.user_id,item.purchased_product.product,item.purchased_product.category,item.purchased_product.price,item.transaction.purchased_at])]
    download('purchase-history.csv', rows.map((row)=>row.map((cell)=>`"${String(cell).replaceAll('"','""')}"`).join(',')).join('\n'), 'text/csv')
  }
  async function remove(item) {
    try { await shoppingApi.deleteHistory(item.user_id, item.transaction.transaction_id); setDeleting(null); await refresh(); toast.success('History updated') }
    catch (error) { toast.error('Delete failed', { description:error.message }) }
  }
  return <div className="page"><PageHeader eyebrow="Activity" title="Recommendation history" description="Search, inspect, export, or remove individual simulated transactions." action={<div className="button-row"><button className="btn btn-secondary" onClick={exportJson}><FileJson size={17}/>Export JSON</button><button className="btn btn-secondary" onClick={exportCsv}><Download size={17}/>Purchase CSV</button></div>}/><Card className="filter-bar"><label className="search-box"><Search/><span className="sr-only">Search history</span><input placeholder="Search buyer, product, or category…" value={query} onChange={(event)=>setQuery(event.target.value)}/></label><label><SlidersHorizontal/><span className="sr-only">Filter category</span><select value={category} onChange={(event)=>setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((item)=><option value={item} key={item}>{formatCategory(item)}</option>)}</select></label><label><span className="sr-only">Sort order</span><select value={sort} onChange={(event)=>setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></Card>{filtered.length ? <div className="timeline">{filtered.map((item) => <Card className="timeline-item" key={item.transaction.transaction_id}><span className="timeline-dot"/><div className="timeline-date"><strong>{dateTime(item.transaction.purchased_at)}</strong><span>{item.user_id}</span></div><div className="timeline-content"><div><Badge tone="accent">{formatCategory(item.recommendation.category)}</Badge><h2>{item.purchased_product.product}</h2><p>{item.recommendation.reason}</p></div><div className="timeline-purchase"><strong>{money(item.purchased_product.price)}</strong><small>{item.recommendation_metrics ? `${item.recommendation_metrics.confidence}% confidence · ${(item.recommendation_metrics.thinking_duration_ms/1000).toFixed(2)}s` : 'Legacy record · timing not recorded'}</small></div></div><button className="btn-icon danger" aria-label={`Delete ${item.transaction.transaction_id}`} onClick={()=>setDeleting(item)}><Trash2/></button></Card>)}</div> : <EmptyState title="No matching history" description="Adjust the filters or generate a new recommendation."/>}{deleting && <div className="dialog-backdrop" onMouseDown={()=>setDeleting(null)}><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event)=>event.stopPropagation()}><span className="danger-icon"><Trash2/></span><h2 id="delete-title">Delete this interaction?</h2><p>This removes transaction {deleting.transaction.transaction_id} and rebuilds the buyer’s latest memory snapshot.</p><div className="button-row"><button className="btn btn-secondary" onClick={()=>setDeleting(null)}>Cancel</button><button className="btn btn-danger" onClick={()=>remove(deleting)}>Delete interaction</button></div></div></div>}</div>
}
