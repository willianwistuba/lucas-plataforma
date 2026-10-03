// detectores.js — detectores de dificuldade por parágrafo (SPEC 6.4).
// Determinístico, sem IA, sem rede (P5). Falso positivo é esperado e declarado.
//
// Cada detector devolve um "motivo": { id, gravidade, texto }.
// A margem exibe no máximo quatro motivos, por gravidade (SPEC 5.3).

import { extrairPalavras, segmentarFrases } from './metricas.js';

// D3 — sufixos de nominalização (radical com 5+ letras).
const SUFIXOS_NOMINALIZACAO = [
  'ções', 'ção', 'mentos', 'mento', 'dades', 'dade',
  'ências', 'ência', 'âncias', 'ância'
];

// D4 — formas do verbo "ser" que iniciam voz passiva.
const FORMAS_SER = new Set([
  'é', 'são', 'foi', 'foram', 'era', 'eram', 'será', 'serão',
  'seja', 'sejam', 'sendo', 'sido', 'for', 'forem', 'fosse', 'fossem',
  'sou', 'és', 'somos', 'éramos', 'fora', 'foras'
]);

// Particípio: terminações regulares + alguns irregulares comuns.
const IRREGULARES_PARTICIPIO = new Set([
  'feito', 'feita', 'feitos', 'feitas', 'dito', 'dita', 'ditos', 'ditas',
  'escrito', 'escrita', 'posto', 'posta', 'visto', 'vista', 'aberto', 'aberta',
  'coberto', 'gasto', 'pago', 'pagos'
]);

function ehParticipio(palavra) {
  const p = palavra.toLowerCase();
  if (IRREGULARES_PARTICIPIO.has(p)) return true;
  return /(ad[oa]s?|id[oa]s?)$/.test(p);
}

// D1 e D2 — frases longas. Um único apontamento por parágrafo (não um por frase):
// um parágrafo com três frases longas vira "3 frases longas: 55, 51 e 47 palavras",
// e não três linhas separadas. A gravidade segue a maior frase (>60 = D1).
function detectarFrasesLongas(texto) {
  const tamanhos = [];
  for (const frase of segmentarFrases(texto)) {
    const n = extrairPalavras(frase).length;
    if (n >= 41) tamanhos.push(n);
  }
  if (!tamanhos.length) return [];
  tamanhos.sort((a, b) => b - a);
  const id = tamanhos[0] > 60 ? 'D1' : 'D2';
  const gravidade = tamanhos[0] > 60 ? 3 : 2;
  let texto2;
  if (tamanhos.length === 1) {
    texto2 = `Frase longa: ${tamanhos[0]} palavras`;
  } else {
    const lista = tamanhos.join(', ').replace(/, (\d+)$/, ' e $1');
    texto2 = `${tamanhos.length} frases longas: ${lista} palavras`;
  }
  return [{ id, gravidade, texto: texto2 }];
}

// Junta uma lista de itens num rótulo curto e legível, com reticências quando
// há mais do que o limite. Ex.: (["a","b","c","d"], 3) -> "a, b, c… (+1)".
function rotularItens(itens, limite = 4) {
  const unicos = [];
  const vistos = new Set();
  for (const it of itens) {
    const k = String(it).toLowerCase();
    if (!vistos.has(k)) { vistos.add(k); unicos.push(it); }
  }
  if (unicos.length <= limite) return unicos.join(', ');
  return unicos.slice(0, limite).join(', ') + `… (+${unicos.length - limite})`;
}

// D3 — nominalização.
function detectarNominalizacao(texto) {
  const palavras = extrairPalavras(texto);
  const achados = [];
  for (const w of palavras) {
    const p = w.toLowerCase();
    for (const suf of SUFIXOS_NOMINALIZACAO) {
      if (p.endsWith(suf) && p.length - suf.length >= 5) { achados.push(w); break; }
    }
  }
  if (achados.length >= 4) {
    return [{ id: 'D3', gravidade: 2, itens: achados,
      texto: `${achados.length} substantivos no lugar de verbos: ${rotularItens(achados)}` }];
  }
  return [];
}

// D4 — voz passiva.
function detectarVozPassiva(texto) {
  const palavras = extrairPalavras(texto);
  for (let i = 0; i < palavras.length - 1; i++) {
    if (FORMAS_SER.has(palavras[i].toLowerCase()) && ehParticipio(palavras[i + 1])) {
      return [{ id: 'D4', gravidade: 1, texto: 'Possível voz passiva' }];
    }
  }
  return [];
}

// D5 — sigla sem abertura.
function detectarSiglaSemAbertura(texto) {
  const siglas = texto.match(/(?<![A-Za-zÀ-ÿ])[A-ZÁÉÍÓÚÀÂÊÔÃÕÇÜ]{2,7}(?![A-Za-zÀ-ÿ])/g) || [];
  if (!siglas.length) return [];

  // Siglas "abertas": as que aparecem entre parênteses, ex.: "... (DIPE) ...".
  const definidas = new Set();
  const emParenteses = texto.match(/\(([A-ZÁÉÍÓÚÀÂÊÔÃÕÇÜ]{2,7})\)/g) || [];
  for (const m of emParenteses) definidas.add(m.replace(/[()]/g, ''));

  for (const s of siglas) {
    if (!definidas.has(s)) {
      return [{ id: 'D5', gravidade: 2, texto: `Sigla sem abertura: ${s}` }];
    }
  }
  return [];
}

// D6 e D7 — termos do dicionário. `buscarTermos` recebe o texto e devolve
// { substituir: n, explicar: n } (injetado pelo módulo dicionario.js).
function detectarTermosDicionario(texto, buscarTermos) {
  if (typeof buscarTermos !== 'function') return [];
  const r = buscarTermos(texto) || {};
  const substituir = r.substituir || 0, explicar = r.explicar || 0;
  const listaSub = r.termosSubstituir || [], listaExp = r.termosExplicar || [];
  const motivos = [];
  if (substituir > 0) {
    const rotulo = listaSub.length ? `: ${rotularItens(listaSub)}` : '';
    motivos.push({
      id: 'D6', gravidade: 1, itens: listaSub,
      texto: (substituir === 1 ? '1 termo com alternativa mais simples' : `${substituir} termos com alternativa mais simples`) + rotulo
    });
  }
  if (explicar > 0) {
    const rotulo = listaExp.length ? `: ${rotularItens(listaExp)}` : '';
    motivos.push({
      id: 'D7', gravidade: 1, itens: listaExp,
      texto: (explicar === 1 ? '1 termo que pede explicação' : `${explicar} termos que pedem explicação`) + rotulo
    });
  }
  return motivos;
}

// D8 — intercalação.
function detectarIntercalacao(texto) {
  const virgulas = (texto.match(/,/g) || []).length;
  const parenteses = (texto.match(/\)/g) || []).length;
  const travessoes = (texto.match(/[—–]/g) || []).length;
  const pares = Math.floor(virgulas / 2) + parenteses + Math.floor(travessoes / 2);
  if (pares >= 3) {
    return [{ id: 'D8', gravidade: 1, texto: `Muitos apartes intercalados (cerca de ${pares})` }];
  }
  return [];
}

// Explicação, em linguagem clara, de cada motivo detectado. Aparece no
// "Detalhes" do card para o autor entender o que observar e como corrigir.
// Chaveada pelo id do detector (D1..D8).
const EXPLICACOES = {
  D1: 'Frase muito longa. Frases extensas obrigam o leitor a guardar muita informação de uma vez. Procure uma ideia por frase e divida em frases mais curtas (ABNT NBR ISO 24495-1, 5.3.3).',
  D2: 'Frase longa. Considere dividi-la em frases menores, uma ideia por vez, para facilitar a leitura.',
  D3: 'Substantivos abstratos no lugar de verbos. Palavras terminadas em -ção, -mento ou -dade (ex.: “realização”, “cumprimento”, “aplicabilidade”) deixam o texto pesado e impessoal. Prefira o verbo correspondente (“realizar”, “cumprir”, “aplicar”).',
  D4: 'Possível voz passiva. A voz passiva esconde quem pratica a ação (“foi decidido” em vez de “o Tribunal decidiu”). Prefira a voz ativa, deixando o agente visível.',
  D5: 'Sigla sem apresentação. Na primeira vez que a sigla aparece, escreva o nome por extenso seguido da sigla entre parênteses — ex.: “Tribunal de Contas do Estado (TCE)”.',
  D6: 'Há termos com uma alternativa mais simples cadastrada no dicionário. Selecione o termo no texto para ver e aplicar a sugestão.',
  D7: 'Há termos técnicos que um leitor sem formação jurídica pode não conhecer. Explique na primeira ocorrência, mantendo o termo, ou crie uma nota de rodapé.',
  D8: 'Muitas informações intercaladas (entre vírgulas, parênteses ou travessões) interrompem o fio da leitura. Separe em frases ou reduza os apartes.'
};

// Roda todos os detectores sobre um parágrafo.
// opts.buscarTermos: função opcional para D6/D7 (do módulo dicionario.js).
function detectar(texto, opts = {}) {
  const motivos = [
    ...detectarFrasesLongas(texto),
    ...detectarNominalizacao(texto),
    ...detectarVozPassiva(texto),
    ...detectarSiglaSemAbertura(texto),
    ...detectarTermosDicionario(texto, opts.buscarTermos),
    ...detectarIntercalacao(texto)
  ];
  // Ordenar por gravidade decrescente (a margem mostra os quatro primeiros).
  motivos.sort((a, b) => b.gravidade - a.gravidade);
  return motivos;
}

export {
  detectar,
  EXPLICACOES,
  detectarFrasesLongas,
  detectarNominalizacao,
  detectarVozPassiva,
  detectarSiglaSemAbertura,
  detectarIntercalacao
};
