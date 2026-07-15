import { BarChart3, Bot, History, LayoutDashboard, Menu, Moon, Settings, Sun, Users, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { cx } from './ui'

const navigation = [
  ['/', 'Dashboard', LayoutDashboard], ['/recommend', 'Recommend', Bot], ['/buyers', 'Buyers', Users],
  ['/analytics', 'Analytics', BarChart3], ['/history', 'History', History], ['/settings', 'Settings', Settings],
]

export default function AppShell({ children }) {
  const [open, setOpen] = useState(false)
  const { theme, setTheme, systemInfo, loading } = useApp()
  const readiness = systemInfo?.ollama_ready
  const aiStatus = loading && !systemInfo ? 'Checking local AI' : readiness === true ? 'Local AI ready' : readiness === false ? 'Local AI offline' : 'Local AI status unknown'
  const flipTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')
  return <div className="app-shell">
    <button className="mobile-menu btn-icon" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu /></button>
    {open && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside className={cx('sidebar', open && 'sidebar-open')}>
      <div className="brand"><span className="brand-mark" aria-hidden="true"><Bot /></span><div className="brand-copy"><strong>RecomAI</strong><span>Shopping intelligence</span></div><button className="sidebar-close btn-icon" aria-label="Close navigation" onClick={() => setOpen(false)}><X /></button></div>
      <nav aria-label="Primary navigation">{navigation.map(([path, label, Icon]) => <NavLink key={path} to={path} end={path === '/'} onClick={() => setOpen(false)} className={({ isActive }) => cx('nav-link', isActive && 'active')}><Icon size={19}/>{label}</NavLink>)}</nav>
      <div className="sidebar-footer"><div className={cx('status-dot', readiness === false && 'status-offline')}><span/>{aiStatus}</div><button className="nav-link theme-toggle" onClick={flipTheme}>{theme === 'dark' ? <Sun size={19}/> : <Moon size={19}/>}Toggle theme</button></div>
    </aside>
    <main className="main-content">{children}</main>
  </div>
}
