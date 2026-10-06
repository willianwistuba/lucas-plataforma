// conversor.js — módulo CONVERSOR. Fluxo sequencial (wizard) que gera uma
// EXPLICAÇÃO em linguagem simples (produto de apoio, SEM valor jurídico): diz o
// que é o documento, o que diz e o que muda na prática. Não reescreve o inteiro
// nem calcula Flesch/Índice de Clareza — só explica, deixa editável e exporta
// (DOCX/TXT/PDF) com disclaimer, link do documento oficial e responsável.
//
// Reaproveita: conversao.js (explicar), prompts.js, construtor.js (público +
// ajustes guiados), dicionario.js (vocabulário), provedores.js (BYOK), importar/*.

import * as prov from './provedores.js';
import { explicar } from './conversao.js';
import { PUBLICOS, CONSTRUTOR_OBJETIVO, CONSTRUTOR_TOM, CONSTRUTOR_FORMATO, CONSTRUTOR_PRESETS, montarInstrucaoConstrutor } from './construtor.js';
import * as dic from './dicionario.js';
import { lerDocx } from './importar/docx.js';
import { lerPdf } from './importar/pdf.js';
import { exportarTxt, exportarDocx, exportarPdf } from './exportar/conversor.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const PASSOS = [
  { id: 'entrada', titulo: 'Documento' },
  { id: 'prompt', titulo: 'Como explicar' },
  { id: 'dados', titulo: 'Dados' },
  { id: 'resultado', titulo: 'Resultado' }
];

const estado = {
  docs: [],        // [{ nome, original }]
  produtos: [],    // [{ nome, original, convertido, vocab, meta }]
  ativo: 0,
  passo: 0,
  rodando: false
};

function toast(msg) {
  let t = $('#cvToast');
  if (!t) { t = document.createElement('div'); t.id = 'cvToast'; t.className = 'cv-toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('on');
  clearTimeout(t.__t); t.__t = setTimeout(() => t.classList.remove('on'), 2800);
}
function escapar(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------
function renderStepper() {
  $('#cvStepper').innerHTML = PASSOS.map((p, i) =>
    `<span class="st ${i === estado.passo ? 'ativo' : (i < estado.passo ? 'feito' : '')}"><b>${i + 1}</b> ${escapar(p.titulo)}</span>`).join('');
}
function mostrarPasso() {
  const id = PASSOS[estado.passo].id;
  $$('.cv-step').forEach((s) => { s.hidden = s.dataset.step !== id; });
  renderStepper();
  $('#cvVoltar').disabled = estado.passo === 0;
  $('#cvAvancar').style.display = estado.passo === PASSOS.length - 1 ? 'none' : '';
  $('#cvPos').textContent = `Passo ${estado.passo + 1} de ${PASSOS.length}`;
  if (id === 'resultado') renderResultadoEstado();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function avancar() {
  if (PASSOS[estado.passo].id === 'entrada' && !estado.docs.length) {
    toast('Carregue um documento ou adicione um texto primeiro.'); return;
  }
  if (estado.passo < PASSOS.length - 1) { estado.passo++; mostrarPasso(); }
}
function voltar() { if (estado.passo > 0) { estado.passo--; mostrarPasso(); } }

// ---------------------------------------------------------------------------
// Provedor de IA (BYOK)
// ---------------------------------------------------------------------------
function renderProvedor() {
  const sel = $('#cvProv');
  sel.innerHTML = Object.entries(prov.PROVEDORES).map(([id, d]) => `<option value="${id}">${escapar(d.rotulo || id)}</option>`).join('');
  sel.value = prov.getProvedorAtual();
  sincronizarChave();
  atualizarModeloSelect();
}
function sincronizarChave() {
  const p = $('#cvProv').value;
  const def = prov.PROVEDORES[p];
  $('#cvChave').value = prov.getChave(p) || '';
  $('#cvChave').disabled = !def.requerChave;
  $('#cvChave').placeholder = def.requerChave ? 'Cole aqui a sua chave da API' : 'Este provedor não exige chave';
  const link = $('#cvChaveLink');
  if (def.urlChave) { link.href = def.urlChave; link.style.display = ''; } else { link.style.display = 'none'; }
}
function atualizarModeloSelect() {
  const p = $('#cvProv').value;
  const def = prov.PROVEDORES[p];
  const atual = prov.getModelo(p);
  $('#cvModelo').innerHTML = (def.modelos || []).map((m) => `<option value="${escapar(m)}" ${m === atual ? 'selected' : ''}>${escapar(m)}</option>`).join('');
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
      st.innerHTML = chaveRuim ? '<span class="erro">A chave foi rejeitada.</span> Confira se copiou a chave certa.'
        : '<span class="aten">Nenhum modelo respondeu agora.</span> Tente de novo em instantes.';
      return;
    }
    $('#cvModelo').innerHTML = ok.map((m, i) => `<option value="${escapar(m)}" ${i === 0 ? 'selected' : ''}>${escapar(m)}${i === 0 ? ' (recomendado)' : ''}</option>`).join('');
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
    $('#cvProvDet').open = true;
    $('#cvProvDet').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Ajustes (construtor) + público
// ---------------------------------------------------------------------------
function renderConstrutor() {
  $('#cvObjetivo').innerHTML = CONSTRUTOR_OBJETIVO.map((o) => `<label class="cv-chk"><input type="checkbox" value="${o.id}"><span>${escapar(o.txt)}</span></label>`).join('');
  $('#cvTom').innerHTML = '<option value="">(padrão)</option>' + CONSTRUTOR_TOM.map((t) => `<option value="${t.id}">${escapar(t.txt)}</option>`).join('');
  $('#cvFormato').innerHTML = '<option value="">(padrão)</option>' + CONSTRUTOR_FORMATO.map((f) => `<option value="${f.id}">${escapar(f.txt)}</option>`).join('');
  $('#cvPresets').innerHTML = '<option value="">Sem modelo</option>' + CONSTRUTOR_PRESETS.map((p) => `<option value="${p.id}">${escapar(p.nome)}</option>`).join('');
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
    publicos: [] // público é tratado em separado no passo próprio
  };
}
function instrucaoAjustes() {
  return montarInstrucaoConstrutor(selecaoConstrutor()).trim();
}
function salvarNaBiblioteca() {
  const instr = instrucaoAjustes();
  if (!instr) { toast('Selecione ao menos uma ênfase/tom/formato para salvar.'); return; }
  const nome = ($('#cvNomePrompt').value || '').trim() || 'Prompt do Conversor';
  const CHAVE = 'lucas.prompts.usuario';
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(CHAVE) || '[]') || []; } catch (e) { arr = []; }
  arr.push({ id: 'u' + Math.abs(Date.now()).toString(36), nome, descricao: 'Criado no Conversor.', instrucao: instr });
  try { localStorage.setItem(CHAVE, JSON.stringify(arr)); } catch (e) {}
  import('./nuvem.js').then((n) => n.salvarPromptNuvem({ nome, descricao: 'Criado no Conversor.', instrucao: instr }).catch(() => {})).catch(() => {});
  toast('Prompt salvo na biblioteca ("Meus prompts").');
}
function renderPublicos() {
  $('#cvPublicos').innerHTML = PUBLICOS.map((pb) => `<label class="cv-chk"><input type="checkbox" value="${pb.id}"><span>${escapar(pb.curto)}</span></label>`).join('');
}
function publicosSelecionados() {
  return $$('#cvPublicos input:checked').map((c) => (PUBLICOS.find((p) => p.id === c.value) || {}).rotulo).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
async function lerArquivo(file) {
  const nome = file.name || 'documento';
  const ext = nome.toLowerCase().split('.').pop();
  if (ext === 'docx') { const { paragrafos } = await lerDocx(file); return { nome, original: paragrafos.map((p) => p.texto).join('\n\n') }; }
  if (ext === 'pdf') { const { paragrafos } = await lerPdf(file, () => {}); return { nome, original: paragrafos.map((p) => p.texto).join('\n\n') }; }
  if (ext === 'txt' || ext === 'md' || file.type === 'text/plain') { return { nome, original: (await file.text()).trim() }; }
  throw new Error('Formato não reconhecido (' + nome + '). Use DOCX, PDF ou TXT.');
}
async function importarArquivos(fileList) {
  for (const f of Array.from(fileList || [])) {
    try {
      $('#cvDropMsg').textContent = 'Lendo ' + (f.name || 'arquivo') + '…';
      const doc = await lerArquivo(f);
      if (doc.original.trim()) estado.docs.push(doc); else toast('Sem texto legível em ' + doc.nome + '.');
    } catch (e) { toast((e && e.message) || 'Falha ao ler arquivo.'); }
  }
  $('#cvDropMsg').textContent = 'Arraste arquivos aqui ou clique para escolher (DOCX, PDF, TXT)';
  renderDocs();
}
function addColado() {
  const t = ($('#cvColar').value || '').trim();
  if (!t) { toast('Cole ou digite um texto primeiro.'); return; }
  const n = estado.docs.filter((d) => /^Texto colado/.test(d.nome)).length + 1;
  estado.docs.push({ nome: 'Texto colado ' + n, original: t });
  $('#cvColar').value = '';
  renderDocs();
}
function renderDocs() {
  const wrap = $('#cvDocs');
  if (!estado.docs.length) { wrap.innerHTML = '<span class="cv-muted">Nenhum documento adicionado ainda.</span>'; return; }
  wrap.innerHTML = estado.docs.map((d, i) => `<span class="cv-chip">${escapar(d.nome)} <button data-rm="${i}" title="Remover" aria-label="Remover">×</button></span>`).join('');
  $$('#cvDocs [data-rm]').forEach((b) => b.addEventListener('click', () => { estado.docs.splice(+b.dataset.rm, 1); renderDocs(); }));
}

// ---------------------------------------------------------------------------
// Vocabulário (do dicionário)
// ---------------------------------------------------------------------------
function construirVocab(texto) {
  const vistos = new Set(); const out = [];
  for (const r of (dic.localizar(texto) || [])) {
    const v = r.verbete; if (!v || !v.termo) continue;
    const chave = v.termo.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const significado = v.tratamento === 'substituir' ? (v.simples || v.explicacao || '') : (v.explicacao || v.simples || '');
    if (significado) out.push({ termo: v.termo, significado, incluir: true });
  }
  out.sort((a, b) => a.termo.localeCompare(b.termo, 'pt'));
  return out;
}

// ---------------------------------------------------------------------------
// Geração (explicar)
// ---------------------------------------------------------------------------
async function gerarTodos() {
  if (estado.rodando) return;
  if (!estado.docs.length) { toast('Nenhum documento para explicar.'); return; }
  if (!configuradoOuAvisa()) return;
  const publicos = publicosSelecionados();
  const instrucaoLivre = instrucaoAjustes();

  estado.rodando = true;
  const btn = $('#cvGerar'); btn.disabled = true; const rot = btn.textContent; btn.textContent = 'Gerando…';
  const prog = $('#cvProgresso');
  estado.produtos = [];
  try {
    for (let i = 0; i < estado.docs.length; i++) {
      const doc = estado.docs[i];
      prog.textContent = `Explicando documento ${i + 1} de ${estado.docs.length} — ${doc.nome}…`;
      const res = await explicar(doc.original, { publicos, instrucaoLivre, onTrocaModelo: (m) => toast('Modelo indisponível; usando ' + m + '.') });
      estado.produtos.push({
        nome: doc.nome, original: doc.original, convertido: (res.texto || '').trim(),
        vocab: construirVocab(doc.original),
        meta: { publicos, provedor: res.provedor, modelo: res.modelo }
      });
    }
    estado.ativo = 0;
    prog.textContent = '';
    renderResultadoEstado();
  } catch (e) {
    prog.innerHTML = `<span style="color:var(--danger);font-weight:700">Falha:</span> ${escapar((e && e.message) || 'erro')}`;
  } finally { estado.rodando = false; btn.disabled = false; btn.textContent = rot; }
}
async function reconverter() {
  if (!estado.produtos.length || !configuradoOuAvisa()) return;
  const doc = estado.produtos[estado.ativo];
  const publicos = publicosSelecionados();
  const variacao = ($('#cvVariacao').value || '').trim();
  const instrucaoLivre = [instrucaoAjustes(), variacao].filter(Boolean).join(' ');
  $('#cvReconverter').disabled = true;
  $('#cvMeta').textContent = 'Gerando de novo…';
  try {
    const res = await explicar(doc.original, { publicos, instrucaoLivre, onTrocaModelo: (m) => toast('Modelo indisponível; usando ' + m + '.') });
    doc.convertido = (res.texto || '').trim();
    doc.meta.publicos = publicos;
    renderSaida();
  } catch (e) { $('#cvMeta').innerHTML = `<span style="color:var(--danger)">Falha: ${escapar((e && e.message) || 'erro')}</span>`; }
  finally { $('#cvReconverter').disabled = false; }
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------
function renderResultadoEstado() {
  const tem = estado.produtos.length > 0;
  $('#cvGerarWrap').style.display = tem ? 'none' : '';
  $('#cvSaida').hidden = !tem;
  if (tem) renderSaida();
}
function renderSaida() {
  const p = estado.produtos[estado.ativo]; if (!p) return;
  const selWrap = $('#cvSeletorWrap');
  if (estado.produtos.length > 1) {
    selWrap.style.display = '';
    $('#cvSeletor').innerHTML = estado.produtos.map((pr, i) => `<option value="${i}" ${i === estado.ativo ? 'selected' : ''}>${escapar(pr.nome)}</option>`).join('');
  } else { selWrap.style.display = 'none'; }
  $('#cvMeta').textContent = (p.meta.modelo ? `Modelo: ${p.meta.modelo}` : '') + (p.meta.publicos && p.meta.publicos.length ? ' · público calibrado' : '');
  $('#cvResultado').value = p.convertido;
  const vocWrap = $('#cvVocab');
  if (p.vocab && p.vocab.length) {
    vocWrap.style.display = '';
    $('#cvVocabLista').innerHTML = p.vocab.map((v, i) => `<label class="cv-vocab-item"><input type="checkbox" data-v="${i}" ${v.incluir !== false ? 'checked' : ''}><span><b>${escapar(v.termo)}</b>: ${escapar(v.significado)}</span></label>`).join('');
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
  p.convertido = $('#cvResultado').value; // edições humanas
  const form = formAtual();
  try {
    if (tipo === 'txt') exportarTxt(p, form);
    else if (tipo === 'pdf') exportarPdf(p, form);
    else await exportarDocx(p, form);
    toast('Exportação gerada.');
  } catch (e) { toast((e && e.message) || 'Falha ao exportar.'); }
}

// ---------------------------------------------------------------------------
// Ligações + init
// ---------------------------------------------------------------------------
function ligar() {
  $('#cvProv').addEventListener('change', () => { prov.setProvedorAtual($('#cvProv').value); sincronizarChave(); atualizarModeloSelect(); $('#cvProvStatus').textContent = ''; });
  $('#cvChave').addEventListener('change', () => prov.setChave($('#cvProv').value, $('#cvChave').value.trim()));
  $('#cvModelo').addEventListener('change', () => prov.setModelo($('#cvProv').value, $('#cvModelo').value));
  $('#cvTestar').addEventListener('click', testarChave);

  const drop = $('#cvDrop'), file = $('#cvFile');
  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { importarArquivos(file.files); file.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('sobre'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('sobre'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('sobre'); if (e.dataTransfer && e.dataTransfer.files) importarArquivos(e.dataTransfer.files); });
  $('#cvAddColado').addEventListener('click', addColado);

  $('#cvPresets').addEventListener('change', () => aplicarPreset($('#cvPresets').value));
  $('#cvSalvarBib').addEventListener('click', salvarNaBiblioteca);

  $('#cvGerar').addEventListener('click', gerarTodos);
  $('#cvReconverter').addEventListener('click', reconverter);
  $('#cvSeletor').addEventListener('change', () => { estado.ativo = +$('#cvSeletor').value; renderSaida(); });
  $('#cvResultado').addEventListener('input', () => { const p = estado.produtos[estado.ativo]; if (p) p.convertido = $('#cvResultado').value; });
  $('#cvExpDocx').addEventListener('click', () => exportar('docx'));
  $('#cvExpTxt').addEventListener('click', () => exportar('txt'));
  $('#cvExpPdf').addEventListener('click', () => exportar('pdf'));

  $('#cvAvancar').addEventListener('click', avancar);
  $('#cvVoltar').addEventListener('click', voltar);
}
async function carregarDicionario() {
  try { const j = await (await fetch('dados/dicionario.json')).json(); dic.carregar(j.verbetes || []); }
  catch (e) { dic.carregar([]); }
}
async function init() {
  await carregarDicionario();
  renderProvedor();
  renderConstrutor();
  renderPublicos();
  renderDocs();
  ligar();
  mostrarPasso();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
