// exportar/docx-original.js — exporta um DOCX preservando a formatação de origem.
//
// Ao contrário de exportar/docx.js (que gera um pacote do zero), este módulo
// clona o pacote DOCX ORIGINAL (doc.zip, um JSZip) e apenas INJETA nele os
// comentários, notas de rodapé e o glossário, além de reescrever somente os
// parágrafos que o usuário alterou. Assim a formatação original (negrito,
// sublinhado, estilos, notas, etc.) é mantida 100% (round-trip).
//
// Usa window.JSZip (script global, sem imports de módulo) e DOMParser /
// XMLSerializer nativos do navegador.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';

const RT_COMMENTS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const RT_FOOTNOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';

// Nomes das faixas por extenso, para exibir no texto do comentário.
const NOME_FAIXA = {
  'muito-facil': 'Muito fácil',
  'facil': 'Fácil',
  'razoavel': 'Razoavelmente difícil',
  'dificil': 'Muito difícil',
  'neutra': 'Neutra',
};

// ---------------------------------------------------------------------------
// Utilitários de texto / XML
// ---------------------------------------------------------------------------

// Escapa caracteres especiais de XML em qualquer texto visível.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Remove travessões (—) de textos visíveis, trocando por hífen simples.
function semTravessao(s) {
  return String(s == null ? '' : s).replace(/—/g, '-');
}

// Faz parse de uma string XML em Document, lançando erro amigável se falhar.
function parseXml(xml) {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length) {
    throw new Error('Não consegui ler um XML do DOCX original.');
  }
  return dom;
}

// Serializa um Document de volta para string.
function serializar(dom) {
  return new XMLSerializer().serializeToString(dom);
}

// Lê uma parte do zip como string, ou null se não existir.
async function lerParte(zip, caminho) {
  const arq = zip.file(caminho);
  if (!arq) return null;
  return arq.async('string');
}

// ---------------------------------------------------------------------------
// Criação de fragmentos de elementos w:* já no namespace correto.
// Como estamos manipulando DOM (e não strings), criamos os nós via
// createElementNS e importamos fragmentos analisados quando conveniente.
// ---------------------------------------------------------------------------

// Cria um elemento no namespace w com nome qualificado "w:local".
function elW(dom, local) {
  return dom.createElementNS(W, 'w:' + local);
}

// Define um atributo no namespace w ("w:val" etc).
function attrW(el, local, valor) {
  el.setAttributeNS(W, 'w:' + local, valor);
}

// Analisa um trecho de XML de corpo (fragmento) usando o mesmo namespace w e
// devolve os nós filhos prontos para importação no document.xml.
// Envolve o fragmento em um elemento raiz com o xmlns:w declarado.
function fragmentoNos(dom, xmlInterno) {
  const wrapper = `<w:wrap xmlns:w="${W}">${xmlInterno}</w:wrap>`;
  const frag = parseXml(wrapper);
  const nos = [];
  const filhos = frag.documentElement.childNodes;
  for (let i = 0; i < filhos.length; i++) {
    nos.push(dom.importNode(filhos[i], true));
  }
  return nos;
}

// ---------------------------------------------------------------------------
// Comentários (reaproveita a lógica de exportar/docx.js)
// ---------------------------------------------------------------------------

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

// Monta as linhas do comentário: índice de clareza + apontamentos + sugestões da IA.
function linhasComentario(p) {
  const cl = p.clareza || {};
  const faixa = cl.faixa || (p.metricas && p.metricas.faixa);
  const linhas = [];
  if (cl.nota != null) linhas.push(`Avaliação do LUCAS: Índice de Clareza ${cl.nota}/100`);
  else if (faixa === 'neutra' || !NOME_FAIXA[faixa]) linhas.push('Avaliação do LUCAS: “Neutra” (conecte a IA para medir a clareza)');
  else linhas.push(`Avaliação do LUCAS: ${NOME_FAIXA[faixa]}`);
  for (const m of motivosDoc(p)) {
    if (m && m.texto) linhas.push(semTravessao(m.texto));
  }
  const sug = (p.avaliacaoIA && p.avaliacaoIA.sugestoes) || [];
  if (sug.length) {
    linhas.push('Sugestões de clareza (IA):');
    for (const s of sug) if (s) linhas.push('- ' + semTravessao(String(s)));
  }
  return linhas;
}

// Maior w:id existente em uma lista de elementos (por atributo w:id). Retorna
// base-1 se não houver nenhum, de modo que "maior + 1" comece em base.
function maiorId(elementos, base) {
  let maior = base - 1;
  for (let i = 0; i < elementos.length; i++) {
    const v = parseInt(elementos[i].getAttributeNS(W, 'id'), 10);
    if (!isNaN(v) && v > maior) maior = v;
  }
  return maior;
}

// ---------------------------------------------------------------------------
// Reescrita de parágrafos alterados
// ---------------------------------------------------------------------------

// Filhos w:r de um w:p que contêm texto (w:t). Não recursa em tabelas aninhadas
// porque só operamos no nível direto do parágrafo.
function runsDeTexto(p) {
  const runs = [];
  for (let i = 0; i < p.childNodes.length; i++) {
    const c = p.childNodes[i];
    if (c.nodeType === 1 && c.localName === 'r') {
      // um run é "de texto" se possui pelo menos um w:t
      if (c.getElementsByTagNameNS(W, 't').length) runs.push(c);
    }
  }
  return runs;
}

// Substitui o texto de um w:p: mantém o primeiro w:r (e seu w:rPr), coloca o
// novo texto em seu w:t (com xml:space=preserve) e remove os demais w:r de
// texto. Preserva a formatação do primeiro run.
function reescreverParagrafo(dom, p, novoTexto) {
  const runs = runsDeTexto(p);
  if (!runs.length) return;
  const primeiro = runs[0];

  // Localiza (ou cria) o w:t do primeiro run e substitui o conteúdo.
  let t = primeiro.getElementsByTagNameNS(W, 't')[0];
  if (!t) {
    t = elW(dom, 't');
    primeiro.appendChild(t);
  }
  // Remove eventuais w:t extras do primeiro run, deixando um só.
  const tsPrim = primeiro.getElementsByTagNameNS(W, 't');
  for (let i = tsPrim.length - 1; i >= 1; i--) {
    tsPrim[i].parentNode.removeChild(tsPrim[i]);
  }
  t.setAttribute('xml:space', 'preserve');
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(dom.createTextNode(semTravessao(novoTexto)));

  // Remove os demais runs de texto (a partir do segundo).
  for (let i = 1; i < runs.length; i++) {
    runs[i].parentNode.removeChild(runs[i]);
  }
}

// ---------------------------------------------------------------------------
// Âncoras de comentário dentro de um w:p já existente
// ---------------------------------------------------------------------------

// Primeiro e último w:r (qualquer run) filho direto do parágrafo.
function primeiroUltimoRun(p) {
  let primeiro = null;
  let ultimo = null;
  for (let i = 0; i < p.childNodes.length; i++) {
    const c = p.childNodes[i];
    if (c.nodeType === 1 && c.localName === 'r') {
      if (!primeiro) primeiro = c;
      ultimo = c;
    }
  }
  return { primeiro, ultimo };
}

// Ancora um comentário no w:p: commentRangeStart antes do primeiro run,
// commentRangeEnd depois do último run, e um run com commentReference logo após.
function ancorarComentario(dom, p, cid) {
  const { primeiro, ultimo } = primeiroUltimoRun(p);
  if (!primeiro || !ultimo) return false;

  const start = elW(dom, 'commentRangeStart');
  attrW(start, 'id', String(cid));
  const end = elW(dom, 'commentRangeEnd');
  attrW(end, 'id', String(cid));

  // run de referência: <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>
  //                        <w:commentReference w:id="cid"/></w:r>
  const refRun = elW(dom, 'r');
  const rPr = elW(dom, 'rPr');
  const rStyle = elW(dom, 'rStyle');
  attrW(rStyle, 'val', 'CommentReference');
  rPr.appendChild(rStyle);
  refRun.appendChild(rPr);
  const ref = elW(dom, 'commentReference');
  attrW(ref, 'id', String(cid));
  refRun.appendChild(ref);

  p.insertBefore(start, primeiro);
  // insere end e o refRun logo após o último run
  if (ultimo.nextSibling) {
    p.insertBefore(end, ultimo.nextSibling);
  } else {
    p.appendChild(end);
  }
  if (end.nextSibling) {
    p.insertBefore(refRun, end.nextSibling);
  } else {
    p.appendChild(refRun);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Notas de rodapé
// ---------------------------------------------------------------------------

// footnotes.xml novo, contendo as duas notas obrigatórias (separator e
// continuationSeparator) — sem elas o Word acusa corrupção.
function footnotesXmlBase() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:footnotes xmlns:w="${W}">` +
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `</w:footnotes>`;
}

// Cria um elemento <w:footnote w:id="id"> com um w:p contendo o w:footnoteRef
// (superscript) seguido de um espaço e do texto da nota.
function criarFootnote(dom, id, texto) {
  const nos = fragmentoNos(dom,
    `<w:footnote w:id="${esc(String(id))}">` +
      `<w:p>` +
        `<w:pPr><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr></w:pPr>` +
        `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>` +
        `<w:r><w:t xml:space="preserve"> ${esc(semTravessao(texto))}</w:t></w:r>` +
      `</w:p>` +
    `</w:footnote>`);
  return nos[0];
}

// Cria o run de referência à nota dentro do document.xml (superscript).
function criarFootnoteRef(dom, id) {
  const nos = fragmentoNos(dom,
    `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr>` +
    `<w:footnoteReference w:id="${esc(String(id))}"/></w:r>`);
  return nos[0];
}

// Insere um run logo após a primeira ocorrência do termo dentro do w:p.
// Procura o w:r de texto cujo w:t contenha o termo e insere o novo run
// imediatamente após ele. Se não achar o termo, insere após o último run.
function inserirAposTermo(dom, p, termo, novoRun) {
  const runs = runsDeTexto(p);
  let alvo = null;
  if (termo) {
    for (let i = 0; i < runs.length; i++) {
      const t = runs[i].getElementsByTagNameNS(W, 't')[0];
      if (t && t.textContent && t.textContent.indexOf(termo) !== -1) {
        alvo = runs[i];
        break;
      }
    }
  }
  if (!alvo) alvo = runs.length ? runs[runs.length - 1] : null;
  if (!alvo) {
    p.appendChild(novoRun);
    return;
  }
  if (alvo.nextSibling) p.insertBefore(novoRun, alvo.nextSibling);
  else p.appendChild(novoRun);
}

// ---------------------------------------------------------------------------
// Glossário
// ---------------------------------------------------------------------------

// Célula de tabela do glossário (XML string).
function celulaXml(texto, negrito) {
  const b = negrito ? '<w:b/>' : '';
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/>${b}</w:rPr>` +
    `<w:t xml:space="preserve">${esc(semTravessao(texto))}</w:t></w:r></w:p></w:tc>`;
}

// Nós DOM do bloco do glossário: quebra de página, título (negrito),
// introdução e tabela de 2 colunas ordenada por termo.
function glossarioNos(dom, apendice) {
  if (!apendice || !apendice.length) return [];
  const linhas = apendice.slice().sort((a, b) => a.termo.localeCompare(b.termo, 'pt'));
  const borda = '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((l) =>
      `<w:${l} w:val="single" w:sz="4" w:space="0" w:color="D6DDE8"/>`).join('') +
    '</w:tblBorders>';
  const cab = `<w:tr>${celulaXml('Termo', true)}${celulaXml('O que significa', true)}</w:tr>`;
  const corpo = linhas.map((v) =>
    `<w:tr>${celulaXml(v.termo, true)}${celulaXml(v.explicacao, false)}</w:tr>`).join('');

  const xml =
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` +
    `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto" w:after="160"/></w:pPr>` +
      `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="28"/><w:b/></w:rPr>` +
      `<w:t xml:space="preserve">Glossário</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto" w:after="160"/></w:pPr>` +
      `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr>` +
      `<w:t xml:space="preserve">Explicação, em linguagem simples, dos termos técnicos usados neste documento.</w:t></w:r></w:p>` +
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borda}</w:tblPr>${cab}${corpo}</w:tbl>`;

  return fragmentoNos(dom, xml);
}

// ---------------------------------------------------------------------------
// Relações e content types
// ---------------------------------------------------------------------------

// Garante que exista uma Relationship do reltype dado apontando para target
// dentro do documento .rels. Cria o documento se ainda não existir. Devolve o
// Id da relação (existente ou nova) e o XML serializado atualizado.
function garantirRelacao(relsXml, reltype, target) {
  let dom;
  if (relsXml) {
    dom = parseXml(relsXml);
  } else {
    dom = parseXml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${PR}"></Relationships>`);
  }
  const rels = dom.getElementsByTagName('Relationship');
  let maiorNum = 0;
  for (let i = 0; i < rels.length; i++) {
    const r = rels[i];
    if (r.getAttribute('Type') === reltype) {
      // já existe: reaproveita
      return { id: r.getAttribute('Id'), xml: serializar(dom) };
    }
    const m = /^rId(\d+)$/.exec(r.getAttribute('Id') || '');
    if (m) maiorNum = Math.max(maiorNum, parseInt(m[1], 10));
  }
  const novoId = 'rId' + (maiorNum + 1);
  const el = dom.createElementNS(PR, 'Relationship');
  el.setAttribute('Id', novoId);
  el.setAttribute('Type', reltype);
  el.setAttribute('Target', target);
  dom.documentElement.appendChild(el);
  return { id: novoId, xml: serializar(dom) };
}

// Garante um Override no [Content_Types].xml para partName/contentType.
// Devolve o XML atualizado (idempotente).
function garantirOverride(ctXml, partName, contentType) {
  const dom = parseXml(ctXml);
  const overrides = dom.getElementsByTagName('Override');
  for (let i = 0; i < overrides.length; i++) {
    if (overrides[i].getAttribute('PartName') === partName) return serializar(dom);
  }
  const el = dom.createElementNS(CT, 'Override');
  el.setAttribute('PartName', partName);
  el.setAttribute('ContentType', contentType);
  dom.documentElement.appendChild(el);
  return serializar(dom);
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

async function exportarDocxComOriginal(doc, nome) {
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error('Biblioteca de DOCX (JSZip) não carregada.');
  if (!doc || !doc.zip) throw new Error('Documento original (doc.zip) não disponível.');

  const zip = doc.zip;

  // 1. Lê o document.xml original.
  const docXmlStr = await lerParte(zip, 'word/document.xml');
  if (!docXmlStr) throw new Error('DOCX inválido: falta word/document.xml.');
  const documentDom = parseXml(docXmlStr);

  // 2. Coleta todos os w:p em ordem de documento (índice ABSOLUTO).
  const psList = documentDom.getElementsByTagNameNS(W, 'p');
  const ps = [];
  for (let i = 0; i < psList.length; i++) ps.push(psList[i]);

  const paragrafos = doc.paragrafos || [];

  // 2b. Reescreve os parágrafos alterados (texto !== textoOriginal).
  for (const p of paragrafos) {
    if (p.texto == null || p.textoOriginal == null) continue;
    if (p.texto === p.textoOriginal) continue; // intacto: preserva formatação
    const alvo = ps[p.indiceXml];
    if (!alvo) continue;
    reescreverParagrafo(documentDom, alvo, p.texto);
  }

  // -------------------------------------------------------------------------
  // 3. Comentários
  // -------------------------------------------------------------------------
  let commentsXmlStr = await lerParte(zip, 'word/comments.xml');
  const novosComentarios = []; // { id, linhas }
  let temNovosComentarios = false;

  // id inicial = maior id existente em comments.xml + 1 (ou 0 se não houver).
  let proxCidBase = 0;
  if (commentsXmlStr) {
    const cDom = parseXml(commentsXmlStr);
    proxCidBase = maiorId(cDom.getElementsByTagNameNS(W, 'comment'), 0) + 1;
  }
  let proxCid = proxCidBase;

  for (const p of paragrafos) {
    if (!precisaComentario(p)) continue;
    const alvo = ps[p.indiceXml];
    if (!alvo) continue;
    const cid = proxCid++;
    if (ancorarComentario(documentDom, alvo, cid)) {
      novosComentarios.push({ id: cid, linhas: linhasComentario(p) });
      temNovosComentarios = true;
    } else {
      proxCid--; // não ancorou: devolve o id
    }
  }

  if (temNovosComentarios) {
    const data = new Date().toISOString();
    const novosXml = novosComentarios.map((c) => {
      const paras = c.linhas.map((linha) =>
        `<w:p><w:r><w:t xml:space="preserve">${esc(linha)}</w:t></w:r></w:p>`).join('');
      return `<w:comment w:id="${c.id}" w:author="LUCAS" w:date="${esc(data)}" w:initials="LU">${paras}</w:comment>`;
    }).join('');

    if (commentsXmlStr) {
      // mescla: injeta os novos w:comment antes de </w:comments>
      const cDom = parseXml(commentsXmlStr);
      const nos = fragmentoNos(cDom, novosXml);
      for (const n of nos) cDom.documentElement.appendChild(n);
      commentsXmlStr = serializar(cDom);
    } else {
      commentsXmlStr = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:comments xmlns:w="${W}">${novosXml}</w:comments>`;
    }
    zip.file('word/comments.xml', commentsXmlStr);
  }

  // -------------------------------------------------------------------------
  // 4. Notas de rodapé
  // -------------------------------------------------------------------------
  // Ordena por posição no documento (parágrafo, depois posição exata gravada na
  // criação — ou 1ª ocorrência do termo), para que a numeração siga o texto,
  // como no Word, e não a ordem em que as notas foram criadas.
  const ordemPar = {};
  (doc.paragrafos || []).forEach((p, i) => { if (p.id != null) ordemPar[p.id] = i; });
  const posNoPar = (n) => {
    if (typeof n.posicao === 'number' && n.posicao >= 0) return n.posicao;
    const p = (doc.paragrafos || []).find((x) => x.id === n.parId);
    const t = (p && p.texto) || '';
    if (n.termo) { const i = t.toLowerCase().indexOf(String(n.termo).toLowerCase()); return i < 0 ? Number.MAX_SAFE_INTEGER : i; }
    return Number.MAX_SAFE_INTEGER;
  };
  const notas = (doc.notas || []).slice().sort((a, b) => {
    const pa = ordemPar[a.parId] ?? Number.MAX_SAFE_INTEGER;
    const pb = ordemPar[b.parId] ?? Number.MAX_SAFE_INTEGER;
    return pa !== pb ? pa - pb : posNoPar(a) - posNoPar(b);
  });
  let temNotas = false;
  let footnotesXmlStr = await lerParte(zip, 'word/footnotes.xml');

  if (notas.length) {
    let fnDom;
    if (footnotesXmlStr) {
      fnDom = parseXml(footnotesXmlStr);
    } else {
      fnDom = parseXml(footnotesXmlBase());
    }
    let proxFid = maiorId(fnDom.getElementsByTagNameNS(W, 'footnote'), 1) + 1;
    if (proxFid < 1) proxFid = 1;

    // mapeia parId -> índice absoluto: o parId nas notas corresponde ao
    // p.id dos parágrafos; localizamos o indiceXml via doc.paragrafos.
    const idParaIndice = {};
    for (const p of paragrafos) {
      if (p.id != null) idParaIndice[p.id] = p.indiceXml;
    }

    for (const nota of notas) {
      const fid = proxFid++;
      // adiciona a nota ao footnotes.xml
      const noteEl = criarFootnote(fnDom, fid, nota.texto || '');
      fnDom.documentElement.appendChild(noteEl);

      // insere a referência no document.xml, após o termo no w:p correspondente
      const idxAbs = idParaIndice[nota.parId];
      const alvo = (idxAbs != null) ? ps[idxAbs] : null;
      if (alvo) {
        const refRun = criarFootnoteRef(documentDom, fid);
        inserirAposTermo(documentDom, alvo, nota.termo, refRun);
      }
      temNotas = true;
    }

    footnotesXmlStr = serializar(fnDom);
    zip.file('word/footnotes.xml', footnotesXmlStr);
  }

  // -------------------------------------------------------------------------
  // 5. Glossário — antes do w:sectPr do corpo.
  // -------------------------------------------------------------------------
  if (doc.apendice && doc.apendice.length) {
    const body = documentDom.getElementsByTagNameNS(W, 'body')[0];
    if (body) {
      const nos = glossarioNos(documentDom, doc.apendice);
      // localiza o sectPr que é filho direto do body (o do corpo).
      let sect = null;
      for (let i = 0; i < body.childNodes.length; i++) {
        const c = body.childNodes[i];
        if (c.nodeType === 1 && c.localName === 'sectPr') { sect = c; break; }
      }
      for (const n of nos) {
        if (sect) body.insertBefore(n, sect);
        else body.appendChild(n);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 6. Relações / content types e serialização final
  // -------------------------------------------------------------------------
  let relsXml = await lerParte(zip, 'word/_rels/document.xml.rels');
  let ctXml = await lerParte(zip, '[Content_Types].xml');
  if (!ctXml) throw new Error('DOCX inválido: falta [Content_Types].xml.');

  if (temNovosComentarios) {
    const r = garantirRelacao(relsXml, RT_COMMENTS, 'comments.xml');
    relsXml = r.xml;
    ctXml = garantirOverride(ctXml, '/word/comments.xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml');
  }
  if (temNotas) {
    const r = garantirRelacao(relsXml, RT_FOOTNOTES, 'footnotes.xml');
    relsXml = r.xml;
    ctXml = garantirOverride(ctXml, '/word/footnotes.xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml');
  }

  if (relsXml == null) {
    // Não havia .rels e nada exigiu criar: nada a gravar. Mas se criamos algo,
    // relsXml já foi preenchido por garantirRelacao.
  } else {
    zip.file('word/_rels/document.xml.rels', relsXml);
  }
  zip.file('[Content_Types].xml', ctXml);

  // grava o document.xml modificado de volta
  zip.file('word/document.xml', serializar(documentDom));

  // 7. Gera o blob e dispara o download.
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const base = (nome || doc.nomeArquivo || 'documento').replace(/\.[^.]+$/, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = base + '-linguagem-simples.docx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { exportarDocxComOriginal };
