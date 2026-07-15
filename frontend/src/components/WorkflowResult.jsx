import { Check, ChevronDown, GitCompareArrows, Info, ShoppingBag, Sparkles, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { shoppingApi } from '../api'
import { useApp } from '../context/AppContext'
import { Badge, Card, cx, dateTime, formatCategory, money } from './ui'

const imageFor = (id) => `/products/${id.toLowerCase()}.png`

function ProductImage({ product }) {
  return <div className="product-image"><img src={imageFor(product.product_id)} alt="" onError={(event) => { event.currentTarget.style.display = 'none' }}/><span>{product.product.slice(0, 1)}</span></div>
}

function CompareDialog({ products, scores, onClose }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><motion.div initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} className="dialog" role="dialog" aria-modal="true" aria-labelledby="compare-title" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-header"><div><p className="eyebrow">Side-by-side</p><h2 id="compare-title">Compare products</h2></div><button autoFocus className="btn-icon" aria-label="Close comparison" onClick={onClose}><X/></button></div><div className="table-wrap"><table><thead><tr><th>Product</th>{products.map((product) => <th key={product.product_id}><ProductImage product={product}/>{product.product}</th>)}</tr></thead><tbody><tr><th>Price</th>{products.map((product) => <td key={product.product_id}>{money(product.price)}</td>)}</tr><tr><th>Category</th>{products.map((product) => <td key={product.product_id}>{formatCategory(product.category)}</td>)}</tr><tr><th>Mean-price match</th>{products.map((product) => <td key={product.product_id}>{scores[product.product_id] == null ? '—' : `${scores[product.product_id]}%`}</td>)}</tr><tr><th>Features</th>{products.map((product) => <td key={product.product_id}><ul>{(product.features || []).map((feature) => <li key={feature}>{feature}</li>)}</ul></td>)}</tr></tbody></table></div></motion.div></div>
}

export default function WorkflowResult({ result }) {
  const { refresh } = useApp()
  const [selected, setSelected] = useState([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [reasoningOpen, setReasoningOpen] = useState(true)
  const [purchaseResult, setPurchaseResult] = useState(null)
  const [purchasingId, setPurchasingId] = useState('')

  useEffect(() => {
    setPurchaseResult(null)
    setSelected([])
  }, [result])

  if (!result) return <Card className="empty-result"><div className="empty-result-icon"><Sparkles/></div><h2>Your recommendation will appear here</h2><p>Submit a buyer profile to see AI reasoning and ranked products, then choose what to purchase.</p></Card>

  const { recommendation, ranked_products: products, warnings, recommendation_metrics: metrics } = result
  const purchased = purchaseResult?.selected_product
  const purchase = purchaseResult?.purchase
  const memory = purchaseResult?.memory
  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const compared = products.filter((product) => selected.includes(product.product_id))

  const buy = async (product) => {
    setPurchasingId(product.product_id)
    try {
      const completed = await shoppingApi.purchase(result, product.product_id)
      setPurchaseResult(completed)
      toast.success('Purchase complete', { description: completed.message })
      await refresh()
    } catch (error) {
      toast.error('Purchase failed', { description: error.message })
    } finally {
      setPurchasingId('')
    }
  }

  return <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="stack-lg" aria-live="polite">
    {purchaseResult && <Card className="success-banner"><span className="success-icon"><Check/></span><div><p className="eyebrow">Purchase complete</p><h2>{purchased.product}</h2><p>Transaction {purchase.transaction_id} · {dateTime(purchase.purchased_at)}</p></div><Badge tone="success">Memory updated</Badge></Card>}
    {(warnings || []).map((warning) => <div key={warning} className="warning"><Info/>{warning}</div>)}
    <Card><div className="recommendation-head"><div><p className="eyebrow">AI recommendation</p><h2>{formatCategory(recommendation.category)}</h2><p className="analyzed-buyer">Analyzed buyer: <strong>{result.buyer?.user_id}</strong> · {result.buyer?.history?.length ?? 0} purchase(s) in recalled history</p></div><div className="confidence"><strong>{metrics?.confidence ?? '—'}%</strong><span>Engineering confidence</span></div></div><div className="metrics-row"><span>Generated {dateTime(metrics?.generated_at)}</span><span>{metrics ? `${(metrics.thinking_duration_ms / 1000).toFixed(2)}s thinking` : 'Thinking time not recorded'}</span></div><button className="reason-toggle" aria-expanded={reasoningOpen} onClick={() => setReasoningOpen(!reasoningOpen)}><Sparkles size={17}/>Why this recommendation?<ChevronDown className={cx(reasoningOpen && 'rotate')}/></button><AnimatePresence>{reasoningOpen && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="reasoning"><p>{recommendation.reason}</p><small>{metrics?.confidence_basis}</small><small className="memory-hint">A manual purchase updates this buyer's memory and influences their next recommendation.</small></motion.div>}</AnimatePresence></Card>
    <Card><div className="section-heading"><div><p className="eyebrow">Top catalog matches</p><h2>Ranked for this buyer</h2><p>Compare the options, then manually purchase the product you want.</p></div>{selected.length >= 2 && <button className="btn btn-secondary" onClick={() => setCompareOpen(true)}><GitCompareArrows size={17}/>Compare {selected.length}</button>}</div><div className="product-grid">{products.map((product, index) => {
      const isPurchased = product.product_id === purchased?.product_id
      const checked = selected.includes(product.product_id)
      const priceMatch = metrics?.product_match_scores?.[product.product_id]
      return <article key={product.product_id} className={cx('product-card', isPurchased && 'recommended')}><div className="product-art"><ProductImage product={product}/><Badge tone={isPurchased ? 'success' : 'neutral'}>#{index + 1} match</Badge></div><div className="product-body"><div className="product-title"><div><p>{formatCategory(product.category)}</p><h3>{product.product}</h3></div><strong>{money(product.price)}</strong></div><div className="feature-chips">{(product.features || []).slice(0, 2).map((feature) => <span key={feature}>{feature}</span>)}</div><div className="match-row"><span>Mean-price match</span><strong>{priceMatch == null ? '—' : `${priceMatch}%`}</strong></div><div className="product-actions"><button className={cx('btn', checked ? 'btn-primary' : 'btn-secondary')} aria-pressed={checked} onClick={() => toggle(product.product_id)}><GitCompareArrows size={16}/>{checked ? 'Selected' : 'Compare'}</button><button className={cx('btn', isPurchased ? 'btn-success' : 'btn-primary')} disabled={Boolean(purchaseResult) || Boolean(purchasingId)} onClick={() => buy(product)}><ShoppingBag size={16}/>{isPurchased ? 'Purchased' : purchasingId === product.product_id ? 'Purchasing…' : 'Purchase'}</button></div></div></article>
    })}</div></Card>
    {memory && <Card className="memory-card"><div><p className="eyebrow">Local memory</p><h2>{memory.purchase_history.length} purchases remembered</h2><p>Buyer {memory.user_id} now has the selected product and transaction saved in local JSON memory.</p></div><span className="memory-pulse"/></Card>}
    {compareOpen && <CompareDialog products={compared} scores={metrics?.product_match_scores || {}} onClose={() => setCompareOpen(false)} />}
  </motion.section>
}
