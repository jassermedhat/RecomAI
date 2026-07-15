import BuyerInput from '../components/BuyerInput'
import WorkflowResult from '../components/WorkflowResult'
import { Badge, Card, formatCategory, money, PageHeader } from '../components/ui'
import { useApp } from '../context/AppContext'
import { ShoppingBag } from 'lucide-react'
import { useEffect, useRef } from 'react'

function BuyerHistoryCard({ buyer }) {
  if (!buyer) return null
  const history = buyer.history || []
  return <Card className="buyer-history-card" aria-label={`Purchase history used for ${buyer.user_id}`}>
    <div className="buyer-history-heading"><span><ShoppingBag size={18}/></span><div><p className="eyebrow">Buyer history used</p><h2>Actual purchases</h2><p>{buyer.user_id} · {history.length} recalled purchase(s)</p></div></div>
    {history.length > 0 ? <div className="buyer-history-list">{history.map((item, index) => <div className="buyer-history-item" key={`${item.product}-${item.category}-${item.price}-${index}`}><span className="buyer-history-number">{index + 1}</span><div className="buyer-history-details"><strong>{item.product}</strong><Badge>{formatCategory(item.category)}</Badge></div><strong className="buyer-history-price">{money(item.price)}</strong></div>)}</div> : <p className="buyer-history-empty">No previous purchases were supplied or recalled for this buyer.</p>}
  </Card>
}

export default function Recommend() {
  const { result, setResult } = useApp()
  const resultRef = useRef(null)
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [result])
  return <div className="page"><PageHeader eyebrow="AI recommendation" title="Shopping workspace" description="Generate ranked choices, then manually purchase only the product you select."/><div className="recommend-layout"><div className="buyer-input-column"><BuyerInput onResult={setResult} onInputChange={() => setResult(null)}/><BuyerHistoryCard buyer={result?.buyer}/></div><div className="result-anchor" ref={resultRef}><WorkflowResult result={result}/></div></div></div>
}
