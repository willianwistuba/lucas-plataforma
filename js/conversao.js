// conversao.js — orquestra a conversão de um trecho por IA (SPEC 5.4, 7, 9).
// A IA só redige; a versão passa pela conferência e só entra no texto se o
// usuário aceitar (princípio P6).

import * as prov from './provedores.js';
import * as prompts from './prompts.js';
import { conferirVersao } from './conferencia.js';
import { calcularFacilidade, nomeFaixa } from './metricas.js';
import * as dic from './dicionario.js';

// Lista de termos protegidos (tratamento "explicar"), com variantes,
// para a regra 2 do sistema e a conferência C3.
function termosProtegidos() {
  const out = [];
  for (const v of dic.todos()) {
    if (v.tratamento === 'explicar') {
      out.push(v.termo);
      for (const alt of (v.variantes || [])) out.push(alt);
    }
  }
  return out;
}

// Cláusula de público-alvo: o usuário marca para quem o texto é escrito e a IA
// calibra o vocabulário e o nível de explicação. `publicos` é um array de
// rótulos legíveis (ex.: "as partes e os interessados no processo").
function clausulaPublico(publicos) {
  if (!Array.isArray(publicos) || !publicos.length) return '';
  return `\n\n---\nPÚBLICO-ALVO: escreva pensando em quem vai ler. O texto precisa ser entendido por ${publicos.join('; ')}. Quando os públicos tiverem repertórios diferentes, priorize o leitor com menos familiaridade jurídica: explique o indispensável, sem infantilizar quem é da área. Mantenha a precisão técnica e os termos que não podem ser trocados, mas garanta que o sentido chegue a esse público.`;
}

// Converte um trecho. Opções:
//   promptCodigo: 'P1'..'P7' | 'PL'
//   instrucaoLivre: texto (só para PL)
//   onStream(textoParcial): callback de streaming
//   signal: AbortSignal opcional
// Retorna: { versao, obj, alertas, faixaAntes, faixaDepois, facilidadeAntes,
//            facilidadeDepois, provedor, modelo, promptCodigo, brutoModelo }
async function converter(texto, opcoes = {}) {
  const { promptCodigo = 'P1', instrucaoLivre = '', onStream, signal, temperatura, sugestoes, publicos, contexto = '', onTrocaModelo, variacao = '' } = opcoes;

  const cfg = prov.configAtual();
  const protegidos = termosProtegidos();
  const msg = prompts.montarTrecho(promptCodigo, texto, protegidos, instrucaoLivre, contexto);
  // Orientação extra vinda das dicas da avaliação de clareza.
  if (Array.isArray(sugestoes) && sugestoes.length) {
    msg.user += `\n\n---\nAO REESCREVER, ATENDA A ESTAS OBSERVAÇÕES:\n${sugestoes.map((s) => '- ' + s).join('\n')}`;
  }
  // Variação: dá um ângulo diferente a cada versão gerada, para que 2 ou 3 versões
  // não saiam praticamente iguais (a temperatura sozinha não basta num prompt tão
  // prescritivo). Sem violar as regras invioláveis.
  if (variacao && String(variacao).trim()) {
    msg.user += `\n\n---\nNESTA VERSÃO ESPECIFICAMENTE: ${String(variacao).trim()} (sem violar as regras invioláveis).`;
  }
  msg.user += clausulaPublico(publicos);

  // Saída em TEXTO puro: a IA responde com a reescrita direta (como numa conversa),
  // sem JSON e sem "devolver o original". A conferência vira apenas aviso.
  const bruto = await prov.enviarComFallback(
    { ...cfg, temperatura: temperatura != null ? temperatura : prompts.TEMPERATURA, maxTokens: 4096, formatoResposta: 'texto' },
    msg,
    (parcial) => { if (onStream) onStream(parcial); },
    { signal, onTrocaModelo }
  );

  const versao = limparSaidaTrecho(bruto);
  const ok = !!(versao && versao.trim());
  const alertas = ok ? conferirVersao(texto, versao, { promptCodigo, termosProtegidos: protegidos }) : [];
  const antes = calcularFacilidade(texto);
  const depois = ok ? calcularFacilidade(versao) : null;

  return {
    ok,
    versao,
    obj: { versao },
    alertas,
    faixaAntes: antes ? antes.faixa : null,
    faixaDepois: depois ? depois.faixa : null,
    facilidadeAntes: antes ? antes.facilidade : null,
    facilidadeDepois: depois ? depois.facilidade : null,
    nomeFaixaAntes: antes ? nomeFaixa(antes.faixa) : '—',
    nomeFaixaDepois: depois ? nomeFaixa(depois.faixa) : '—',
    provedor: cfg.provedor,
    modelo: cfg.modelo,
    promptCodigo,
    brutoModelo: bruto
  };
}

// Limpa a saída do modelo: tira cercas de código e rótulos que às vezes ecoa.
function limparSaidaTrecho(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  t = t.replace(/^(TRECHO REESCRITO|VERS[ÃA]O(\s+SIMPLES)?|TEXTO REESCRITO|REESCRITA)\s*:?\s*/i, '').trim();
  // se veio entre aspas em toda a extensão, remove-as
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”'))) t = t.slice(1, -1).trim();
  return t;
}

// Converte o DOCUMENTO INTEIRO em BLOCOS sequenciais (com streaming), não numa
// única chamada. Uma chamada só, com max_tokens alto para caber o documento
// reescrito, era recusada por alguns modelos e travava em documentos grandes.
// Cada bloco tem saída pequena e segura; o texto vai sendo montado e transmitido.
const BLOCO_CONVERSAO = 10; // parágrafos por bloco

async function converterDocumento(textoCompleto, opcoes = {}) {
  const { onStream, onProgress, signal, temperatura, orientacoes, publicos, promptCodigo = 'P1', instrucaoLivre = '', onTrocaModelo } = opcoes;
  const cfg = prov.configAtual();
  const protegidos = termosProtegidos();
  const orient = (Array.isArray(orientacoes) && orientacoes.length)
    ? `\n\n---\nAO REESCREVER, LEVE EM CONTA ESTAS OBSERVAÇÕES SOBRE O CONJUNTO (organização, conexões, repetições), sem violar as regras invioláveis:\n${orientacoes.map((s) => '- ' + s).join('\n')}`
    : '';
  const claus = clausulaPublico(publicos);

  const paras = String(textoCompleto).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const blocos = [];
  for (let i = 0; i < paras.length; i += BLOCO_CONVERSAO) blocos.push(paras.slice(i, i + BLOCO_CONVERSAO));

  // Blocos em PARALELO (era sequencial e somava os tempos — daí a lentidão). O
  // texto é montado em ordem; o streaming mostra o prefixo já pronto e contíguo.
  const resultados = new Array(blocos.length).fill(null);
  let feitos = 0;
  const emitir = () => {
    let k = 0; while (k < resultados.length && resultados[k] != null) k++;
    if (onStream) onStream(resultados.slice(0, k).join('\n\n'));
  };
  const converterBloco = async (bloco, idx) => {
    const msg = prompts.montarDocumento(bloco.join('\n\n'), protegidos, promptCodigo, instrucaoLivre);
    msg.user += orient + claus;
    const bruto = await prov.enviarComFallback(
      // Temperatura um pouco maior que a padrão: reescrever em linguagem simples
      // exige reestruturar (quebrar frases, reordenar), não só copiar com trocas.
      { ...cfg, temperatura: temperatura != null ? temperatura : 0.4, maxTokens: 4096, formatoResposta: 'texto' },
      msg, () => {}, { signal, onTrocaModelo }
    );
    const limpo = String(bruto || '').trim();
    // Bloco vazio (ex.: modelo "thinking" estourou o limite de tokens e truncou):
    // NÃO engolir o conteúdo — preserva o texto original do bloco, para o documento
    // não sair com parágrafos faltando sem aviso.
    resultados[idx] = limpo || bloco.join('\n\n');
    feitos++;
    if (onProgress) onProgress(feitos, blocos.length);
    emitir();
  };
  // allSettled: se um bloco falha, os irmãos ainda assentam (sem promessa órfã /
  // unhandled rejection); propagamos o primeiro erro real ao chamador.
  const _res = await Promise.allSettled(blocos.map((b, i) => converterBloco(b, i)));
  const _erro = _res.find((r) => r.status === 'rejected');
  if (_erro) throw _erro.reason;
  return { texto: resultados.join('\n\n').trim(), provedor: cfg.provedor, modelo: cfg.modelo };
}

// Extrai o JSON da avaliação, tolerando cercas e formatos variados. Devolve
// { itens: [{n, nota, sugestoes}], global: {nota, sugestoes} | null }.
function parseAvaliacao(raw) {
  let t = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const tenta = (s) => {
    try { return JSON.parse(s); }
    catch (e) {
      // tolera vírgula final antes de } ou ] (comum em modelos menores)
      try { return JSON.parse(String(s).replace(/,(\s*[}\]])/g, '$1')); } catch (e2) { return null; }
    }
  };
  let o = tenta(t);
  if (!o) { const m = t.match(/\{[\s\S]*\}/); if (m) o = tenta(m[0]); }
  if (!o) { const m = t.match(/\[[\s\S]*\]/); if (m) o = tenta(m[0]); }

  let itens = [];
  let global = null;
  if (Array.isArray(o)) {
    itens = o;
  } else if (o && typeof o === 'object') {
    itens = Array.isArray(o.paragrafos) ? o.paragrafos
      : Array.isArray(o.avaliacoes) ? o.avaliacoes : [];
    const d = o.documento || o.geral || o.conjunto;
    if (d && typeof d === 'object') {
      const nota = Number(d.nota);
      global = {
        nota: isFinite(nota) ? nota : null,
        sugestoes: Array.isArray(d.sugestoes) ? d.sugestoes.filter((s) => s && String(s).trim()) : []
      };
    }
  }
  return { itens, global };
}

// Avalia a clareza do documento em LOTES paralelos de parágrafos + uma chamada
// separada para o CONJUNTO. Antes era uma única chamada pedindo um JSON enorme
// (max_tokens alto), que alguns modelos recusam ("recusou o tamanho do pedido") e
// que travava em documentos grandes. Cada chamada agora tem saída pequena e
// segura. Devolve { itens: [{n, nota, sugestoes}], global }.
const LOTE_AVALIACAO = 15; // parágrafos por chamada (poucas chamadas, saída pequena)

async function avaliarDocumento(paragrafos, opcoes = {}) {
  const { signal, pesos, publicos, onTrocaModelo, onProgress } = opcoes;
  const cfg = prov.configAtual();
  const claus = clausulaPublico(publicos);

  // Lotes de parágrafos, numerados com o índice GLOBAL (para mapear de volta).
  const lotes = [];
  for (let i = 0; i < paragrafos.length; i += LOTE_AVALIACAO) {
    lotes.push(paragrafos.slice(i, i + LOTE_AVALIACAO).map((p, j) => ({ n: i + j + 1, texto: p.texto })));
  }
  const total = lotes.length + 1; // +1 do conjunto
  let feitos = 0;
  const passo = () => { feitos++; if (onProgress) onProgress(feitos, total); };
  const avaliarLote = async (lote) => {
    const numerado = lote.map((x) => `[${x.n}] ${x.texto}`).join('\n\n');
    const msg = prompts.montarAvaliacaoLote(numerado, pesos);
    msg.user += claus;
    const bruto = await prov.enviarComFallback(
      { ...cfg, temperatura: 0.2, maxTokens: 4096, formatoResposta: 'json' },
      msg, () => {}, { signal, onTrocaModelo }
    );
    const itens = parseAvaliacao(bruto).itens;
    // Se o modelo renumerou os itens (ex.: 1..N por lote em vez do índice global),
    // remapeia por posição para os índices globais esperados deste lote, evitando
    // que a nota caia no parágrafo errado.
    const esperados = lote.map((x) => x.n);
    const conjunto = new Set(esperados);
    const batem = itens.length > 0 && itens.every((it) => conjunto.has(parseInt(it && it.n, 10)));
    if (!batem) itens.forEach((it, k) => { if (it && esperados[k] != null) it.n = esperados[k]; });
    passo();
    return itens;
  };

  // Conjunto: uma chamada leve (saída pequena). Best-effort — não bloqueia o resto.
  const avaliarConjunto = async () => {
    try {
      const numerado = paragrafos.map((p, i) => `[${i + 1}] ${p.texto}`).join('\n\n');
      const msg = prompts.montarAvaliacaoConjunto(numerado);
      msg.user += claus;
      const bruto = await prov.enviarComFallback(
        { ...cfg, temperatura: 0.2, maxTokens: 1024, formatoResposta: 'json' },
        msg, () => {}, { signal, onTrocaModelo }
      );
      let t = String(bruto || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      let o = null; try { o = JSON.parse(t); } catch (e) { const m = t.match(/\{[\s\S]*\}/); if (m) { try { o = JSON.parse(m[0]); } catch (e2) {} } }
      if (!o) { passo(); return null; }
      const nota = Number(o.nota);
      passo();
      return { nota: isFinite(nota) ? nota : null, sugestoes: Array.isArray(o.sugestoes) ? o.sugestoes.filter((s) => s && String(s).trim()) : [] };
    } catch (e) { passo(); return null; }
  };

  const [lotesRes, global] = await Promise.all([
    Promise.allSettled(lotes.map(avaliarLote)).then((rs) => {
      const err = rs.find((r) => r.status === 'rejected');
      if (err) throw err.reason;
      return rs.map((r) => r.value);
    }),
    avaliarConjunto()
  ]);
  const itens = [].concat(...lotesRes);
  return { itens, global };
}

// Avalia a clareza de UM trecho (usado ao reescrever um parágrafo). Devolve
// { nota, sugestoes } ou null se a resposta não puder ser lida. Prompt e formato
// dedicados — mais confiáveis do que reaproveitar o avaliador do documento todo.
async function avaliarTrecho(texto, opcoes = {}) {
  const { pesos, publicos, signal, onTrocaModelo } = opcoes;
  const cfg = prov.configAtual();
  const msg = prompts.montarAvaliacaoTrecho(texto, pesos);
  msg.user += clausulaPublico(publicos);
  const bruto = await prov.enviarComFallback(
    { ...cfg, temperatura: 0.2, maxTokens: 1500, formatoResposta: 'json' },
    msg,
    () => {},
    { signal, onTrocaModelo }
  );
  let t = String(bruto || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let o = null;
  try { o = JSON.parse(t); } catch (e) { const m = t.match(/\{[\s\S]*\}/); if (m) { try { o = JSON.parse(m[0]); } catch (e2) {} } }
  if (!o || typeof o !== 'object') return null;
  const nota = Number(o.nota);
  return {
    nota: isFinite(nota) ? Math.max(0, Math.min(100, nota)) : null,
    sugestoes: Array.isArray(o.sugestoes) ? o.sugestoes.filter((s) => s && String(s).trim()) : []
  };
}

// Módulo CONVERSOR: gera uma EXPLICAÇÃO/RESUMO em linguagem simples (produto de
// apoio, sem valor jurídico), não uma reescrita. Uma chamada só; saída em
// Markdown com estrutura fixa (ver prompts.sistemaExplicacao). `instrucaoLivre`
// recebe ajustes opcionais montados pelo construtor; `publicos` calibra a linguagem.
async function explicar(texto, opcoes = {}) {
  const { publicos, instrucaoLivre = '', onStream, onTrocaModelo, signal } = opcoes;
  const cfg = prov.configAtual();
  const msg = prompts.montarExplicacao(texto);
  msg.user += clausulaPublico(publicos);
  if (instrucaoLivre && String(instrucaoLivre).trim()) {
    msg.user += `\n\n---\nAJUSTES PEDIDOS PELO USUÁRIO (respeite as regras acima, sem distorcer o original):\n${String(instrucaoLivre).trim()}`;
  }
  const bruto = await prov.enviarComFallback(
    { ...cfg, temperatura: 0.2, maxTokens: 2048, formatoResposta: 'texto' },
    msg,
    (parcial) => { if (onStream) onStream(parcial); },
    { signal, onTrocaModelo }
  );
  const t = String(bruto || '').trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  return { texto: t, provedor: cfg.provedor, modelo: cfg.modelo };
}

export { converter, converterDocumento, explicar, avaliarDocumento, avaliarTrecho, termosProtegidos };
