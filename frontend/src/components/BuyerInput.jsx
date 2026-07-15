import { Check, Clipboard, FileJson, LoaderCircle, Plus, Sparkles, Trash2, Upload, UserPlus, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { shoppingApi } from '../api'
import { Card, cx, ErrorState } from './ui'

const example = JSON.stringify({
  user_id: 'A123',
  history: [
    { product: 'Bluetooth headphones', category: 'electronics', price: 120 },
    { product: 'Running shoes', category: 'sportswear', price: 80 },
  ],
}, null, 2)
const tabs = [['guided', 'Guided form', UserPlus], ['paste', 'Paste JSON', FileJson], ['upload', 'Upload file', Upload], ['sample', 'Sample buyer', Users]]
const stages = ['LLM analyzing buyer history', 'LLM choosing a new category', 'Searching matching catalog products', 'Ranking product choices']
const blankPurchase = () => ({ product: '', category: '', price: '' })
const savedBuyersKey = 'asa-saved-buyers'

function savedBuyers() {
  try {
    const value = JSON.parse(localStorage.getItem(savedBuyersKey) || '[]')
    return Array.isArray(value) ? value.filter((buyer) => buyer?.user_id && Array.isArray(buyer.history)) : []
  } catch {
    return []
  }
}

function mergeBuyers(...groups) {
  const merged = new Map()
  groups.flat().forEach((buyer) => merged.set(buyer.user_id, buyer))
  return [...merged.values()]
}

export default function BuyerInput({ onResult, onInputChange }) {
  const [mode, setMode] = useState('guided')
  const [text, setText] = useState(example)
  const [file, setFile] = useState(null)
  const [samples, setSamples] = useState(savedBuyers)
  const [sampleId, setSampleId] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState(0)
  const [error, setError] = useState('')
  const [guidedId, setGuidedId] = useState('')
  const [hasHistory, setHasHistory] = useState(true)
  const [guidedHistory, setGuidedHistory] = useState([blankPurchase()])
  const timer = useRef(null)

  useEffect(() => {
    shoppingApi.samples().then((data) => {
      const merged = mergeBuyers(savedBuyers(), data)
      setSamples(merged)
      setSampleId((current) => current || merged[0]?.user_id || '')
    }).catch((err) => {
      const saved = savedBuyers()
      setSamples(saved)
      setSampleId((current) => current || saved[0]?.user_id || '')
      setError(err.message)
    })
    return () => clearInterval(timer.current)
  }, [])

  const guidedBuyer = () => ({
    user_id: guidedId.trim(),
    history: hasHistory ? guidedHistory.map((item) => ({
      product: item.product.trim(), category: item.category.trim(), price: Number(item.price),
    })) : [],
  })

  function updatePurchase(index, field, value) {
    onInputChange?.()
    setGuidedHistory((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  }

  function changeInput(update) {
    onInputChange?.()
    setError('')
    update()
  }

  function saveBuyer(buyer) {
    const saved = mergeBuyers(savedBuyers(), [buyer])
    localStorage.setItem(savedBuyersKey, JSON.stringify(saved))
    setSamples((current) => mergeBuyers(current, [buyer]))
    setSampleId(buyer.user_id)
  }

  async function copyGuidedJson() {
    if (!guidedId.trim()) { setError('Enter a buyer ID before copying the JSON.'); return }
    await navigator.clipboard.writeText(JSON.stringify(guidedBuyer(), null, 2))
    toast.success('Buyer JSON copied')
  }

  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true); setStage(0)
    timer.current = setInterval(() => setStage((current) => Math.min(current + 1, stages.length - 1)), 900)
    try {
      let result
      if (mode === 'guided') {
        if (!guidedId.trim()) throw new Error('Answer the buyer ID question first.')
        if (samples.some((buyer) => buyer.user_id.toLocaleLowerCase() === guidedId.trim().toLocaleLowerCase())) {
          throw new Error(`Buyer ID ${guidedId.trim()} already exists. Enter a unique buyer ID.`)
        }
        if (hasHistory && guidedHistory.some((item) => !item.product.trim() || !item.category.trim() || item.price === '' || !Number.isFinite(Number(item.price)) || Number(item.price) < 0)) {
          throw new Error('Complete every purchase with a product, category, and valid non-negative price.')
        }
        const buyer = guidedBuyer()
        saveBuyer(buyer)
        result = await shoppingApi.process(buyer)
      } else if (mode === 'paste') {
        let buyer
        try { buyer = JSON.parse(text) } catch { throw new Error('Paste valid JSON before submitting.') }
        result = await shoppingApi.process(buyer)
      } else if (mode === 'upload') {
        if (!file) throw new Error('Choose a buyer JSON file first.')
        result = await shoppingApi.upload(file)
      } else {
        const buyer = samples.find((item) => item.user_id === sampleId)
        if (!buyer) throw new Error('Choose a sample buyer first.')
        result = await shoppingApi.process(buyer)
      }
      setStage(stages.length - 1)
      await onResult(result)
    } catch (err) {
      setError(err.message); toast.error('Recommendation failed', { description: err.message })
    } finally { clearInterval(timer.current); setBusy(false) }
  }

  if (busy) return <Card className="workflow-loader" aria-live="polite" aria-busy="true"><div className="thinking-orb"><Sparkles/></div><p className="eyebrow">AI workflow in progress</p><h2>{stages[stage]}</h2><div className="stage-list">{stages.map((label, index) => <div key={label} className={cx('stage-item', index <= stage && 'done', index === stage && 'current')} aria-current={index === stage ? 'step' : undefined}><span className="stage-marker">{index < stage ? <Check/> : index === stage ? <LoaderCircle className="spin"/> : index + 1}</span><p>{label}</p></div>)}</div><p className="muted">No purchase is made until you choose a product.</p></Card>

  return <div className="stack-lg">
    {error && <ErrorState message={error} />}
    <Card className="input-card"><div className="section-heading"><div><p className="eyebrow">Buyer input</p><h2>Start a recommendation</h2><p>Use purchase history to discover a new catalog category.</p></div><Sparkles className="accent-icon" /></div>
      <div className="tabs input-tabs" role="tablist" aria-label="Buyer input method">{tabs.map(([key, label, Icon]) => <button type="button" role="tab" aria-selected={mode === key} key={key} className={cx('tab', mode === key && 'active')} onClick={() => changeInput(() => setMode(key))}><Icon size={17}/>{label}</button>)}</div>
      <form onSubmit={submit} className="form-stack">
        {mode === 'guided' && <div className="guided-form">
          <label><span>1. What is this buyer's ID?</span><input aria-label="Guided buyer ID" value={guidedId} onChange={(event) => changeInput(() => setGuidedId(event.target.value))} placeholder="Example: D204" maxLength="100" /></label>
          <fieldset><legend>2. Does this buyer have previous purchases?</legend><div className="choice-row"><label><input type="radio" name="has-history" checked={hasHistory} onChange={() => changeInput(() => setHasHistory(true))} />Yes</label><label><input type="radio" name="has-history" checked={!hasHistory} onChange={() => changeInput(() => setHasHistory(false))} />No, this is a new buyer</label></div></fieldset>
          {hasHistory && <fieldset className="purchase-builder"><legend>3. What have they purchased?</legend>{guidedHistory.map((item, index) => <div className="purchase-entry" key={index}><div className="purchase-entry-head"><strong>Purchase {index + 1}</strong>{guidedHistory.length > 1 && <button type="button" className="btn-icon danger" aria-label={`Remove purchase ${index + 1}`} onClick={() => changeInput(() => setGuidedHistory((current) => current.filter((_, itemIndex) => itemIndex !== index)))}><Trash2 size={16}/></button>}</div><label><span>Product name</span><input value={item.product} onChange={(event) => updatePurchase(index, 'product', event.target.value)} placeholder="Wireless headphones" /></label><div className="guided-row"><label><span>Category</span><input value={item.category} onChange={(event) => updatePurchase(index, 'category', event.target.value)} placeholder="electronics" /></label><label><span>Price (USD)</span><input type="number" min="0" step="0.01" value={item.price} onChange={(event) => updatePurchase(index, 'price', event.target.value)} placeholder="120" /></label></div></div>)}<button type="button" className="btn btn-secondary add-purchase" onClick={() => changeInput(() => setGuidedHistory((current) => [...current, blankPurchase()]))}><Plus size={16}/>Add another purchase</button></fieldset>}
          <div className="json-preview"><div><span>Generated JSON preview</span><button type="button" className="btn-icon" aria-label="Copy generated buyer JSON" onClick={copyGuidedJson}><Clipboard size={16}/></button></div><pre>{JSON.stringify(guidedBuyer(), null, 2)}</pre></div>
        </div>}
        {mode === 'paste' && <label><span>Buyer JSON</span><textarea value={text} onChange={(event) => changeInput(() => setText(event.target.value))} rows="12" spellCheck="false" /></label>}
        {mode === 'upload' && <label className="upload-zone"><Upload/><strong>Choose a JSON buyer profile</strong><span>{file?.name || 'Maximum file size: 1 MB'}</span><input aria-label="Buyer JSON file" type="file" accept="application/json,.json" onChange={(event) => changeInput(() => setFile(event.target.files?.[0] || null))}/></label>}
        {mode === 'sample' && <label><span>Sample or saved buyer</span><select value={sampleId} onChange={(event) => changeInput(() => setSampleId(event.target.value))}>{samples.map((buyer) => <option key={buyer.user_id} value={buyer.user_id}>{buyer.user_id} — {buyer.history.length} prior purchases</option>)}</select></label>}
        <button className="btn btn-primary btn-large"><Sparkles size={18}/>{mode === 'guided' ? 'Create JSON and analyze' : 'Analyze recommendations'}</button>
      </form>
    </Card>
  </div>
}
