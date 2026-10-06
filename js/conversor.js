// conversor.js — módulo CONVERSOR. Gera uma versão em linguagem
// simples (produto acessório, SEM valor jurídico) de um ou mais documentos ou de
// um parágrafo colado. Fluxo próprio, separado do editor: sem Flesch/Índice de
// Clareza — apenas converte, exibe editável e exporta (DOCX/TXT/PDF) com o
// disclaimer, o link do documento oficial e o responsável pela validação.
//
// Reaproveita: conversao.js (converterDocumento), prompts.js, construtor.js
// (público-alvo + construtor guiado), dicionario.js (vocabulário), provedores.js
// (BYOK) e importar/*. A exportação fica em exportar/conversor.js.

import * as prov from './provedores.js';
import { converterDocumento } from './conversao.js';
import { PROMPTS, PROMPT_LIVRE, porCodigo } from './prompts.js';
import { PUBLICOS, CONSTRUTOR_OBJETIVO, CONSTRUTOR_TOM, CONSTRUTOR_FORMATO, CONSTRUTOR_PRESETS, montarInstrucaoConstrutor } from './construtor.js';
import * as dic from './dicionario.js';
import { lerDocx } from './importar/docx.js';
import { lerPdf } from './importar/pdf.js';
import { exportarTxt, exportarDocx, exportarPdf } from './exportar/conversor.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const estado = {
  docs: [],        // [{ nome, original }]
  produtos: [],    // [{ nome, original, convertido, vocab:[{termo,significado,incluir}], meta }]
  ativo: 0,
  rodando: false,
  custom: null     // instrução vinda do construtor (quando a pessoa personaliza)
};

function toast(msg) {
  let t = $('#cvToast');
  if (!t) { t = document.createElement('div'); t.id = 'cvToast'; t.className = 'cv-toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('on');
  clearTimeout(t.__t); t.__t = setTimeout(() => t.classList.remove('on'), 2600);
}
function escapar(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Provedor de IA (BYOK) — barra compacta
// ---------------------------------------------------------------------------
function renderProvedor() {
  const sel = $('#cvProv');
  sel.innerHTML = Object.entries(prov.PROVEDORES).map(([id, d]) => `<option value="${id}">${escapar(d.nome)}</option>`).join('');
  sel.value = prov.getProvedorAtual();
  sincronizarChave();
  atualizarModeloSelect();
}
function sincronizarChave() {
  const p = $('#cvProv').value;
  const def = prov.PROVEDORES[p];
  $('#cvChave').value = prov.getChave(p) || '';
  $('#cvChave').placeholder = def.requerChave ? 'Cole aqui a sua chave da API' : 'Este provedor não exige chave';
  $('#cvChave').disabled = !def.requerChave;
  const link = $('#cvChaveLink');
  if (def.urlChave) { link.href = def.urlChave; link.style.display = ''; } else { link.style.display = 'none'; }
}
function atualizarModeloSelect() {
  const p = $('#cvProv').value;
  const def = prov.PROVEDORES[p];
  const sel = $('#cvModelo');
  const atual = prov.getModelo(p);
  sel.innerHTML = (def.modelos || []).map((m) => `<option value="${escapar(m)}" ${m === atual ? 'selected' : ''}>${escapar(m)}</option>`).join('');
}
async function testarChave() {
  const p = $('#cvProv').value;
  const chave = $('#cvChave').value.trim();
  const def = prov.PROVEDORES[p];
  const st = $('#cvProvStatus');
  prov.setProvedorAtual(p);
  if (def.requerChave && !chave) { st.innerHTML = '<span class="erro">Cole a chave primeiro.</span>'; return; }
  prov.setChave(p, chave);
  const btn = $('#cvTestar'); btn.disabled = true; const rot = btn.textContent; btn.textContent = 'Testando…';
  st.textContent = 'Testando a chave em cada modelo…';
  try {
    const res = await prov.testarModelos({ provedor: p, chave });
    const ok = res.filter((r) => r.ok).map((r) => r.modelo);
    if (!ok.length) {
      const chaveRuim = res.some((r) => /chave rejeitada|401|403/i.test(r.erro || ''));
      st.innerHTML = chaveRuim ? '<span class="erro">A chave foi rejeitada.</span> Confira se copiou a chave certa desse provedor.'
        : '<span class="aten">Nenhum modelo respondeu agora.</span> Tente de novo em instantes ou troque de provedor.';
      return;
    }
    const sel = $('#cvModelo');
    sel.innerHTML = ok.map((m, i) => `<option value="${escapar(m)}" ${i === 0 ? 'selected' : ''}>${escapar(m)}${i === 0 ? ' (recomendado)' : ''}</option>`).join('');
    prov.setModelo(p, ok[0]);
    const fora = res.filter((r) => !r.ok).map((r) => r.modelo);
    st.innerHTML = `<span class="ok">${ok.length} modelo(s) funcionando.</span> Escolha ao lado${fora.length ? ` (${escapar(fora.join(', '))} fora do ar agora)` : ''}.`;
  } catch (e) {
    st.innerHTML = `<span class="erro">Não consegui testar:</span> ${escapar((e && e.message) || 'erro')}`;
  } finally { btn.disabled = false; btn.textContent = rot; }
}
function configuradoOuAvisa() {
  const cfg = prov.configAtual();
  const def = prov.PROVEDORES[cfg.provedor];
  if (def.requerChave && !cfg.chave) {
    toast('Configure a chave do provedor de IA primeiro.');
    $('#cvChave').focus();
    document.querySelector('.cv-prov').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Prompt e público-alvo
// ---------------------------------------------------------------------------
function renderPromptSelect() {
  const sel = $('#cvPrompt');
  const opts = PROMPTS.map((p) => `<option value="${p.codigo}">${escapar(p.nome)}</option>`);
  opts.push(`<option value="PL">${escapar(PROMPT_LIVRE.nome)}</option>`);
  sel.innerHTML = opts.join('');
  sel.value = 'P1'; // norma ABNT como padrão
  atualizarDescricaoPrompt();
}
function atualizarDescricaoPrompt() {
  const c = $('#cvPrompt').value;
  const p = c === 'PL' ? PROMPT_LIVRE : porCodigo(c);
  $('#cvPromptDesc').textContent = (p && p.descricao) || '';
}
function renderPublicos() {
  $('#cvPublicos').innerHTML = PUBLICOS.map((pb) =>
    `<label class="cv-chk"><input type="checkbox" value="${pb.id}"><span>${escapar(pb.curto)}</span></label>`).join('');
}
function publicosSelecionados() {
  return $$('#cvPublicos input:checked').map((c) => (PUBLICOS.find((p) => p.id === c.value) || {}).rotulo).filter(Boolean);
}

// Construtor guiado (personalizar o prompt) + salvar na biblioteca.
function renderConstrutor() {
  $('#cvObjetivo').innerHTML = CONSTRUTOR_OBJETIVO.map((o) => `<label class="cv-chk"><input type="checkbox" value="${o.id}"><span>${escapar(o.txt)}</span></label>`).join('');
  $('#cvTom').innerHTML = CONSTRUTOR_TOM.map((t, i) => `<option value="${t.id}" ${i === 0 ? 'selected' : ''}>${escapar(t.txt)}</option>`).join('');
  $('#cvFormato').innerHTML = CONSTRUTOR_FORMATO.map((f, i) => `<option value="${f.id}" ${i === 0 ? 'selected' : ''}>${escapar(f.txt)}</option>`).join('');
  $('#cvPresets').innerHTML = '<option value="">Começar de um modelo…</option>' + CONSTRUTOR_PRESETS.map((p) => `<option value="${p.id}">${escapar(p.nome)}</option>`).join('');
}
function aplicarPreset(id) {
  const pr = CONSTRUTOR_PRESETS.find((p) => p.id === id); if (!pr) return;
  $$('#cvObjetivo input').forEach((c) => { c.checked = pr.objetivo.includes(c.value); });
  $('#cvTom').value = pr.tom; $('#cvFormato').value = pr.formato;
  $$('#cvPublicos input').forEach((c) => { c.checked = pr.publicos.includes(c.value); });
}
function selecaoConstrutor() {
  return {
    objetivo: $$('#cvObjetivo input:checked').map((c) => c.value),
    tom: $('#cvTom').value,
    formato: $('#cvFormato').value,
    publicos: $$('#cvPublicos input:checked').map((c) => c.value)
  };
}
function usarPersonalizacao() {
  const instr = montarInstrucaoConstrutor(selecaoConstrutor());
  if (!instr.trim()) { toast('Escolha ao menos uma opção na personalização.'); return; }
  estado.custom = instr;
  $('#cvPrompt').value = 'PL';
  atualizarDescricaoPrompt();
  $('#cvPromptDesc').textContent = 'Personalizado: ' + instr.slice(0, 120) + (instr.length > 120 ? '…' : '');
  toast('Personalização aplicada a esta conversão.');
}
function salvarNaBiblioteca() {
  const instr = montarInstrucaoConstrutor(selecaoConstrutor());
  if (!instr.trim()) { toast('Monte o prompt na personalização antes de salvar.'); return; }
  const nome = ($('#cvNomePrompt').value || '').trim() || 'Prompt do Conversor';
  const CHAVE = 'lucas.prompts.usuario'; // mesma chave da Biblioteca e do Editor
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(CHAVE) || '[]') || []; } catch (e) { arr = []; }
  const id = 'u' + Math.abs(Date.now()).toString(36);
  arr.push({ id, nome, descricao: 'Criado no Conversor.', instrucao: instr });
  try { localStorage.setItem(CHAVE, JSON.stringify(arr)); } catch (e) {}
  // Nuvem, se a pessoa estiver logada (não bloqueia o fluxo se falhar).
  import('./nuvem.js').then((nuvem) => {
    nuvem.salvarPromptNuvem({ nome, descricao: 'Criado no Conversor.', instrucao: instr }).catch(() => {});
  }).catch(() => {});
  toast('Prompt salvo na biblioteca ("Meus prompts").');
}

// ---------------------------------------------------------------------------
// Entrada: arquivos + texto colado
// ---------------------------------------------------------------------------
async function lerArquivo(file) {
  const nome = file.name || 'documento';
  const ext = nome.toLowerCase().split('.').pop();
  if (ext === 'docx') {
    const { paragrafos } = await lerDocx(file);
    return { nome, original: paragrafos.map((p) => p.texto).join('\n\n') };
  }
  if (ext === 'pdf') {
    const { paragrafos } = await lerPdf(file, () => {});
    return { nome, original: paragrafos.map((p) => p.texto).join('\n\n') };
  }
  if (ext === 'txt' || ext === 'md' || file.type === 'text/plain') {
    return { nome, original: (await file.text()).trim() };
  }
  throw new Error('Formato não reconhecido (' + nome + '). Use DOCX, PDF ou TXT.');
}
async function importarArquivos(fileList) {
  const files = Array.from(fileList || []);
  for (const f of files) {
    try {
      $('#cvDropMsg').textContent = 'Lendo ' + (f.name || 'arquivo') + '…';
      const doc = await lerArquivo(f);
      if (doc.original.trim()) estado.docs.push(doc);
      else toast('Sem texto legível em ' + doc.nome + '.');
    } catch (e) { toast((e && e.message) || 'Falha ao ler arquivo.'); }
  }
  $('#cvDropMsg').textContent = 'Arraste arquivos aqui ou clique para escolher (DOCX, PDF, TXT)';
  renderDocs();
}
function addColado() {
  const t = ($('#cvColar').value || '').trim();
  if (!t) { toast('Cole ou digite um texto primeiro.'); return; }
  estado.docs.push({ nome: 'Texto colado ' + (estado.docs.filter((d) => /^Texto colado/.test(d.nome)).length + 1), original: t });
  $('#cvColar').value = '';
  renderDocs();
}
function renderDocs() {
  const wrap = $('#cvDocs');
  if (!estado.docs.length) { wrap.innerHTML = '<span class="cv-muted">Nenhum documento carregado ainda.</span>'; return; }
  wrap.innerHTML = estado.docs.map((d, i) =>
    `<span class="cv-chip">${escapar(d.nome)} <button data-rm="${i}" title="Remover" aria-label="Remover">×</button></span>`).join('');
  $$('#cvDocs [data-rm]').forEach((b) => b.addEventListener('click', () => { estado.docs.splice(+b.dataset.rm, 1); renderDocs(); }));
}

// ---------------------------------------------------------------------------
// Conversão
// ---------------------------------------------------------------------------
function construirVocab(texto) {
  const ranges = dic.localizar(texto) || [];
  const vistos = new Set();
  const out = [];
  for (const r of ranges) {
    const v = r.verbete; if (!v) continue;
    const termo = v.termo;
    const chave = (termo || '').toLowerCase();
    if (!termo || vistos.has(chave)) continue;
    vistos.add(chave);
    const significado = v.tratamento === 'substituir' ? (v.simples || v.explicacao || '') : (v.explicacao || v.simples || '');
    if (significado) out.push({ termo, significado, incluir: true });
  }
  out.sort((a, b) => a.termo.localeCompare(b.termo, 'pt'));
  return out;
}

async function converterTudo() {
  if (estado.rodando) return;
  if (!estado.docs.length) { toast('Carregue um documento ou cole um texto primeiro.'); return; }
  if (!configuradoOuAvisa()) return;

  const codigo = $('#cvPrompt').value;
  const instrucaoLivre = codigo === 'PL' ? (estado.custom || '') : '';
  if (codigo === 'PL' && !instrucaoLivre.trim()) { toast('Para prompt livre, use a personalização para montar a instrução.'); return; }
  const publicos = publicosSelecionados();
  const promptNome = codigo === 'PL' ? 'Personalizado' : ((porCodigo(codigo) || {}).nome || codigo);

  estado.rodando = true;
  const btn = $('#cvConverter'); btn.disabled = true; const rot = btn.textContent; btn.textContent = 'Convertendo…';
  const prog = $('#cvProgresso');
  estado.produtos = [];
  try {
    for (let i = 0; i < estado.docs.length; i++) {
      const doc = estado.docs[i];
      prog.textContent = `Convertendo documento ${i + 1} de ${estado.docs.length} — ${doc.nome}…`;
      const res = await converterDocumento(doc.original, {
        promptCodigo: codigo, instrucaoLivre, publicos,
        onProgress: (feito, total) => { prog.textContent = `Documento ${i + 1}/${estado.docs.length} — bloco ${feito}/${total}…`; },
        onTrocaModelo: (m) => toast('Modelo indisponível; usando ' + m + '.')
      });
      estado.produtos.push({
        nome: doc.nome, original: doc.original, convertido: (res.texto || '').trim(),
        vocab: construirVocab(doc.original),
        meta: { promptNome, publicos, provedor: res.provedor, modelo: res.modelo }
      });
    }
    estado.ativo = 0;
    prog.textContent = 'Pronto. Revise, edite se precisar e exporte.';
    renderSaida();
    $('#cvSaida').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    prog.innerHTML = `<span class="erro">Falha na conversão:</span> ${escapar((e && e.message) || 'erro')}`;
  } finally {
    estado.rodando = false; btn.disabled = false; btn.textContent = rot;
  }
}

async function reconverter() {
  if (!estado.produtos.length) return;
  if (!configuradoOuAvisa()) return;
  const i = estado.ativo;
  const doc = estado.produtos[i];
  const codigo = $('#cvPrompt').value;
  const instrucaoLivre = codigo === 'PL' ? (estado.custom || '') : '';
  const publicos = publicosSelecionados();
  const variacao = ($('#cvVariacao').value || '').trim();
  const prog = $('#cvProgresso'); prog.textContent = 'Convertendo de novo…';
  $('#cvReconverter').disabled = true;
  try {
    const res = await converterDocumento(doc.original, {
      promptCodigo: codigo, instrucaoLivre, publicos,
      orientacoes: variacao ? [variacao] : undefined,
      onProgress: (f, t) => { prog.textContent = `Reconvertendo — bloco ${f}/${t}…`; },
      onTrocaModelo: (m) => toast('Modelo indisponível; usando ' + m + '.')
    });
    doc.convertido = (res.texto || '').trim();
    doc.meta.promptNome = codigo === 'PL' ? 'Personalizado' : ((porCodigo(codigo) || {}).nome || codigo);
    doc.meta.publicos = publicos;
    prog.textContent = 'Nova versão pronta.';
    renderSaida();
  } catch (e) {
    prog.innerHTML = `<span class="erro">Falha:</span> ${escapar((e && e.message) || 'erro')}`;
  } finally { $('#cvReconverter').disabled = false; }
}

// ---------------------------------------------------------------------------
// Saída: seletor de documento, resultado editável, vocabulário, exportação
// ---------------------------------------------------------------------------
function renderSaida() {
  if (!estado.produtos.length) { $('#cvSaida').style.display = 'none'; return; }
  $('#cvSaida').style.display = '';
  const p = estado.produtos[estado.ativo];

  const selWrap = $('#cvSeletorWrap');
  if (estado.produtos.length > 1) {
    selWrap.style.display = '';
    $('#cvSeletor').innerHTML = estado.produtos.map((pr, i) => `<option value="${i}" ${i === estado.ativo ? 'selected' : ''}>${escapar(pr.nome)}</option>`).join('');
  } else { selWrap.style.display = 'none'; }

  $('#cvMeta').textContent = `Prompt: ${p.meta.promptNome}` + (p.meta.modelo ? ` · ${p.meta.modelo}` : '') + (p.meta.publicos && p.meta.publicos.length ? ` · público calibrado` : '');
  $('#cvResultado').value = p.convertido;

  const vocWrap = $('#cvVocab');
  if (p.vocab && p.vocab.length) {
    vocWrap.style.display = '';
    $('#cvVocabLista').innerHTML = p.vocab.map((v, i) =>
      `<label class="cv-vocab-item"><input type="checkbox" data-v="${i}" ${v.incluir !== false ? 'checked' : ''}><span><b>${escapar(v.termo)}</b>: ${escapar(v.significado)}</span></label>`).join('');
    $$('#cvVocabLista input').forEach((c) => c.addEventListener('change', () => { p.vocab[+c.dataset.v].incluir = c.checked; }));
  } else { vocWrap.style.display = 'none'; }
}
function formAtual() {
  return {
    linkOficial: ($('#cvLink').value || '').trim(),
    respNome: ($('#cvRespNome').value || '').trim(),
    respCargo: ($('#cvRespCargo').value || '').trim(),
    respId: ($('#cvRespId').value || '').trim()
  };
}
async function exportar(tipo) {
  const p = estado.produtos[estado.ativo]; if (!p) return;
  p.convertido = $('#cvResultado').value; // pega as edições humanas
  const form = formAtual();
  try {
    if (tipo === 'txt') exportarTxt(p, form);
    else if (tipo === 'pdf') exportarPdf(p, form);
    else await exportarDocx(p, form);
    toast('Exportação gerada.');
  } catch (e) { toast((e && e.message) || 'Falha ao exportar.'); }
}

// ---------------------------------------------------------------------------
// Ligações
// ---------------------------------------------------------------------------
function ligar() {
  // Provedor
  $('#cvProv').addEventListener('change', () => { prov.setProvedorAtual($('#cvProv').value); sincronizarChave(); atualizarModeloSelect(); $('#cvProvStatus').textContent = ''; });
  $('#cvChave').addEventListener('change', () => prov.setChave($('#cvProv').value, $('#cvChave').value.trim()));
  $('#cvModelo').addEventListener('change', () => prov.setModelo($('#cvProv').value, $('#cvModelo').value));
  $('#cvTestar').addEventListener('click', testarChave);

  // Entrada
  const drop = $('#cvDrop'), file = $('#cvFile');
  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { importarArquivos(file.files); file.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('sobre'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('sobre'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('sobre'); if (e.dataTransfer && e.dataTransfer.files) importarArquivos(e.dataTransfer.files); });
  $('#cvAddColado').addEventListener('click', addColado);

  // Prompt / personalização
  $('#cvPrompt').addEventListener('change', atualizarDescricaoPrompt);
  $('#cvPersonalizar').addEventListener('click', () => { const pan = $('#cvConstrutor'); pan.style.display = pan.style.display === 'none' ? '' : 'none'; });
  $('#cvPresets').addEventListener('change', () => aplicarPreset($('#cvPresets').value));
  $('#cvUsarCustom').addEventListener('click', usarPersonalizacao);
  $('#cvSalvarBib').addEventListener('click', salvarNaBiblioteca);

  // Conversão e saída
  $('#cvConverter').addEventListener('click', converterTudo);
  $('#cvReconverter').addEventListener('click', reconverter);
  $('#cvSeletor').addEventListener('change', () => { estado.ativo = +$('#cvSeletor').value; renderSaida(); });
  $('#cvResultado').addEventListener('input', () => { const p = estado.produtos[estado.ativo]; if (p) p.convertido = $('#cvResultado').value; });
  $('#cvExpDocx').addEventListener('click', () => exportar('docx'));
  $('#cvExpTxt').addEventListener('click', () => exportar('txt'));
  $('#cvExpPdf').addEventListener('click', () => exportar('pdf'));
}

async function carregarDicionario() {
  try {
    const json = await (await fetch('dados/dicionario.json')).json();
    dic.carregar(json.verbetes || []);
  } catch (e) { dic.carregar([]); /* vocabulário fica vazio se o dicionário não carregar */ }
}

async function init() {
  await carregarDicionario();
  renderProvedor();
  renderPromptSelect();
  renderPublicos();
  renderConstrutor();
  renderDocs();
  renderSaida();
  ligar();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
