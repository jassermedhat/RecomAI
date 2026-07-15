import BuyerInput from '../components/BuyerInput'
import WorkflowResult from '../components/WorkflowResult'
import { PageHeader } from '../components/ui'
import { useApp } from '../context/AppContext'
import { useEffect, useRef } from 'react'

export default function Recommend() {
  const { result, setResult } = useApp()
  const resultRef = useRef(null)
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [result])
  return <div className="page"><PageHeader eyebrow="AI recommendation" title="Shopping workspace" description="Generate ranked choices, then manually purchase only the product you select."/><div className="recommend-layout"><BuyerInput onResult={setResult} onInputChange={() => setResult(null)}/><div className="result-anchor" ref={resultRef}><WorkflowResult result={result}/></div></div></div>
}
