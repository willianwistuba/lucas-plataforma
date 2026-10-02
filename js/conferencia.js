// conferencia.js — conferência automática das versões geradas por IA (SPEC 9).
// Roda antes de exibir a versão. Determinístico.

import { extrairPalavras, segmentarFrases } from './metricas.js';

function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Números do texto (SPEC 9): sequências de dígitos com ./,/-/ internos.
function extrairNumeros(texto) {
  const brutos = String(texto).match(/\d[\d.,/\-]*\d|\d/g) || [];
  // normaliza removendo pontuação nas pontas
  return brutos.map((n) => n.replace(/^[.,/\-]+|[.,/\-]+$/g, ''));
}

// Chave canônica para COMPARAR números ignorando só formatação de milhar/decimal,
// sem fundir identificadores (datas, nº de processo com / ou -, intervalos). O
// texto bruto é mantido para exibição; apenas a comparação usa a chave.
function chaveNumero(n) {
  const s = String(n);
  if (/[/\-]/.test(s)) return s;                        // data/processo/intervalo: literal
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return s.replace(/\./g, '').replace(',', '.'); // 1.000 / 1.000,50
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return s.replace(/,/g, '');                      // 1,000 / 1,000.50
  if (/^\d+,\d+$/.test(s)) return s.replace(',', '.');  // 3,5 -> 3.5
  return s;
}

// Indexa os números por chave canônica, com CONTAGEM (multiconjunto) e uma amostra
// do texto bruto por chave (para a mensagem de alerta).
function indexarNumeros(nums) {
  const cont = new Map();
  const amostra = new Map();
  for (const n of nums) {
    const k = chaveNumero(n);
    cont.set(k, (cont.get(k) || 0) + 1);
    if (!amostra.has(k)) amostra.set(k, String(n));
  }
  return { cont, amostra };
}

// Termo presente como PALAVRA INTEIRA (não como pedaço de outra palavra, ex.:
// "pena" dentro de "penalidade"). Recebe textos já normalizados por fold().
function contemTermoFold(textoFold, termoFold) {
  if (!termoFold) return false;
  const esc = termoFold.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^0-9a-z])' + esc + '($|[^0-9a-z])').test(textoFold);
}

// Tenta interpretar a resposta do modelo como JSON (SPEC 9, C6).
function parseResposta(raw) {
  if (raw == null) return { ok: false };
  let t = String(raw).trim();
  // remove cercas de código markdown, se houver
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const o = JSON.parse(t);
    if (o && typeof o.versao === 'string') return { ok: true, obj: o };
  } catch (e) {}
  // tolera vírgula final antes de } ou ]
  try {
    const o = JSON.parse(t.replace(/,(\s*[}\]])/g, '$1'));
    if (o && typeof o.versao === 'string') return { ok: true, obj: o };
  } catch (e) {}
  // tenta extrair o primeiro objeto {...}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      if (o && typeof o.versao === 'string') return { ok: true, obj: o };
    } catch (e) {}
  }
  // último recurso: extrai só o valor de "versao", mesmo de JSON malformado
  // (ex.: quebras de linha não escapadas dentro da string, comuns em modelos
  // menores). Pega do primeiro `"versao": "` até a próxima aspa não escapada.
  const mv = t.match(/"versao"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (mv) {
    let v = mv[1];
    try { v = JSON.parse('"' + v + '"'); } catch (e) { v = v.replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
    if (v && v.trim()) return { ok: true, obj: { versao: v, _recuperado: true } };
  }
  return { ok: false, textoBruto: t };
}

// Confere uma resposta contra o texto original.
// Retorna { ok, versao, obj, alertas:[{id,texto}] }.
function conferir(original, respostaRaw, opts = {}) {
  const promptCodigo = opts.promptCodigo || '';
  const termosProtegidos = opts.termosProtegidos || [];
  const alertas = [];

  const p = parseResposta(respostaRaw);
  if (!p.ok) {
    return { ok: false, versao: p.textoBruto || '', obj: null, alertas: [{ id: 'C6', texto: 'Resposta do modelo em formato inesperado' }] };
  }
  const versao = p.obj.versao;

  const numOrig = indexarNumeros(extrairNumeros(original));
  const numVer = indexarNumeros(extrairNumeros(versao));

  // C1 — número na versão em quantidade acima do original (surgiu ou duplicou)
  for (const [k, q] of numVer.cont) if (q > (numOrig.cont.get(k) || 0)) alertas.push({ id: 'C1', texto: `Número que não está no original: ${numVer.amostra.get(k)}` });
  // C2 — número do original ausente ou com contagem reduzida na versão
  for (const [k, q] of numOrig.cont) if (q > (numVer.cont.get(k) || 0)) alertas.push({ id: 'C2', texto: `Número do original ausente: ${numOrig.amostra.get(k)}` });

  // C3 — termo protegido presente no original e ausente na versão (palavra inteira)
  const verFold = fold(versao);
  const origFold = fold(original);
  for (const termo of termosProtegidos) {
    const tf = fold(termo);
    if (contemTermoFold(origFold, tf) && !contemTermoFold(verFold, tf)) {
      alertas.push({ id: 'C3', texto: `Termo com efeito jurídico removido: ${termo}` });
    }
  }

  // C4 — versão BEM mais longa que o original. Crescer um pouco para explicar
  // melhor é legítimo (o alvo é clareza, não brevidade); só avisamos quando o
  // crescimento é grande (>30%). P4 (Explicar termos) é isento.
  const codigos = Array.isArray(promptCodigo) ? promptCodigo : [promptCodigo];
  const podeCrescer = codigos.some((c) => c === 'P4');
  if (!podeCrescer) {
    const nOrig = extrairPalavras(original).length;
    const nVer = extrairPalavras(versao).length;
    if (nVer > Math.ceil(nOrig * 1.3) + 4) alertas.push({ id: 'C4', texto: 'A versão ficou bem maior que o original' });
  }

  // C5 — frase acima de 40 palavras na versão
  for (const frase of segmentarFrases(versao)) {
    if (extrairPalavras(frase).length > 40) { alertas.push({ id: 'C5', texto: 'Ainda há frase com mais de 40 palavras' }); break; }
  }

  return { ok: true, versao, obj: p.obj, alertas };
}

// Confere uma versão já em TEXTO puro (a IA respondeu direto, sem JSON) contra o
// original. Só gera AVISOS (não bloqueia): a reescrita sempre é entregue.
function conferirVersao(original, versao, opts = {}) {
  const promptCodigo = opts.promptCodigo || '';
  const termosProtegidos = opts.termosProtegidos || [];
  const alertas = [];
  const numOrig = indexarNumeros(extrairNumeros(original));
  const numVer = indexarNumeros(extrairNumeros(versao));
  for (const [k, q] of numVer.cont) if (q > (numOrig.cont.get(k) || 0)) alertas.push({ id: 'C1', texto: `Número que não está no original: ${numVer.amostra.get(k)}` });
  for (const [k, q] of numOrig.cont) if (q > (numVer.cont.get(k) || 0)) alertas.push({ id: 'C2', texto: `Número do original ausente: ${numOrig.amostra.get(k)}` });
  const verFold = fold(versao), origFold = fold(original);
  for (const termo of termosProtegidos) {
    const tf = fold(termo);
    if (contemTermoFold(origFold, tf) && !contemTermoFold(verFold, tf)) alertas.push({ id: 'C3', texto: `Termo com efeito jurídico removido: ${termo}` });
  }
  const codigos = Array.isArray(promptCodigo) ? promptCodigo : [promptCodigo];
  const podeCrescer = codigos.some((c) => c === 'P4');
  if (!podeCrescer && extrairPalavras(versao).length > Math.ceil(extrairPalavras(original).length * 1.3) + 4) {
    alertas.push({ id: 'C4', texto: 'A versão ficou bem maior que o original' });
  }
  for (const frase of segmentarFrases(versao)) {
    if (extrairPalavras(frase).length > 40) { alertas.push({ id: 'C5', texto: 'Ainda há frase com mais de 40 palavras' }); break; }
  }
  return alertas;
}

export { conferir, conferirVersao, parseResposta, extrairNumeros };
