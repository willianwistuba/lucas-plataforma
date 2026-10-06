// exportar/conversor.js — exporta o produto do módulo Conversor (explicação em
// linguagem simples, SEM valor jurídico) em DOCX, TXT ou PDF (impressão).
// O texto convertido vem em Markdown (## título, **negrito**, - tópicos); aqui
// ele é renderizado. Toda saída carrega o disclaimer, o link do documento
// oficial e o responsável pela validação (textos-padrão quando não informados).

// ---------------------------------------------------------------------------
// Rodapé jurídico (defensivo).
// ---------------------------------------------------------------------------
function montarRodape(form = {}) {
  const link = String(form.linkOficial || '').trim();
  const nome = String(form.respNome || '').trim();
  const cargo = String(form.respCargo || '').trim();
  const ident = String(form.respId || '').trim();
  const temResp = nome || cargo || ident;

  const aviso =
    'AVISO — VERSÃO EM LINGUAGEM SIMPLES, SEM VALOR OFICIAL. Este documento é uma explicação ' +
    'em linguagem simples, de caráter meramente informativo, produzida para facilitar a ' +
    'compreensão do documento oficial correspondente. NÃO substitui o documento oficial, NÃO ' +
    'possui validade jurídica, NÃO é ato oficial e NÃO produz efeitos legais. Em caso de dúvida, ' +
    'omissão ou divergência entre esta versão e o documento oficial, prevalece integralmente o ' +
    'DOCUMENTO OFICIAL, única fonte autêntica e vinculante. O resumo pode conter imprecisões.';

  const linhaOficial = link
    ? `Documento oficial (fonte autêntica e vinculante): ${link}`
    : 'Documento oficial: esta versão foi produzida SEM a indicação de um link público para o ' +
      'documento oficial. Consulte sempre o documento oficial diretamente com o órgão emissor.';

  const linhaResp = temResp
    ? `Validação humana desta versão: ${[nome, cargo, ident].filter(Boolean).join(' — ')}.`
    : 'Validação humana: esta versão foi produzida SEM a identificação de um responsável pela ' +
      'validação humana do resultado convertido.';

  const lucas =
    'Gerado com apoio da plataforma LUCAS, facilitador para a aplicação de linguagem simples ' +
    'com base na Lei nº 15.263/2025 e na ABNT NBR ISO 24495. A plataforma LUCAS NÃO é órgão ' +
    'emissor de documentos oficiais, não assume autoria do conteúdo nem responsabilidade final ' +
    'pela conversão, e não responde por decisões tomadas com base nesta versão.';

  return { aviso, linhaOficial, linhaResp, lucas };
}

// ---------------------------------------------------------------------------
// Markdown mínimo (a explicação sai em Markdown). Cada linha não vazia é um bloco.
// ---------------------------------------------------------------------------
function parseMd(md) {
  const blocos = [];
  for (const raw of String(md || '').replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) blocos.push({ tipo: 'h', nivel: m[1].length, texto: m[2] });
    else if ((m = l.match(/^[-*]\s+(.*)$/))) blocos.push({ tipo: 'li', texto: m[1] });
    else if ((m = l.match(/^>\s?(.*)$/))) blocos.push({ tipo: 'quote', texto: m[1] });
    else blocos.push({ tipo: 'p', texto: l });
  }
  return blocos;
}
// Divide um texto em partes negrito/normal (**assim**).
function inlineParts(text) {
  const parts = []; const re = /\*\*([^*]+)\*\*/g; let m, last = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index), b: false });
    parts.push({ t: m[1], b: true }); last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ t: text.slice(last), b: false });
  return parts.length ? parts : [{ t: text, b: false }];
}

function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function nomeBase(produto) {
  return String((produto && produto.nome) || 'documento')
    .replace(/\.(docx|pdf|txt|md)$/i, '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'documento';
}

// ---------------------------------------------------------------------------
// TXT
// ---------------------------------------------------------------------------
function mdToTxt(md) {
  return parseMd(md).map((b) => {
    const t = b.texto.replace(/\*\*([^*]+)\*\*/g, '$1');
    if (b.tipo === 'h') return t.toUpperCase();
    if (b.tipo === 'li') return '- ' + t;
    if (b.tipo === 'quote') return '> ' + t;
    return t;
  }).join('\r\n');
}
function exportarTxt(produto, form = {}) {
  const r = montarRodape(form);
  const linhas = [];
  if (produto.nome) linhas.push('(' + produto.nome + ')', '');
  linhas.push(r.aviso, '', '——————————————————————————', '');
  linhas.push(mdToTxt(produto.convertido), '');
  const vocab = (produto.vocab || []).filter((v) => v && v.incluir !== false);
  if (vocab.length) { linhas.push('VOCABULÁRIO'); vocab.forEach((v) => linhas.push(`- ${v.termo}: ${v.significado}`)); linhas.push(''); }
  linhas.push('——————————————————————————', r.linhaOficial, r.linhaResp, '', r.lucas);
  baixar(new Blob([linhas.join('\r\n')], { type: 'text/plain;charset=utf-8' }), nomeBase(produto) + '-linguagem-simples.txt');
}

// ---------------------------------------------------------------------------
// DOCX (OpenXML mínimo, via window.JSZip)
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// Parágrafo de uma só "cara" (aviso, rodapé).
function pXml(text, o = {}) {
  let rpr = '<w:rPr>';
  if (o.b) rpr += '<w:b/>';
  if (o.i) rpr += '<w:i/>';
  if (o.color) rpr += `<w:color w:val="${o.color}"/>`;
  rpr += `<w:sz w:val="${o.sz || 22}"/><w:szCs w:val="${o.sz || 22}"/></w:rPr>`;
  const shd = o.shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shd}"/>` : '';
  return `<w:p><w:pPr><w:spacing w:after="${o.after != null ? o.after : 160}"/>${shd}</w:pPr><w:r>${rpr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}
// Runs com negrito inline (a partir do Markdown).
function runsXml(text, sz) {
  return inlineParts(text).map((p) =>
    `<w:r><w:rPr>${p.b ? '<w:b/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${esc(p.t)}</w:t></w:r>`).join('');
}
function pRuns(runs, after) {
  return `<w:p><w:pPr><w:spacing w:after="${after}"/></w:pPr>${runs}</w:p>`;
}
function corpoDocxMd(md) {
  let body = '';
  for (const b of parseMd(md)) {
    if (b.tipo === 'h') body += pRuns(runsXml(b.texto, b.nivel <= 2 ? 28 : 24), 80);
    else if (b.tipo === 'li') body += pRuns(runsXml('•  ' + b.texto, 22), 60);
    else if (b.tipo === 'quote') body += pXml(b.texto, { sz: 20, i: true, color: '555555', after: 120 });
    else body += pRuns(runsXml(b.texto, 22), 140);
  }
  return body;
}
async function exportarDocx(produto, form = {}) {
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error('Biblioteca de DOCX (JSZip) não carregada.');
  const r = montarRodape(form);

  let body = '';
  if (produto.nome) body += pXml(produto.nome, { sz: 18, i: true, color: '666666', after: 120 });
  body += pXml(r.aviso, { sz: 18, b: true, after: 200, shd: 'F2F2F2' });
  body += corpoDocxMd(produto.convertido);

  const vocab = (produto.vocab || []).filter((v) => v && v.incluir !== false);
  if (vocab.length) {
    body += pXml('Vocabulário', { sz: 26, b: true, after: 80 });
    vocab.forEach((v) => {
      body += `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr>` +
        `<w:r><w:rPr><w:b/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${esc(v.termo)}: </w:t></w:r>` +
        `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${esc(v.significado)}</w:t></w:r></w:p>`;
    });
  }
  body += pXml('', { sz: 10, after: 40 });
  body += pXml(r.linhaOficial, { sz: 16, color: '555555', after: 40 });
  body += pXml(r.linhaResp, { sz: 16, color: '555555', after: 120 });
  body += pXml(r.lucas, { sz: 15, i: true, color: '777777', after: 0 });

  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + sect + '</w:body></w:document>';
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels').file('.rels', rels);
  zip.folder('word').file('document.xml', documentXml);
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  baixar(blob, nomeBase(produto) + '-linguagem-simples.docx');
}

// ---------------------------------------------------------------------------
// PDF — visão limpa + impressão do navegador (Salvar como PDF)
// ---------------------------------------------------------------------------
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function mdToHtml(md) {
  const inline = (t) => escHtml(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  let html = '', inList = false;
  for (const b of parseMd(md)) {
    if (b.tipo === 'li') { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(b.texto) + '</li>'; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (b.tipo === 'h') html += '<h2>' + inline(b.texto) + '</h2>';
    else if (b.tipo === 'quote') html += '<blockquote>' + inline(b.texto) + '</blockquote>';
    else html += '<p>' + inline(b.texto) + '</p>';
  }
  if (inList) html += '</ul>';
  return html;
}
function exportarPdf(produto, form = {}) {
  const r = montarRodape(form);
  const vocab = (produto.vocab || []).filter((v) => v && v.incluir !== false);
  const vocabHtml = vocab.length
    ? `<h2>Vocabulário</h2><dl>${vocab.map((v) => `<dt>${escHtml(v.termo)}</dt><dd>${escHtml(v.significado)}</dd>`).join('')}</dl>`
    : '';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${escHtml(nomeBase(produto))} — linguagem simples</title>
<style>
  @page { margin: 2cm; }
  body { font: 12pt/1.6 Georgia, 'Times New Roman', serif; color:#1a1a1a; max-width: 720px; margin: 0 auto; padding: 24px; }
  .sub { color:#666; font-style:italic; margin: 0 0 14px; }
  .aviso { background:#f2f2f2; border-left:4px solid #999; padding:12px 14px; font-size:9.5pt; font-weight:700; margin: 0 0 20px; }
  h2 { font-size: 14pt; margin: 20px 0 6px; }
  p { margin: 0 0 10px; text-align: justify; }
  ul { margin: 0 0 10px 0; padding-left: 22px; } li { margin: 0 0 4px; }
  dl { margin: 0; } dt { font-weight:700; } dd { margin: 0 0 8px 0; }
  blockquote { margin: 0 0 10px; padding-left: 12px; border-left:3px solid #ccc; color:#555; font-style:italic; }
  .rodape { margin-top: 24px; padding-top: 12px; border-top:1px solid #ccc; color:#555; font-size:9pt; }
  .rodape .lucas { font-style:italic; color:#777; margin-top:8px; }
  @media print { .barra { display:none; } }
  .barra { position:sticky; top:0; background:#fff; padding:10px 0; text-align:center; }
  .barra button { font:600 14px system-ui; padding:9px 16px; border-radius:8px; border:1px solid #1d4ed8; background:#1d4ed8; color:#fff; cursor:pointer; }
</style></head><body>
<div class="barra"><button onclick="window.print()">Imprimir / Salvar como PDF</button></div>
${produto.nome ? `<p class="sub">${escHtml(produto.nome)}</p>` : ''}
<div class="aviso">${escHtml(r.aviso)}</div>
${mdToHtml(produto.convertido)}
${vocabHtml}
<div class="rodape"><div>${escHtml(r.linhaOficial)}</div><div>${escHtml(r.linhaResp)}</div><div class="lucas">${escHtml(r.lucas)}</div></div>
<script>window.addEventListener('load',function(){setTimeout(function(){try{window.print();}catch(e){}},350);});<\/script>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) throw new Error('O navegador bloqueou a janela de impressão. Permita pop-ups para exportar em PDF.');
  w.document.open(); w.document.write(html); w.document.close();
}

export { montarRodape, exportarTxt, exportarDocx, exportarPdf };
