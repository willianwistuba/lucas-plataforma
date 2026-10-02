// metricas.js — motor de métricas por parágrafo e por documento.
// SPEC secoes 6.1, 6.2, 6.5. Determinístico, sem IA, sem rede (P5).

import { contarSilabas } from './silabas.js';

// Abaixo deste nº de palavras o índice de facilidade fica estatisticamente
// instável (uma frase muito curta gera valores extremos), então o parágrafo
// recebe só os detectores. 25 dá índice à maioria dos parágrafos reais de voto
// e ainda protege fragmentos minúsculos (títulos, "É o relatório.").
const MIN_PALAVRAS_INDICE = 25;

// Coeficientes do índice de facilidade (SPEC 6.5).
// Flesch (1948) 206,835 + 42 (Martins et al., 1996) = 248,835. Forma do NILC.
const A = 248.835;
const B = 1.015;
const C = 84.6;

// Abreviaturas cujo ponto NÃO encerra frase (SPEC 6.2).
const ABREVIATURAS = [
  'art', 'arts', 'inc', 'incs', 'fls', 'fl', 'dr', 'dra', 'sr', 'sra', 'srs',
  'cf', 'pp', 'pag', 'pags', 'pág', 'proc', 'ed', 'séc', 'sec', 'ss',
  'ex', 'exmo', 'exma', 'ilmo', 'obs', 'ref', 'op', 'cit', 'nº'
];
// 'p' e 'n' sozinhos NÃO entram na lista acima: "p. Agora" é fim de frase, não
// abreviatura. Mas "p. 5" / "n. 10" (página/item) são referências; protegemos o
// ponto só quando vier um número logo depois.

const MARCA_PONTO = ''; // marcador temporário para pontos protegidos

// Extrai palavras (SPEC 6.2). Números e códigos não contam.
function extrairPalavras(texto) {
  return String(texto || '').match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*/g) || [];
}

// Segmenta um texto em frases (SPEC 6.2).
function segmentarFrases(texto) {
  let t = ' ' + String(texto || '') + ' ';

  // Proteger o ponto das abreviaturas conhecidas.
  for (const a of ABREVIATURAS) {
    const raiz = a.replace('.', '');
    const re = new RegExp('(\\b' + raiz + ')\\.', 'gi');
    t = t.replace(re, '$1' + MARCA_PONTO);
  }

  // "p." / "n." seguidos de número (página/item) não encerram frase.
  t = t.replace(/\b([pn])\.(\s*\d)/gi, '$1' + MARCA_PONTO + '$2');

  // Proteger pontos e barras internos de números (14.133, 1.017,18, TC-013176.989.26-7).
  t = t.replace(/(\d)([.\/])(\d)/g, '$1' + MARCA_PONTO + '$3');

  // Dividir após . ! ? ; seguidos de espaço e início de frase
  // (maiúscula, número, abre-parêntese ou marcador de lista).
  const partes = t.split(/(?<=[.!?;])\s+(?=[A-ZÀ-Þ0-9(])/);

  return partes
    .map((s) => s.replace(new RegExp(MARCA_PONTO, 'g'), '.').trim())
    .filter((s) => /[A-Za-zÀ-ÿ0-9]/.test(s));
}

// Faixa de facilidade a partir do índice (SPEC 6.5).
function faixaDe(facilidade) {
  if (facilidade >= 75) return 'muito-facil';
  if (facilidade >= 50) return 'facil';
  if (facilidade >= 25) return 'razoavel';
  return 'dificil';
}

const NOME_FAIXA = {
  'muito-facil': 'Muito fácil',
  'facil': 'Fácil',
  'razoavel': 'Razoavelmente difícil',
  'dificil': 'Muito difícil',
  'neutra': 'Índice não calculado'
};

function nomeFaixa(faixa) {
  return NOME_FAIXA[faixa] || faixa;
}

// Calcula o índice de facilidade de um texto (parágrafo ou documento inteiro).
// Retorna null quando não há palavras ou frases suficientes.
function calcularFacilidade(texto) {
  const palavras = extrairPalavras(texto);
  const frases = segmentarFrases(texto);
  const nPalavras = palavras.length;
  const nFrases = Math.max(1, frases.length);
  if (nPalavras === 0) return null;

  const nSilabas = contarSilabas(palavras);
  const asl = nPalavras / nFrases;              // palavras por frase
  const asw = nSilabas / nPalavras;             // sílabas por palavra
  const facilidade = A - B * asl - C * asw;
  const facilidadeArred = Math.round(facilidade * 10) / 10;

  return {
    facilidade: facilidadeArred,
    faixa: faixaDe(facilidadeArred),
    palavras: nPalavras,
    frases: nFrases,
    silabas: nSilabas,
    asl: Math.round(asl * 100) / 100,
    asw: Math.round(asw * 100) / 100
  };
}

// Métricas de um parágrafo. Abaixo de 40 palavras: sem índice (faixa neutra).
function metricasParagrafo(texto, emTabela = false) {
  const palavras = extrairPalavras(texto);
  const base = {
    palavras: palavras.length,
    frases: segmentarFrases(texto).length,
    curto: palavras.length < MIN_PALAVRAS_INDICE,
    emTabela: !!emTabela
  };

  // Parágrafos em tabela não são medidos (SPEC 6.1).
  if (emTabela || base.curto) {
    return { ...base, facilidade: null, faixa: 'neutra' };
  }

  const r = calcularFacilidade(texto);
  return { ...base, facilidade: r.facilidade, faixa: r.faixa, silabas: r.silabas, asl: r.asl, asw: r.asw };
}

// Métricas do documento: índice sobre o texto inteiro de uma vez (SPEC 6.5),
// mais a distribuição de faixas dos parágrafos.
function metricasDocumento(paragrafos) {
  const textoInteiro = paragrafos
    .filter((p) => !p.emTabela)
    .map((p) => p.texto)
    .join('\n\n');

  const r = calcularFacilidade(textoInteiro);

  const distribuicao = { 'muito-facil': 0, 'facil': 0, 'razoavel': 0, 'dificil': 0, 'neutra': 0 };
  let pior = null;
  for (const p of paragrafos) {
    const faixa = (p.metricas && p.metricas.faixa) || 'neutra';
    distribuicao[faixa] = (distribuicao[faixa] || 0) + 1;
    const fac = p.metricas && p.metricas.facilidade;
    if (fac != null && (pior === null || fac < pior.facilidade)) {
      pior = { id: p.id, facilidade: fac, faixa };
    }
  }

  return {
    facilidade: r ? r.facilidade : null,
    faixa: r ? r.faixa : 'neutra',
    palavras: r ? r.palavras : 0,
    frases: r ? r.frases : 0,
    distribuicao,
    pior
  };
}

export {
  extrairPalavras,
  segmentarFrases,
  faixaDe,
  nomeFaixa,
  calcularFacilidade,
  metricasParagrafo,
  metricasDocumento,
  MIN_PALAVRAS_INDICE
};
