import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const buyer = { user_id: 'A123', purchase_history: [{ product: 'Headphones', category: 'electronics', price: 120 }, { product: 'Shoes', category: 'sportswear', price: 80 }], purchase_count: 2, interaction_count: 0, average_spending: 100, favorite_category: 'sportswear', is_sample: true }
const result = {
  message: 'Recommendation ready. Choose a product to purchase.',
  buyer: { user_id: 'A123', history: [] },
  recommendation: { category: 'fitness_technology', reason: 'It complements activity-focused purchases.' },
  recommendation_metrics: { confidence: 95, generated_at: '2026-01-01T00:00:00Z', thinking_duration_ms: 420, product_match_scores: { 'FT-102': 95, 'FT-101': 90 }, confidence_basis: 'Engineering score, not an LLM probability.' },
  ranked_products: [
    { product_id: 'FT-102', product: 'Stride GPS Band', category: 'fitness_technology', price: 95, features: ['Built-in GPS'] },
    { product_id: 'FT-101', product: 'Pulse Activity Ring', category: 'fitness_technology', price: 75, features: ['Sleep tracking'] },
  ],
  warnings: [],
}
const completedPurchase = {
  message: 'Simulated purchase successful: Pulse Activity Ring.',
  selected_product: { product_id: 'FT-101', product: 'Pulse Activity Ring', category: 'fitness_technology', price: 75, features: ['Sleep tracking'] },
  purchase: { transaction_id: 'SIM-1', purchased_at: '2026-01-01T00:00:00Z' },
  memory: { user_id: 'A123', purchase_history: [{ product: 'Pulse Activity Ring' }] },
}
const routeData = (path) => {
  if (path === '/api/buyers') return [buyer]
  if (path === '/api/history') return []
  if (path === '/api/system-info') return { version: '2.0.0', ollama_model: 'qwen2.5:3b', ollama_ready: true, memory_type: 'Local JSON', memory_location: 'backend/data/memory.json' }
  if (path === '/api/sample-buyers') return [{ user_id: 'A123', history: [] }]
  if (path === '/api/shopping/purchase') return completedPurchase
  return result
}
const renderAt = (path = '/') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)

describe('portfolio app', () => {
  beforeEach(() => {
    localStorage.clear()
    global.fetch = vi.fn((path) => Promise.resolve({ ok: true, status: 200, json: async () => routeData(path) }))
  })

  it('renders dashboard data and navigation', async () => {
    renderAt()
    expect(await screen.findByRole('heading', { name: /welcome back/i }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('Total purchases')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /recommend/i }).length).toBeGreaterThan(0)
    expect(screen.getByText(/local ai ready/i)).toBeInTheDocument()
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
  })

  it('uses the same known-purchase total in analytics as the buyers data', async () => {
    renderAt('/analytics')
    expect(await screen.findByRole('heading', { name: /purchase intelligence/i }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('2 known')).toBeInTheDocument()
    expect(screen.getByText('$200.00')).toBeInTheDocument()
    expect(screen.getByText(/0 dated transaction/i)).toBeInTheDocument()
  })

  it('survives corrupted pin storage', async () => {
    localStorage.setItem('asa-pins', '{broken')
    renderAt('/buyers')
    expect(await screen.findByRole('heading', { name: /buyer profiles/i })).toBeInTheDocument()
  })

  it('does not call missing health data offline and marks AI ready after a recommendation', async () => {
    global.fetch = vi.fn((path) => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => path === '/api/system-info'
        ? { version: '1.0.0', ollama_model: 'qwen2.5:3b' }
        : routeData(path),
    }))
    renderAt('/recommend')
    expect(await screen.findByText(/local ai status unknown/i)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('tab', { name: /paste json/i }))
    fireEvent.click(screen.getByRole('button', { name: /analyze recommendations/i }))
    await screen.findByRole('heading', { name: 'Fitness Technology' })
    expect(screen.getByText(/local ai ready/i)).toBeInTheDocument()
  })

  it('recommends without buying and manually purchases the chosen product', async () => {
    renderAt('/recommend')
    fireEvent.click(await screen.findByRole('tab', { name: /paste json/i }))
    fireEvent.click(await screen.findByRole('button', { name: /analyze recommendations/i }))
    expect(await screen.findByRole('heading', { name: 'Fitness Technology' })).toBeInTheDocument()
    expect(screen.queryByText(/purchase complete/i)).not.toBeInTheDocument()
    expect(screen.getAllByText('Stride GPS Band').length).toBeGreaterThan(0)
    expect(screen.getAllByText('95%').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: /^purchase$/i })[1])
    expect(await screen.findByText(/purchase complete/i)).toBeInTheDocument()
    expect(screen.getAllByText('Pulse Activity Ring').length).toBeGreaterThan(0)
    const purchaseCall = global.fetch.mock.calls.find(([path]) => path === '/api/shopping/purchase')
    expect(JSON.parse(purchaseCall[1].body).product_id).toBe('FT-101')
  })

  it('renders a friendly backend error', async () => {
    global.fetch = vi.fn((path) => Promise.resolve({ ok: !String(path).includes('/shopping/process'), status: 503, json: async () => String(path).includes('/shopping/process') ? { detail: 'Ollama is unavailable.' } : routeData(path) }))
    renderAt('/recommend')
    fireEvent.click(await screen.findByRole('tab', { name: /paste json/i }))
    fireEvent.click(await screen.findByRole('button', { name: /analyze recommendations/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Ollama is unavailable.'))
    expect(screen.getByText(/ollama is offline/i)).toBeInTheDocument()
  })

  it('does not label an invalid recommendation as an offline error', async () => {
    global.fetch = vi.fn((path) => Promise.resolve({
      ok: !String(path).includes('/shopping/process'),
      status: 502,
      json: async () => String(path).includes('/shopping/process')
        ? { detail: 'Ollama recommended a category already present in buyer history.' }
        : routeData(path),
    }))
    renderAt('/recommend')
    fireEvent.click(await screen.findByRole('tab', { name: /paste json/i }))
    fireEvent.click(await screen.findByRole('button', { name: /analyze recommendations/i }))
    expect(await screen.findByRole('heading', { name: /recommendation needs another try/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /ollama is offline/i })).not.toBeInTheDocument()
  })

  it('shows the LLM recommendation stages with consistent progress markers', async () => {
    global.fetch = vi.fn((path) => String(path).includes('/shopping/process')
      ? new Promise(() => {})
      : Promise.resolve({ ok: true, status: 200, json: async () => routeData(path) }))
    renderAt('/recommend')
    fireEvent.click(await screen.findByRole('tab', { name: /paste json/i }))
    fireEvent.click(screen.getByRole('button', { name: /analyze recommendations/i }))
    const workflow = await screen.findByText(/ai workflow in progress/i)
    const card = workflow.closest('[aria-busy="true"]')
    expect(card).toHaveTextContent('LLM analyzing buyer history')
    expect(card).toHaveTextContent('LLM choosing a new category')
    expect(card).toHaveTextContent('Searching matching catalog products')
    expect(card.querySelectorAll('.stage-marker')).toHaveLength(4)
  })

  it('builds valid buyer JSON from the guided questions', async () => {
    renderAt('/recommend')
    fireEvent.change(await screen.findByLabelText(/guided buyer id/i), { target: { value: 'D204' } })
    fireEvent.change(screen.getByPlaceholderText('Wireless headphones'), { target: { value: 'Camera bag' } })
    fireEvent.change(screen.getByPlaceholderText('electronics'), { target: { value: 'photography' } })
    fireEvent.change(screen.getByPlaceholderText('120'), { target: { value: '75' } })
    fireEvent.click(screen.getByRole('button', { name: /create json and analyze/i }))
    await screen.findByRole('heading', { name: 'Fitness Technology' })
    const processCall = global.fetch.mock.calls.find(([path]) => path === '/api/shopping/process')
    expect(JSON.parse(processCall[1].body)).toEqual({
      user_id: 'D204', history: [{ product: 'Camera bag', category: 'photography', price: 75 }],
    })
    expect(JSON.parse(localStorage.getItem('asa-saved-buyers'))).toEqual([
      { user_id: 'D204', history: [{ product: 'Camera bag', category: 'photography', price: 75 }] },
    ])
    fireEvent.click(screen.getByRole('tab', { name: /sample buyer/i }))
    expect(screen.getByRole('option', { name: /D204.*1 prior purchase/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Fitness Technology' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /your recommendation will appear here/i })).toBeInTheDocument()
  })

  it('rejects duplicate guided buyer IDs and keeps backend samples authoritative', async () => {
    localStorage.setItem('asa-saved-buyers', JSON.stringify([
      { user_id: 'A123', history: [{ product: 'Local override', category: 'other', price: 1 }] },
    ]))
    renderAt('/recommend')
    fireEvent.change(await screen.findByLabelText(/guided buyer id/i), { target: { value: 'a123' } })
    fireEvent.click(screen.getByRole('button', { name: /create json and analyze/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/buyer id a123 already exists/i)
    expect(global.fetch.mock.calls.some(([path]) => path === '/api/shopping/process')).toBe(false)
    fireEvent.click(screen.getByRole('tab', { name: /sample buyer/i }))
    expect(screen.getByRole('option', { name: /A123.*0 prior purchases/i })).toBeInTheDocument()
  })

  it('persists a selected theme locally', async () => {
    renderAt('/settings')
    fireEvent.click(await screen.findByRole('button', { name: /dark/i }))
    expect(localStorage.getItem('asa-theme')).toBe('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })
})
