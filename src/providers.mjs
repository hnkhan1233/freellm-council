// Provider registry — the FreeLLMAPI-style routing layer, native to the council.
// Each provider is an OpenAI-compatible endpoint we can fan council calls across.
// Add a provider's key (env var) to "light it up" — more providers lit = a more
// diverse, more powerful council. A provider with no key set is simply dark.

export const PROVIDERS = [
  {
    id: 'openrouter', label: 'OpenRouter', keyEnv: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1', modelsPath: '/models',
    signup: 'https://openrouter.ai/keys',
    note: 'broadest catalog; ~dozens of :free models',
    // OpenRouter publishes pricing — "free" = prompt and completion both cost 0.
    pickModels: (data) => (data.data || [])
      .filter((m) => Number(m?.pricing?.prompt ?? 1) === 0 && Number(m?.pricing?.completion ?? 1) === 0)
      .map((m) => ({ id: m.id, ctx: m.context_length || 0 })),
  },
  {
    id: 'groq', label: 'Groq', keyEnv: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1', modelsPath: '/models',
    signup: 'https://console.groq.com/keys',
    note: 'very fast inference; generous free tier',
    pickModels: (data) => (data.data || []).map((m) => ({ id: m.id, ctx: m.context_window || 0 })),
  },
  {
    id: 'cerebras', label: 'Cerebras', keyEnv: 'CEREBRAS_API_KEY',
    baseUrl: 'https://api.cerebras.ai/v1', modelsPath: '/models',
    signup: 'https://cloud.cerebras.ai',
    note: 'fastest tokens/sec; small but strong roster',
    pickModels: (data) => (data.data || []).map((m) => ({ id: m.id, ctx: 0 })),
  },
  {
    id: 'gemini', label: 'Google Gemini', keyEnv: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', modelsPath: '/models',
    signup: 'https://aistudio.google.com/apikey',
    note: 'huge context windows; free tier on flash models',
    pickModels: (data) => (data.data || []).map((m) => ({ id: m.id, ctx: 0 })),
  },
  {
    id: 'mistral', label: 'Mistral', keyEnv: 'MISTRAL_API_KEY',
    baseUrl: 'https://api.mistral.ai/v1', modelsPath: '/models',
    signup: 'https://console.mistral.ai/api-keys',
    note: 'strong general + codestral for code',
    pickModels: (data) => (data.data || []).map((m) => ({ id: m.id, ctx: 0 })),
  },
]

// Capability tagging. No clean machine-readable "good at X" flag exists for free
// models, so we approximate from the model id + context length. A model can carry
// several tags; if it has no specialist tag it counts as "general".
export function categorize(model) {
  const id = (model.id || '').toLowerCase()
  const tags = new Set()
  if (/coder|code|codestral|starcoder|deepseek-coder/.test(id)) tags.add('coding')
  if (/(^|[^a-z])r1([^a-z]|$)|reason|qwq|thinking|nemotron|o1|o3|deepseek-r/.test(id)) tags.add('reasoning')
  if (/math/.test(id)) tags.add('math')
  if (/vl|vision|llava|image|multimodal/.test(id)) tags.add('vision')
  const specialist = tags.size > 0
  if ((model.ctx || 0) >= 200000) tags.add('long-context') // attribute, not a specialty
  if (!specialist) tags.add('general')
  return [...tags]
}

export const CATEGORIES = ['coding', 'reasoning', 'math', 'vision', 'long-context', 'general']
