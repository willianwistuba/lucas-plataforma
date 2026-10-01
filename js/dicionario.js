// dicionario.js — localização de termos no texto e dados dos verbetes (SPEC 8).
// Tudo aqui é determinístico (a reescrita com IA fica no módulo de conversão).

let VERBETES = [];
let FORMAS = []; // { formaFold, verbete } ordenado por tamanho decrescente

// Remove acentos preservando o comprimento (1 caractere -> 1 caractere),
// para que os índices do texto dobrado casem com os do texto original.
function foldChar(ch) {
  const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return (base || ch).toLowerCase();
}
function fold(s) {
  let out = '';
  for (const ch of String(s)) out += foldChar(ch);
  return out;
}

function carregar(verbetes) {
  VERBETES = Array.isArray(verbetes) ? verbetes : [];
  FORMAS = [];
  for (const v of VERBETES) {
    const formas = [v.termo, ...(v.variantes || [])];
    for (const f of formas) {
      if (f) FORMAS.push({ formaFold: fold(f).trim().replace(/\s+/g, ' '), verbete: v });
    }
  }
  // Termos compostos (mais longos) têm prioridade sobre os contidos neles (SPEC 8.2.3).
  FORMAS.sort((a, b) => b.formaFold.length - a.formaFold.length);
}

function lookup(termo) {
  const f = fold(termo).trim().replace(/\s+/g, ' ');
  const achado = FORMAS.find((x) => x.formaFold === f);
  return achado ? achado.verbete : null;
}

// Escapa uma forma para uso em regex, tolerando múltiplos espaços entre palavras.
function regexDaForma(formaFold) {
  const partes = formaFold.split(' ').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const corpo = partes.join('\\s+');
  // Fronteira de palavra baseada em letras (SPEC 8.2.2).
  return new RegExp('(?<![\\p{L}])' + corpo + '(?![\\p{L}])', 'giu');
}

// Localiza todas as ocorrências não sobrepostas dos termos no texto.
// Retorna [{ inicio, fim, verbete }] em ordem de posição.
function localizar(texto) {
  const alvo = fold(texto);
  const ranges = [];

  const ocupado = (ini, fim) => ranges.some((r) => ini < r.fim && fim > r.inicio);

  for (const { formaFold, verbete } of FORMAS) {
    const re = regexDaForma(formaFold);
    let m;
    while ((m = re.exec(alvo)) !== null) {
      const ini = m.index;
      const fim = m.index + m[0].length;
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (!ocupado(ini, fim)) ranges.push({ inicio: ini, fim, verbete });
    }
  }
  ranges.sort((a, b) => a.inicio - b.inicio);
  return ranges;
}

// Contagem por tratamento, usada pelos detectores D6/D7. Além da contagem,
// devolve os TERMOS concretos encontrados (distintos), para que os detectores
// possam listá-los — "3 termos com alternativa simples" vale pouco sem dizer
// quais são.
function buscarContagem(texto) {
  const ranges = localizar(texto);
  let substituir = 0, explicar = 0;
  const listaSub = [], listaExp = [];
  const vistosSub = new Set(), vistosExp = new Set();
  for (const r of ranges) {
    const termo = texto.slice(r.inicio, r.fim);
    if (r.verbete.tratamento === 'substituir') {
      substituir++;
      const chave = fold(termo);
      if (!vistosSub.has(chave)) { vistosSub.add(chave); listaSub.push(termo); }
    } else {
      explicar++;
      const chave = fold(termo);
      if (!vistosExp.has(chave)) { vistosExp.add(chave); listaExp.push(termo); }
    }
  }
  return { substituir, explicar, termosSubstituir: listaSub, termosExplicar: listaExp };
}

// Gera HTML do parágrafo com os termos sublinhados, escapando o restante.
function sublinhar(texto) {
  const ranges = localizar(texto);
  if (!ranges.length) return escaparHtml(texto);

  let html = '';
  let cursor = 0;
  for (const r of ranges) {
    html += escaparHtml(texto.slice(cursor, r.inicio));
    const trecho = escaparHtml(texto.slice(r.inicio, r.fim));
    const cls = r.verbete.tratamento === 'substituir' ? 'substituir' : 'explicar';
    html += `<span class="termo ${cls}" data-verbete="${r.verbete.id}">${trecho}</span>`;
    cursor = r.fim;
  }
  html += escaparHtml(texto.slice(cursor));
  return html;
}

function escaparHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function todos() { return VERBETES; }

export { carregar, lookup, localizar, buscarContagem, sublinhar, todos, fold };
