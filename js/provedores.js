// provedores.js — camada BYOK de provedores de IA (SPEC 11).
// Adaptado da extensão Linguagem Simples (Teste_Multi_LLM_1), com Anthropic
// acrescentado e como padrão. A chave fica só no localStorage do navegador,
// nunca no Supabase (princípio P3). Todo acesso a localStorage em try/catch.

// Lista curada e enxuta. Só provedores com modelos que sabemos que funcionam
// para reescrita jurídica em português. Grátis: Gemini e Groq. Pagos: Claude,
// ChatGPT, Gemini. Os modelos são poucos e testados de propósito — o difícil,
// para o usuário leigo, é achar um modelo que de fato responda.
const PROVEDORES = {
  anthropic: {
    rotulo: 'Claude (Anthropic)', custo: 'paga',
    formato: 'anthropic', base: 'https://api.anthropic.com/v1',
    modeloPadrao: 'claude-sonnet-4-6',
    modelos: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'],
    requerChave: true,
    urlChave: 'https://console.anthropic.com/settings/keys',
    nota: 'Melhor qualidade para reescrita jurídica em português. Recomendado.'
  },
  openai: {
    rotulo: 'ChatGPT (OpenAI)', custo: 'paga',
    formato: 'openai-compat', base: 'https://api.openai.com/v1',
    modeloPadrao: 'gpt-4o',
    modelos: ['gpt-4o', 'gpt-4o-mini'],
    requerChave: true,
    urlChave: 'https://platform.openai.com/api-keys',
    nota: 'Boa qualidade geral. Requer chave paga da OpenAI.'
  },
  gemini: {
    rotulo: 'Gemini (Google)', custo: 'gratis',
    formato: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta',
    modeloPadrao: 'gemini-2.5-flash',
    modelos: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    requerChave: true,
    urlChave: 'https://aistudio.google.com/apikey',
    nota: 'Tem camada gratuita. No plano grátis o conteúdo pode ser usado para treinamento — evite com documento sensível.'
  },
  groq: {
    rotulo: 'Groq', custo: 'gratis',
    formato: 'openai-compat', base: 'https://api.groq.com/openai/v1',
    modeloPadrao: 'llama-3.3-70b-versatile',
    modelos: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    requerChave: true,
    urlChave: 'https://console.groq.com/keys',
    nota: 'Muito rápido e com camada gratuita generosa.'
  }
};

const PADRAO = 'anthropic';

// ------------------------------------------------------------------
// Armazenamento local das chaves e preferências
// ------------------------------------------------------------------
function getChave(prov) {
  try { return localStorage.getItem('lucas.chave.' + prov) || ''; } catch (e) { return ''; }
}
function setChave(prov, valor) {
  try {
    if (valor) localStorage.setItem('lucas.chave.' + prov, valor.trim());
    else localStorage.removeItem('lucas.chave.' + prov);
  } catch (e) {}
}
function apagarTodasChaves() {
  try {
    for (const p of Object.keys(PROVEDORES)) localStorage.removeItem('lucas.chave.' + p);
  } catch (e) {}
}
function getModelo(prov) {
  try {
    const def = PROVEDORES[prov] || {};
    const modelos = def.modelos || [];
    const salvo = localStorage.getItem('lucas.modelo.' + prov) || '';
    if (salvo && modelos.includes(salvo)) return salvo;
    // Modelo salvo fora da lista curada (id antigo/inválido, ex.: um
    // "claude-opus-4-6" que ficou no navegador). Preserva a INTENÇÃO: se era um
    // "opus", usa o opus curado atual; um "sonnet", o sonnet atual; etc. Sem
    // correspondência, cai no recomendado. Assim nunca usamos/mostramos um id que
    // o provedor rejeita.
    if (salvo) {
      const fam = salvo.replace(/[^a-z]/gi, '').toLowerCase();
      const parecido = modelos.find((m) => {
        const base = m.split('-').slice(0, 2).join('').toLowerCase();
        return base && fam.includes(base);
      });
      if (parecido) return parecido;
    }
    return def.modeloPadrao || salvo || '';
  } catch (e) { return (PROVEDORES[prov] && PROVEDORES[prov].modeloPadrao) || ''; }
}
function setModelo(prov, m) { try { localStorage.setItem('lucas.modelo.' + prov, m); } catch (e) {} }
function getProvedorAtual() {
  try {
    const p = localStorage.getItem('lucas.provedor') || PADRAO;
    return PROVEDORES[p] ? p : PADRAO; // provedor removido (ex.: openrouter) recai no padrão
  } catch (e) { return PADRAO; }
}
function setProvedorAtual(p) { try { localStorage.setItem('lucas.provedor', p); } catch (e) {} }

// Configuração ativa pronta para uso.
function configAtual() {
  const prov = getProvedorAtual();
  return { provedor: prov, modelo: getModelo(prov), chave: getChave(prov) };
}

// ------------------------------------------------------------------
// Envio para a IA (streaming). Recebe { system, user } e um callback
// aoReceber(textoAcumulado) chamado a cada pedaço.
// ------------------------------------------------------------------
async function enviarParaIA(cfg, mensagem, aoReceber, opts = {}) {
  const def = PROVEDORES[cfg.provedor];
  if (!def) throw new Error('Provedor desconhecido: ' + cfg.provedor);
  if (def.requerChave && !cfg.chave) throw new Error(def.rotulo + ' precisa de chave. Configure em Provedores de IA.');

  const completo = {
    base: def.base,
    formato: def.formato,
    modelo: cfg.modelo || def.modeloPadrao,
    temperatura: typeof cfg.temperatura === 'number' ? cfg.temperatura : 0.2,
    chave: cfg.chave,
    maxTokens: cfg.maxTokens || 2048,
    formatoResposta: cfg.formatoResposta || 'json' // 'json' (por parágrafo) ou 'texto' (documento inteiro)
  };
  const sistema = mensagem.system || '';
  const usuario = mensagem.user || '';

  switch (def.formato) {
    case 'anthropic': return enviarAnthropic(completo, sistema, usuario, aoReceber, opts);
    case 'openai-compat': return enviarOpenAiCompat(completo, sistema, usuario, aoReceber, opts);
    case 'gemini': return enviarGemini(completo, sistema, usuario, aoReceber, opts);
    case 'ollama': return enviarOllama(completo, sistema, usuario, aoReceber, opts);
    default: throw new Error('Formato não implementado: ' + def.formato);
  }
}

// Erro que vale a pena tentar OUTRO modelo do mesmo provedor: sobrecarga,
// indisponibilidade, modelo inexistente ou limite de uso. Erro de chave ou de
// pedido inválido (tamanho) NÃO adianta trocar de modelo.
function erroPermiteOutroModelo(msg) {
  const s = String(msg || '');
  if (/chave rejeitada|401|403|saldo|402/i.test(s)) return false;
  if (/max_tokens|context_window|invalid_request/i.test(s)) return false;
  // Limite de taxa (429) NÃO entra: trocar de modelo raramente resolve e só
  // multiplica chamadas lentas. Trocamos só quando o MODELO está indisponível.
  return /sobrecarregad|instável|indispon[ií]vel|unavailable|overloaded|high demand|not found|model_not_found|does not exist|decommission|\b404\b|\b500\b|\b502\b|\b503\b|\b529\b|try again/i.test(s);
}

// Envia à IA trocando de modelo AUTOMATICAMENTE quando o escolhido está
// indisponível/sobrecarregado. Tenta o modelo preferido e, se falhar por um
// motivo que outro modelo possa resolver, cai para os demais modelos curados do
// provedor. Ao achar um que responde, passa a usá-lo (setModelo) e avisa via
// opts.onTrocaModelo(modelo). Fim do "brigar para achar um modelo disponível".
async function enviarComFallback(cfg, mensagem, aoReceber, opts = {}) {
  const def = PROVEDORES[cfg.provedor];
  if (!def) throw new Error('Provedor desconhecido: ' + cfg.provedor);
  const preferido = cfg.modelo || def.modeloPadrao;
  const ordem = [preferido, ...(def.modelos || []).filter((m) => m && m !== preferido)];
  let ultimoErro = null;
  for (let i = 0; i < ordem.length; i++) {
    const modelo = ordem[i];
    try {
      const r = await enviarParaIA({ ...cfg, modelo }, mensagem, aoReceber, opts);
      if (modelo !== preferido) {
        try { setModelo(cfg.provedor, modelo); } catch (e) {}
        if (typeof opts.onTrocaModelo === 'function') { try { opts.onTrocaModelo(modelo); } catch (e) {} }
      }
      return r;
    } catch (e) {
      ultimoErro = e;
      const podeOutro = erroPermiteOutroModelo((e && e.message) || e) && i < ordem.length - 1;
      if (!podeOutro) throw e;
    }
  }
  throw ultimoErro || new Error('Falha ao enviar para a IA.');
}

async function conferir(resp) {
  if (resp.ok) return;
  let detalhe = '';
  try { detalhe = (await resp.text()).slice(0, 300); } catch (e) {}
  const map = {
    401: 'chave rejeitada', 403: 'chave rejeitada', 429: 'limite de uso atingido',
    404: 'modelo indisponível', 402: 'saldo esgotado ou cota vencida',
    500: 'provedor instável no momento', 502: 'provedor instável no momento',
    503: 'provedor sobrecarregado no momento', 529: 'provedor sobrecarregado no momento'
  };
  // Para erros transitórios/de sobrecarga não anexamos o corpo cru (JSON feio):
  // a UI mostra uma mensagem amistosa. Nos demais, o detalhe ajuda a diagnosticar.
  const semDetalhe = new Set([401, 403, 429, 500, 502, 503, 529]);
  const base = map[resp.status] || ('erro HTTP ' + resp.status);
  throw new Error(base + (detalhe && !semDetalhe.has(resp.status) ? ' — ' + detalhe : ''));
}

// Lê um corpo SSE linha a linha, chamando onEvent(dataJson) para cada "data:".
async function lerSSE(resp, onDataLinha) {
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const linhas = buffer.split('\n');
    buffer = linhas.pop();
    for (const linha of linhas) {
      const t = linha.trim();
      if (!t || t.startsWith('event:') || t.startsWith(':')) continue;
      if (t.startsWith('data:')) onDataLinha(t.slice(5).trim());
    }
  }
}

// ---- Anthropic (SSE próprio) ----
async function enviarAnthropic(cfg, sistema, usuario, aoReceber, opts) {
  const resp = await fetch(cfg.base + '/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.chave,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: cfg.modelo,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperatura,
      system: sistema || undefined,
      messages: [{ role: 'user', content: usuario }],
      stream: true
    })
  });
  await conferir(resp);
  let acc = '';
  await lerSSE(resp, (data) => {
    if (data === '[DONE]') return;
    try {
      const o = JSON.parse(data);
      if (o.type === 'content_block_delta' && o.delta && o.delta.text) {
        acc += o.delta.text; aoReceber(acc);
      }
    } catch (e) {}
  });
  return acc;
}

// ---- OpenAI-compatível (OpenRouter, Groq) ----
async function enviarOpenAiCompat(cfg, sistema, usuario, aoReceber, opts) {
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.chave };
  if (cfg.base.includes('openrouter')) {
    headers['HTTP-Referer'] = 'https://lucas.local';
    headers['X-Title'] = 'LUCAS Linguagem Simples';
  }
  const msgs = [];
  if (sistema) msgs.push({ role: 'system', content: sistema });
  msgs.push({ role: 'user', content: usuario });
  const resp = await fetch(cfg.base + '/chat/completions', {
    method: 'POST', headers, signal: opts.signal,
    body: JSON.stringify({ model: cfg.modelo, messages: msgs, temperature: cfg.temperatura, max_tokens: cfg.maxTokens, stream: true })
  });
  await conferir(resp);
  let acc = '';
  await lerSSE(resp, (data) => {
    if (data === '[DONE]') return;
    try {
      const o = JSON.parse(data);
      const d = o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content;
      if (d) { acc += d; aoReceber(acc); }
    } catch (e) {}
  });
  return acc;
}

// ---- Gemini (SSE) ----
async function enviarGemini(cfg, sistema, usuario, aoReceber, opts) {
  const url = cfg.base + '/models/' + cfg.modelo + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(cfg.chave);
  const corpo = {
    contents: [{ role: 'user', parts: [{ text: usuario }] }],
    generationConfig: {
      temperature: cfg.temperatura,
      // Gemini 2.5 usa "thinking" por padrão, que consome o teto de tokens antes
      // da saída. Damos folga; e forçamos JSON puro só quando a resposta é JSON
      // (na conversão de documento inteiro a saída é texto corrido).
      maxOutputTokens: Math.max(cfg.maxTokens || 2048, 8192)
    }
  };
  if (cfg.formatoResposta !== 'texto') corpo.generationConfig.responseMimeType = 'application/json';
  if (sistema) corpo.systemInstruction = { parts: [{ text: sistema }] };
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: opts.signal, body: JSON.stringify(corpo) });
  await conferir(resp);
  let acc = '', finish = '', block = '';
  await lerSSE(resp, (data) => {
    try {
      const o = JSON.parse(data);
      const cand = o.candidates && o.candidates[0];
      if (cand) {
        const parts = cand.content && cand.content.parts;
        if (parts) for (const p of parts) if (p.text) { acc += p.text; aoReceber(acc); }
        if (cand.finishReason) finish = cand.finishReason;
      }
      if (o.promptFeedback && o.promptFeedback.blockReason) block = o.promptFeedback.blockReason;
    } catch (e) {}
  });
  // Não devolver "vazio" silencioso: bloqueio/truncamento viram erro descritivo.
  if (block) throw new Error('O Gemini bloqueou o pedido (' + block + ').');
  if (!acc.trim()) {
    if (finish === 'MAX_TOKENS') throw new Error('O Gemini atingiu o limite de tokens antes de responder (modelo "thinking"). Use um modelo sem "thinking" ou reduza o trecho.');
    if (finish === 'SAFETY' || finish === 'RECITATION') throw new Error('O Gemini recusou a resposta (' + finish + ').');
    throw new Error('O Gemini retornou resposta vazia' + (finish ? ' (' + finish + ')' : '') + '.');
  }
  return acc;
}

// ---- Ollama (NDJSON local) ----
async function enviarOllama(cfg, sistema, usuario, aoReceber, opts) {
  const resp = await fetch(cfg.base + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: opts.signal,
    body: JSON.stringify({
      model: cfg.modelo,
      messages: [...(sistema ? [{ role: 'system', content: sistema }] : []), { role: 'user', content: usuario }],
      options: { temperature: cfg.temperatura },
      stream: true
    })
  });
  await conferir(resp);
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buffer = '', acc = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const linhas = buffer.split('\n');
    buffer = linhas.pop();
    for (const linha of linhas) {
      if (!linha.trim()) continue;
      try {
        const o = JSON.parse(linha);
        if (o.message && o.message.content) { acc += o.message.content; aoReceber(acc); }
      } catch (e) {}
    }
  }
  return acc;
}

// Lê os modelos que a chave tem acesso, direto da API do provedor. Assim o
// usuário escolhe de uma lista real, sem digitar (e sem cair em model_not_found).
async function listarModelos(cfg) {
  const def = PROVEDORES[cfg.provedor];
  if (!def) throw new Error('Provedor desconhecido.');
  const chave = (cfg.chave || '').trim();
  if (def.requerChave && !chave) throw new Error('Informe a chave para listar os modelos.');
  const fmt = def.formato;
  let url, headers = {};
  if (fmt === 'anthropic') {
    url = def.base + '/models?limit=1000';
    headers = { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  } else if (fmt === 'gemini') {
    url = def.base + '/models?pageSize=1000&key=' + encodeURIComponent(chave);
  } else if (fmt === 'ollama') {
    url = def.base + '/api/tags';
  } else { // openai-compat (OpenRouter, Groq)
    url = def.base + '/models';
    if (chave) headers = { Authorization: 'Bearer ' + chave };
  }
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    let msg = 'HTTP ' + resp.status;
    try { const j = await resp.json(); msg = (j.error && (j.error.message || j.error)) || j.message || msg; } catch (e) {}
    throw new Error(msg);
  }
  const j = await resp.json();
  let ids = [];
  if (fmt === 'gemini') {
    ids = (j.models || [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''));
  } else if (fmt === 'ollama') {
    ids = (j.models || []).map((m) => m.name);
  } else { // Anthropic e OpenAI-compat retornam { data: [{ id }] }
    ids = (j.data || []).map((m) => m.id);
  }
  return [...new Set(ids.filter(Boolean))].sort();
}

// Testa o provedor com um prompt curto.
async function testarProvedor(cfg) {
  const t0 = performance.now();
  let recebido = '';
  await enviarParaIA({ ...cfg, temperatura: 0, maxTokens: 20 }, { system: '', user: 'Responda apenas com a palavra OK.' }, (t) => { recebido = t; });
  return { ok: true, ms: Math.round(performance.now() - t0), amostra: recebido.trim().slice(0, 60) };
}

// Testa TODOS os modelos curados do provedor com a chave, em paralelo, e diz
// quais respondem AGORA. É o que permite oferecer ao usuário só os modelos que
// estão de fato funcionando naquele momento, em vez de mandá-lo adivinhar.
async function testarModelos({ provedor, chave }) {
  const def = PROVEDORES[provedor];
  if (!def) throw new Error('Provedor desconhecido.');
  const modelos = def.modelos || [];
  const resultados = await Promise.all(modelos.map(async (modelo) => {
    try {
      const r = await testarProvedor({ provedor, modelo, chave });
      return { modelo, ok: true, ms: r.ms };
    } catch (e) {
      return { modelo, ok: false, erro: String((e && e.message) || e) };
    }
  }));
  // Mantém a ordem curada (o 1º é o recomendado).
  return modelos.map((m) => resultados.find((r) => r.modelo === m)).filter(Boolean);
}

export {
  PROVEDORES, PADRAO,
  getChave, setChave, apagarTodasChaves,
  getModelo, setModelo, getProvedorAtual, setProvedorAtual, configAtual,
  enviarParaIA, enviarComFallback, testarProvedor, testarModelos, listarModelos
};
