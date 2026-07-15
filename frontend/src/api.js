async function request(path, options = {}) {
  const response = await fetch(path, options)
  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = payload.detail
    const message = Array.isArray(detail)
      ? detail.map((item) => item.msg || String(item)).join('; ')
      : detail
    throw new Error(message || 'The request could not be completed.')
  }
  return payload
}

export const shoppingApi = {
  samples: () => request('/api/sample-buyers'),
  buyers: () => request('/api/buyers'),
  history: () => request('/api/history'),
  systemInfo: () => request('/api/system-info'),
  process: (buyer) => request('/api/shopping/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buyer),
  }),
  purchase: (recommendation, productId) => request('/api/shopping/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      buyer: recommendation.buyer,
      recommendation: recommendation.recommendation,
      ranked_products: recommendation.ranked_products,
      recommendation_metrics: recommendation.recommendation_metrics,
      product_id: productId,
    }),
  }),
  upload: (file) => {
    const body = new FormData()
    body.append('file', file)
    return request('/api/shopping/upload', { method: 'POST', body })
  },
  deleteHistory: (userId, transactionId) => request(
    `/api/history/${encodeURIComponent(userId)}/${encodeURIComponent(transactionId)}`,
    { method: 'DELETE' },
  ),
}
