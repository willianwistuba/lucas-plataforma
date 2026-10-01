// importar/pdf.js — leitura de PDF com camada de texto (SPEC 5.1, E2).
// Reconstrói linhas e parágrafos a partir das posições dos itens de texto.
// É o módulo mais frágil da ferramenta, e isso é declarado ao usuário.

import * as pdfjsLib from '../../lib/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.mjs';

// Padrões fixos a descartar (cabeçalho/rodapé/carimbo).
const PADROES_LIXO = [
  /^p[áa]gina\s+\d+(\s+de\s+\d+)?$/i,
  /^\d+\s*\/\s*\d+$/,
  /^-?\s*\d+\s*-?$/,                 // numeração de página isolada
  /c[óo]pia de documento assinado digitalmente/i,
  /assinado digitalmente/i
];

function ehLixo(texto) {
  const t = texto.trim();
  if (!t) return true;
  return PADROES_LIXO.some((re) => re.test(t));
}

// ---------------------------------------------------------------------------
// Reparo de acentuação "Mac Roman".
// Alguns PDFs trazem fontes cuja tabela de caracteres faz o pdf.js extrair os
// acentos como símbolos (ç→Á, ã→„, é→È, í→Ì, ó→Û, ô→Ù, õ→ı, á→·, ê→Í...). O
// padrão vem de texto Windows-1252 lido como Mac Roman. Quando detectado, os
// caracteres são remapeados de volta. Só se aplica a documentos com essa
// assinatura, para nunca corromper PDFs extraídos corretamente.
// ---------------------------------------------------------------------------
const MAC_PT = {
  'Á': 'ç', '„': 'ã', '·': 'á', '‚': 'â', '‡': 'à',
  'È': 'é', 'Í': 'ê', 'Ì': 'í',
  'Û': 'ó', 'Ù': 'ô', 'ı': 'õ',
  '˙': 'ú', '¸': 'ü',
  '¡': 'Á', '¬': 'Â', '√': 'Ã', '¿': 'À',
  '∫': 'º', '™': 'ª', '∞': '°'
};
// Sinais que praticamente nunca ocorrem em português correto: sua presença
// repetida denuncia a má decodificação.
const SINAL_MAC = /[„·‚‡ı∫¬√¿¡˙¸]/g;
const REMAP_MAC = /[Á„·‚‡ÈÍÌÛÙı˙¸¡¬√¿∫™∞]/g;

function pareceMacRoman(texto) {
  const n = (texto.match(SINAL_MAC) || []).length;
  return n >= 4 && n / Math.max(1, texto.length) > 0.001;
}

function repararMacRoman(texto) {
  return texto.replace(REMAP_MAC, (c) => MAC_PT[c] || c);
}

function mediana(nums) {
  if (!nums.length) return 0;
  const s = nums.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Agrupa os itens de uma página em linhas, pela posição vertical.
function itensEmLinhas(itens) {
  // cada item: { str, x, y, h, w }
  const linhas = [];
  for (const it of itens) {
    let alvo = null;
    for (const l of linhas) {
      const tol = Math.max(l.h, it.h) * 0.5;
      if (Math.abs(l.y - it.y) <= tol) { alvo = l; break; }
    }
    if (!alvo) { alvo = { y: it.y, h: it.h, itens: [] }; linhas.push(alvo); }
    alvo.itens.push(it);
    alvo.y = (alvo.y + it.y) / 2;
    alvo.h = Math.max(alvo.h, it.h);
  }
  // ordena linhas de cima para baixo (y do pdf cresce para cima)
  linhas.sort((a, b) => b.y - a.y);
  return linhas.map((l) => {
    l.itens.sort((a, b) => a.x - b.x);
    // Junção sensível ao espaçamento: só insere espaço quando há afastamento
    // horizontal real entre os pedaços (evita "TC - 008554" e "04 /0 3").
    let texto = '';
    for (let k = 0; k < l.itens.length; k++) {
      const it = l.itens[k];
      if (k === 0) { texto = it.str; continue; }
      const prev = l.itens[k - 1];
      const gap = it.x - (prev.x + (prev.w || 0));
      const limiar = (Math.max(prev.h, it.h) || 10) * 0.22;
      const jaTemEspaco = /\s$/.test(prev.str) || /^\s/.test(it.str);
      texto += ((gap > limiar && !jaTemEspaco) ? ' ' : '') + it.str;
    }
    texto = texto.replace(/\s+/g, ' ').trim();
    const x0 = Math.min(...l.itens.map((i) => i.x));
    const x1 = Math.max(...l.itens.map((i) => i.x + (i.w || 0)));
    return { texto, y: l.y, h: l.h, x0, x1 };
  }).filter((l) => l.texto);
}

async function lerPdf(file, onProgresso) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const paginas = [];
  let totalChars = 0;

  for (let i = 1; i <= pdf.numPages; i++) {
    if (onProgresso) onProgresso(i, pdf.numPages);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const itens = [];
    for (const it of content.items) {
      const tr = it.transform; // [a,b,c,d,e,f]
      if (!it.str || !it.str.trim()) continue;
      // descarta texto girado (marca d'água lateral)
      if (Math.abs(tr[1]) > 0.01 || Math.abs(tr[2]) > 0.01) continue;
      const h = Math.abs(tr[3]) || it.height || 10;
      itens.push({ str: it.str, x: tr[4], y: tr[5], h, w: it.width || 0 });
      totalChars += it.str.length;
    }
    paginas.push(itensEmLinhas(itens));
  }

  // Repara acentuação mal decodificada (Mac Roman), se houver a assinatura —
  // antes de filtrar lixo e montar parágrafos, para que os padrões com acento
  // continuem funcionando.
  const amostra = paginas.flat().map((l) => l.texto).join('\n');
  if (pareceMacRoman(amostra)) {
    for (const pag of paginas) for (const l of pag) l.texto = repararMacRoman(l.texto);
  }

  // PDF digitalizado (sem camada de texto real)
  if (totalChars / Math.max(1, pdf.numPages) < 200) {
    const err = new Error('Este PDF parece ser uma imagem digitalizada. O LUCAS não lê imagens. Use um PDF com texto ou o arquivo original em Word.');
    err.codigo = 'PDF_DIGITALIZADO';
    throw err;
  }

  // Remove repetições de página (cabeçalho/rodapé): mesma linha em > metade das páginas.
  const contagem = {};
  for (const linhas of paginas) {
    const vistos = new Set();
    for (const l of linhas) {
      if (vistos.has(l.texto)) continue;
      vistos.add(l.texto);
      contagem[l.texto] = (contagem[l.texto] || 0) + 1;
    }
  }
  const limiar = paginas.length / 2;
  const repetida = (t) => paginas.length > 2 && contagem[t] > limiar;

  // Junta todas as linhas válidas, em ordem.
  const linhas = [];
  paginas.forEach((pag, pIdx) => {
    for (const l of pag) {
      if (ehLixo(l.texto) || repetida(l.texto)) continue;
      linhas.push(Object.assign({ pagina: pIdx + 1 }, l)); // guarda a página de origem da linha
    }
  });
  if (!linhas.length) throw new Error('Não consegui extrair texto legível do PDF.');

  // Espaçamento mediano entre linhas (para detectar quebra de parágrafo).
  const gaps = [];
  for (let i = 1; i < linhas.length; i++) {
    const g = linhas[i - 1].y - linhas[i].y;
    if (g > 0 && g < 100) gaps.push(g);
  }
  const gapMediano = mediana(gaps) || 12;
  const margemEsq = mediana(linhas.map((l) => l.x0));
  const larguraUtil = mediana(linhas.map((l) => l.x1 - margemEsq)) || 400;

  // Junta linhas em parágrafos.
  const paragrafos = []; // { texto, pagina }
  let atual = '';
  let paginaCorrente = linhas[0] ? linhas[0].pagina : 1; // página onde o parágrafo atual começou
  // Marcador de item de lista (a), I –, 1.1, 1. ) no início da linha.
  const marcadorLista = /^([a-z]\)|[IVXLC]{1,4}\s*[–-]|\d+(\.\d+)*[).\-]\s)/;

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const ant = linhas[i - 1];
    let novo = false;
    if (i === 0) {
      novo = true;
    } else {
      const gap = ant.y - l.y;
      // Recuo RELATIVO: esta linha está mais indentada que a anterior (recuo de
      // primeira linha). Blocos uniformemente indentados, como ementas, têm x0
      // constante e por isso NÃO são quebrados.
      const indentRelativo = l.x0 - ant.x0;
      const antTerminouFrase = /[.!?;:]\s*["'”’)\]]?\s*$/.test(ant.texto);
      // Erramos para o lado de UNIR: só quebra em sinais fortes. O usuário
      // divide com Enter e une com Backspace quando quiser.
      // Rótulo no início da linha (Assunto:, Responsável(is):, EMENTA:, etc.),
      // padrão dos cabeçalhos de voto do TCESP.
      const rotulo = /^([A-ZÀ-Þ][A-Za-zÀ-ÿ]*(\([^)]*\))?\s*:|EMENTA)/.test(l.texto);
      if (gap > gapMediano * 1.55) novo = true;                              // espaço vertical extra
      else if (indentRelativo > larguraUtil * 0.03 && antTerminouFrase) novo = true; // recuo de 1ª linha após frase
      else if (rotulo && antTerminouFrase) novo = true;                      // linha com rótulo após frase
      else if (marcadorLista.test(l.texto) && antTerminouFrase && gap > gapMediano * 1.1) novo = true; // item de lista
    }

    if (novo && atual) { paragrafos.push({ texto: atual.trim(), pagina: paginaCorrente }); atual = ''; }
    if (novo) paginaCorrente = l.pagina; // o novo parágrafo começa na página desta linha

    // desfaz hifenização: linha anterior terminada em hífen + atual iniciada por minúscula
    if (!novo && /[-­]$/.test(atual) && /^[a-zà-ÿ]/.test(l.texto)) {
      atual = atual.replace(/[-­]$/, '') + l.texto;
    } else {
      atual = atual ? atual + ' ' + l.texto : l.texto;
    }
  }
  if (atual.trim()) paragrafos.push({ texto: atual.trim(), pagina: paginaCorrente });

  return {
    paragrafos: paragrafos.map((p) => ({ texto: p.texto, emTabela: false, paginaOrigem: p.pagina })),
    aviso: 'Parágrafos reconstruídos a partir do PDF. Confira se algum parágrafo foi unido ou dividido indevidamente.',
    totalPaginas: pdf.numPages
  };
}

export { lerPdf };
