import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppProvider } from './context/AppContext'
import AppShell from './components/AppShell'
import { PageSkeleton } from './components/ui'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Recommend = lazy(() => import('./pages/Recommend'))
const Buyers = lazy(() => import('./pages/Buyers'))
const Analytics = lazy(() => import('./pages/Analytics'))
const History = lazy(() => import('./pages/History'))
const Settings = lazy(() => import('./pages/Settings'))

export default function App() {
  return <AppProvider>
    <AppShell>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/recommend" element={<Recommend />} />
          <Route path="/buyers" element={<Buyers />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
    <Toaster position="top-right" richColors closeButton />
  </AppProvider>
}
