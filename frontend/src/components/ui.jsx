import { AlertTriangle, RefreshCw } from 'lucide-react'

export const cx = (...classes) => classes.filter(Boolean).join(' ')
export const formatCategory = (value = '') => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
export const money = (value = 0) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
export const dateTime = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not recorded'

export function Card({ className, children, ...props }) {
  return <section className={cx('card', className)} {...props}>{children}</section>
}
export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
export function PageHeader({ eyebrow, title, description, action }) {
  return <header className="page-header">
    <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}
  </header>
}
export function EmptyState({ icon: Icon = AlertTriangle, title, description, action }) {
  return <Card className="empty-state"><Icon /><h2>{title}</h2><p>{description}</p>{action}</Card>
}
export function ErrorState({ message, onRetry }) {
  const ollama = /unavailable|offline|could not run model|start ollama|503/i.test(message)
  const recommendation = /ollama|recommend|category/i.test(message)
  const storage = /memory|catalog|storage|json/i.test(message)
  const title = ollama ? 'Ollama is offline' : storage ? 'Local data needs attention' : recommendation ? 'Recommendation needs another try' : 'We could not complete that'
  const guidance = ollama ? 'Start Ollama and confirm the configured model is installed.' : recommendation ? 'The model response was rejected before any purchase or memory update.' : 'Your existing data has not been changed.'
  return <Card className="error-state" role="alert"><AlertTriangle /><div><h2>{title}</h2><p>{message}</p><p className="muted">{guidance}</p></div>{onRetry && <button className="btn btn-secondary" onClick={onRetry}><RefreshCw size={16} />Retry</button>}</Card>
}
export function PageSkeleton() {
  return <div aria-label="Loading page" className="skeleton-page"><div className="skeleton h-10 w-64"/><div className="kpi-grid">{[1,2,3,4].map((i) => <div className="skeleton h-32" key={i}/>)}</div><div className="skeleton h-80"/></div>
}
