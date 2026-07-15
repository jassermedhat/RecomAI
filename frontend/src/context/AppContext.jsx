import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { shoppingApi } from '../api'

const AppContext = createContext(null)

function storedPins() {
  try {
    const value = JSON.parse(localStorage.getItem('asa-pins') || '[]')
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : []
  } catch {
    return []
  }
}

export function AppProvider({ children }) {
  const [buyers, setBuyers] = useState([])
  const [history, setHistory] = useState([])
  const [systemInfo, setSystemInfo] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState('')
  const [theme, setThemeState] = useState(() => localStorage.getItem('asa-theme') || 'system')
  const [pins, setPins] = useState(storedPins)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [buyerData, historyData, info] = await Promise.all([
        shoppingApi.buyers(), shoppingApi.history(), shoppingApi.systemInfo(),
      ])
      setBuyers(buyerData)
      setHistory(historyData)
      setSystemInfo(info)
      setDataError('')
    } catch (error) {
      setDataError(error.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const updateAiStatus = () => shoppingApi.systemInfo().then((info) => {
      setSystemInfo((current) => ({
        ...info,
        ollama_ready: info.ollama_ready ?? current?.ollama_ready,
      }))
    }).catch(() => {})
    const interval = setInterval(updateAiStatus, 10000)
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    const root = document.documentElement
    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : { matches: false }
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      root.classList.toggle('dark', dark)
      root.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    media.addEventListener?.('change', apply)
    return () => media.removeEventListener?.('change', apply)
  }, [theme])

  const setTheme = (value) => {
    setThemeState(value)
    localStorage.setItem('asa-theme', value)
  }
  const togglePin = (userId) => setPins((current) => {
    const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    localStorage.setItem('asa-pins', JSON.stringify(next))
    return next
  })
  const recordResult = useCallback(async (value) => {
    setResult(value)
    if (!value) return
    setSystemInfo((current) => ({ ...current, ollama_ready: true }))
    toast.success('Recommendation complete', { description: value.message })
  }, [])

  const value = useMemo(() => ({
    buyers, history, systemInfo, result, setResult: recordResult, loading, dataError,
    refresh, theme, setTheme, pins, togglePin,
  }), [buyers, history, systemInfo, result, recordResult, loading, dataError, refresh, theme, pins])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used within AppProvider')
  return value
}
