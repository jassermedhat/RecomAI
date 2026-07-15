import { BarChart3 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApp } from '../context/AppContext'
import { Card, EmptyState, ErrorState, formatCategory, money, PageHeader, PageSkeleton } from '../components/ui'

const colors = ['#10b981','#14b8a6','#6366f1','#f59e0b','#f43f5e']
export default function Analytics() {
  const { buyers, history, loading, dataError, refresh } = useApp()
  if (loading) return <PageSkeleton />
  if (dataError) return <ErrorState message={dataError} onRetry={refresh}/>
  const knownPurchases = buyers.flatMap((buyer) => buyer.purchase_history || [])
  if (!knownPurchases.length) return <div className="page"><PageHeader eyebrow="Analytics" title="Purchase intelligence" description="Trends appear when buyer purchase history is available."/><EmptyState icon={BarChart3} title="No analytics yet" description="Add buyer history or complete a purchase to generate insights."/></div>
  const categoryMap = knownPurchases.reduce((all,item) => { const key=formatCategory(item.category); all[key]=(all[key]||0)+1; return all },{})
  const categories = Object.entries(categoryMap).map(([name,value]) => ({name,value}))
  const timeline = [...history].reverse().map((item) => ({ name: new Date(item.transaction.purchased_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}), spending:item.purchased_product.price }))
  const avg = knownPurchases.reduce((sum,item)=>sum+item.price,0)/knownPurchases.length
  return <div className="page"><PageHeader eyebrow="Analytics" title="Purchase intelligence" description="A clear view of all known buyer purchases and dated app transactions."/><div className="analytics-summary"><Card><span>Total volume</span><strong>{money(knownPurchases.reduce((sum,item)=>sum+item.price,0))}</strong></Card><Card><span>Average spending</span><strong>{money(avg)}</strong></Card><Card><span>Total purchases</span><strong>{knownPurchases.length} known</strong></Card></div><div className="chart-grid"><Card className="chart-card"><div><p className="eyebrow">Recorded transactions</p><h2>App purchases over time</h2><p>{history.length} dated transaction(s)</p></div><ResponsiveContainer width="100%" height={290}><BarChart data={timeline}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name"/><YAxis/><Tooltip formatter={(value)=>money(value)}/><Bar dataKey="spending" fill="#10b981" radius={[8,8,0,0]} isAnimationActive={false}/></BarChart></ResponsiveContainer></Card><Card className="chart-card"><div><p className="eyebrow">All known purchases</p><h2>Purchase distribution</h2></div><ResponsiveContainer width="100%" height={240}><PieChart><Pie data={categories} dataKey="value" nameKey="name" innerRadius={62} outerRadius={90} paddingAngle={4} isAnimationActive={false}>{categories.map((item,index)=><Cell key={item.name} fill={colors[index%colors.length]}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer><div className="chart-legend">{categories.map((item,index)=><div key={item.name}><span style={{background:colors[index%colors.length]}}/><p>{item.name}</p><strong>{item.value}</strong></div>)}</div></Card></div></div>
}
