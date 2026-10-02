// exportar/docx.js — gera um DOCX a partir do documento atual (SPEC 13).
// Gera um pacote DOCX do zero (abre no Word e no LibreOffice sem aviso de
// reparo) com: fonte Arial 12, espaçamento 1,5, título no topo, glossário
// (quando houver apêndice) e COMENTÁRIOS NATIVOS do Word nos parágrafos
// problemáticos. Usa window.JSZip (script global, sem imports de módulo).

import { exportarDocxComOriginal } from './docx-original.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// Nomes das faixas por extenso, para exibir no texto do comentário.
const NOME_FAIXA = {
  'muito-facil': 'Muito fácil',
  'facil': 'Fácil',
  'razoavel': 'Razoavelmente difícil',
  'dificil': 'Muito difícil',
  'neutra': 'Neutra',
};

// Escapa caracteres especiais de XML em qualquer texto visível.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Monta o run de texto padrão (Arial, tamanho em meio-pontos, negrito opcional).
function runXml(texto, opc = {}) {
  const negrito = opc.negrito ? '<w:b/>' : '';
  const sz = opc.sz || 24; // meio-pontos -> 24 = 12pt
  return `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="${sz}"/>${negrito}</w:rPr>` +
    `<w:t xml:space="preserve">${esc(texto)}</w:t></w:r>`;
}

// Parágrafo simples de texto (título ou linha comum).
function paragrafoXml(texto, opc = {}) {
  const spacing = '<w:spacing w:line="360" w:lineRule="auto" w:after="160"/>';
  return `<w:p><w:pPr>${spacing}</w:pPr>${runXml(texto, opc)}</w:p>`;
}

// Run da marca da nota de rodapé (número sobrescrito) ancorada no texto.
function footnoteRefRun(fid) {
  return `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${fid}"/></w:r>`;
}

// Constrói os runs de um parágrafo inserindo a marca da nota logo após a
// primeira ocorrência do termo de cada nota (ou no fim, se não encontrar).
function runsComNotas(texto, notas) {
  if (!notas || !notas.length) return runXml(texto);
  const pts = notas.map((nt) => {
    let base = -1;
    if (typeof nt.posicao === 'number' && nt.posicao >= 0) base = nt.posicao;
    else if (nt.termo) base = texto.indexOf(nt.termo);
    const pos = base >= 0 ? base + String(nt.termo || '').length : texto.length;
    return { pos, fid: nt.fid };
  }).sort((a, b) => a.pos - b.pos);
  let out = ''; let cursor = 0;
  for (const pt of pts) {
    const seg = texto.slice(cursor, pt.pos);
    if (seg) out += runXml(seg);
    out += footnoteRefRun(pt.fid);
    cursor = pt.pos;
  }
  const resto = texto.slice(cursor);
  if (resto) out += runXml(resto);
  return out;
}

// Parágrafo do corpo: aceita notas de rodapé (marcas no texto) e, opcionalmente,
// um comentário nativo ancorado no parágrafo inteiro (cid != null).
function paragrafoCorpoXml(texto, notas, cid) {
  const spacing = '<w:spacing w:line="360" w:lineRule="auto" w:after="160"/>';
  const runs = runsComNotas(texto, notas);
  if (cid == null) return `<w:p><w:pPr>${spacing}</w:pPr>${runs}</w:p>`;
  const ref = `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${cid}"/></w:r>`;
  return `<w:p><w:pPr>${spacing}</w:pPr>` +
    `<w:commentRangeStart w:id="${cid}"/>${runs}<w:commentRangeEnd w:id="${cid}"/>${ref}</w:p>`;
}

// Agrupa as notas do documento por parágrafo, na ordem de aparição, atribuindo
// o id sequencial (a partir de 1) que o Word usa em footnotes.xml.
function coletarNotas(doc) {
  const notas = doc.notas || [];
  const porPar = new Map();
  const lista = []; // { fid, texto } na ordem
  let fid = 1;
  // Posição da nota no parágrafo: usa a posição exata gravada na criação; se não
  // houver, cai para a primeira ocorrência do termo. É o que garante que a
  // numeração siga a ordem do documento (como no Word), não a ordem de criação.
  const pos = (t, n) => {
    if (typeof n.posicao === 'number' && n.posicao >= 0) return n.posicao;
    if (n.termo) { const i = String(t).toLowerCase().indexOf(String(n.termo).toLowerCase()); return i < 0 ? Number.MAX_SAFE_INTEGER : i; }
    return Number.MAX_SAFE_INTEGER;
  };
  for (const p of doc.paragrafos) {
    const t = p.texto || '';
    const doPar = notas.filter((n) => n.parId === p.id).sort((a, b) => pos(t, a) - pos(t, b));
    if (!doPar.length) continue;
    porPar.set(p.id, doPar.map((n) => {
      lista.push({ fid, texto: n.texto });
      return { termo: n.termo, posicao: n.posicao, fid: fid++ };
    }));
  }
  return { porPar, lista };
}

// footnotes.xml: os dois separadores obrigatórios do Word (sem eles o arquivo é
// acusado de corrompido) mais uma nota por item.
function footnotesXml(lista) {
  const notas = lista.map((n) =>
    `<w:footnote w:id="${n.fid}"><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve"> ${esc(n.texto)}</w:t></w:r>` +
    `</w:p></w:footnote>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:footnotes xmlns:w="${W}">` +
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    notas + `</w:footnotes>`;
}

// Sem análise por IA, só os detectores confiáveis (tamanho de frase e siglas)
// entram no comentário; os demais são heurísticas que erram muito. Com IA, tudo.
const MOTIVOS_SEM_IA = new Set(['D1', 'D2', 'D5']);
function motivosDoc(p) {
  const todos = (p && p.motivos) || [];
  if (p && p.avaliacaoIA) return todos;
  return todos.filter((m) => MOTIVOS_SEM_IA.has(m.id));
}

// Decide se um parágrafo deve receber comentário: não pode estar em tabela e
// precisa ter algum motivo grave (gravidade >= 2) ou faixa difícil/razoável.
function precisaComentario(p) {
  if (p.emTabela) return false;
  const faixa = (p.clareza && p.clareza.faixa) || (p.metricas && p.metricas.faixa);
  if (faixa === 'dificil' || faixa === 'razoavel') return true;
  if (p.avaliacaoIA && p.avaliacaoIA.sugestoes && p.avaliacaoIA.sugestoes.length) return true;
  return motivosDoc(p).some((m) => (m.gravidade || 0) >= 2);
}

// Monta as linhas de texto do comentário: faixa por extenso + um motivo por linha.
function linhasComentario(p) {
  const cl = p.clareza || {};
  const faixa = cl.faixa || (p.metricas && p.metricas.faixa);
  const linhas = [];
  if (cl.nota != null) linhas.push(`Avaliação do LUCAS: Índice de Clareza ${cl.nota}/100`);
  else if (faixa === 'neutra' || !NOME_FAIXA[faixa]) linhas.push('Avaliação do LUCAS: “Neutra” (conecte a IA para medir a clareza)');
  else linhas.push(`Avaliação do LUCAS: ${NOME_FAIXA[faixa]}`);
  for (const m of motivosDoc(p)) {
    if (m && m.texto) linhas.push(m.texto);
  }
  const sug = (p.avaliacaoIA && p.avaliacaoIA.sugestoes) || [];
  if (sug.length) {
    linhas.push('Sugestões de clareza (IA):');
    for (const s of sug) if (s) linhas.push('- ' + String(s));
  }
  return linhas;
}

// Célula de tabela do glossário.
function celulaXml(texto, negrito) {
  const b = negrito ? '<w:b/>' : '';
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/>${b}</w:rPr>` +
    `<w:t xml:space="preserve">${esc(texto)}</w:t></w:r></w:p></w:tc>`;
}

// Bloco do glossário: quebra de página, título, introdução e tabela.
function glossarioXml(apendice) {
  if (!apendice || !apendice.length) return '';
  const linhas = apendice.slice().sort((a, b) => a.termo.localeCompare(b.termo, 'pt'));
  const borda = '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((l) =>
      `<w:${l} w:val="single" w:sz="4" w:space="0" w:color="D6DDE8"/>`).join('') +
    '</w:tblBorders>';
  const cab = `<w:tr>${celulaXml('Termo', true)}${celulaXml('O que significa', true)}</w:tr>`;
  const corpo = linhas.map((v) => `<w:tr>${celulaXml(v.termo, true)}${celulaXml(v.explicacao, false)}</w:tr>`).join('');
  return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` +
    paragrafoXml('Glossário', { negrito: true, sz: 28 }) +
    paragrafoXml('Explicação, em linguagem simples, dos termos técnicos usados neste documento.') +
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borda}</w:tblPr>${cab}${corpo}</w:tbl>`;
}

// Percorre os parágrafos e produz: XML do corpo + lista de comentários.
// Cada comentário recebe um id sequencial começando em 0.
function construir(doc) {
  const corpo = [];
  const comentarios = []; // { id, linhas: string[] }
  let proxId = 0;
  const { porPar, lista: notas } = coletarNotas(doc);

  if (doc.nomeArquivo) {
    corpo.push(paragrafoXml(doc.nomeArquivo.replace(/\.[^.]+$/, ''), { negrito: true, sz: 32 }));
  }

  for (const p of doc.paragrafos) {
    if (!p.texto || !p.texto.trim()) continue;
    const notasDoP = porPar.get(p.id) || null;
    let cid = null;
    if (precisaComentario(p)) {
      cid = proxId++;
      comentarios.push({ id: cid, linhas: linhasComentario(p) });
    }
    corpo.push(paragrafoCorpoXml(p.texto, notasDoP, cid));
  }

  corpo.push(glossarioXml(doc.apendice));

  return { corpoXml: corpo.join(''), comentarios, notas };
}

// document.xml completo a partir do XML do corpo.
function documentoXml(corpoXml) {
  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}"><w:body>${corpoXml}${sect}</w:body></w:document>`;
}

// comments.xml: um w:comment por comentário, com um w:p por linha de texto.
function comentariosXml(comentarios) {
  const data = new Date().toISOString();
  const partes = comentarios.map((c) => {
    const paras = c.linhas.map((linha) =>
      `<w:p><w:r><w:t xml:space="preserve">${esc(linha)}</w:t></w:r></w:p>`).join('');
    return `<w:comment w:id="${c.id}" w:author="LUCAS" w:date="${esc(data)}" w:initials="LU">${paras}</w:comment>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:comments xmlns:w="${W}">${partes}</w:comments>`;
}

// [Content_Types].xml — inclui os overrides de comments/footnotes só quando há.
function contentTypesXml(temComentarios, temNotas) {
  const oc = temComentarios
    ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'
    : '';
  const of = temNotas
    ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    oc + of +
    `</Types>`;
}

// _rels/.rels — relação raiz para o documento principal.
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

// word/_rels/document.xml.rels — relações para comments.xml e footnotes.xml.
function documentRelsXml(temComentarios, temNotas) {
  const rels = [];
  if (temComentarios) rels.push('<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>');
  if (temNotas) rels.push('<Relationship Id="rIdFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rels.join('') +
    `</Relationships>`;
}

async function exportarDocx(doc, nome) {
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error('Biblioteca de DOCX (JSZip) não carregada.');

  // Origem DOCX: exporta clonando o Word original (preserva toda a formatação).
  if (doc.zip) return exportarDocxComOriginal(doc, nome);

  const { corpoXml, comentarios, notas } = construir(doc);
  const temComentarios = comentarios.length > 0;
  const temNotas = notas.length > 0;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml(temComentarios, temNotas));
  zip.folder('_rels').file('.rels', RELS);
  const word = zip.folder('word');
  word.file('document.xml', documentoXml(corpoXml));
  if (temComentarios) word.file('comments.xml', comentariosXml(comentarios));
  if (temNotas) word.file('footnotes.xml', footnotesXml(notas));
  // O document.xml.rels é necessário quando há comentários e/ou notas.
  if (temComentarios || temNotas) {
    word.folder('_rels').file('document.xml.rels', documentRelsXml(temComentarios, temNotas));
  }

  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const base = (nome || doc.nomeArquivo || 'documento').replace(/\.[^.]+$/, '');
  const a = document.createElement('a');
  a.href = url; a.download = base + '-linguagem-simples.docx';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { exportarDocx };
