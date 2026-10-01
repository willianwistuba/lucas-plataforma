// importar/docx.js — leitura de DOCX (SPEC 5.1, E1).
// Usa JSZip (carregado como script global em editor.html) e DOMParser nativo.
// Guarda o zip original para reexportação futura.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function temAncestral(node, localName) {
  let n = node.parentNode;
  while (n && n.nodeType === 1) {
    if (n.localName === localName) return true;
    n = n.parentNode;
  }
  return false;
}

// Texto de um w:p: concatena w:t; w:tab e w:br viram espaço (SPEC 5.1).
function textoDoParagrafo(p) {
  let out = '';
  (function walk(n) {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 't') out += c.textContent;
      else if (c.localName === 'tab' || c.localName === 'br') out += ' ';
      else walk(c);
    }
  })(p);
  return out.replace(/\s+/g, ' ').trim();
}

async function lerDocx(file) {
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error('Biblioteca de DOCX (JSZip) não carregada.');
  const zip = await JSZip.loadAsync(file);
  const arq = zip.file('word/document.xml');
  if (!arq) throw new Error('Arquivo DOCX inválido: falta word/document.xml.');

  const xml = await arq.async('string');
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length) throw new Error('Não consegui ler o XML do DOCX.');

  const paragrafos = [];
  const ps = dom.getElementsByTagNameNS(W, 'p'); // ordem de documento
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const emTabela = temAncestral(p, 'tbl');
    const texto = textoDoParagrafo(p);
    if (!texto) continue;                 // descarta parágrafos vazios da exibição
    // indiceXml = posição ABSOLUTA do w:p na lista, para a exportação por clonagem
    // localizar o parágrafo exato no document.xml original.
    paragrafos.push({ texto, textoOriginal: texto, emTabela, indiceXml: i });
  }
  if (!paragrafos.length) throw new Error('O DOCX não tem texto legível.');
  return { paragrafos, zip };
}

export { lerDocx };
