// exportar/conversor.js — exporta o produto do módulo Conversor (versão em
// linguagem simples, SEM valor jurídico) em DOCX, TXT ou PDF (impressão).
// Toda saída carrega o disclaimer, o link do documento oficial e o responsável
// pela validação humana — com textos-padrão de ressalva quando não informados.

// ---------------------------------------------------------------------------
// Rodapé jurídico (defensivo). Reforçado para deixar claro que esta versão não
// substitui o documento oficial, não tem validade jurídica e não é ato oficial.
// ---------------------------------------------------------------------------
function montarRodape(form = {}) {
  const link = String(form.linkOficial || '').trim();
  const nome = String(form.respNome || '').trim();
  const cargo = String(form.respCargo || '').trim();
  const ident = String(form.respId || '').trim();
  const temResp = nome || cargo || ident;

  const aviso =
    'AVISO — VERSÃO EM LINGUAGEM SIMPLES, SEM VALOR OFICIAL. Este documento é uma versão ' +
    'em linguagem simples, de caráter meramente informativo e explicativo, produzida para ' +
    'facilitar a compreensão do documento oficial correspondente. NÃO substitui o documento ' +
    'oficial, NÃO possui validade jurídica, NÃO é ato oficial e NÃO produz efeitos legais. ' +
    'Em caso de dúvida, omissão ou divergência de interpretação entre esta versão e o ' +
    'documento oficial, prevalece integralmente o DOCUMENTO OFICIAL, que é a única fonte ' +
    'autêntica e vinculante. O processo de simplificação pode introduzir imprecisões ou omissões.';

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

// Divide o texto convertido em parágrafos (linha em branco = novo parágrafo).
function paragrafos(texto) {
  return String(texto || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
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
function exportarTxt(produto, form = {}) {
  const r = montarRodape(form);
  const linhas = [];
  linhas.push('VERSÃO EM LINGUAGEM SIMPLES');
  if (produto.nome) linhas.push(produto.nome);
  linhas.push('');
  linhas.push(r.aviso);
  linhas.push('');
  linhas.push('——————————————————————————');
  linhas.push('');
  paragrafos(produto.convertido).forEach((p) => { linhas.push(p); linhas.push(''); });
  const vocab = (produto.vocab || []).filter((v) => v && v.incluir !== false);
  if (vocab.length) {
    linhas.push('VOCABULÁRIO');
    vocab.forEach((v) => linhas.push(`- ${v.termo}: ${v.significado}`));
    linhas.push('');
  }
  linhas.push('——————————————————————————');
  linhas.push(r.linhaOficial);
  linhas.push(r.linhaResp);
  linhas.push('');
  linhas.push(r.lucas);
  const blob = new Blob([linhas.join('\r\n')], { type: 'text/plain;charset=utf-8' });
  baixar(blob, nomeBase(produto) + '-linguagem-simples.txt');
}

// ---------------------------------------------------------------------------
// DOCX (OpenXML mínimo, via window.JSZip)
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// p(text, opções) → um <w:p>. sz em meios-pontos; after em twips.
function pXml(text, o = {}) {
  let rpr = '<w:rPr>';
  if (o.b) rpr += '<w:b/>';
  if (o.i) rpr += '<w:i/>';
  if (o.color) rpr += `<w:color w:val="${o.color}"/>`;
  rpr += `<w:sz w:val="${o.sz || 22}"/><w:szCs w:val="${o.sz || 22}"/></w:rPr>`;
  const shd = o.shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shd}"/>` : '';
  const ppr = `<w:pPr><w:spacing w:after="${o.after != null ? o.after : 160}"/>${shd}</w:pPr>`;
  return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

async function exportarDocx(produto, form = {}) {
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error('Biblioteca de DOCX (JSZip) não carregada.');
  const r = montarRodape(form);

  let body = '';
  body += pXml('Versão em linguagem simples', { sz: 32, b: true, after: 60 });
  if (produto.nome) body += pXml(produto.nome, { sz: 20, i: true, color: '666666', after: 160 });
  // Caixa de aviso (fundo cinza-claro)
  body += pXml(r.aviso, { sz: 18, b: true, after: 200, shd: 'F2F2F2' });
  paragrafos(produto.convertido).forEach((p) => { body += pXml(p, { sz: 22, after: 160 }); });

  const vocab = (produto.vocab || []).filter((v) => v && v.incluir !== false);
  if (vocab.length) {
    body += pXml('Vocabulário', { sz: 26, b: true, after: 80 });
    vocab.forEach((v) => {
      body += `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr>` +
        `<w:r><w:rPr><w:b/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${esc(v.termo)}: </w:t></w:r>` +
        `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${esc(v.significado)}</w:t></w:r></w:p>`;
    });
  }
  // Rodapé jurídico
  body += pXml('', { sz: 10, after: 40 });
  body += pXml(r.linhaOficial, { sz: 16, color: '555555', after: 40 });
  body += pXml(r.linhaResp, { sz: 16, color: '555555', after: 120 });
  body += pXml(r.lucas, { sz: 15, i: true, color: '777777', after: 0 });

  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body + sect + '</w:body></w:document>';
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
// PDF — abre uma visão limpa e chama a impressão do navegador (Salvar como PDF)
// ---------------------------------------------------------------------------
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function exportarPdf(produto, form = {}) {
  const r = montarRodape(form);
  const corpo = paragrafos(produto.convertido).map((p) => `<p>${escHtml(p)}</p>`).join('');
  const vocab = (produto.vocab || []).filter((v) => v && v.incluir !== false);
  const vocabHtml = vocab.length
    ? `<h2>Vocabulário</h2><dl>${vocab.map((v) => `<dt>${escHtml(v.termo)}</dt><dd>${escHtml(v.significado)}</dd>`).join('')}</dl>`
    : '';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${escHtml(nomeBase(produto))} — linguagem simples</title>
<style>
  @page { margin: 2cm; }
  body { font: 12pt/1.6 Georgia, 'Times New Roman', serif; color:#1a1a1a; max-width: 720px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 18pt; margin: 0 0 2px; }
  .sub { color:#666; font-style:italic; margin: 0 0 18px; }
  .aviso { background:#f2f2f2; border-left:4px solid #999; padding:12px 14px; font-size:9.5pt; font-weight:700; margin: 0 0 20px; }
  p { margin: 0 0 12px; text-align: justify; }
  h2 { font-size: 13pt; margin: 22px 0 6px; }
  dl { margin: 0; } dt { font-weight:700; } dd { margin: 0 0 8px 0; }
  .rodape { margin-top: 24px; padding-top: 12px; border-top:1px solid #ccc; color:#555; font-size:9pt; }
  .rodape .lucas { font-style:italic; color:#777; margin-top:8px; }
  @media print { .barra { display:none; } }
  .barra { position:sticky; top:0; background:#fff; padding:10px 0; text-align:center; }
  .barra button { font:600 14px system-ui; padding:9px 16px; border-radius:8px; border:1px solid #1d4ed8; background:#1d4ed8; color:#fff; cursor:pointer; }
</style></head><body>
<div class="barra"><button onclick="window.print()">Imprimir / Salvar como PDF</button></div>
<h1>Versão em linguagem simples</h1>
${produto.nome ? `<p class="sub">${escHtml(produto.nome)}</p>` : ''}
<div class="aviso">${escHtml(r.aviso)}</div>
${corpo}
${vocabHtml}
<div class="rodape"><div>${escHtml(r.linhaOficial)}</div><div>${escHtml(r.linhaResp)}</div><div class="lucas">${escHtml(r.lucas)}</div></div>
<script>window.addEventListener('load',function(){setTimeout(function(){try{window.print();}catch(e){}},350);});<\/script>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { throw new Error('O navegador bloqueou a janela de impressão. Permita pop-ups para exportar em PDF.'); }
  w.document.open(); w.document.write(html); w.document.close();
}

export { montarRodape, exportarTxt, exportarDocx, exportarPdf };
