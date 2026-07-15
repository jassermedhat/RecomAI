import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { shoppingApi } from '../api'

const AppContext = createContext(null)
const savedBuyersKey = 'asa-saved-buyers'

function storedBuyers() {
  try {
    const value = JSON.parse(localStorage.getItem(savedBuyersKey) || '[]')
    return Array.isArray(value)
      ? value.filter((buyer) => buyer?.user_id && Array.isArray(buyer.history))
      : []
  } catch {
    return []
  }
}

function buyerSummary(buyer) {
  const purchaseHistory = buyer.history
  const categories = purchaseHistory.reduce((counts, item) => ({
    ...counts, [item.category]: (counts[item.category] || 0) + 1,
  }), {})
  const favoriteCategory = Object.keys(categories).sort((first, second) => (
    categories[second] - categories[first] || second.localeCompare(first)
  ))[0] || null
  return {
    user_id: buyer.user_id,
    purchase_history: purchaseHistory,
    purchase_count: purchaseHistory.length,
    interaction_count: 0,
    average_spending: purchaseHistory.length
      ? Math.round((purchaseHistory.reduce((sum, item) => sum + Number(item.price), 0) / purchaseHistory.length) * 100) / 100
      : 0,
    favorite_category: favoriteCategory,
    is_sample: false,
    is_local: true,
  }
}

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
  const [savedBuyers, setSavedBuyers] = useState(storedBuyers)
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
    const synchronizeSavedBuyers = (event) => {
      if (event.key === savedBuyersKey) setSavedBuyers(storedBuyers())
    }
    window.addEventListener('storage', synchronizeSavedBuyers)
    return () => window.removeEventListener('storage', synchronizeSavedBuyers)
  }, [])
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
  const saveBuyer = useCallback((buyer) => {
    const key = buyer.user_id.toLocaleLowerCase()
    const next = [...storedBuyers().filter((item) => item.user_id.toLocaleLowerCase() !== key), buyer]
    localStorage.setItem(savedBuyersKey, JSON.stringify(next))
    setSavedBuyers(next)
  }, [])
  const recordResult = useCallback(async (value) => {
    setResult(value)
    if (!value) return
    setSystemInfo((current) => ({ ...current, ollama_ready: true }))
    toast.success('Recommendation complete', { description: value.message })
  }, [])

  const visibleBuyers = useMemo(() => {
    const merged = new Map(savedBuyers.map((buyer) => [buyer.user_id.toLocaleLowerCase(), buyerSummary(buyer)]))
    buyers.forEach((buyer) => merged.set(buyer.user_id.toLocaleLowerCase(), buyer))
    return [...merged.values()].sort((first, second) => first.user_id.localeCompare(second.user_id))
  }, [buyers, savedBuyers])

  const value = useMemo(() => ({
    buyers: visibleBuyers, savedBuyers, saveBuyer, history, systemInfo, result,
    setResult: recordResult, loading, dataError, refresh, theme, setTheme, pins, togglePin,
  }), [visibleBuyers, savedBuyers, saveBuyer, history, systemInfo, result, recordResult, loading, dataError, refresh, theme, pins])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used within AppProvider')
  return value
}
