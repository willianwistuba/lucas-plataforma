// editor.js — módulo Editor da plataforma LUCAS.
// Importa/escreve texto, calcula o índice por parágrafo, exibe a margem de
// comentários (faixa + motivos), o dicionário interativo, a conversão por IA
// (BYOK, com conferência) e o registro de revisão. Exportação DOCX e Supabase
// entram nas próximas etapas.

import { metricasParagrafo, metricasDocumento, nomeFaixa } from './metricas.js';
import { detectar, EXPLICACOES } from './detectores.js';
import * as dic from './dicionario.js';
import * as prov from './provedores.js';
import { converter, converterDocumento, avaliarDocumento, avaliarTrecho, termosProtegidos } from './conversao.js';
import * as registro from './registro.js';
import { PROMPTS, PROMPT_LIVRE, porCodigo, sistema, sistemaTrecho } from './prompts.js';
import { lerDocx } from './importar/docx.js';
import { lerPdf } from './importar/pdf.js';
import { exportarDocx } from './exportar/docx.js';
import { painelHtml } from './painel.js';
import * as nuvem from './nuvem.js';
import { PUBLICOS, CONSTRUTOR_OBJETIVO, CONSTRUTOR_TOM, CONSTRUTOR_FORMATO, CONSTRUTOR_PRESETS, montarInstrucaoConstrutor } from './construtor.js';

const ATRASO_ANALISE = 1500; // ms após a última tecla (SPEC 5.3)

const estado = {
  documento: { origem: 'digitado', nomeArquivo: '', paragrafos: [] },
  ativo: null
};

let contadorId = 0;
const novoId = () => 'p-' + String(++contadorId).padStart(4, '0');

// ---------------------------------------------------------------------------
// Ajustes de clareza do usuário (persistidos): pesos do Índice de Clareza e
// público-alvo. Não há "percentual científico" para os pesos, então o usuário
// os controla; o público-alvo calibra a linguagem que a IA usa (SPEC — ajuste
// fino). Nenhum desses dados vai para a nuvem. PUBLICOS vem de construtor.js.
// ---------------------------------------------------------------------------
const PESOS_PADRAO = { legibilidade: 40, ia: 60 };

function limitarPeso(v, padrao) {
  const n = Number(v);
  return isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : padrao;
}
function carregarAjustes() {
  try {
    const o = JSON.parse(localStorage.getItem('lucas.ajustesClareza') || 'null');
    if (o) {
      return {
        pesos: {
          legibilidade: limitarPeso(o.pesos && o.pesos.legibilidade, PESOS_PADRAO.legibilidade),
          ia: limitarPeso(o.pesos && o.pesos.ia, PESOS_PADRAO.ia)
        },
        publicos: Array.isArray(o.publicos) ? o.publicos.filter((id) => PUBLICOS.some((p) => p.id === id)) : [],
        autoAvaliar: o.autoAvaliar !== false // padrão: ligado
      };
    }
  } catch (e) { /* ignora */ }
  return { pesos: { ...PESOS_PADRAO }, publicos: [], autoAvaliar: true };
}
function gravarAjustes() {
  try { localStorage.setItem('lucas.ajustesClareza', JSON.stringify(ajustes)); } catch (e) { /* ignora */ }
}
function publicosRotulos() {
  return ajustes.publicos.map((id) => (PUBLICOS.find((p) => p.id === id) || {}).rotulo).filter(Boolean);
}
let ajustes = carregarAjustes();

// ---------------------------------------------------------------------------
// Referências de DOM
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
let elEditor, elEditorWrap, elMargemCanvas, elMargem, elKpis, elVazio, elToasts;

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
async function iniciar() {
  elEditor = $('#editor');
  elEditorWrap = $('#editorWrap');
  elMargem = $('#margem');
  elMargemCanvas = $('#margemCanvas');
  elKpis = $('#margemResumo'); // resumo de clareza mora na aba lateral (painel de revisão)
  elVazio = $('#vazio');
  elToasts = $('#toasts');

  await carregarDicionario();
  ligarUI();
  iniciarAuth();
  mostrarAvisoInicial();
  renderVazio(); // já reoferece retomar via cartão discreto (sem modal)
}

let SINONIMOS = {};
let SINONIMOS_USUARIO = {}; // substituições cadastradas pelo usuário (localStorage + nuvem)
let popoverAnchor = null; // termo ancorado ao popover aberto (para reposicionar ao rolar)
let reconstruindoEditor = false; // enquanto true, o blur não sincroniza (evita duplicação em dividir/unir)

async function carregarDicionario() {
  try {
    const resp = await fetch('dados/dicionario.json');
    const json = await resp.json();
    dic.carregar(json.verbetes || []);
  } catch (e) {
    console.warn('Não foi possível carregar o dicionário:', e);
    dic.carregar([]);
  }
  try {
    const s = await (await fetch('dados/sinonimos.json')).json();
    SINONIMOS = s.sinonimos || {};
  } catch (e) { SINONIMOS = {}; }
  carregarSinonimosUsuario();
  carregarPromptsUsuario();
}

function ligarUI() {
  $('#btnDemo').addEventListener('click', carregarDemo);
  $('#btnColar').addEventListener('click', abrirColar);
  $('#btnLimpar').addEventListener('click', limpar);
  const bcfg = $('#btnConfig'); if (bcfg) bcfg.addEventListener('click', abrirConfigProvedores);
  const br = $('#btnRegistro'); if (br) br.addEventListener('click', abrirRegistro);
  const brs = $('#btnRestaurar'); if (brs) brs.addEventListener('click', restaurarOriginal);
  const bex = $('#btnExportar'); if (bex) bex.addEventListener('click', exportar);
  const bpn = $('#btnPainel'); if (bpn) bpn.addEventListener('click', abrirPainel);
  const bct = $('#btnConverterTudo'); if (bct) bct.addEventListener('click', abrirConversaoLote);
  const bav = $('#btnAvaliar'); if (bav) bav.addEventListener('click', avaliarClareza);
  const bconta = $('#btnConta'); if (bconta) bconta.addEventListener('click', abrirConta);
  const bmp = $('#btnMeusPrompts'); if (bmp) bmp.addEventListener('click', abrirMeusPrompts);
  // Menus suspensos (Documento e ⋯). Movidos ao <body> e posicionados como fixed,
  // para não serem cortados por overflow nem competirem na barra.
  function ligarDropdown(btn, menu) {
    if (!btn || !menu) return;
    document.body.appendChild(menu);
    menu.style.position = 'fixed';
    const posicionar = () => {
      const r = btn.getBoundingClientRect();
      menu.style.top = (r.bottom + 8) + 'px';
      menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
      menu.style.left = 'auto';
    };
    const fechar = () => { menu.classList.remove('on'); btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.editor-menu.on').forEach((m) => { if (m !== menu) m.classList.remove('on'); });
      const on = menu.classList.toggle('on');
      if (on) posicionar();
      btn.setAttribute('aria-expanded', String(on));
    });
    menu.addEventListener('click', () => setTimeout(fechar, 0));
    document.addEventListener('click', (e) => { if (e.target !== btn && !btn.contains(e.target) && !menu.contains(e.target)) fechar(); });
    window.addEventListener('resize', () => { if (menu.classList.contains('on')) posicionar(); });
  }
  ligarDropdown($('#btnDoc'), $('#docMenu'));
  ligarDropdown($('#btnMais'), $('#editorMenu'));

  const inp = $('#inputArquivo');
  inp.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) importarArquivo(f);
    e.target.value = ''; // permite reabrir o mesmo arquivo
  });
  const bab = $('#btnAbrir'); if (bab) bab.addEventListener('click', () => inp.click());
  const bdz = $('#btnDesfazer'); if (bdz) bdz.addEventListener('click', desfazer);
  const btr = $('#btnTrabalhos'); if (btr) btr.addEventListener('click', abrirTrabalhos);
  atualizarBotaoDesfazer();
  atualizarBadgeTrabalhos();

  // Dropzone: clique e arrastar-soltar.
  const dz = $('#dropzone');
  if (dz) {
    dz.addEventListener('click', () => inp.click());
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('hover'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('hover'); }));
    dz.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) importarArquivo(f);
    });
  }

  // Sincroniza a rolagem da margem com a do editor (comentários alinhados).
  elEditorWrap.addEventListener('scroll', () => {
    elMargemCanvas.style.transform = `translateY(${-elEditorWrap.scrollTop}px)`;
    reposicionarPopover(); // o menu acompanha o termo ao rolar (não fecha à toa)
    fecharJuntar();
  });

  // A margem tem overflow:hidden (os cards são posicionados em sincronia com o
  // editor). Para o scroll funcionar também com o mouse sobre a margem, a roda do
  // mouse ali é repassada ao editor — que é quem realmente rola.
  elMargem.addEventListener('wheel', (e) => {
    const unidade = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? elEditorWrap.clientHeight : 1;
    elEditorWrap.scrollTop += e.deltaY * unidade;
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('resize', () => alinharComentarios());
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.popover') && !e.target.closest('.termo')) fecharPopover();
    if (!e.target.closest('.juntar-pop')) fecharJuntar();
  });

  ligarEditor(); // edição estilo Word no contenteditable único
}

// ---------------------------------------------------------------------------
// Importação de texto
// ---------------------------------------------------------------------------
function textoEmParagrafos(texto) {
  const bruto = String(texto).replace(/\r\n/g, '\n').trim();
  let blocos = bruto.split(/\n\s*\n/);
  if (blocos.length <= 1) blocos = bruto.split(/\n/);
  return blocos.map((t) => t.trim()).filter(Boolean);
}

function carregarTexto(texto, origem, nome) {
  // Ao aplicar a conversão integral (origem 'convertido'), preserva a versão
  // original e o vínculo de nuvem, para que "Restaurar versão original" volte ao
  // documento que a pessoa carregou, não à conversão.
  const preservar = origem === 'convertido';
  const originalAnterior = estado.documento.original;
  const idNuvemAnterior = estado.documento.idNuvem;
  const blocos = textoEmParagrafos(texto);
  estado.documento = {
    origem: origem || 'digitado',
    nomeArquivo: nome || '',
    idNuvem: preservar ? (idNuvemAnterior || null) : null,
    paragrafos: blocos.map((t) => ({ id: novoId(), texto: t, emTabela: false, metricas: null, motivos: [] }))
  };
  estado.documento.original = preservar && originalAnterior ? originalAnterior : snapshotParagrafos();
  if (!preservar) { undoStack = []; atualizarBotaoDesfazer(); } // novo documento: zera o desfazer
  estado.documento.paragrafos.forEach(analisar);
  renderTudo();
  talvezAvaliarAoCarregar();
}

// Carrega parágrafos já estruturados (DOCX/PDF): [{texto, emTabela}].
function carregarParagrafos(pars, origem, nome, extra = {}) {
  estado.documento = {
    origem, nomeArquivo: nome || '', idNuvem: null,
    zip: extra.zip || null,
    paragrafos: pars.filter((p) => p.texto && p.texto.trim())
      .map((p) => ({ id: novoId(), texto: p.texto.trim(), textoOriginal: p.textoOriginal != null ? p.textoOriginal : p.texto.trim(), indiceXml: p.indiceXml != null ? p.indiceXml : null, emTabela: !!p.emTabela, paginaOrigem: p.paginaOrigem || null, metricas: null, motivos: [] }))
  };
  estado.documento.original = snapshotParagrafos();
  undoStack = []; atualizarBotaoDesfazer(); // novo documento: zera o desfazer
  estado.documento.paragrafos.forEach(analisar);
  renderTudo();
  talvezAvaliarAoCarregar();
}

// Instantâneo enxuto dos parágrafos atuais (texto puro), para guardar a versão
// original e para o rascunho local. Não inclui o objeto JSZip (não serializável).
function snapshotParagrafos() {
  return estado.documento.paragrafos.map((p) => ({
    id: p.id, texto: p.texto, textoOriginal: p.textoOriginal != null ? p.textoOriginal : null, indiceXml: p.indiceXml != null ? p.indiceXml : null, emTabela: !!p.emTabela, paginaOrigem: p.paginaOrigem || null
  }));
}

// ---------------------------------------------------------------------------
// Preservação da versão de trabalho (SPEC — persistência local do rascunho e
// retorno à versão original). Local para todos; na nuvem, via "Arquivar".
// ---------------------------------------------------------------------------
const CHAVE_RASCUNHO = 'lucas.rascunho';

// Estado serializável do documento (sem o JSZip), para arquivar e para rascunho.
function estadoParaSalvar() {
  const d = estado.documento;
  return {
    idNuvem: d.idNuvem || null,
    origem: d.origem || 'digitado',
    nomeArquivo: d.nomeArquivo || '',
    paragrafos: (d.paragrafos || []).map((p) => ({ id: p.id, texto: p.texto, emTabela: !!p.emTabela, paginaOrigem: p.paginaOrigem || null })),
    apendice: d.apendice || [],
    notas: d.notas || [],
    original: d.original || null,
    avaliacaoGlobal: d.avaliacaoGlobal || null
  };
}

function salvarRascunho() {
  try {
    if (!estado.documento.paragrafos.length) return;
    localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ salvoEm: Date.now(), doc: estadoParaSalvar() }));
    atualizarBadgeTrabalhos();
  } catch (e) { /* ignora (quota/serialização) */ }
}
let timerRascunho = null;
function agendarRascunho() { clearTimeout(timerRascunho); timerRascunho = setTimeout(salvarRascunho, 1500); }
function limparRascunho() { try { localStorage.removeItem(CHAVE_RASCUNHO); } catch (e) { /* ignora */ } atualizarBadgeTrabalhos(); }

// Reconstrói o documento a partir de um estado salvo (rascunho ou nuvem),
// reaproveitando os ids dos parágrafos para não quebrar notas e glossário.
function restaurarDoc(doc) {
  estado.documento = {
    idNuvem: doc.idNuvem || null,
    origem: doc.origem || 'digitado',
    nomeArquivo: doc.nomeArquivo || '',
    paragrafos: (doc.paragrafos || []).map((o) => ({ id: o.id || novoId(), texto: o.texto, emTabela: !!o.emTabela, paginaOrigem: o.paginaOrigem || null, metricas: null, motivos: [] })),
    apendice: doc.apendice || [],
    notas: doc.notas || [],
    original: doc.original || null,
    avaliacaoGlobal: doc.avaliacaoGlobal || null
  };
  let maxN = 0;
  for (const p of estado.documento.paragrafos) { const m = /(\d+)/.exec(p.id || ''); if (m) maxN = Math.max(maxN, +m[1]); }
  if (maxN > contadorId) contadorId = maxN;
  estado.documento.paragrafos.forEach(analisar);
  renderTudo();
}

// ---------------------------------------------------------------------------
// Desfazer (Ctrl+Z e botão): pilha de instantâneos do documento. Guardamos o
// estado ANTES de cada mudança (edição, conversão aceita, junção, troca de
// termo, nota, restauração) e voltamos ao topo da pilha ao desfazer.
// ---------------------------------------------------------------------------
let undoStack = [];
function snapshotUndo() {
  try {
    if (!estado.documento.paragrafos || !estado.documento.paragrafos.length) return;
    const snap = JSON.stringify(estadoParaSalvar());
    if (undoStack.length && undoStack[undoStack.length - 1] === snap) return; // sem mudança
    undoStack.push(snap);
    if (undoStack.length > 50) undoStack.shift();
    atualizarBotaoDesfazer();
  } catch (e) { /* ignora */ }
}
function atualizarBotaoDesfazer() {
  const b = $('#btnDesfazer'); if (b) b.disabled = undoStack.length === 0;
}
function desfazer() {
  if (!undoStack.length) { toast('Nada para desfazer.'); return; }
  const snap = undoStack.pop();
  try { restaurarDoc(JSON.parse(snap)); toast('Ação desfeita.'); } catch (e) { /* ignora */ }
  atualizarBotaoDesfazer();
}

// Lê o rascunho local (trabalho em andamento não arquivado), se houver e for
// válido. Devolve null quando não há nada para retomar.
function lerRascunho() {
  let r; try { r = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) || 'null'); } catch (e) { r = null; }
  if (!r || !r.doc || !Array.isArray(r.doc.paragrafos) || !r.doc.paragrafos.length) return null;
  return r;
}

// Mostra um pontinho discreto no item de menu "Trabalhos em andamento" quando
// existe um rascunho a retomar. Sem modal, sem poluir a tela inicial.
function atualizarBadgeTrabalhos() {
  const b = $('#badgeTrabalhos'); if (!b) return;
  b.hidden = !lerRascunho();
}

// Área dedicada "Trabalhos em andamento" (tela cheia, aberta pelo menu). Lista
// o trabalho não arquivado com Retomar/Descartar. Substitui o antigo modal que
// abria sozinho toda vez.
function abrirTrabalhos() {
  fecharModal(); fecharParagrafo();
  const ja = document.querySelector('#telaTrabalhos'); if (ja) ja.remove();
  const ov = document.createElement('div');
  ov.className = 'tela-conversao'; ov.id = 'telaTrabalhos';
  const fechar = () => ov.remove();
  ov.innerHTML = `
    <header class="tela-top">
      <button class="btn sm ghost" id="trabVoltar">‹ Voltar</button>
      <div class="tela-titulo">Trabalhos em andamento</div>
      <span style="width:64px"></span>
    </header>
    <div class="trab-lista" id="trabLista"></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#trabVoltar').addEventListener('click', fechar);
  renderTrabalhos(ov, fechar);
}

function renderTrabalhos(ov, fechar) {
  const lista = ov.querySelector('#trabLista');
  const r = lerRascunho();
  if (!r) {
    lista.innerHTML = `
      <div class="trab-vazio">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/></svg>
        <div>Nenhum trabalho em andamento.</div>
        <p style="font-size:13px;margin-top:6px">Quando você edita um documento sem arquivar, ele fica guardado aqui neste navegador para você retomar depois.</p>
      </div>`;
    return;
  }
  const quando = r.salvoEm ? new Date(r.salvoEm).toLocaleString('pt-BR') : '';
  const nParag = r.doc.paragrafos.length;
  const nome = r.doc.nomeArquivo ? escapar(r.doc.nomeArquivo) : 'Documento sem título';
  lista.innerHTML = `
    <div class="trab-card">
      <span class="tc-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/></svg></span>
      <div class="tc-tx">
        <div class="tc-nome">${nome}</div>
        <div class="tc-meta">${nParag} parágrafo${nParag > 1 ? 's' : ''}${quando ? ' · guardado em ' + escapar(quando) : ''}</div>
      </div>
      <div class="tc-acoes">
        <button class="btn sm primary" data-a="retomar">Retomar</button>
        <button class="btn sm ghost" data-a="descartar">Descartar</button>
      </div>
    </div>`;
  lista.querySelector('[data-a=retomar]').addEventListener('click', () => { restaurarDoc(r.doc); fechar(); toast('Trabalho retomado.'); });
  lista.querySelector('[data-a=descartar]').addEventListener('click', () => {
    confirmar('Descartar trabalho em andamento',
      'Isto apaga este rascunho deste navegador. Não é possível desfazer. Quer continuar?',
      () => { limparRascunho(); atualizarBadgeTrabalhos(); renderTrabalhos(ov, fechar); toast('Rascunho descartado.'); },
      null, { sim: 'Descartar', nao: 'Cancelar' });
  });
}

// Volta ao documento como foi carregado, descartando todas as alterações.
function restaurarOriginal() {
  const orig = estado.documento.original;
  if (!orig || !orig.length) { toast('Não há versão original guardada para este documento.'); return; }
  confirmar('Restaurar a versão original',
    'Isto descarta TODAS as alterações feitas desde que o documento foi carregado: conversões, trocas de termos, notas de rodapé e o glossário. Não é possível desfazer. Quer continuar?',
    () => {
      snapshotUndo();
      const guardado = orig; // preserva o snapshot
      estado.documento.paragrafos = orig.map((o) => ({ id: novoId(), texto: o.texto, emTabela: !!o.emTabela, paginaOrigem: o.paginaOrigem || null, metricas: null, motivos: [] }));
      estado.documento.notas = [];
      estado.documento.apendice = [];
      estado.documento.avaliacaoGlobal = null;
      estado.documento.original = guardado;
      estado.documento.paragrafos.forEach(analisar);
      renderTudo();
      toast('Versão original restaurada.');
    },
    null, { sim: 'Restaurar', nao: 'Cancelar' });
}

// Modal simples de confirmação Sim/Não (com rótulos opcionais).
function confirmar(titulo, texto, aoSim, aoNao, rotulos = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'modalOverlay';
  ov.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-h"><div class="t">${escapar(titulo)}</div><button class="btn ghost sm fechar">✕</button></div>
      <div class="modal-b">
        <p style="color:var(--ink-2);line-height:1.55">${escapar(texto)}</p>
        <div style="display:flex;gap:8px;margin-top:18px">
          <button class="btn sm primary" id="cfSim">${escapar(rotulos.sim || 'Sim')}</button>
          <button class="btn sm ghost" id="cfNao">${escapar(rotulos.nao || 'Não')}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const fim = (fn) => { fecharModal(); if (typeof fn === 'function') fn(); };
  ov.querySelector('.fechar').addEventListener('click', () => fim(aoNao));
  ov.addEventListener('click', (e) => { if (e.target === ov) fim(aoNao); });
  ov.querySelector('#cfSim').addEventListener('click', () => fim(aoSim));
  ov.querySelector('#cfNao').addEventListener('click', () => fim(aoNao));
}

// Overlay de carregamento: documentos grandes (PDF de muitas páginas) levam
// alguns segundos para ler e montar; sem feedback isso parece um travamento.
let elCarga = null;
function mostrarCarga(msg, sub) {
  if (!elCarga) { elCarga = document.createElement('div'); elCarga.className = 'carga'; document.body.appendChild(elCarga); }
  elCarga.innerHTML = `<div class="carga-box"><div class="spin"></div><div class="carga-msg">${escapar(msg)}</div><div class="carga-sub">${escapar(sub || '')}</div></div>`;
  elCarga.style.display = 'grid';
}
function atualizarCarga(msg, sub) {
  if (!elCarga) return;
  const m = elCarga.querySelector('.carga-msg'); if (m) m.textContent = msg;
  const s = elCarga.querySelector('.carga-sub'); if (s && sub != null) s.textContent = sub;
}
function esconderCarga() { if (elCarga) elCarga.style.display = 'none'; }
// Cede o fio ao navegador para pintar a mensagem antes de um trecho síncrono pesado.
const respirar = () => new Promise((r) => setTimeout(r, 30));

// Roteia a importação pela extensão do arquivo (DOCX, PDF, TXT).
async function importarArquivo(file) {
  const nome = file.name || '';
  const ext = nome.toLowerCase().split('.').pop();
  mostrarCarga('Abrindo o arquivo…', nome);
  try {
    if (ext === 'docx') {
      atualizarCarga('Lendo o Word…', nome);
      const { paragrafos, zip } = await lerDocx(file);
      atualizarCarga('Montando o documento…', `${paragrafos.length} parágrafos`);
      await respirar();
      carregarParagrafos(paragrafos, 'docx', nome, { zip });
    } else if (ext === 'pdf') {
      const { paragrafos, aviso } = await lerPdf(file, (p, t) => atualizarCarga('Lendo o PDF…', `página ${p} de ${t}`));
      atualizarCarga('Montando o documento…', `${paragrafos.length} parágrafos`);
      await respirar();
      carregarParagrafos(paragrafos, 'pdf', nome);
      if (aviso) mostrarAviso('PDF importado', aviso);
    } else if (ext === 'txt' || ext === 'md' || file.type === 'text/plain') {
      const texto = await file.text();
      carregarTexto(texto, 'txt', nome);
    } else if (ext === 'doc') {
      toast('Formato .doc antigo não é suportado. Salve como .docx e tente de novo.');
    } else {
      toast('Formato não reconhecido. Use DOCX, PDF ou TXT.');
    }
  } catch (e) {
    if (e && e.codigo === 'PDF_DIGITALIZADO') mostrarAviso('PDF sem texto', e.message);
    else { console.error(e); toast('Não consegui ler o arquivo: ' + (e.message || 'erro desconhecido')); }
  } finally {
    esconderCarga();
  }
}

// Substitui toda quebra de linha por um espaço: realinha texto copiado de PDF
// cujas linhas foram quebradas em várias linhas.
function eliminarQuebras(texto) {
  return String(texto || '')
    .replace(/\r?\n/g, ' ')      // toda quebra de linha vira espaco
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function abrirColar() {
  abrirModal('Colar ou escrever texto', `
    <div class="field">
      <label>Cole aqui o texto a analisar</label>
      <textarea id="txtColar" rows="12" placeholder="Cole o texto da decisão, voto ou minuta..."></textarea>
    </div>
    <label class="pconv-op" style="margin-top:2px"><input type="checkbox" id="colarQuebras"><span><b>Eliminar quebras de linha</b></span></label>`, [
    { rotulo: 'Analisar', classe: 'primary', acao: () => {
      let t = $('#txtColar').value;
      const quebras = $('#colarQuebras') && $('#colarQuebras').checked;
      fecharModal();
      if (quebras) t = eliminarQuebras(t);
      if (t.trim()) carregarTexto(t, 'colado', '');
    }}
  ]);
  setTimeout(() => $('#txtColar') && $('#txtColar').focus(), 50);
}

function limpar() {
  confirmar('Limpar documento',
    'Isto remove o documento atual da tela e apaga o rascunho salvo neste navegador. Se ainda não arquivou, você vai perder o trabalho. Continuar?',
    () => {
      estado.documento = { origem: 'digitado', nomeArquivo: '', paragrafos: [] };
      undoStack = []; atualizarBotaoDesfazer();
      limparRascunho();
      renderVazio();
      toast('Documento limpo.');
    }, null, { sim: 'Limpar', nao: 'Cancelar' });
}

// ---------------------------------------------------------------------------
// Análise
// ---------------------------------------------------------------------------
function analisar(p) {
  p.metricas = metricasParagrafo(p.texto, p.emTabela);
  p.motivos = p.emTabela ? [] : detectar(p.texto, { buscarTermos: dic.buscarContagem });
  p.clareza = clarezaComposta(p);
}

// Detectores confiáveis SEM IA: só tamanho de frase (D1/D2) e siglas (D5). Os
// demais (nominalização, voz passiva, termos do dicionário, intercalações) são
// heurísticas que erram muito e só aparecem depois de uma análise com IA — até
// lá, escondê-las evita apontamentos enganosos (pedido do Gabinete).
const MOTIVOS_SEM_IA = new Set(['D1', 'D2', 'D5']);
function motivosVisiveis(p) {
  const todos = (p && p.motivos) || [];
  if (p && p.avaliacaoIA) return todos; // já houve análise com IA: mostra tudo
  return todos.filter((m) => MOTIVOS_SEM_IA.has(m.id));
}

// Índice de Clareza LUCAS: combina a legibilidade (Flesch, determinístico) com a
// nota de clareza da IA (critérios da Lei 15.263 + ABNT ISO 24495), quando esta
// existir. Sem avaliação de IA, é o Flesch puro (como antes). 0..100; faixa nas
// mesmas 4 bandas de cor do editor.
function clarezaComposta(p) {
  const m = p.metricas || {};
  const flesch = (!m.curto && !p.emTabela && typeof m.facilidade === 'number')
    ? Math.max(0, Math.min(100, m.facilidade)) : null;
  const ia = p.avaliacaoIA && typeof p.avaliacaoIA.nota === 'number'
    ? Math.max(0, Math.min(100, p.avaliacaoIA.nota)) : null;
  let nota, base;
  // Regra (Fase 1): só há "Clareza" quando a IA avaliou. Sem IA, a legibilidade
  // NÃO vira nota de clareza — para não confundir. Ela entra só como componente
  // quando a IA está presente.
  if (ia != null && flesch != null) {
    const wL = ajustes.pesos.legibilidade, wI = ajustes.pesos.ia, tot = (wL + wI) || 1;
    nota = Math.round((wL * flesch + wI * ia) / tot); base = 'flesch+ia';
  }
  else if (ia != null) { nota = Math.round(ia); base = 'ia'; }
  else return { nota: null, faixa: 'neutra', base: 'sem-ia' };
  const faixa = nota >= 75 ? 'muito-facil' : nota >= 50 ? 'facil' : nota >= 25 ? 'razoavel' : 'dificil';
  return { nota, faixa, base };
}

// Rótulo da faixa no sentido de CLAREZA (o índice composto).
// Concorda no masculino: o referente é sempre "o parágrafo" / "o documento" /
// "o conjunto" (todos masculinos).
function nomeClareza(faixa) {
  return { 'muito-facil': 'Muito claro', 'facil': 'Claro', 'razoavel': 'Clareza razoável', 'dificil': 'Pouco claro' }[faixa] || 'Não avaliado';
}

// Faixa efetiva usada na classificação exibida (clareza composta, com recuo ao Flesch).
function faixaDe(p) {
  return (p.clareza && p.clareza.faixa) || (p.metricas && p.metricas.faixa) || 'neutra';
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderVazio() {
  elVazio.classList.remove('hidden');
  elEditor.classList.add('hidden');
  elKpis.classList.add('hidden');
  atualizarMenusDoc();
  atualizarBadgeTrabalhos(); // pontinho no menu quando há trabalho a retomar
}

// Ações que exigem um documento carregado só aparecem quando há um (no menu
// Documento). Sem documento, ficam ocultas — não faz sentido "Exportar" vazio.
function atualizarMenusDoc() {
  const tem = estado.documento.paragrafos.length > 0;
  document.querySelectorAll('#docMenu .doc-dep').forEach((el) => { el.style.display = tem ? '' : 'none'; });
}

function renderTudo() {
  if (!estado.documento.paragrafos.length) return renderVazio();
  elVazio.classList.add('hidden');
  elEditor.classList.remove('hidden');
  elKpis.classList.remove('hidden');
  atualizarMenusDoc();
  renderEditor();
  renderKpis();
  renderMargem();
  agendarRascunho(); // preserva a versão de trabalho localmente
}

function renderEditor() {
  reconstruindoEditor = true; // evita sincronizar durante a reconstrução
  elEditor.innerHTML = '';
  const titulo = document.createElement('div');
  titulo.className = 'doc-title';
  titulo.contentEditable = 'false';
  titulo.textContent = estado.documento.nomeArquivo || 'Documento sem título';
  elEditor.appendChild(titulo);
  // A página de origem (p.paginaOrigem) serve só para a extração do PDF; não
  // marcamos quebras fixas no editor (ficariam estranhas depois de editar).
  for (const p of estado.documento.paragrafos) {
    elEditor.appendChild(construirBloco(p));
  }
  renderNotas();
  setTimeout(() => { reconstruindoEditor = false; }, 0);
}

// Um parágrafo é um bloco dentro do contenteditable único (edição estilo Word).
// A numeração exibida é feita por contador CSS (ver .par::before), então não
// depende de data-num nem do timing do sincronizar — nunca duplica.
function construirBloco(p) {
  const div = document.createElement('div');
  div.className = 'par';
  div.dataset.id = p.id;
  aplicarClasseFaixa(div, p);
  div.innerHTML = dic.sublinhar(p.texto) || '<br>';
  return div;
}

function aplicarClasseFaixa(div, p) {
  div.classList.remove('f-muito-facil', 'f-facil', 'f-razoavel', 'f-dificil');
  if (p.emTabela) { div.classList.add('em-tabela'); return; }
  const map = { 'muito-facil': 'f-muito-facil', 'facil': 'f-facil', 'razoavel': 'f-razoavel', 'dificil': 'f-dificil' };
  const f = faixaDe(p); // clareza composta (recai no Flesch se não houver IA)
  if (map[f]) div.classList.add(map[f]);
}

// ---------------------------------------------------------------------------
// Edição estilo Word num contenteditable único
// O editor inteiro é editável e cada parágrafo é um bloco <div class="par">.
// Enter/Backspace/Delete e a seleção de vários parágrafos funcionam de forma
// nativa (o navegador cuida da junção e da separação); a cada pausa na
// digitação reconciliamos o modelo de dados com o DOM.
// ---------------------------------------------------------------------------
let timerEdicao = null;
let blocoAnterior = null;

function ligarEditor() {
  elEditor.addEventListener('input', aoEditar);
  elEditor.addEventListener('click', aoClicarEditor);
  elEditor.addEventListener('mouseup', aoSelecionar);
  document.addEventListener('selectionchange', aoMoverCaret);
  // Colar SEMPRE como texto plano (evita HTML de PDF/Word quebrar os blocos).
  elEditor.addEventListener('paste', (e) => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (t) document.execCommand('insertText', false, t);
  });
  // Desfazer com Ctrl+Z / Cmd+Z (nossa pilha de instantâneos cobre edições e
  // ações de IA/dicionário, que o desfazer nativo não alcança).
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      // não interferir quando o foco está num campo de formulário (modais)
      const alvo = e.target;
      const emCampo = alvo && alvo.matches && alvo.matches('input:not([type=checkbox]):not([type=radio]), textarea, select');
      if (emCampo) return;
      e.preventDefault();
      desfazer();
    }
  });
  // Enter cria um novo <div> (bloco de parágrafo), não um <p> ou <br>.
  try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch (e) {}
}

function aoEditar() {
  if (reconstruindoEditor) return;
  clearTimeout(timerEdicao);
  timerEdicao = setTimeout(sincronizar, ATRASO_ANALISE);
}

// Blocos de parágrafo: filhos diretos do editor, exceto título e notas.
function blocosDoEditor() {
  return Array.from(elEditor.children).filter((el) =>
    el.nodeType === 1 && !el.classList.contains('doc-title') && !el.classList.contains('notas-pe') && !el.classList.contains('quebra-pagina'));
}

// Texto de um bloco EXCLUINDO os marcadores de nota (o numero sobrescrito
// .nota-ref) e a lista de notas ao pe (.notas-pe) - existem no DOM mas nao fazem
// parte do texto do modelo. Sem isso, ao editar o paragrafo o numero da nota
// "caia" para dentro do texto (perdia o sobrescrito).
function textoDoBloco(div) {
  var out = '';
  var walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      return (node.parentElement && node.parentElement.closest('.nota-ref, .notas-pe'))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  var node; while ((node = walker.nextNode())) out += node.textContent;
  return out.replace(/ /g, ' ').replace(/^\s+|\s+$/g, '');
}

// Bloco <div class="par"> que contém o cursor (ou null se o cursor está fora).
function blocoDoCaret() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let node = sel.anchorNode;
  while (node && node !== elEditor) {
    if (node.nodeType === 1 && node.classList && node.classList.contains('par')) return node;
    node = node.parentNode;
  }
  return null;
}

// Reconcilia o modelo com o DOM depois de editar: identifica blocos novos
// (Enter) e removidos (junção), reanalisa e redesenha margem e indicadores.
// Não reescreve o bloco em edição (preserva o cursor); os sublinhados desse
// bloco são aplicados quando o cursor sai dele (ver aoMoverCaret).
function sincronizar() {
  snapshotUndo(); // guarda o estado antes deste lote de edição (para Ctrl+Z)
  const blocos = blocosDoEditor();
  const caretBloco = blocoDoCaret();
  const antigos = new Map(estado.documento.paragrafos.map((p) => [p.id, p]));
  const vistos = new Set();
  const novaLista = [];
  for (const div of blocos) {
    let id = div.dataset.id;
    if (!id || vistos.has(id)) { id = novoId(); div.dataset.id = id; } // bloco novo ou clone do Enter
    vistos.add(id);
    if (!div.classList.contains('par')) div.classList.add('par');
    const texto = textoDoBloco(div);
    let p = antigos.get(id);
    if (!p) p = { id, texto, emTabela: false, metricas: null, motivos: [] };
    else p.texto = texto;
    analisar(p);
    aplicarClasseFaixa(div, p);
    if (div !== caretBloco) {
      const html = dic.sublinhar(p.texto) || '<br>';
      if (div.innerHTML !== html) { div.innerHTML = html; reinserirNotasNoBloco(div); }
    }
    novaLista.push(p);
  }
  if (!novaLista.length) return;
  // Notas cujo parágrafo sumiu numa junção passam para o primeiro parágrafo.
  const idsVivos = new Set(novaLista.map((p) => p.id));
  (estado.documento.notas || []).forEach((nt) => { if (!idsVivos.has(nt.parId)) nt.parId = novaLista[0].id; });
  estado.documento.paragrafos = novaLista;
  renderMargem();
  renderKpis();
  renderRodapeNotas(notasOrdenadas()); // mantém a numeração do rodapé coerente com os sups
  agendarRascunho(); // salva a versão de trabalho enquanto a pessoa edita
}

// Ao mover o cursor: destaca o parágrafo ativo e aplica os sublinhados no
// bloco que o cursor acabou de deixar (o bloco em edição fica intocado).
function aoMoverCaret() {
  const bloco = blocoDoCaret();
  if (!bloco) return;
  if (blocoAnterior && blocoAnterior !== bloco && blocoAnterior.isConnected && blocoAnterior.classList.contains('par')) {
    // Re-deriva o texto do DOM ATUAL do bloco (nunca do modelo, que pode estar
    // desatualizado logo após um Enter/Backspace ou digitação recente); assim
    // não recolocamos texto antigo por cima (evita duplicar ao separar).
    const texto = textoDoBloco(blocoAnterior);
    const p = estado.documento.paragrafos.find((x) => x.id === blocoAnterior.dataset.id);
    if (p) p.texto = texto;
    const html = dic.sublinhar(texto) || '<br>';
    if (blocoAnterior.innerHTML !== html) { blocoAnterior.innerHTML = html; reinserirNotasNoBloco(blocoAnterior); }
  }
  blocoAnterior = bloco;
  if (bloco.dataset.id !== estado.ativo) setAtivo(bloco.dataset.id);
}

// Clique num termo do dicionário abre o menu de ações (delegação no editor).
function aoClicarEditor(e) {
  const termo = e.target.closest('.termo');
  if (!termo) return;
  e.preventDefault();
  const bloco = termo.closest('.par');
  const p = bloco && estado.documento.paragrafos.find((x) => x.id === bloco.dataset.id);
  if (p) abrirMenuTermo(termo, p);
}

// Selecionar uma palavra OU um trecho de palavras abre o menu (sinônimos,
// cadastrar substituição, reescrever). Vale para duplo-clique (uma palavra) e
// para arrastar sobre várias palavras.
function aoSelecionar(e) {
  if (e && e.target && e.target.closest('.termo')) return; // termo tem menu próprio (clique)
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  // Seleção que cruza 2+ parágrafos: oferece juntar as linhas em um só (útil para
  // realinhar parágrafos que o PDF quebrou). Tem prioridade sobre o menu de palavra.
  const rangeMulti = sel.getRangeAt(0);
  const blocosSel = blocosDoEditor().filter((b) => { try { return rangeMulti.intersectsNode(b); } catch (_e) { return false; } });
  if (blocosSel.length >= 2) {
    const rectMulti = rangeMulti.getBoundingClientRect();
    const ids = blocosSel.map((b) => b.dataset.id);
    setTimeout(() => mostrarBotaoJuntar(ids, rectMulti), 0);
    return;
  }
  const texto = sel.toString().trim();
  // só palavras/expressões (letras, números, hífen, apóstrofo, espaços); 2+ caracteres
  if (!texto || texto.length < 2 || !/^[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’.\- ]*$/.test(texto)) return;
  const range = sel.getRangeAt(0);
  const no = range.commonAncestorContainer;
  const par = (no.nodeType === 1 ? no : no.parentNode).closest('.par');
  if (!par) return; // a seleção precisa estar dentro de um único parágrafo
  const p = estado.documento.paragrafos.find((x) => x.id === par.dataset.id);
  if (!p) return;
  const rect = range.getBoundingClientRect();
  const alcance = range.cloneRange();
  // Abre no próximo tick: o 'click' que segue o mouseup dispara o fechamento
  // global de popovers; abrindo depois dele, o menu não é fechado na hora.
  setTimeout(() => abrirMenuPalavra(texto, rect, p, alcance), 0);
}

// Botão flutuante para juntar os parágrafos abrangidos por uma seleção.
let elJuntar = null;
function fecharJuntar() { if (elJuntar) { elJuntar.remove(); elJuntar = null; } }
function mostrarBotaoJuntar(ids, rect) {
  fecharJuntar(); fecharPopover();
  elJuntar = document.createElement('div');
  elJuntar.className = 'juntar-pop';
  elJuntar.innerHTML = `<button class="btn sm primary">⤵ Juntar ${ids.length} parágrafos (eliminar quebras)</button>`;
  document.body.appendChild(elJuntar);
  const acima = rect.top - 46;
  elJuntar.style.top = (acima < 8 ? rect.bottom + 8 : acima) + 'px';
  elJuntar.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 280)) + 'px';
  elJuntar.querySelector('button').addEventListener('click', (ev) => { ev.stopPropagation(); juntarParagrafos(ids); });
}

// Funde os parágrafos indicados num só: o texto vira uma linha corrida, as notas
// migram para o primeiro e os demais somem. Realinha o que o PDF quebrou.
function juntarParagrafos(ids) {
  fecharJuntar();
  const pars = estado.documento.paragrafos;
  const sel = ids.map((id) => pars.find((p) => p.id === id)).filter(Boolean).filter((p) => !p.emTabela);
  if (sel.length < 2) { toast('Selecione ao menos dois parágrafos (fora de tabela).'); return; }
  snapshotUndo();
  const primeiro = sel[0];
  primeiro.texto = sel.map((p) => (p.texto || '').trim()).join(' ').replace(/\s+/g, ' ').trim();
  const removidos = new Set(sel.slice(1).map((p) => p.id));
  (estado.documento.notas || []).forEach((n) => { if (removidos.has(n.parId)) n.parId = primeiro.id; });
  estado.documento.paragrafos = pars.filter((p) => !removidos.has(p.id));
  analisar(primeiro);
  renderTudo();
  const sc = window.getSelection(); if (sc) sc.removeAllRanges();
  toast(`${sel.length} parágrafos unidos.`);
}

// Estado do acordeon do painel de revisão (recolhido/expandido), lembrado entre
// sessões neste navegador.
let resumoRecolhido = (() => { try { return localStorage.getItem('lucas.resumo.recolhido') === '1'; } catch (e) { return false; } })();

// Aplica o estado recolhido e liga o cabeçalho-acordeon. Chamado ao fim de cada
// renderização do painel (o innerHTML é refeito toda vez).
function finalizarResumo() {
  elKpis.classList.toggle('recolhido', resumoRecolhido);
  const tg = $('#mrToggle');
  if (tg) tg.addEventListener('click', () => {
    resumoRecolhido = !resumoRecolhido;
    try { localStorage.setItem('lucas.resumo.recolhido', resumoRecolhido ? '1' : '0'); } catch (e) {}
    elKpis.classList.toggle('recolhido', resumoRecolhido);
    tg.setAttribute('aria-expanded', String(!resumoRecolhido));
    agendarAlinhar(); // a altura do painel mudou: realinha os cards abaixo dele
  });
  agendarAlinhar();
}

// Há uma IA pronta para uso? (chave configurada, ou provedor que dispensa chave.)
function iaConectada() {
  try {
    const cfg = prov.configAtual();
    const def = prov.PROVEDORES[cfg.provedor];
    if (!def) return false;
    return def.requerChave ? !!(cfg.chave && String(cfg.chave).trim()) : true;
  } catch (e) { return false; }
}

function renderKpis() {
  const pars = estado.documento.paragrafos;
  const dist = { 'muito-facil': 0, 'facil': 0, 'razoavel': 0, 'dificil': 0, 'neutra': 0 };
  let soma = 0, n = 0;
  for (const p of pars) {
    const f = faixaDe(p);
    dist[f] = (dist[f] || 0) + 1;
    if (p.clareza && p.clareza.nota != null) { soma += p.clareza.nota; n++; }
  }
  const media = n ? Math.round(soma / n) : null;
  const faixaDoc = media == null ? 'neutra' : (media >= 75 ? 'muito-facil' : media >= 50 ? 'facil' : media >= 25 ? 'razoavel' : 'dificil');
  const temIA = pars.some((p) => p.avaliacaoIA);

  const cabeca = `<button class="mr-h" id="mrToggle" aria-expanded="${!resumoRecolhido}" title="Recolher/expandir"><svg class="mr-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>Revisão de clareza</span><svg class="mr-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>`;

  // Sem avaliação por IA ainda: não mostramos nota de clareza (evita confundir
  // com legibilidade). Mas a mensagem depende de a chave já estar conectada:
  //  - sem chave  → convite a conectar uma IA;
  //  - com chave  → convite a avaliar (a IA já está pronta, só falta rodar).
  if (!temIA) {
    const comSinais = pars.filter((p) => !p.emTabela && motivosVisiveis(p).length).length;
    const conectada = iaConectada();
    const aviso = conectada
      ? '<b>IA conectada.</b><br>Clique em “Avaliar clareza” para a IA analisar cada parágrafo e o documento como um todo.'
      : '<b>Conecte uma IA para avaliar a clareza.</b><br>Sem IA, o LUCAS mostra só os sinais de dificuldade por parágrafo.';
    const botao = conectada
      ? '<button class="btn xs primary" id="kpiAvaliar">Avaliar clareza</button>'
      : '<button class="btn xs primary" id="kpiConectar">Conectar IA</button>';
    elKpis.innerHTML = `
      ${cabeca}
      <div class="mr-corpo">
        <div class="mr-aviso">${aviso}</div>
        <div class="mr-grid">
          <div class="mr-cel"><div class="v">${pars.length}</div><div class="l">Parágrafos</div></div>
          <div class="mr-cel"><div class="v" style="color:var(--faixa-razoavel)">${comSinais}</div><div class="l">Com sinais</div></div>
        </div>
        <div class="mr-acoes">${botao}</div>
      </div>`;
    const bc = $('#kpiConectar'); if (bc) bc.addEventListener('click', abrirConfigProvedores);
    const ba = $('#kpiAvaliar'); if (ba) ba.addEventListener('click', () => avaliarClareza());
    finalizarResumo();
    return;
  }

  const g = estado.documento.avaliacaoGlobal;
  const temSugestoes = pars.some((p) => p.avaliacaoIA && p.avaliacaoIA.sugestoes && p.avaliacaoIA.sugestoes.length) || !!(g && g.sugestoes && g.sugestoes.length);
  elKpis.innerHTML = `
    ${cabeca}
    <div class="mr-corpo">
      <div class="mr-faixa"><span class="mr-nome">${media == null ? '—' : nomeClareza(faixaDoc)}</span><span class="mr-sub">Clareza do documento</span></div>
      <div class="mr-grid">
        <div class="mr-cel"><div class="v" style="color:var(--faixa-dificil)">${dist.dificil}</div><div class="l">Pouco claros</div></div>
        <div class="mr-cel"><div class="v" style="color:var(--faixa-razoavel)">${dist.razoavel}</div><div class="l">Razoáveis</div></div>
        <div class="mr-cel"><div class="v" style="color:var(--faixa-facil)">${dist.facil + dist['muito-facil']}</div><div class="l">Claros</div></div>
      </div>
      <div class="mr-acoes">
        <button class="btn xs ghost" id="kpiAjustes" title="Público-alvo e pesos da Clareza">⚙ Ajustes</button>
        ${g && g.nota != null ? `<button class="btn xs" id="kpiDicasDoc">Conjunto: ${g.nota}/100${g.sugestoes && g.sugestoes.length ? ' · ' + g.sugestoes.length + ' dica(s)' : ''}</button>` : ''}
        ${temSugestoes ? `<button class="btn xs primary" id="kpiAplicarDoc">Aplicar sugestões</button>` : ''}
      </div>
    </div>`;
  const bAj = $('#kpiAjustes'); if (bAj) bAj.addEventListener('click', abrirAjustes);
  const bDd = $('#kpiDicasDoc'); if (bDd) bDd.addEventListener('click', abrirDicasDocumento);
  const bAp = $('#kpiAplicarDoc'); if (bAp) bAp.addEventListener('click', () => abrirConversaoLote({ orientar: true }));
  finalizarResumo();
}

function renderMargem() {
  elMargemCanvas.innerHTML = '';
  for (const p of estado.documento.paragrafos) {
    elMargemCanvas.appendChild(cartaoComentario(p));
  }
  agendarAlinhar();
}

function cartaoComentario(p) {
  const card = document.createElement('div');
  card.className = 'comentario';
  card.dataset.id = p.id;
  card.style.position = 'absolute';
  card.style.left = '0';
  card.style.right = '0';

  const m = p.metricas || {};
  const cl = p.clareza || {};
  let faixaHtml;
  if (p.__avaliando) {
    faixaHtml = `<span class="faixa neutra avaliando">Avaliando a clareza…</span>`;
  } else if (p.emTabela) {
    faixaHtml = `<span class="faixa neutra">Em tabela: não medido</span>`;
  } else if (cl.nota != null) {
    faixaHtml = `<span class="faixa ${cl.faixa}">${nomeClareza(cl.faixa)}</span><span class="clareza-nota">${cl.nota}/100</span>`;
  } else {
    // Sem IA: não há nota de clareza; mostramos só os sinais confiáveis.
    const nSin = motivosVisiveis(p).length;
    faixaHtml = nSin
      ? `<span class="faixa neutra">${nSin} ${nSin > 1 ? 'sinais' : 'sinal'} de dificuldade</span>`
      : `<span class="faixa neutra">${m.curto ? 'Parágrafo curto' : 'Sem sinais'}</span>`;
  }

  // Card ENXUTO: pílula (nome + índice ao lado), até 3 sinais curtos e as ações.
  // Todo o resto (texto original, o que observar, dicas da IA) fica no modal.
  const motivos = motivosVisiveis(p).slice(0, 3);
  const motivosHtml = motivos.length
    ? `<ul class="motivos">${motivos.map((x) => `<li class="grave-${x.gravidade}">${escapar(x.texto)}</li>`).join('')}</ul>`
    : '';
  const sug = (p.avaliacaoIA && p.avaliacaoIA.sugestoes) || [];
  const temAlgo = motivos.length || sug.length;
  const num = estado.documento.paragrafos.indexOf(p) + 1;
  card.innerHTML = `
    <div class="cab"><span class="card-num">${num}</span>${faixaHtml}</div>
    ${motivosHtml}
    <div class="acoes">
      <button class="btn sm primary" data-acao="converter">Converter parágrafo</button>
      ${temAlgo ? '<button class="btn sm" data-acao="dicas">Veja dicas</button>' : ''}
    </div>`;

  card.addEventListener('click', () => setAtivo(p.id));
  card.querySelector('[data-acao="converter"]').addEventListener('click', (e) => { e.stopPropagation(); abrirPainelConversao(p); });
  const bDicas = card.querySelector('[data-acao="dicas"]');
  if (bDicas) bDicas.addEventListener('click', (e) => { e.stopPropagation(); abrirDicas(p); });

  return card;
}

// ---------------------------------------------------------------------------
// Fluxo do parágrafo em PÁGINAS (tela cheia, sem modal-dentro-de-modal):
//   Diagnóstico → entender o parágrafo (original, clareza, o que observar, dicas)
//   Reescrever  → converter com IA (como reescrever, versões, aceitar)
// Público-alvo e provedor NÃO aparecem aqui (são do documento, não do parágrafo).
// ---------------------------------------------------------------------------
function fecharParagrafo() { const e = document.querySelector('#telaParagrafo'); if (e) e.remove(); }

function abrirParagrafo(p, aba, opts = {}) {
  fecharModal(); fecharParagrafo();
  const num = estado.documento.paragrafos.indexOf(p) + 1;
  const sugOpt = Array.isArray(opts.sugestoes) ? opts.sugestoes.filter((s) => s && String(s).trim()) : [];
  const ov = document.createElement('div');
  ov.className = 'tela-conversao'; ov.id = 'telaParagrafo';
  ov.__p = p; ov.__aba = aba || 'diagnostico'; ov.__sugestoes = sugOpt;
  ov.innerHTML = `
    <header class="tela-top">
      <button class="btn sm ghost" id="parVoltar">‹ Voltar ao documento</button>
      <div class="tela-titulo">Parágrafo ${num}</div>
      <div class="par-tabs">
        <button class="par-tab" data-aba="diagnostico">Diagnóstico</button>
        <button class="par-tab" data-aba="reescrever">Reescrever</button>
      </div>
    </header>
    <div class="par-corpo"><div class="par-pagina" id="parCorpo"></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#parVoltar').addEventListener('click', fecharParagrafo);
  ov.querySelectorAll('.par-tab').forEach((t) => t.addEventListener('click', () => { ov.__aba = t.dataset.aba; renderParagrafo(ov); }));
  renderParagrafo(ov);
}

function renderParagrafo(ov) {
  const p = ov.__p; const aba = ov.__aba;
  ov.querySelectorAll('.par-tab').forEach((t) => t.classList.toggle('on', t.dataset.aba === aba));
  const corpo = ov.querySelector('#parCorpo');
  if (aba === 'diagnostico') { corpo.innerHTML = htmlDiagnostico(p); ligarDiagnostico(ov, p); }
  else { corpo.innerHTML = htmlReescrever(p, ov.__sugestoes); ligarReescrever(ov, p); }
}

function htmlDiagnostico(p) {
  const cl = p.clareza || {};
  const sug = (p.avaliacaoIA && p.avaliacaoIA.sugestoes) || [];
  const classe = cl.nota != null
    ? `<span class="faixa ${cl.faixa}">${nomeClareza(cl.faixa)}</span> <span class="muted" style="font-size:12.5px">Clareza ${cl.nota}/100</span>`
    : '<span class="muted" style="font-size:12.5px">Conecte uma IA para avaliar a clareza.</span>';
  const idsMot = [...new Set(motivosVisiveis(p).map((x) => x.id))];
  const explic = idsMot.map((id) => EXPLICACOES[id]).filter(Boolean);
  const explicHtml = explic.length
    ? `<div class="dicas-bloco"><div class="dicas-h">O que observar</div><ul class="dicas-lista">${explic.map((t) => `<li>${escapar(t)}</li>`).join('')}</ul></div>` : '';
  const dicasHtml = sug.length
    ? `<div class="dicas-bloco"><div class="dicas-h">Dicas da IA <span class="muted" style="font-weight:400">· Lei 15.263 e ABNT ISO 24495</span></div><ul class="dicas-lista">${sug.map((s) => `<li>${escapar(s)}</li>`).join('')}</ul></div>` : '';
  return `
    <div class="pconv-orig"><div class="pconv-lbl">Texto original</div><div>${escapar(p.texto)}</div><div style="margin-top:8px">${classe}</div></div>
    ${explicHtml}${dicasHtml}
    ${(!explic.length && !sug.length) ? '<p class="muted" style="margin-top:14px">Sem apontamentos relevantes neste parágrafo.</p>' : ''}
    <div class="par-nav">
      <button class="btn primary" id="parIrReescrever">Reescrever este parágrafo →</button>
      ${sug.length ? '<button class="btn ghost" id="parCopiarDicas">Copiar dicas</button>' : ''}
    </div>`;
}

function ligarDiagnostico(ov, p) {
  const sug = (p.avaliacaoIA && p.avaliacaoIA.sugestoes) || [];
  ov.querySelector('#parIrReescrever').addEventListener('click', () => {
    if (sug.length) ov.__sugestoes = sug; // leva as dicas para orientar a reescrita
    ov.__aba = 'reescrever'; renderParagrafo(ov);
  });
  const bc = ov.querySelector('#parCopiarDicas');
  if (bc) bc.addEventListener('click', () => { if (sug.length && navigator.clipboard) navigator.clipboard.writeText(sug.join('\n')); toast('Dicas copiadas.'); });
}

function htmlReescrever(p, sugOrient) {
  const opcoes = [...PROMPTS.filter((x) => x.codigo !== 'P7'), PROMPT_LIVRE];
  const radios = opcoes.map((pr, i) =>
    `<label class="pconv-op"><input type="checkbox" name="pconv" value="${pr.codigo}" ${i === 0 ? 'checked' : ''}><span><b>${pr.usuario ? 'Meu · ' : ''}${escapar(pr.nome)}</b>${pr.descricao ? `<small class="pconv-desc">${escapar(pr.descricao)}</small>` : ''}</span></label>`).join('');
  return `
    <div class="pconv-orig"><div class="pconv-lbl">Original</div><div>${escapar(p.texto)}</div></div>
    ${(sugOrient && sugOrient.length) ? `<div class="pconv-orient"><b>Reescrita orientada pelas dicas:</b><ul>${sugOrient.map((s) => `<li>${escapar(s)}</li>`).join('')}</ul></div>` : ''}
    <div id="pconvVersoes"></div>
    <div class="label" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">Como reescrever <span class="muted" style="font-weight:400">pode combinar · <button type="button" class="ver-prompt" id="pconvVerPrompt">ver prompt</button></span></div>
    <div class="pconv-ops">${radios}</div>
    <textarea id="pconvLivre" class="campo-texto hidden" rows="3" placeholder="Escreva sua instrução (marque PL para usar)"></textarea>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px">
      <label class="muted" style="display:flex;align-items:center;gap:7px">Quantas versões
        <select id="pconvQtd" class="field-select"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>
      </label>
      <button class="btn primary btn-auto" id="pconvGerar">Gerar</button>
    </div>`;
}

function ligarReescrever(ov, p) {
  const livre = ov.querySelector('#pconvLivre');
  ov.querySelectorAll('input[name=pconv]').forEach((r) => r.addEventListener('change', () => {
    livre.classList.toggle('hidden', !ov.querySelector('input[name=pconv][value="PL"]:checked'));
  }));
  ov.querySelector('#pconvVerPrompt').addEventListener('click', () => mostrarPromptAplicado(tecnicasMarcadas(ov)));
  ov.querySelector('#pconvGerar').addEventListener('click', () => gerarVersao(p, ov));
}

// Entradas antigas viram atalhos para a página certa do parágrafo.
function abrirDicas(p) { abrirParagrafo(p, 'diagnostico'); }

// Sugestões que pedem nota de rodapé/explicação de termo (para oferecer o
// atalho de criar a nota já integrado à ferramenta de notas da plataforma).
function dicasDeNota(sug) {
  return (sug || []).filter((s) => /rodap|nota de rodap|ap[êe]ndice|gloss[áa]rio|explic\w+ (o|os|a|as|esse|este|o termo)|explicar o termo|significa\b/i.test(String(s)));
}

// Formulário curto para criar uma nota de rodapé a partir de uma dica: o autor
// indica a palavra a marcar e o texto da nota (pré-preenchido com a dica).
function abrirNotaDaDica(p, sugNota) {
  fecharModal();
  const dica = (sugNota && sugNota[0]) || '';
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'modalOverlay';
  ov.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-h"><div class="t">Criar nota de rodapé</div><button class="btn ghost sm fechar">✕</button></div>
      <div class="modal-b">
        <div class="label">Palavra ou trecho a marcar (deve existir no parágrafo)</div>
        <input id="ndTermo" class="campo-texto" style="width:100%" placeholder="ex.: inexigibilidade">
        <div class="label" style="margin-top:12px">Texto da nota</div>
        <textarea id="ndTexto" class="campo-texto" rows="4" style="width:100%">${escapar(dica)}</textarea>
        <div class="muted" style="font-size:12px;margin-top:8px">A nota vira um número sobrescrito após a palavra e aparece ao pé do documento e no Word exportado.</div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn sm primary" id="ndCriar">Criar nota</button>
          <button class="btn sm ghost fechar2">Cancelar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const fechar = () => fecharModal();
  ov.querySelector('.fechar').addEventListener('click', fechar);
  ov.querySelector('.fechar2').addEventListener('click', fechar);
  ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
  ov.querySelector('#ndCriar').addEventListener('click', () => {
    const termo = ov.querySelector('#ndTermo').value.trim();
    const texto = ov.querySelector('#ndTexto').value.trim();
    if (!termo || !texto) { toast('Preencha a palavra e o texto da nota.'); return; }
    const posicao = p.texto.toLowerCase().indexOf(termo.toLowerCase());
    if (posicao < 0) { toast('Essa palavra não foi encontrada no parágrafo.'); return; }
    criarNotaLivre(termo, texto, p, posicao);
    fecharModal();
  });
}

// Modal de ajustes da clareza: público-alvo (calibra a linguagem da IA) e os
// pesos do Índice de Clareza (não há percentual "científico"; o usuário decide).
function abrirAjustes() {
  fecharModal();
  const { pesos, publicos } = ajustes;
  const pubHtml = PUBLICOS.map((pb) =>
    `<label class="pconv-op"><input type="checkbox" name="pub" value="${pb.id}" ${publicos.includes(pb.id) ? 'checked' : ''}><span><b>${escapar(pb.curto)}</b><br><span class="muted" style="font-size:12px">${escapar(pb.rotulo)}</span></span></label>`).join('');
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'modalOverlay';
  ov.innerHTML = `
    <div class="modal" style="max-width:640px">
      <div class="modal-h"><div class="t">Ajustes da clareza</div><button class="btn ghost sm fechar">✕</button></div>
      <div class="modal-b">
        <div class="dicas-h" style="margin-bottom:6px">Para quem é o texto?</div>
        <div class="muted" style="font-size:12.5px;margin-bottom:10px">Uma decisão costuma ter leitores variados. Marque os públicos e a IA calibra o vocabulário e o nível de explicação, priorizando quem tem menos familiaridade jurídica. Vale para a conversão e para a avaliação de clareza.</div>
        <div class="pconv-ops">${pubHtml}</div>

        <div class="dicas-h" style="margin:20px 0 6px">Pesos do Índice de Clareza</div>
        <div class="muted" style="font-size:12.5px;margin-bottom:12px">O Índice combina a <b>legibilidade</b> (fórmula objetiva, tamanho de frases e palavras) com a <b>compreensão</b> avaliada pela IA (critérios da Lei 15.263 e da ABNT). Não há proporção exata "certa" — ajuste conforme seu entendimento. A ênfase também é informada à IA.</div>
        <label class="label" style="display:block;margin-bottom:2px">Legibilidade (fórmula) — <span id="ajLegV">${pesos.legibilidade}</span></label>
        <input type="range" id="ajLeg" min="0" max="100" step="5" value="${pesos.legibilidade}" style="width:100%">
        <label class="label" style="display:block;margin:10px 0 2px">Compreensão (IA) — <span id="ajIaV">${pesos.ia}</span></label>
        <input type="range" id="ajIa" min="0" max="100" step="5" value="${pesos.ia}" style="width:100%">
        <div class="muted" style="font-size:12.5px;margin-top:10px">Na prática: <b id="ajResumo"></b></div>

        <div class="dicas-h" style="margin:20px 0 6px">Ao abrir um documento</div>
        <label class="pconv-op"><input type="checkbox" id="ajAuto" ${ajustes.autoAvaliar ? 'checked' : ''}><span><b>Avaliar a clareza automaticamente</b><br><span class="muted" style="font-size:12px">Assim que o documento carrega, a IA já traz as dicas por parágrafo e a avaliação do conjunto (usa a sua chave). Desligue para avaliar só ao clicar em “Avaliar clareza”.</span></span></label>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px">
          <button class="btn sm primary" id="ajSalvar">Salvar ajustes</button>
          <button class="btn sm ghost" id="ajPadrao">Restaurar padrão (40/60)</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const leg = ov.querySelector('#ajLeg'), ia = ov.querySelector('#ajIa');
  const legV = ov.querySelector('#ajLegV'), iaV = ov.querySelector('#ajIaV'), resumo = ov.querySelector('#ajResumo');
  const atualizar = () => {
    legV.textContent = leg.value; iaV.textContent = ia.value;
    const l = Number(leg.value), i = Number(ia.value), tot = (l + i) || 1;
    resumo.textContent = `Legibilidade ${Math.round(l / tot * 100)}% · Compreensão (IA) ${Math.round(i / tot * 100)}%`;
  };
  leg.addEventListener('input', atualizar); ia.addEventListener('input', atualizar); atualizar();
  ov.querySelector('.fechar').addEventListener('click', fecharModal);
  ov.addEventListener('click', (e) => { if (e.target === ov) fecharModal(); });
  ov.querySelector('#ajPadrao').addEventListener('click', () => {
    leg.value = PESOS_PADRAO.legibilidade; ia.value = PESOS_PADRAO.ia; atualizar();
  });
  ov.querySelector('#ajSalvar').addEventListener('click', () => {
    const l = limitarPeso(leg.value, PESOS_PADRAO.legibilidade), i = limitarPeso(ia.value, PESOS_PADRAO.ia);
    if (l + i === 0) { toast('Ao menos um peso precisa ser maior que zero.'); return; }
    ajustes.pesos = { legibilidade: l, ia: i };
    ajustes.publicos = [...ov.querySelectorAll('input[name=pub]:checked')].map((c) => c.value);
    ajustes.autoAvaliar = ov.querySelector('#ajAuto').checked;
    gravarAjustes();
    estado.documento.paragrafos.forEach((p) => { p.clareza = clarezaComposta(p); });
    renderMargem(); renderKpis();
    fecharModal();
    toast('Ajustes salvos.');
  });
}

// Modal com a avaliação do documento como um todo (coerência, organização,
// conexões entre ideias) e as sugestões macro, com atalho para aplicá-las.
function abrirDicasDocumento() {
  const g = estado.documento.avaliacaoGlobal;
  if (!g) { toast('Rode "Avaliar clareza" primeiro.'); return; }
  fecharModal();
  const faixaG = g.nota != null ? (g.nota >= 75 ? 'muito-facil' : g.nota >= 50 ? 'facil' : g.nota >= 25 ? 'razoavel' : 'dificil') : 'neutra';
  const sug = g.sugestoes || [];
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'modalOverlay';
  ov.innerHTML = `
    <div class="modal" style="max-width:720px">
      <div class="modal-h"><div class="t">Clareza do documento como um todo</div><button class="btn ghost sm fechar">✕</button></div>
      <div class="modal-b">
        <div class="muted" style="font-size:12.5px;margin-bottom:12px">Parágrafos claros isoladamente não garantem um documento claro. Esta avaliação olha o conjunto: ordem das ideias, conexões entre parágrafos, repetições e organização.</div>
        ${g.nota != null ? `<div style="margin-bottom:12px"><span class="faixa ${faixaG}">${nomeClareza(faixaG)}</span> <span class="muted" style="font-size:12.5px">Clareza do conjunto ${g.nota}/100</span></div>` : ''}
        <div class="dicas-bloco">
          <div class="dicas-h">Sugestões para o conjunto <span class="muted" style="font-weight:400">· critérios da Lei nº 15.263/2025 e da ABNT NBR ISO 24495 (partes 1 e 2)</span></div>
          ${sug.length ? `<ul class="dicas-lista">${sug.map((s) => `<li>${escapar(s)}</li>`).join('')}</ul>` : '<p class="muted">Sem sugestões macro: a IA considerou a organização do documento adequada.</p>'}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
          <button class="btn sm primary" id="ddAplicar">Aplicar sugestões ao documento</button>
          <button class="btn sm ghost" id="ddCopiar">Copiar sugestões</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('.fechar').addEventListener('click', fecharModal);
  ov.addEventListener('click', (e) => { if (e.target === ov) fecharModal(); });
  ov.querySelector('#ddAplicar').addEventListener('click', () => { fecharModal(); abrirConversaoLote({ orientar: true }); });
  ov.querySelector('#ddCopiar').addEventListener('click', () => {
    if (sug.length && navigator.clipboard) navigator.clipboard.writeText(sug.join('\n'));
    toast('Sugestões copiadas.');
  });
}

// Agenda o alinhamento com robustez: espera dois frames (layout pronto) e
// re-executa quando as fontes web carregam (evita descompasso no primeiro render).
let fontesProntas = false;
function agendarAlinhar() {
  requestAnimationFrame(() => requestAnimationFrame(alinharComentarios));
  setTimeout(alinharComentarios, 90); // reserva: dispara mesmo se o rAF estiver pausado
  if (!fontesProntas && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { fontesProntas = true; requestAnimationFrame(alinharComentarios); });
  }
}

// Alinha cada comentário ao topo do seu parágrafo; colisões empurram o de baixo.
function alinharComentarios() {
  const cards = Array.from(elMargemCanvas.children);
  // Referência: o topo do contêiner de rolagem (mesmo topo da margem, que são
  // irmãos no grid). Assim o topo de cada card casa com o topo do parágrafo.
  const topoRef = elEditorWrap.getBoundingClientRect().top;
  // O painel de revisão (resumo) é fixo no topo da aba; os cards começam abaixo
  // dele para não ficarem escondidos atrás.
  const resumoH = (elKpis && !elKpis.classList.contains('hidden')) ? elKpis.offsetHeight + 12 : 0;
  let ultimoFim = resumoH;
  const gap = 10;
  for (const card of cards) {
    const par = elEditor.querySelector(`.par[data-id="${card.dataset.id}"]`);
    if (!par) continue;
    let topoDesejado = par.getBoundingClientRect().top - topoRef + elEditorWrap.scrollTop;
    if (topoDesejado < ultimoFim + gap) topoDesejado = ultimoFim + gap;
    card.style.top = topoDesejado + 'px';
    ultimoFim = topoDesejado + card.offsetHeight;
  }
  elMargemCanvas.style.height = ultimoFim + 40 + 'px';
  elMargemCanvas.style.transform = `translateY(${-elEditorWrap.scrollTop}px)`;
}

function setAtivo(id) {
  estado.ativo = id;
  elEditor.querySelectorAll('.par').forEach((el) => el.classList.toggle('ativo', el.dataset.id === id));
  elMargemCanvas.querySelectorAll('.comentario').forEach((el) => el.classList.toggle('ativo', el.dataset.id === id));
  agendarAlinhar(); // o card ativo mudou de altura: realinha
}

// ---------------------------------------------------------------------------
// Menu do dicionário (popover)
// ---------------------------------------------------------------------------
function abrirMenuTermo(span, p) {
  fecharPopover();
  const v = dic.lookup(span.textContent) || buscarVerbetePorId(span.dataset.verbete);
  if (!v) return;

  const pop = document.createElement('div');
  pop.className = 'popover';
  const protegido = v.tratamento === 'explicar';

  let itens = '';
  if (!protegido) {
    itens += `<button class="item" data-a="trocar">↺ Trocar por “${escapar(v.simples)}”</button>`;
    itens += `<button class="item" data-a="reescrever">✎ Reescrever a frase com IA</button>`;
  }
  itens += `<button class="item" data-a="nota">¹ Criar nota de rodapé</button>`;
  itens += `<button class="item" data-a="apendice">▤ Incluir no glossário</button>`;
  if (!protegido) itens += `<button class="item" data-a="sinonimos">≈ Ver sinônimos</button>`;
  else itens += `<button class="item" data-a="explicacao">ⓘ Ver explicação</button>`;

  pop.innerHTML = `
    <div class="cab">
      <div class="termo-nome">${escapar(span.textContent)}</div>
      <div class="termo-tipo">${protegido ? 'Termo com efeito jurídico. Não trocar.' : (v.explicacao ? escapar(v.explicacao) : 'Termo do dicionário')}</div>
    </div>
    ${itens}`;

  document.body.appendChild(pop);
  popoverAnchor = span;
  const r = span.getBoundingClientRect();
  // position:fixed -> coordenadas de viewport (acompanha o termo, sem depender do scroll da página)
  pop.style.top = (r.bottom + 6) + 'px';
  pop.style.left = Math.max(10, Math.min(r.left, window.innerWidth - pop.offsetWidth - 12)) + 'px';

  pop.addEventListener('click', (e) => {
    const b = e.target.closest('.item');
    if (!b) return;
    acaoTermo(b.dataset.a, v, span, p);
    fecharPopover();
  });
}

function acaoTermo(acao, v, span, p) {
  if (acao === 'trocar') {
    trocarOcorrencia(span, p, v);
  } else if (acao === 'reescrever') {
    abrirPainelConversao(p);
  } else if (acao === 'sinonimos') {
    const s = (v.sinonimos || []).join(', ') || 'sem sinônimos cadastrados';
    toast(`Sinônimos de “${v.termo}”: ${s}`);
  } else if (acao === 'apendice') {
    incluirNoGlossario(v);
  } else if (acao === 'nota') {
    criarNota(v, p);
  } else if (acao === 'explicacao') {
    toast(v.explicacao);
  }
}

function incluirNoGlossario(v) {
  const doc = estado.documento;
  doc.apendice = doc.apendice || [];
  if (doc.apendice.some((x) => x.termo.toLowerCase() === v.termo.toLowerCase())) { toast('Este termo já está no glossário.'); return; }
  doc.apendice.push({ termo: v.termo, explicacao: v.explicacao, fonte: v.fonte || 'dicionario-oficial' });
  toast('“' + v.termo + '” incluído no glossário (sai no Exportar DOCX).');
}

// ---------------------------------------------------------------------------
// Notas de rodapé (SPEC 8.4 B)
// ---------------------------------------------------------------------------
function criarNota(v, p) {
  snapshotUndo();
  const doc = estado.documento;
  doc.notas = doc.notas || [];
  if (doc.notas.some((n) => n.termo.toLowerCase() === v.termo.toLowerCase())) {
    toast('Este termo já tem nota de rodapé.'); return;
  }
  doc.notas.push({ termo: v.termo, texto: v.explicacao, parId: p.id });
  renderNotas();
  toast('Nota de rodapé criada.');
}

function removerNota(n) {
  const arr = estado.documento.notas || [];
  const i = arr.indexOf(n);
  if (i >= 0) arr.splice(i, 1);
  renderNotas();
}

// Posição da âncora da nota dentro do parágrafo (para ordenar como no Word):
// usa a posição exata guardada (n.posicao) ou a 1ª ocorrência do termo.
function posNota(p, n) {
  const t = (p && p.texto) || '';
  if (typeof n.posicao === 'number' && n.posicao >= 0) return n.posicao;
  const i = t.toLowerCase().indexOf(String(n.termo || '').toLowerCase());
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

// Notas em ordem de aparição REAL: por parágrafo e, dentro dele, pela posição do
// termo no texto. Assim a numeração renumera sozinha quando se cria uma nota
// antes de outra (comportamento do Word). O índice + 1 é o número.
function notasOrdenadas() {
  const notas = estado.documento.notas || [];
  const out = [];
  for (const p of estado.documento.paragrafos) {
    const doPar = notas.filter((n) => n.parId === p.id).sort((a, b) => posNota(p, a) - posNota(p, b));
    out.push(...doPar);
  }
  return out;
}

function acharSpanTermo(par, termo) {
  const alvo = dic.fold(termo);
  for (const s of par.querySelectorAll('.termo')) {
    if (dic.fold(s.textContent) === alvo) return s;
  }
  return null;
}

// Insere o marcador da nota logo após a primeira ocorrência do texto escolhido
// (para notas livres, em qualquer seleção). Se não achar num único nó de texto,
// coloca o marcador no fim do parágrafo.
function inserirRefNoTexto(par, termo, sup) {
  const alvo = (termo || '').trim();
  if (alvo) {
    const walker = document.createTreeWalker(par, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf(alvo);
      if (idx >= 0) {
        const depois = node.splitText(idx + alvo.length);
        depois.parentNode.insertBefore(sup, depois);
        return;
      }
    }
  }
  par.appendChild(sup);
}

// Offset (em caracteres) do início da seleção dentro do texto do parágrafo,
// ignorando os números sobrescritos das notas e a lista ao pé (que existem no
// DOM mas não no modelo). É a "posição exata de entrada" da nota, usada para
// ordenar/numerar como no Word e para inserir o marcador no ponto certo do DOCX.
function offsetNoPar(p, range) {
  try {
    const par = elEditor.querySelector(`.par[data-id="${p.id}"]`);
    if (!par || !range || !range.startContainer || range.startContainer.nodeType !== 3) return -1;
    const walker = document.createTreeWalker(par, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.parentElement && node.parentElement.closest('.nota-ref, .notas-pe')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let offset = 0, node;
    while ((node = walker.nextNode())) {
      if (node === range.startContainer) return offset + range.startOffset;
      offset += node.textContent.length;
    }
    return -1;
  } catch (e) { return -1; }
}

// Cria uma nota de rodapé para QUALQUER trecho selecionado (texto livre do
// usuário), não só para termos do dicionário. `posicao` é o offset exato da
// seleção no parágrafo (quando conhecido), para posicionar/numerar como no Word.
function criarNotaLivre(selecao, textoNota, p, posicao) {
  snapshotUndo();
  const doc = estado.documento;
  doc.notas = doc.notas || [];
  const nota = { termo: selecao, texto: textoNota, parId: p.id, livre: true };
  if (typeof posicao === 'number' && posicao >= 0) nota.posicao = posicao;
  doc.notas.push(nota);
  renderNotas();
  toast('Nota de rodapé criada.');
}

// Re-insere os marcadores sobrescritos (nota-ref) SÓ de um bloco, sem mexer nos
// outros nem no cursor. Usado depois de reconstruir o HTML de um parágrafo em
// edição (a reconstrução via dic.sublinhar apaga os <sup>). O número segue a
// ordem global das notas (notasOrdenadas).
function reinserirNotasNoBloco(div) {
  if (!div || !div.dataset) return;
  div.querySelectorAll('.nota-ref').forEach((el) => el.remove());
  const ordenadas = notasOrdenadas();
  ordenadas.forEach((n, i) => {
    if (n.parId !== div.dataset.id) return;
    const sup = document.createElement('sup');
    sup.className = 'nota-ref';
    sup.textContent = i + 1;
    const span = acharSpanTermo(div, n.termo);
    if (span) span.after(sup); else inserirRefNoTexto(div, n.termo, sup);
  });
}

// Monta/atualiza apenas a lista de notas ao pé (rodapé), na ordem global atual.
// Separado para poder ser chamado no sincronizar sem mexer nos sups (e no cursor).
function renderRodapeNotas(ordenadas) {
  const antiga = elEditor.querySelector('.notas-pe');
  if (antiga) antiga.remove();
  if (!ordenadas || !ordenadas.length) return;
  const sec = document.createElement('div');
  sec.className = 'notas-pe';
  sec.contentEditable = 'false';
  sec.innerHTML = '<h3>Notas de rodapé</h3><ol>' +
    ordenadas.map((n, i) => `<li><span>${escapar(n.texto)}</span> <button class="remover-nota" data-i="${i}" title="Remover nota">remover</button></li>`).join('') +
    '</ol>';
  elEditor.appendChild(sec);
  sec.querySelectorAll('.remover-nota').forEach((b) => b.addEventListener('click', () => removerNota(ordenadas[+b.dataset.i])));
}

// (Re)insere os marcadores sobrescritos no texto e a lista de notas ao pé.
function renderNotas() {
  elEditor.querySelectorAll('.nota-ref').forEach((el) => el.remove());

  const ordenadas = notasOrdenadas();
  if (!ordenadas.length) { renderRodapeNotas(ordenadas); agendarAlinhar(); return; }

  ordenadas.forEach((n, i) => {
    const par = elEditor.querySelector(`.par[data-id="${n.parId}"]`);
    if (!par) return;
    const sup = document.createElement('sup');
    sup.className = 'nota-ref';
    sup.textContent = i + 1;
    const span = acharSpanTermo(par, n.termo);
    if (span) span.after(sup); else inserirRefNoTexto(par, n.termo, sup);
  });

  renderRodapeNotas(ordenadas);
  agendarAlinhar();
}

function trocarOcorrencia(span, p, v) {
  snapshotUndo();
  const par = span.closest('.par');
  let novo = v.simples;
  // Se o termo abre a frase (primeira letra maiúscula), capitaliza a troca (SPEC 8.4 A1).
  if (/^[A-ZÀ-Þ]/.test(span.textContent)) novo = novo.charAt(0).toUpperCase() + novo.slice(1);
  span.replaceWith(document.createTextNode(novo));
  p.texto = textoDoBloco(par);
  analisar(p);
  aplicarClasseFaixa(par, p);
  par.innerHTML = dic.sublinhar(p.texto);
  renderMargem();
  renderKpis();
  toast(`Trocado por “${novo}”.`);
}

function buscarVerbetePorId(id) {
  return dic.todos().find((v) => v.id === id) || null;
}

// Menu para uma palavra OU um trecho selecionado (não só termos do dicionário).
function abrirMenuPalavra(palavra, rect, p, range) {
  fecharPopover();
  const v = dic.lookup(palavra);
  const chave = dic.fold(palavra);
  let sinonimos = [];
  if (v && v.sinonimos && v.sinonimos.length) sinonimos = sinonimos.concat(v.sinonimos);
  if (SINONIMOS[chave]) sinonimos = sinonimos.concat(SINONIMOS[chave]);
  if (SINONIMOS_USUARIO[chave]) sinonimos = sinonimos.concat(SINONIMOS_USUARIO[chave]); // cadastros do usuário
  sinonimos = [...new Set(sinonimos.filter(Boolean))];

  const pop = document.createElement('div');
  pop.className = 'popover';
  let itens = '';
  if (v && v.tratamento === 'substituir') itens += `<button class="item" data-a="trocar">↺ Trocar por “${escapar(v.simples)}”</button>`;
  itens += `<button class="item" data-a="cadastrar">＋ Cadastrar minha substituição</button>`;
  itens += `<button class="item" data-a="nota">¹ Criar nota de rodapé</button>`;
  itens += `<button class="item" data-a="reescrever">✎ Reescrever a frase com IA</button>`;
  if (sinonimos.length) {
    itens += `<div class="pop-sub">Sugestões · confira o sentido no contexto</div>`;
    itens += sinonimos.slice(0, 8).map((s) => `<button class="item" data-s="${escapar(s)}">≈ ${escapar(s)}</button>`).join('');
  }
  const rotulo = palavra.length > 46 ? escapar(palavra.slice(0, 46)) + '…' : escapar(palavra);
  pop.innerHTML = `<div class="cab"><div class="termo-nome">${rotulo}</div>` +
    `<div class="termo-tipo">${sinonimos.length ? 'Escolha uma sugestão, cadastre a sua ou reescreva' : 'Cadastre a sua substituição ou reescreva a frase'}</div></div>${itens}`;
  document.body.appendChild(pop);
  popoverAnchor = null;
  pop.style.top = (rect.bottom + 6) + 'px';
  pop.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 12)) + 'px';
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('.item'); if (!b) return;
    e.stopPropagation(); // impede o fechamento global (o alvo some ao trocar o innerHTML)
    if (b.dataset.a === 'reescrever') { fecharPopover(); abrirPainelConversao(p); return; }
    if (b.dataset.a === 'cadastrar') { formCadastroSinonimo(pop, palavra, range, p); return; }
    if (b.dataset.a === 'nota') { formNotaRodape(pop, palavra, p, offsetNoPar(p, range)); return; }
    const novo = b.dataset.a === 'trocar' ? v.simples : b.dataset.s;
    substituirSelecao(range, capitalizarComo(palavra, novo), p, palavra);
    fecharPopover();
  });
}

// Formulário inline dentro do popover: o usuário digita a versão simples da
// palavra/trecho selecionado; ela é salva (localStorage + Supabase quando
// logado), aplicada no texto e sugerida nas próximas vezes.
function formCadastroSinonimo(pop, selecao, range, p) {
  const curto = selecao.length > 46 ? escapar(selecao.slice(0, 46)) + '…' : escapar(selecao);
  pop.innerHTML = `
    <div class="cab"><div class="termo-nome">Cadastrar substituição</div>
      <div class="termo-tipo">Trocar “${curto}” por uma versão mais simples. Fica salva e é sugerida depois.</div></div>
    <div class="pop-form">
      <input id="novoSinonimo" class="pop-input" placeholder="versão simples" autocomplete="off" />
      <div class="pop-form-acoes">
        <button class="btn sm primary" data-a="salvar">Salvar e aplicar</button>
        <button class="btn sm ghost" data-a="cancelar">Cancelar</button>
      </div>
    </div>`;
  const inp = pop.querySelector('#novoSinonimo');
  setTimeout(() => inp && inp.focus(), 0);
  const salvar = () => {
    const novo = inp.value.trim();
    if (!novo) { inp.focus(); return; }
    salvarSinonimoUsuario(selecao, novo);
    substituirSelecao(range, capitalizarComo(selecao, novo), p, selecao);
    fecharPopover();
    toast('Substituição cadastrada e aplicada.');
  };
  pop.querySelector('[data-a=salvar]').addEventListener('click', salvar);
  pop.querySelector('[data-a=cancelar]').addEventListener('click', fecharPopover);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); salvar(); } });
}

// Formulário inline para nota de rodapé em qualquer trecho selecionado.
function formNotaRodape(pop, selecao, p, posicao) {
  const curto = selecao.length > 46 ? escapar(selecao.slice(0, 46)) + '…' : escapar(selecao);
  pop.innerHTML = `
    <div class="cab"><div class="termo-nome">Nota de rodapé</div>
      <div class="termo-tipo">Explique “${curto}”. A nota sai ao pé do documento e no DOCX exportado.</div></div>
    <div class="pop-form">
      <textarea id="notaTexto" class="pop-input" rows="3" placeholder="texto da nota"></textarea>
      <div class="pop-form-acoes">
        <button class="btn sm primary" data-a="salvar">Criar nota</button>
        <button class="btn sm ghost" data-a="cancelar">Cancelar</button>
      </div>
    </div>`;
  const inp = pop.querySelector('#notaTexto');
  setTimeout(() => inp && inp.focus(), 0);
  const salvar = () => {
    const t = inp.value.trim();
    if (!t) { inp.focus(); return; }
    criarNotaLivre(selecao, t, p, posicao);
    fecharPopover();
  };
  pop.querySelector('[data-a=salvar]').addEventListener('click', salvar);
  pop.querySelector('[data-a=cancelar]').addEventListener('click', fecharPopover);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); salvar(); } });
}

// Substituições cadastradas pelo usuário: { chaveFold: [versõesSimples] }.
function carregarSinonimosUsuario() {
  try { SINONIMOS_USUARIO = JSON.parse(localStorage.getItem('lucas.sinonimos.usuario') || '{}') || {}; }
  catch (e) { SINONIMOS_USUARIO = {}; }
}
function salvarSinonimoUsuario(termo, simples) {
  const chave = dic.fold(termo);
  if (!SINONIMOS_USUARIO[chave]) SINONIMOS_USUARIO[chave] = [];
  if (!SINONIMOS_USUARIO[chave].includes(simples)) SINONIMOS_USUARIO[chave].unshift(simples);
  try { localStorage.setItem('lucas.sinonimos.usuario', JSON.stringify(SINONIMOS_USUARIO)); } catch (e) {}
  salvarSinonimoNuvem(termo, simples); // persistência opcional na nuvem (quando configurada)
}
// Sincroniza a substituição com o Supabase quando há usuário logado (a nuvem
// ignora silenciosamente se não houver login). O cadastro local já valeu.
function salvarSinonimoNuvem(termo, simples) {
  nuvem.salvarSinonimoNuvem(termo, simples).catch(() => {});
}

function capitalizarComo(orig, novo) {
  return /^[A-ZÀ-Þ]/.test(orig) ? novo.charAt(0).toUpperCase() + novo.slice(1) : novo;
}

function substituirSelecao(range, texto, p, textoOrig) {
  snapshotUndo();
  const conectado = range && range.startContainer && range.startContainer.isConnected && elEditor.contains(range.startContainer);
  let aplicado = false;
  if (conectado) {
    try { range.deleteContents(); range.insertNode(document.createTextNode(texto)); aplicado = true; } catch (e) {}
  }
  const par = elEditor.querySelector(`.par[data-id="${p.id}"]`);
  if (par) {
    if (!aplicado && textoOrig) {
      // Range obsoleto (o bloco foi re-renderizado entre a seleção e o clique):
      // aplica no modelo, trocando a 1ª ocorrência do texto original. Antes isso
      // falhava em silêncio (toast de sucesso sem mudança) ou ia para o lugar errado.
      const atual = textoDoBloco(par);
      const idx = atual.indexOf(textoOrig);
      p.texto = idx >= 0 ? atual.slice(0, idx) + texto + atual.slice(idx + textoOrig.length) : atual;
    } else {
      p.texto = textoDoBloco(par);
    }
    analisar(p);
    aplicarClasseFaixa(par, p);
    par.innerHTML = dic.sublinhar(p.texto);
  }
  renderNotas(); renderMargem(); renderKpis();
  toast('Trocado por “' + texto + '”.');
}

function fecharPopover() {
  document.querySelectorAll('.popover').forEach((el) => el.remove());
  popoverAnchor = null;
}

// Reposiciona o popover ancorado a um termo quando o editor rola; fecha o menu
// baseado em seleção (duplo-clique) ou se o termo sair da área visível.
function reposicionarPopover() {
  const pop = document.querySelector('.popover');
  if (!pop) return;
  if (popoverAnchor && popoverAnchor.isConnected) {
    const r = popoverAnchor.getBoundingClientRect();
    const wrap = elEditorWrap.getBoundingClientRect();
    if (r.bottom < wrap.top || r.top > wrap.bottom) { fecharPopover(); return; }
    pop.style.top = (r.bottom + 6) + 'px';
    pop.style.left = Math.max(10, Math.min(r.left, window.innerWidth - pop.offsetWidth - 12)) + 'px';
  } else {
    fecharPopover();
  }
}

// ---------------------------------------------------------------------------
// Modal e aviso inicial
// ---------------------------------------------------------------------------
function abrirModal(titulo, corpoHtml, botoes) {
  fecharModal();
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.id = 'modalOverlay';
  const botoesHtml = (botoes || []).map((b, i) => `<button class="btn ${b.classe || ''}" data-i="${i}">${b.rotulo}</button>`).join('');
  ov.innerHTML = `
    <div class="modal">
      <div class="modal-h"><div class="t">${escapar(titulo)}</div><button class="btn ghost sm fechar">✕</button></div>
      <div class="modal-b">${corpoHtml}</div>
      <div class="modal-f"><button class="btn" data-cancelar>Fechar</button>${botoesHtml}</div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('.fechar').addEventListener('click', fecharModal);
  ov.querySelector('[data-cancelar]').addEventListener('click', fecharModal);
  ov.addEventListener('click', (e) => { if (e.target === ov) fecharModal(); });
  (botoes || []).forEach((b, i) => {
    ov.querySelector(`[data-i="${i}"]`).addEventListener('click', b.acao);
  });
}

function fecharModal() {
  const ov = $('#modalOverlay');
  if (ov) ov.remove();
}

function mostrarAvisoInicial() {
  let visto = false;
  try { visto = localStorage.getItem('lucas.aviso.visto') === '1'; } catch (e) {}
  if (visto) return;
  abrirModal('Antes de começar', `
    <div class="aviso"><b>Privacidade</b>O texto fica no seu navegador. Ele só sai quando você pede uma conversão, e vai direto para o provedor de IA que você escolher, com a sua chave (BYOK). Não use documentos sigilosos ou com dados pessoais protegidos.</div>`,
    [{ rotulo: 'Entendi', classe: 'primary', acao: () => {
      try { localStorage.setItem('lucas.aviso.visto', '1'); } catch (e) {}
      fecharModal();
    }}]);
}

// ---------------------------------------------------------------------------
// Configuração de provedores de IA (BYOK)
// ---------------------------------------------------------------------------
function revisorAtual() { try { return localStorage.getItem('lucas.revisor') || ''; } catch (e) { return ''; } }

function abrirConfigProvedores() {
  const atual = prov.getProvedorAtual();
  const options = Object.entries(prov.PROVEDORES)
    .map(([k, d]) => `<option value="${k}" ${k === atual ? 'selected' : ''}>${escapar(d.rotulo)} — ${d.custo === 'gratis' ? 'grátis' : 'paga'}</option>`).join('');
  abrirModal('Conectar uma IA', `
    <p class="muted" style="margin-bottom:12px">Sua chave fica só neste navegador, nunca vai para o servidor (princípio P3). Ao usar, o LUCAS ainda <b>troca de modelo sozinho</b> se o escolhido ficar indisponível.</p>
    <div class="field"><label>1. Escolha o provedor de IA</label><select id="cfgProv">${options}</select></div>
    <div id="cfgLink" class="muted" style="margin:-4px 0 14px"></div>
    <div class="field" id="cfgBlocoChave"><label>2. Cole a sua chave</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="cfgChave" type="password" placeholder="cole a chave de API aqui" style="flex:1">
        <button class="btn sm ghost" id="cfgPegarChave" type="button" style="white-space:nowrap">Pegar chave ↗</button>
      </div>
    </div>
    <div class="field"><label>3. Teste a chave para ver os modelos que funcionam</label>
      <button class="btn sm" id="cfgTestarModelos" type="button" style="white-space:nowrap">Testar chave e listar modelos</button>
      <div id="cfgModelosStatus" class="muted" style="font-size:12.5px;margin-top:8px">Clique acima: o LUCAS testa a sua chave e mostra só os modelos que estão respondendo agora.</div>
      <select id="cfgModelo" style="margin-top:10px;display:none"></select>
    </div>
    <div id="cfgEstado" class="muted" style="margin-top:8px"></div>
    <button class="linkb" id="cfgApagar" style="background:none;border:none;color:var(--danger);font:inherit;font-weight:700;cursor:pointer;margin-top:8px">Apagar minhas chaves deste navegador</button>`,
    [
      { rotulo: 'Salvar e usar', classe: 'primary', acao: salvarConfig }
    ]);

  const selProv = $('#cfgProv');
  const selModelo = $('#cfgModelo');
  // Preenche o select de modelos, mantendo o modelo salvo mesmo se não estiver
  // na lista (para não perder a escolha do usuário).
  const preencherModelos = (lista, escolhido) => {
    const alvo = escolhido || selModelo.value || '';
    const opts = [...lista];
    if (alvo && !opts.includes(alvo)) opts.unshift(alvo);
    selModelo.innerHTML = opts.map((m) => `<option value="${escapar(m)}" ${m === alvo ? 'selected' : ''}>${escapar(m)}</option>`).join('');
  };
  // Estado inicial do select de modelos: começa escondido; só aparece depois do
  // teste, já filtrado para os que respondem. Guarda o modelo recomendado como
  // padrão para salvar mesmo se o usuário não testar (o fallback cuida do resto).
  const resetModelos = (d) => {
    selModelo.style.display = 'none';
    preencherModelos(d.modelos || [], prov.getModelo(selProv.value));
    $('#cfgModelosStatus').innerHTML = 'Clique acima: o LUCAS testa a sua chave e mostra só os modelos que estão respondendo agora.';
  };
  const atualizar = () => {
    const k = selProv.value; const d = prov.PROVEDORES[k];
    $('#cfgBlocoChave').style.display = d.requerChave ? '' : 'none';
    $('#cfgChave').value = prov.getChave(k);
    const bpc = $('#cfgPegarChave');
    if (bpc) bpc.style.display = (d.requerChave && d.urlChave) ? '' : 'none';
    const grat = d.custo === 'gratis'
      ? '<b style="color:var(--good)">Tem camada gratuita.</b> '
      : '<b>Chave paga.</b> ';
    $('#cfgLink').innerHTML = grat + escapar(d.nota || '');
    $('#cfgEstado').textContent = '';
    resetModelos(d);
  };
  selProv.addEventListener('change', atualizar);
  atualizar();
  const bpc = $('#cfgPegarChave');
  if (bpc) bpc.addEventListener('click', () => {
    const d = prov.PROVEDORES[selProv.value];
    if (d && d.urlChave) window.open(d.urlChave, '_blank', 'noopener');
  });
  $('#cfgTestarModelos').addEventListener('click', descobrirModelos);
  $('#cfgApagar').addEventListener('click', () => { prov.apagarTodasChaves(); $('#cfgChave').value = ''; toast('Chaves apagadas deste navegador.'); });
}

// Testa a chave em todos os modelos curados e deixa disponíveis SÓ os que estão
// respondendo naquele momento, já selecionando o recomendado.
async function descobrirModelos() {
  const btn = $('#cfgTestarModelos');
  const st = $('#cfgModelosStatus');
  const selModelo = $('#cfgModelo');
  const provedor = $('#cfgProv').value;
  const chave = $('#cfgChave').value.trim();
  const def = prov.PROVEDORES[provedor];
  if (def.requerChave && !chave) { st.innerHTML = '<span style="color:var(--danger);font-weight:700">Cole a chave primeiro.</span>'; return; }
  btn.disabled = true; const rotulo = btn.textContent; btn.textContent = 'Testando…';
  st.textContent = 'Testando a sua chave em cada modelo…';
  selModelo.style.display = 'none';
  try {
    const res = await prov.testarModelos({ provedor, chave });
    const funcionando = res.filter((r) => r.ok).map((r) => r.modelo);
    if (!funcionando.length) {
      const chaveRuim = res.some((r) => /chave rejeitada|401|403/i.test(r.erro || ''));
      st.innerHTML = chaveRuim
        ? '<span style="color:var(--danger);font-weight:700">A chave foi rejeitada.</span> Confira se copiou a chave certa desse provedor.'
        : '<span style="color:var(--faixa-razoavel);font-weight:700">Nenhum modelo respondeu agora.</span> Podem estar sobrecarregados: tente de novo em instantes ou troque de provedor.';
      return;
    }
    selModelo.innerHTML = funcionando.map((m, i) => `<option value="${escapar(m)}" ${i === 0 ? 'selected' : ''}>${escapar(m)}${i === 0 ? ' (recomendado)' : ''}</option>`).join('');
    selModelo.style.display = '';
    const foraDoAr = res.filter((r) => !r.ok).map((r) => r.modelo);
    const nota = foraDoAr.length ? ` (${foraDoAr.join(', ')} fora do ar agora)` : '';
    st.innerHTML = `<span style="color:var(--good);font-weight:700">${funcionando.length} modelo(s) funcionando:</span> escolha abaixo${nota}. Depois é só <b>Salvar e usar</b>.`;
  } catch (e) {
    st.innerHTML = `<span style="color:var(--danger);font-weight:700">Não consegui testar:</span> ${escapar(mensagemErroIA(e).texto)}`;
  } finally {
    btn.disabled = false; btn.textContent = rotulo;
  }
}

async function testarConfig() {
  const est = $('#cfgEstado'); if (!est) return;
  est.textContent = 'Testando a sua chave…';
  const provedor = $('#cfgProv').value;
  const chave = $('#cfgChave').value.trim();
  const modelo = $('#cfgModelo').value.trim();
  try {
    const r = await prov.testarProvedor({ provedor, modelo, chave });
    est.innerHTML = `<span style="color:var(--good);font-weight:700">Funcionou!</span> Respondeu em ${r.ms} ms. Pode salvar e usar.`;
  } catch (e) {
    const info = mensagemErroIA(e);
    // Se o problema é o modelo (indisponível/sobrecarga), a chave pode estar boa:
    // o LUCAS troca de modelo sozinho ao usar. Só chave/pedido inválido é bloqueio.
    if (info.sobrecarga) {
      est.innerHTML = `<span style="color:var(--faixa-razoavel);font-weight:700">O modelo não respondeu agora</span>, mas o LUCAS tenta outros modelos automaticamente ao usar. Se a chave estiver certa, pode salvar assim mesmo.`;
    } else {
      est.innerHTML = `<span style="color:var(--danger);font-weight:700">Não funcionou:</span> ${escapar(info.texto)}`;
    }
  }
}

function salvarConfig() {
  const k = $('#cfgProv').value;
  prov.setProvedorAtual(k);
  prov.setModelo(k, $('#cfgModelo').value.trim());
  prov.setChave(k, $('#cfgChave').value.trim());
  fecharModal();
  toast('Provedor configurado: ' + prov.PROVEDORES[k].rotulo);
  // Atualiza o painel de revisão na hora: agora que há chave, a indicação deixa
  // de ser "Conecte uma IA" e passa a oferecer "Avaliar clareza".
  if (estado.documento.paragrafos.length) renderKpis();
  // Se há um documento aberto e ainda não foi avaliado pela IA, agora que existe
  // chave a avaliação automática pode rodar (fecha o vão do "só funcionou depois
  // de clicar no botão").
  const jaAvaliado = estado.documento.paragrafos.some((p) => p.avaliacaoIA);
  if (!jaAvaliado) talvezAvaliarAoCarregar();
}

// ---------------------------------------------------------------------------
// Painel de conversão por IA (SPEC 5.4)
// ---------------------------------------------------------------------------
function faixaPill(m) {
  if (!m || m.faixa == null || m.faixa === 'neutra' || m.curto) return `<span class="faixa neutra">Índice não calculado</span>`;
  return `<span class="faixa ${m.faixa}">${nomeFaixa(m.faixa)}</span>`;
}

// Abre direto na página "Reescrever" do fluxo do parágrafo (§ acima).
function abrirPainelConversao(p, opts = {}) { abrirParagrafo(p, 'reescrever', opts); }

// Ângulos distintos para gerar versões variadas do mesmo parágrafo. Cada uma
// muda a ESTRATÉGIA de reescrita (não só a temperatura), para as versões saírem
// de fato diferentes entre si.
const VARIACOES_VERSAO = [
  'busque a MÁXIMA concisão — o texto mais curto e direto possível, sem perder nada essencial',
  'priorize FRASES BEM CURTAS: divida bastante o período, uma ideia por frase',
  'reorganize a ORDEM da informação: comece pelo ponto principal e deixe os detalhes e as qualificações depois',
  'fique o MAIS PRÓXIMO possível do original, mudando só o indispensável para ficar claro'
];

async function gerarVersao(p, ov) {
  const cfg = prov.configAtual();
  const provDef = prov.PROVEDORES[cfg.provedor];
  if (provDef.requerChave && !cfg.chave) { toast('Configure a chave em Provedores de IA.'); abrirConfigProvedores(); return; }

  const codigos = tecnicasMarcadas(ov);
  if (!codigos.length) { toast('Escolha ao menos uma técnica.'); return; }
  const rotulo = codigos.join('+');
  const instrucaoLivre = ov.querySelector('#pconvLivre').value;
  const qtd = Math.min(3, Math.max(1, parseInt((ov.querySelector('#pconvQtd') || {}).value || '1', 10)));
  const cont = ov.querySelector('#pconvVersoes');
  const btn = ov.querySelector('#pconvGerar');
  const temps = [0.4, 0.7, 1.0]; // variação de temperatura para versões distintas
  btn.disabled = true;

  // Contexto enxuto (janela ao redor do parágrafo): calculado UMA vez e reusado.
  const contexto = contextoParaParagrafo(p);

  // Cada versão recebe um ÂNGULO diferente. A temperatura sozinha não dá variedade
  // num prompt tão prescritivo (as versões saíam idênticas). Aqui a variedade é de
  // ESTRATÉGIA de reescrita, sem violar as regras invioláveis.
  const base = cont.querySelectorAll('.pconv-versao').length; // p/ "Gerar mais" continuar variando
  const aplicarVar = qtd > 1 || base > 0;

  // Gera `qtd` versões EM PARALELO. Antes era em série — o usuário esperava a soma
  // dos tempos. Clicar de novo em "Gerar mais" acrescenta outras acima.
  const cards = [];
  for (let i = 0; i < qtd; i++) {
    const card = document.createElement('div');
    card.className = 'pconv-versao';
    card.innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:6px">Gerando versão ${i + 1} de ${qtd} com ${escapar(cfg.modelo)}…</div><div class="pconv-stream mono"></div>`;
    cont.prepend(card);
    cards.push(card);
  }
  await Promise.all(cards.map((card, i) => {
    const streamEl = card.querySelector('.pconv-stream');
    const variacao = aplicarVar ? VARIACOES_VERSAO[(base + i) % VARIACOES_VERSAO.length] : '';
    return converter(p.texto, { promptCodigo: codigos, instrucaoLivre, temperatura: temps[i % temps.length], sugestoes: ov.__sugestoes, publicos: publicosRotulos(), contexto, variacao, onTrocaModelo: aoTrocarModelo, onStream: (t) => { streamEl.textContent = t; } })
      .then((res) => renderVersaoCard(card, p, res, rotulo))
      .catch((e) => { card.innerHTML = htmlErroIA(e); ligarTrocaIA(card); });
  }));
  btn.disabled = false;
  btn.textContent = 'Gerar mais';
}

// Técnicas marcadas no painel (array de códigos, ex.: ['P1','P4']).
function tecnicasMarcadas(ov) {
  return [...ov.querySelectorAll('input[name=pconv]:checked')].map((c) => c.value);
}

function renderVersaoCard(card, p, res, codigo) {
  if (!res.ok) {
    card.innerHTML = `<div class="errbox">A resposta do modelo veio fora do formato esperado. Tente de novo ou troque de técnica.</div>
      <div class="pconv-texto mono" style="margin-top:8px">${escapar(res.versao)}</div>`;
    return;
  }
  const alertasHtml = res.alertas.length
    ? `<div class="pconv-alertas">${res.alertas.map((a) => `<div class="pconv-alerta">⚠ ${escapar(a.texto)}</div>`).join('')}</div>` : '';
  const obs = res.obj && res.obj.observacao ? `<div class="muted" style="margin-top:6px">${escapar(res.obj.observacao)}</div>` : '';
  card.innerHTML = `
    <div class="pconv-tag">${codigo} · ${escapar(res.nomeFaixaAntes)} → <b>${escapar(res.nomeFaixaDepois)}</b></div>
    <div class="pconv-texto">${escapar(res.versao)}</div>
    ${obs}
    ${alertasHtml}
    <div class="pconv-acoes">
      <button class="btn sm primary" data-a="aceitar">Aceitar</button>
      <button class="btn sm" data-a="descartar">Descartar</button>
      <button class="btn sm ghost" data-a="copiar">Copiar</button>
    </div>`;
  card.querySelector('[data-a=aceitar]').addEventListener('click', () => aceitarVersao(p, res, codigo));
  card.querySelector('[data-a=descartar]').addEventListener('click', () => { registrar(p, res, codigo, 'descartada'); card.remove(); toast('Versão descartada.'); });
  card.querySelector('[data-a=copiar]').addEventListener('click', () => { if (navigator.clipboard) navigator.clipboard.writeText(res.versao); toast('Copiado.'); });
}

async function aceitarVersao(p, res, codigo) {
  const comAlerta = res.alertas.length > 0;
  if (comAlerta && !confirm('Esta versão tem alertas da conferência automática. Aceitar mesmo assim?')) return;
  snapshotUndo();
  p.texto = res.versao;
  // O texto mudou: a avaliação de IA anterior (nota e dicas) era do texto ANTIGO.
  // Descarta para não exibir classificação/dicas defasadas; será refeita abaixo.
  p.avaliacaoIA = null;
  analisar(p);
  const par = elEditor.querySelector(`.par[data-id="${p.id}"]`);
  if (par) { aplicarClasseFaixa(par, p); par.innerHTML = dic.sublinhar(p.texto); }
  renderMargem(); renderKpis();
  registrar(p, res, codigo, comAlerta ? 'aceita_com_alerta' : 'aceita');
  fecharParagrafo();
  toast('Versão aplicada ao parágrafo.');
  // Reavalia a clareza DESTE parágrafo com a IA (a classificação e as dicas têm de
  // acompanhar o novo texto, mesmo sem rodar a avaliação geral do documento).
  await reavaliarParagrafoIA(p);
}

// Avalia a clareza de UM parágrafo com a IA e atualiza nota, dicas e classificação.
// Silencioso: sem overlay de tela cheia. Não faz nada se não houver IA conectada.
async function reavaliarParagrafoIA(p) {
  if (!p || p.emTabela || !iaConectada()) return false;
  marcarAvaliandoParagrafo(p, true);
  renderMargem(); // mostra "Avaliando a clareza…" já
  let ok = false;
  try {
    const r = await avaliarTrecho(p.texto, { pesos: ajustes.pesos, publicos: publicosRotulos(), onTrocaModelo: aoTrocarModelo });
    if (r && r.nota != null) {
      p.avaliacaoIA = { nota: r.nota, sugestoes: r.sugestoes || [] };
      p.clareza = clarezaComposta(p);
      ok = true;
    } else {
      toast('Não consegui reavaliar a clareza deste parágrafo. Tente “Avaliar clareza”.');
    }
  } catch (e) {
    toast(mensagemErroIA(e).texto);
  } finally {
    marcarAvaliandoParagrafo(p, false);
    renderMargem(); renderKpis();
  }
  return ok;
}

// Marca visualmente que a IA está reavaliando a clareza de um parágrafo (o card
// mostra "avaliando…"). Guardado no próprio parágrafo para sobreviver ao render.
function marcarAvaliandoParagrafo(p, on) {
  if (on) p.__avaliando = true; else delete p.__avaliando;
}

function registrar(p, res, codigo, decisao) {
  const entrada = {
    documento: estado.documento.nomeArquivo || estado.documento.origem,
    paragrafo: p.id, acao: 'versao_ia', promptCodigo: codigo,
    provedor: res.provedor, modelo: res.modelo,
    faixaAntes: res.faixaAntes, faixaDepois: res.faixaDepois,
    facilidadeAntes: res.facilidadeAntes, facilidadeDepois: res.facilidadeDepois,
    alertas: res.alertas, decisao, revisor: revisorAtual(),
    observacao: res.obj && res.obj.observacao ? res.obj.observacao : ''
  };
  registro.adicionar(entrada);       // memória (CSV/JSON), sempre
  gravarRegistroNuvem(entrada);      // Supabase, se logado (trilha de auditoria, SPEC 12)
}

// Grava uma linha da trilha no Supabase quando há login. Silencioso em caso de
// falha: o registro local (CSV/JSON) já garante a evidência. Mapeia os campos
// para as colunas snake_case da tabela registro_revisao.
function gravarRegistroNuvem(entrada) {
  if (!usuarioLogado) return;
  const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
  nuvem.inserirRegistro({
    documento_id: estado.documento.idNuvem || null,
    paragrafo: entrada.paragrafo || null,
    acao: entrada.acao || 'versao_ia',
    prompt_codigo: Array.isArray(entrada.promptCodigo) ? entrada.promptCodigo.join('+') : (entrada.promptCodigo || null),
    provedor: entrada.provedor || null,
    modelo: entrada.modelo || null,
    faixa_antes: entrada.faixaAntes || null,
    faixa_depois: entrada.faixaDepois || null,
    facilidade_antes: num(entrada.facilidadeAntes),
    facilidade_depois: num(entrada.facilidadeDepois),
    alertas: entrada.alertas || [],
    decisao: entrada.decisao,
    revisor: entrada.revisor || null,
    observacao: entrada.observacao || null
  }).catch(() => { /* trilha local já garantida */ });
}

// Transparência: mostra exatamente o prompt aplicado numa conversão — a
// instrução da técnica escolhida mais as regras fixas do sistema (ISO 24495 /
// Lei 15.263, preservar números e termos jurídicos, formato JSON).
function mostrarPromptAplicado(codigo) {
  const codigos = (Array.isArray(codigo) ? codigo : [codigo]).filter(Boolean);
  if (!codigos.length) codigos.push('P1');
  const sys = sistemaTrecho(termosProtegidos());
  const nomes = codigos.map((c) => (c === 'PL' ? PROMPT_LIVRE.nome : ((porCodigo(c) || {}).nome || c)));
  const instrucao = codigos.map((c) => c === 'PL'
    ? 'Instrução livre digitada por você no campo do prompt.'
    : ((porCodigo(c) || {}).instrucao || '')).join('\n\n---\n\n');
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'modalPrompt';
  ov.innerHTML = `
    <div class="modal" style="max-width:760px">
      <div class="modal-h"><div class="t">Prompt aplicado · ${escapar(nomes.join(' + '))}</div><button class="btn ghost sm fechar">✕</button></div>
      <div class="modal-b">
        <div class="muted" style="margin-bottom:10px">É exatamente isto que o LUCAS envia ao modelo de IA para reescrever cada parágrafo. A(s) <b>técnica(s)</b> escolhida(s) mudam a instrução; as <b>regras fixas</b> valem para toda conversão.</div>
        <div class="prompt-box">
          <h4>Instrução da(s) técnica(s) (${escapar(codigos.join(' + '))})</h4>
          <div>${escapar(instrucao)}</div>
          <h4>Regras fixas (todas as conversões)</h4>
          <div class="mono">${escapar(sys)}</div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('.fechar').addEventListener('click', () => ov.remove());
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
}

// ---------------------------------------------------------------------------
// Conversão do documento INTEIRO numa única requisição (evita estourar o limite
// de uso do provedor, que acontece ao disparar uma requisição por parágrafo).
// A saída é o texto completo reescrito em linguagem simples (texto corrido).
// ---------------------------------------------------------------------------
let conversaoDocEmAndamento = false;

// Avalia a clareza do documento inteiro com IA (uma requisição): cada parágrafo
// recebe uma nota de clareza e sugestões (Lei 15.263 + ABNT), que entram no card
// e no Índice de Clareza composto.
async function avaliarClareza(opts = {}) {
  const auto = !!opts.auto; // modo automático (ao carregar): sem pop-ups intrusivos
  if (!estado.documento.paragrafos.length) { if (!auto) toast('Carregue um documento primeiro.'); return; }
  const cfg = prov.configAtual();
  const provDef = prov.PROVEDORES[cfg.provedor];
  if (provDef.requerChave && !cfg.chave) { if (!auto) { toast('Configure a chave em Provedores de IA.'); abrirConfigProvedores(); } return; }
  const pars = estado.documento.paragrafos;
  mostrarCarga('Avaliando a clareza com IA…', `${pars.length} parágrafos`);
  try {
    const resultado = await avaliarDocumento(pars, { pesos: ajustes.pesos, publicos: publicosRotulos(), onTrocaModelo: aoTrocarModelo,
      onProgress: (feito, total) => atualizarCarga('Avaliando a clareza com IA…', `${Math.round(100 * feito / total)}% (${feito}/${total} lotes)`) });
    const itens = (resultado && resultado.itens) || [];
    let aplicados = 0;
    for (const item of itens) {
      const idx = (parseInt(item && item.n, 10) || 0) - 1;
      if (idx >= 0 && idx < pars.length) {
        const nota = Number(item.nota);
        pars[idx].avaliacaoIA = {
          nota: isFinite(nota) ? nota : null,
          sugestoes: Array.isArray(item.sugestoes) ? item.sugestoes.filter((s) => s && String(s).trim()) : []
        };
        aplicados++;
      }
    }
    // Avaliação do documento como um todo (coerência/organização), quando veio.
    estado.documento.avaliacaoGlobal = (resultado && resultado.global) || null;
    pars.forEach((p) => { p.clareza = clarezaComposta(p); });
    renderMargem(); renderKpis();
    toast(aplicados ? `Clareza avaliada em ${aplicados} parágrafo(s).` : 'A avaliação não retornou parágrafos.');
  } catch (e) {
    if (auto) toast('Não consegui avaliar a clareza automaticamente. Use o botão “Avaliar clareza”.');
    else mostrarAvisoIA('Avaliação de clareza', e);
  } finally {
    esconderCarga();
  }
}

// Dispara a avaliação por IA logo após carregar, se o usuário deixou ligado e há
// chave configurada. Entrega valor imediato sem travar a edição (assíncrono).
function talvezAvaliarAoCarregar() {
  if (!ajustes.autoAvaliar) return;
  if (!estado.documento.paragrafos.length) return;
  const cfg = prov.configAtual();
  const provDef = prov.PROVEDORES[cfg.provedor];
  if (provDef.requerChave && !cfg.chave) return; // sem chave: fica só na legibilidade
  // deixa a UI pintar o documento antes de abrir o overlay da avaliação
  setTimeout(() => avaliarClareza({ auto: true }), 120);
}

// Junta os parágrafos do documento num único texto (linha em branco entre eles).
function textoDocumentoCompleto() {
  return estado.documento.paragrafos.map((p) => p.texto).filter((t) => t && t.trim()).join('\n\n');
}

// Contexto ENXUTO para reescrever um parágrafo: em documentos curtos manda tudo;
// em documentos longos manda só uma janela em volta do parágrafo (alguns antes e
// depois), com um teto de caracteres. Mandar o documento inteiro a cada parágrafo
// deixava a IA lentíssima e cara sem ganho real de coerência local.
function contextoParaParagrafo(p) {
  const pars = estado.documento.paragrafos || [];
  const full = textoDocumentoCompleto();
  const TETO_TUDO = 2000;         // até aqui, o documento inteiro é barato: manda tudo
  if (full.length <= TETO_TUDO) return full;
  const idx = pars.indexOf(p);
  if (idx < 0) return '';
  const VIZ = 2;                  // parágrafos de cada lado
  const TETO_JANELA = 2800;       // teto de caracteres da janela
  const ini = Math.max(0, idx - VIZ);
  const fim = Math.min(pars.length - 1, idx + VIZ);
  const trechos = [];
  for (let i = ini; i <= fim; i++) {
    const t = (pars[i].texto || '').trim();
    if (t) trechos.push(t);
  }
  let ctx = trechos.join('\n\n');
  if (ctx.length > TETO_JANELA) ctx = ctx.slice(0, TETO_JANELA);
  return ctx;
}

function abrirConversaoLote(opts = {}) {
  if (!estado.documento.paragrafos.length) { toast('Carregue um documento primeiro.'); return; }
  const cfg = prov.configAtual();
  const provDef = prov.PROVEDORES[cfg.provedor];
  const nPar = estado.documento.paragrafos.length;
  const nPalavras = estado.documento.paragrafos.reduce((s, p) => s + (p.texto ? p.texto.trim().split(/\s+/).length : 0), 0);
  // Orientações macro (da avaliação do documento como um todo), quando o usuário
  // pediu "Aplicar sugestões ao documento".
  const g = estado.documento.avaliacaoGlobal;
  const orient = (opts.orientar && g && Array.isArray(g.sugestoes)) ? g.sugestoes.filter((s) => s && String(s).trim()) : [];
  const pubCurtos = ajustes.publicos.map((id) => (PUBLICOS.find((x) => x.id === id) || {}).curto).filter(Boolean);
  // Técnicas disponíveis (as mesmas do parágrafo): linguagem simples, explicar
  // termos, resumir, os prompts do usuário e o prompt livre.
  const opcoesTec = [...PROMPTS.filter((x) => x.codigo !== 'P7'), PROMPT_LIVRE];
  const tecHtml = opcoesTec.map((pr, i) =>
    `<label class="doctec-op"><input type="checkbox" name="doctec" value="${pr.codigo}" ${i === 0 ? 'checked' : ''}><span><b>${pr.usuario ? 'Meu · ' : ''}${escapar(pr.nome)}</b>${pr.descricao ? `<small class="pconv-desc">${escapar(pr.descricao)}</small>` : ''}</span></label>`).join('');

  // Tela cheia (não modal): documento inteiro pede espaço para o antes/depois.
  const ov = document.createElement('div');
  ov.className = 'tela-conversao'; ov.id = 'telaConversao';
  ov.innerHTML = `
    <header class="tela-top">
      <div class="tela-titulo">Converter documento inteiro em linguagem simples</div>
      <button class="btn sm ghost" id="docFechar">Fechar ✕</button>
    </header>
    <div class="tela-barra">
      <div class="muted"><b>${nPar}</b> parágrafos · ${nPalavras} palavras · <button type="button" class="ver-prompt" id="docVerPrompt">ver prompt</button> · <b>${escapar(provDef.rotulo)}</b> · ${escapar(cfg.modelo)} <button class="linkb" id="docCfg">trocar</button>${pubCurtos.length ? ` · Público: ${escapar(pubCurtos.join(', '))}` : ''}${orient.length ? ` · <b>${orient.length} sugestão(ões) do conjunto</b>` : ''}</div>
      <div class="tela-botoes">
        <span id="docProgresso" class="muted"></span>
        <button class="btn sm primary" id="docConverter">Converter documento</button>
        <button class="btn sm" id="docAplicar" disabled>Aplicar ao editor</button>
        <button class="btn sm" id="docCopiar" disabled>Copiar</button>
      </div>
    </div>
    <div class="tela-tecnicas">
      <details ${'' /* fechado por padrão */}>
        <summary>Técnica de conversão <span class="muted" id="docTecResumo"></span> · <button type="button" class="linkb" id="docConstrutor">construtor guiado</button></summary>
        <div class="doctec-ops">${tecHtml}</div>
        <textarea id="docLivre" class="campo-texto hidden" rows="3" placeholder="Escreva sua instrução (marque PL para usar)"></textarea>
      </details>
    </div>
    <div class="tela-grid">
      <div class="tela-col"><div class="pconv-lbl">Original</div><div class="tela-texto" id="docOriginal">${escapar(textoDocumentoCompleto())}</div></div>
      <div class="tela-col"><div class="pconv-lbl">Linguagem simples</div><div class="tela-texto" id="docConvertido"><span class="muted">Clique em “Converter documento” para gerar a versão em linguagem simples do documento inteiro.</span></div></div>
    </div>`;
  document.body.appendChild(ov);
  const fechar = () => {
    if (conversaoDocEmAndamento && !confirm('A conversão está em andamento. Fechar mesmo assim?')) return;
    conversaoDocEmAndamento = false; ov.remove();
  };
  ov.__orientacoes = orient; // sugestões macro para orientar a reescrita
  const docLivre = ov.querySelector('#docLivre');
  const resumoTec = ov.querySelector('#docTecResumo');
  const atualizarTec = () => {
    const cods = tecnicasLote(ov);
    if (docLivre) docLivre.classList.toggle('hidden', !cods.includes('PL'));
    if (resumoTec) resumoTec.textContent = cods.length ? '· ' + cods.join(' + ') : '· escolha ao menos uma';
  };
  ov.querySelectorAll('input[name=doctec]').forEach((c) => c.addEventListener('change', atualizarTec));
  atualizarTec();
  const bConstr = ov.querySelector('#docConstrutor');
  if (bConstr) bConstr.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    abrirConstrutor({
      rotuloUsar: 'Usar nesta conversão',
      aoUsar: (instr) => {
        ov.querySelectorAll('input[name=doctec]').forEach((c) => { c.checked = (c.value === 'PL'); });
        if (docLivre) { docLivre.value = instr; docLivre.classList.remove('hidden'); }
        atualizarTec();
        toast('Prompt do construtor aplicado. Clique em “Converter documento”.');
      }
    });
  });
  ov.querySelector('#docFechar').addEventListener('click', fechar);
  ov.querySelector('#docCfg').addEventListener('click', abrirConfigProvedores);
  ov.querySelector('#docVerPrompt').addEventListener('click', () => mostrarPromptAplicado(tecnicasLote(ov)));
  ov.querySelector('#docConverter').addEventListener('click', () => converterDocumentoInteiro(ov));
  ov.querySelector('#docCopiar').addEventListener('click', () => {
    const t = ov.__convertido || '';
    if (t && navigator.clipboard) navigator.clipboard.writeText(t);
    toast('Texto copiado.');
  });
  ov.querySelector('#docAplicar').addEventListener('click', () => {
    const t = ov.__convertido || '';
    if (!t.trim()) return;
    if (!confirm('Isto substitui o texto do editor pela versão em linguagem simples. Continuar?')) return;
    snapshotUndo();
    carregarTexto(t, 'convertido', estado.documento.nomeArquivo || '');
    ov.remove();
    toast('Documento convertido aplicado ao editor.');
    // A classificação de clareza precisa acompanhar o texto novo. Se a avaliação
    // automática estiver ligada, carregarTexto já a dispara; se estiver desligada
    // mas houver IA conectada, forçamos aqui (o usuário acabou de usar a IA).
    if (iaConectada() && !ajustes.autoAvaliar) avaliarClareza({ auto: true });
  });
}

// Técnicas marcadas na tela de conversão do documento inteiro.
function tecnicasLote(ov) {
  return [...ov.querySelectorAll('input[name=doctec]:checked')].map((c) => c.value);
}

async function converterDocumentoInteiro(ov) {
  const cfg = prov.configAtual();
  const provDef = prov.PROVEDORES[cfg.provedor];
  if (provDef.requerChave && !cfg.chave) { toast('Configure a chave em Provedores de IA.'); abrirConfigProvedores(); return; }

  const codigos = tecnicasLote(ov);
  if (!codigos.length) { toast('Escolha ao menos uma técnica de conversão.'); return; }
  const instrucaoLivre = (ov.querySelector('#docLivre') || {}).value || '';

  const btn = ov.querySelector('#docConverter');
  const prog = ov.querySelector('#docProgresso');
  const alvo = ov.querySelector('#docConvertido');
  btn.disabled = true; btn.textContent = 'Convertendo…';
  prog.textContent = 'enviando o documento…';
  conversaoDocEmAndamento = true;
  alvo.textContent = '';
  try {
    const res = await converterDocumento(textoDocumentoCompleto(), {
      promptCodigo: codigos, instrucaoLivre,
      orientacoes: ov.__orientacoes, publicos: publicosRotulos(), onTrocaModelo: aoTrocarModelo,
      onProgress: (feito, total) => { prog.textContent = `convertendo… ${feito}/${total} blocos`; },
      onStream: (t) => { alvo.textContent = t; alvo.scrollTop = alvo.scrollHeight; }
    });
    ov.__convertido = res.texto;
    alvo.textContent = res.texto;
    prog.textContent = 'pronto. Revise e aplique.';
    ov.querySelector('#docAplicar').disabled = false;
    ov.querySelector('#docCopiar').disabled = false;
  } catch (e) {
    alvo.innerHTML = htmlErroIA(e); ligarTrocaIA(alvo);
    prog.textContent = '';
  } finally {
    conversaoDocEmAndamento = false;
    btn.disabled = false; btn.textContent = 'Converter de novo';
  }
}

function abrirPainel() {
  if (!estado.documento.paragrafos.length) { toast('Carregue um documento primeiro.'); return; }
  abrirModal('Retrato do documento', painelHtml(estado.documento.paragrafos), []);
}

async function exportar() {
  if (!estado.documento.paragrafos.length) { toast('Carregue um documento primeiro.'); return; }
  try {
    await exportarDocx(estado.documento, estado.documento.nomeArquivo);
    toast('DOCX exportado.');
  } catch (e) {
    console.error(e);
    toast('Erro ao exportar: ' + (e.message || 'desconhecido'));
  }
}

function abrirRegistro() {
  const n = registro.todos().length;
  abrirModal('Registro de revisão', `
    <p>${n} ação(ões) registrada(s) nesta sessão.</p>
    <p class="muted">Trilha das conversões (faixa antes/depois, alertas e decisão). É a evidência da transformação e da validação técnica das reescritas.</p>`,
    [
      { rotulo: 'Baixar CSV', classe: '', acao: () => registro.baixarCSV() },
      { rotulo: 'Baixar JSON', classe: 'primary', acao: () => registro.baixarJSON() }
    ]);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function mostrarAviso(titulo, texto) {
  abrirModal(titulo, `<div class="aviso">${escapar(texto)}</div>`, [{ rotulo: 'Entendi', classe: 'primary', acao: fecharModal }]);
}

// Avisa quando o LUCAS trocou de modelo sozinho porque o escolhido estava
// indisponível. Sem drama: o trabalho continua com o que respondeu.
function aoTrocarModelo(modelo) {
  toast(`O modelo escolhido estava indisponível agora. Passei a usar “${modelo}”, que respondeu.`);
}

// Traduz um erro da IA numa mensagem amistosa. Sinaliza `sobrecarga` para que a
// UI ofereça o atalho de trocar de provedor.
function mensagemErroIA(e) {
  const msg = String((e && e.message) || e || '');
  const rot = (prov.PROVEDORES[prov.getProvedorAtual()] || {}).rotulo || 'a IA escolhida';
  if (/sobrecarregad|instável|high demand|overloaded|unavailable|\b503\b|\b529\b|\b502\b|\b500\b|try again later/i.test(msg)) {
    return { sobrecarga: true, texto: `${rot} está com muita demanda agora e não respondeu. Isso costuma ser passageiro: tente de novo em instantes ou troque de provedor de IA.` };
  }
  if (/limite de uso|429|quota|rate/i.test(msg)) {
    return { sobrecarga: true, texto: `Você atingiu o limite de uso da chave de ${rot}. Aguarde alguns minutos, verifique a cota do seu provedor ou troque de IA.` };
  }
  if (/chave rejeitada|401|403/i.test(msg)) {
    return { sobrecarga: false, texto: `A chave de ${rot} foi rejeitada. Confira a chave em Provedores de IA.` };
  }
  if (/max_tokens|context_window|invalid_request/i.test(msg)) {
    return { sobrecarga: true, texto: `O modelo de ${rot} recusou o tamanho do pedido. Tente um trecho menor, ou troque de modelo/provedor de IA.` };
  }
  return { sobrecarga: false, texto: msg };
}

// HTML de um box de erro de IA amistoso, com botão para trocar de provedor.
function htmlErroIA(e) {
  const info = mensagemErroIA(e);
  const btn = '<div style="margin-top:8px"><button class="btn sm" data-a="trocar-ia">Trocar de provedor de IA</button></div>';
  return `<div class="errbox"><b>Não foi possível concluir com a IA.</b><div style="margin-top:4px">${escapar(info.texto)}</div>${btn}</div>`;
}

// Liga o botão "Trocar de provedor de IA" dentro de um container recém-renderizado.
function ligarTrocaIA(container) {
  const b = container && container.querySelector('[data-a=trocar-ia]');
  if (b) b.addEventListener('click', abrirConfigProvedores);
}

// Modal de aviso para erros de IA, com atalho para trocar de provedor quando o
// problema for de sobrecarga/limite (e não algo do próprio texto).
function mostrarAvisoIA(titulo, e) {
  const info = mensagemErroIA(e);
  const botoes = [{ rotulo: 'Entendi', classe: '', acao: fecharModal }];
  if (info.sobrecarga) botoes.push({ rotulo: 'Trocar de provedor de IA', classe: 'primary', acao: () => { fecharModal(); abrirConfigProvedores(); } });
  abrirModal(titulo, `<div class="aviso">${escapar(info.texto)}</div>`, botoes);
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  elToasts.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

function escapar(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Conta e nuvem (Supabase): login por e-mail/senha (só @tce.sp.gov.br),
// arquivamento e reabertura de documentos. Sem login, o app funciona igual.
// ---------------------------------------------------------------------------
let usuarioLogado = null;

async function iniciarAuth() {
  atualizarConta();
  try {
    const s = await nuvem.sessaoAtual();
    if (s && s.user) { usuarioLogado = s.user; atualizarConta(); sincronizarPromptsDaNuvem(); }
  } catch (e) { /* nuvem indisponível/não configurada: segue sem login */ }
}

function atualizarConta() {
  const el = $('#btnConta'); if (!el) return;
  el.textContent = usuarioLogado ? usuarioLogado.email.split('@')[0] : 'Entrar';
  el.title = usuarioLogado ? (usuarioLogado.email + ' · sua conta') : 'Entrar ou criar conta';
}

function abrirConta() { if (usuarioLogado) abrirMenuConta(); else abrirLogin('entrar'); }

function abrirLogin(modo) {
  fecharModal();
  let modoAtual = modo || 'entrar';
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'modalOverlay';
  ov.innerHTML = `
    <div class="modal" style="max-width:440px">
      <div class="modal-h"><div class="t">Acesso ao LUCAS</div><button class="btn ghost sm fechar">✕</button></div>
      <div class="modal-b">
        <div class="conta-tabs">
          <button class="conta-tab ${modoAtual === 'entrar' ? 'on' : ''}" data-m="entrar">Entrar</button>
          <button class="conta-tab ${modoAtual === 'criar' ? 'on' : ''}" data-m="criar">Criar conta</button>
        </div>
        <div id="contaNome" class="field ${modoAtual === 'criar' ? '' : 'hidden'}"><label>Seu nome</label><input id="contaNomeInp" type="text" placeholder="Nome completo" autocomplete="name"></div>
        <div class="field"><label>E-mail institucional</label><input id="contaEmail" type="email" placeholder="nome@tce.sp.gov.br" autocomplete="email"></div>
        <div class="field"><label>Senha</label><input id="contaSenha" type="password" placeholder="mínimo de 6 caracteres" autocomplete="current-password"></div>
        <div id="contaMsg" class="muted" style="min-height:18px;margin:2px 0 10px"></div>
        <button class="btn primary" id="contaEnviar" style="width:100%">${modoAtual === 'criar' ? 'Criar conta' : 'Entrar'}</button>
        <p class="muted" style="font-size:12px;margin-top:10px">Acesso restrito a e-mails <b>@tce.sp.gov.br</b>. Sem conta, o app funciona igual; o login serve para arquivar seus documentos na nuvem.</p>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('.fechar').addEventListener('click', fecharModal);
  ov.addEventListener('click', (e) => { if (e.target === ov) fecharModal(); });
  ov.querySelectorAll('.conta-tab').forEach((t) => t.addEventListener('click', () => {
    modoAtual = t.dataset.m;
    ov.querySelectorAll('.conta-tab').forEach((x) => x.classList.toggle('on', x.dataset.m === modoAtual));
    ov.querySelector('#contaNome').classList.toggle('hidden', modoAtual !== 'criar');
    ov.querySelector('#contaEnviar').textContent = modoAtual === 'criar' ? 'Criar conta' : 'Entrar';
  }));
  const enviar = async () => {
    const email = ov.querySelector('#contaEmail').value.trim();
    const senha = ov.querySelector('#contaSenha').value;
    const nome = ov.querySelector('#contaNomeInp').value.trim();
    const msg = ov.querySelector('#contaMsg');
    const btn = ov.querySelector('#contaEnviar');
    msg.style.color = ''; msg.textContent = '';
    if (!email || !senha) { msg.textContent = 'Preencha e-mail e senha.'; return; }
    if (modoAtual === 'criar' && !nome) { msg.textContent = 'Informe seu nome.'; return; }
    btn.disabled = true; const rot = btn.textContent; btn.textContent = 'Aguarde…';
    try {
      if (modoAtual === 'criar') await nuvem.cadastrarEmailSenha(email, senha, nome);
      else await nuvem.loginEmailSenha(email, senha);
      const u = await nuvem.usuarioAtual();
      if (u) { usuarioLogado = u; atualizarConta(); sincronizarPromptsDaNuvem(); fecharModal(); toast('Bem-vindo, ' + u.email.split('@')[0] + '.'); }
      else { msg.style.color = 'var(--good)'; msg.textContent = 'Conta criada. Agora entre com e-mail e senha.'; }
    } catch (e) {
      msg.style.color = 'var(--danger)'; msg.textContent = String((e && e.message) || e);
    } finally {
      btn.disabled = false; btn.textContent = rot;
    }
  };
  ov.querySelector('#contaEnviar').addEventListener('click', enviar);
  ov.querySelector('#contaSenha').addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });
  setTimeout(() => { const i = ov.querySelector('#contaEmail'); if (i) i.focus(); }, 0);
}

function abrirMenuConta() {
  fecharModal();
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'modalOverlay';
  ov.innerHTML = `
    <div class="modal" style="max-width:560px">
      <div class="modal-h"><div class="t">Sua conta</div><button class="btn ghost sm fechar">✕</button></div>
      <div class="modal-b">
        <div class="muted" style="margin-bottom:12px">Conectado como <b>${escapar(usuarioLogado.email)}</b></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn sm primary" id="contaArquivar">Arquivar este documento</button>
          <button class="btn sm" id="contaMeus">Meus documentos</button>
          <button class="btn sm ghost" id="contaSair">Sair</button>
        </div>
        <div id="contaLista" style="margin-top:16px"></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('.fechar').addEventListener('click', fecharModal);
  ov.addEventListener('click', (e) => { if (e.target === ov) fecharModal(); });
  ov.querySelector('#contaArquivar').addEventListener('click', () => arquivarAtual(ov));
  ov.querySelector('#contaMeus').addEventListener('click', () => listarMeus(ov));
  ov.querySelector('#contaSair').addEventListener('click', async () => {
    try { await nuvem.sair(); } catch (e) {}
    usuarioLogado = null; atualizarConta(); fecharModal(); toast('Você saiu.');
  });
}

async function arquivarAtual(ov) {
  if (!estado.documento.paragrafos.length) { toast('Carregue um documento primeiro.'); return; }
  const lista = ov.querySelector('#contaLista');
  lista.innerHTML = '<div class="muted">Arquivando…</div>';
  try {
    const titulo = estado.documento.nomeArquivo || ('documento ' + new Date().toLocaleDateString('pt-BR'));
    const metricas = metricasDocumento(estado.documento.paragrafos);
    const salvo = await nuvem.arquivarDocumento({ titulo, origem: estado.documento.origem || 'digitado', estado: estadoParaSalvar(), metricas });
    if (salvo && salvo.id) estado.documento.idNuvem = salvo.id; // vincula a trilha de revisão
    lista.innerHTML = '<div class="rdc"><span class="ok">✓</span><div class="t">Documento arquivado na nuvem.</div></div>';
  } catch (e) {
    lista.innerHTML = `<div class="errbox">${escapar(String((e && e.message) || e))}</div>`;
  }
}

async function listarMeus(ov) {
  const lista = ov.querySelector('#contaLista');
  lista.innerHTML = '<div class="muted">Carregando…</div>';
  try {
    const docs = await nuvem.listarMeusDocumentos();
    if (!docs.length) { lista.innerHTML = '<div class="muted">Nenhum documento arquivado ainda.</div>'; return; }
    lista.innerHTML = docs.map((d) => `<div class="mine" data-id="${d.id}"><div class="mine-main"><div class="mine-t">${escapar(d.titulo)}</div><div class="mine-sub">${escapar(d.origem || '')} · ${new Date(d.atualizado_em || d.criado_em).toLocaleString('pt-BR')}</div></div><button class="btn sm" data-a="abrir">Abrir</button></div>`).join('');
    lista.querySelectorAll('.mine').forEach((el) => {
      el.querySelector('[data-a=abrir]').addEventListener('click', async () => {
        try {
          const doc = await nuvem.abrirDocumento(el.dataset.id);
          if (doc && doc.estado) {
            const est = doc.estado; est.idNuvem = doc.id; // vincula para a trilha de revisão
            restaurarDoc(est); fecharModal(); toast('Documento aberto.');
          }
        } catch (e) { toast('Erro ao abrir: ' + ((e && e.message) || '')); }
      });
    });
  } catch (e) {
    lista.innerHTML = `<div class="errbox">${escapar(String((e && e.message) || e))}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Prompts próprios do usuário (nomeados, reutilizáveis). Salvos no navegador e,
// quando logado, no Supabase. Aparecem junto das técnicas P1..P6 na conversão.
// ---------------------------------------------------------------------------
let PROMPTS_USUARIO = [];

function carregarPromptsUsuario() {
  try { PROMPTS_USUARIO = JSON.parse(localStorage.getItem('lucas.prompts.usuario') || '[]') || []; }
  catch (e) { PROMPTS_USUARIO = []; }
  sincronizarPromptsNaLista();
}

function gravarPromptsUsuarioLocal() {
  try {
    localStorage.setItem('lucas.prompts.usuario', JSON.stringify(
      PROMPTS_USUARIO.map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, instrucao: p.instrucao, nuvemId: p.nuvemId || null }))
    ));
  } catch (e) {}
}

// Reflete PROMPTS_USUARIO na lista PROMPTS (usada pelo seletor e por montar()).
function sincronizarPromptsNaLista() {
  for (let i = PROMPTS.length - 1; i >= 0; i--) if (PROMPTS[i].usuario) PROMPTS.splice(i, 1);
  PROMPTS_USUARIO.forEach((p, i) => {
    PROMPTS.push({ codigo: 'U' + (i + 1), nome: p.nome, descricao: p.descricao || 'Prompt próprio.', instrucao: p.instrucao, usuario: true });
  });
}

async function salvarMeuPrompt(p) {
  if (!p.id) p.id = 'u' + Date.now() + Math.floor(Math.random() * 1e4);
  const idx = PROMPTS_USUARIO.findIndex((x) => x.id === p.id);
  if (idx >= 0) PROMPTS_USUARIO[idx] = Object.assign(PROMPTS_USUARIO[idx], p);
  else PROMPTS_USUARIO.push(p);
  gravarPromptsUsuarioLocal();
  sincronizarPromptsNaLista();
  if (usuarioLogado) {
    try {
      const salvo = await nuvem.salvarPromptNuvem(p);
      if (salvo && salvo.id) { const it = PROMPTS_USUARIO.find((x) => x.id === p.id); if (it) { it.nuvemId = salvo.id; gravarPromptsUsuarioLocal(); } }
    } catch (e) { toast('Salvo no navegador; nuvem falhou: ' + ((e && e.message) || '')); }
  }
}

async function excluirMeuPrompt(id) {
  const it = PROMPTS_USUARIO.find((x) => x.id === id);
  PROMPTS_USUARIO = PROMPTS_USUARIO.filter((x) => x.id !== id);
  gravarPromptsUsuarioLocal();
  sincronizarPromptsNaLista();
  if (usuarioLogado && it && it.nuvemId) { try { await nuvem.excluirPromptNuvem(it.nuvemId); } catch (e) {} }
}

// Puxa os prompts do usuário da nuvem após o login e mescla (por nuvemId).
async function sincronizarPromptsDaNuvem() {
  if (!usuarioLogado) return;
  try {
    const remotos = await nuvem.listarMeusPrompts();
    for (const r of remotos) {
      if (!PROMPTS_USUARIO.some((p) => p.nuvemId === r.id)) {
        PROMPTS_USUARIO.push({ id: 'u' + r.id, nome: r.nome, descricao: r.descricao, instrucao: r.instrucao, nuvemId: r.id });
      }
    }
    gravarPromptsUsuarioLocal();
    sincronizarPromptsNaLista();
  } catch (e) { /* segue só com os locais */ }
}

// ---------------------------------------------------------------------------
// Construtor guiado de prompt (enxuto). Dados e montagem vêm de construtor.js
// (fonte única, compartilhada com a Biblioteca de prompts). Aqui fica só o modal.
// ---------------------------------------------------------------------------
// Modal do construtor. opts.aoUsar(instrucao): callback opcional para usar a
// instrução na hora (ex.: na conversão do documento). Sempre permite salvar.
function abrirConstrutor(opts = {}) {
  fecharModal();
  const ini = { objetivo: ['completa'], tom: 'neutro', formato: 'corrido', publicos: [...ajustes.publicos] };
  const gCheck = (name, itens, sel) => itens.map((o) => `<label class="doctec-op"><input type="checkbox" name="${name}" value="${o.id}" ${sel.includes(o.id) ? 'checked' : ''}><span>${escapar(o.txt)}</span></label>`).join('');
  const gRadio = (name, itens, val) => itens.map((o) => `<label class="doctec-op"><input type="radio" name="${name}" value="${o.id}" ${val === o.id ? 'checked' : ''}><span>${escapar(o.txt)}</span></label>`).join('');
  const pubItens = PUBLICOS.map((p) => ({ id: p.id, txt: p.curto }));
  const presetsHtml = CONSTRUTOR_PRESETS.map((p) => `<button type="button" class="btn xs" data-preset="${p.id}">${escapar(p.nome)}</button>`).join('');
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'modalOverlay';
  ov.innerHTML = `
    <div class="modal" style="max-width:720px">
      <div class="modal-h"><div class="t">Construtor guiado de prompt</div><button class="btn ghost sm fechar">✕</button></div>
      <div class="modal-b">
        <div class="muted" style="font-size:12.5px;margin-bottom:10px">Monte uma instrução de conversão escolhendo as opções abaixo. Comece por um preset e ajuste, ou monte do zero. A instrução pode ser usada agora e/ou salva em “Meus prompts”.</div>
        <div class="label">Presets</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 14px">${presetsHtml}</div>
        <div class="label">Objetivo (pode combinar)</div>
        <div class="doctec-ops" style="margin:6px 0 14px">${gCheck('cObj', CONSTRUTOR_OBJETIVO, ini.objetivo)}</div>
        <div class="label">Tom</div>
        <div class="doctec-ops" style="margin:6px 0 14px">${gRadio('cTom', CONSTRUTOR_TOM, ini.tom)}</div>
        <div class="label">Formato de saída</div>
        <div class="doctec-ops" style="margin:6px 0 14px">${gRadio('cFmt', CONSTRUTOR_FORMATO, ini.formato)}</div>
        <div class="label">Público-alvo</div>
        <div class="doctec-ops" style="margin:6px 0 14px">${gCheck('cPub', pubItens, ini.publicos)}</div>
        <div class="label">Instrução montada</div>
        <textarea id="cPreview" class="campo-texto" rows="4" style="width:100%" readonly></textarea>
        <div class="field" style="margin-top:12px"><label>Salvar como (nome)</label><input id="cNome" type="text" placeholder="ex.: Para o cidadão — voto de contas" maxlength="80"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          ${opts.aoUsar ? `<button class="btn sm primary" id="cUsar">${escapar(opts.rotuloUsar || 'Usar agora')}</button>` : ''}
          <button class="btn sm ${opts.aoUsar ? '' : 'primary'}" id="cSalvar">Salvar em Meus prompts</button>
          <button class="btn sm ghost fechar2">Cancelar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const lerSel = () => ({
    objetivo: [...ov.querySelectorAll('input[name=cObj]:checked')].map((c) => c.value),
    tom: (ov.querySelector('input[name=cTom]:checked') || {}).value || '',
    formato: (ov.querySelector('input[name=cFmt]:checked') || {}).value || '',
    publicos: [...ov.querySelectorAll('input[name=cPub]:checked')].map((c) => c.value)
  });
  const preview = ov.querySelector('#cPreview');
  const atualizar = () => { preview.value = montarInstrucaoConstrutor(lerSel()); };
  ov.querySelectorAll('input[name^=c]').forEach((i) => i.addEventListener('change', atualizar));
  atualizar();
  ov.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const pr = CONSTRUTOR_PRESETS.find((x) => x.id === b.dataset.preset); if (!pr) return;
    ov.querySelectorAll('input[name=cObj]').forEach((c) => { c.checked = pr.objetivo.includes(c.value); });
    ov.querySelectorAll('input[name=cTom]').forEach((c) => { c.checked = (c.value === pr.tom); });
    ov.querySelectorAll('input[name=cFmt]').forEach((c) => { c.checked = (c.value === pr.formato); });
    ov.querySelectorAll('input[name=cPub]').forEach((c) => { c.checked = pr.publicos.includes(c.value); });
    const nomeInp = ov.querySelector('#cNome'); if (!nomeInp.value.trim()) nomeInp.value = pr.nome;
    atualizar();
  }));
  const fechar = () => fecharModal();
  ov.querySelector('.fechar').addEventListener('click', fechar);
  ov.querySelector('.fechar2').addEventListener('click', fechar);
  ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
  if (opts.aoUsar) {
    ov.querySelector('#cUsar').addEventListener('click', () => {
      const instr = preview.value.trim();
      if (!instr) { toast('Escolha ao menos uma opção.'); return; }
      opts.aoUsar(instr); fecharModal();
    });
  }
  ov.querySelector('#cSalvar').addEventListener('click', async () => {
    const instr = preview.value.trim();
    const nome = ov.querySelector('#cNome').value.trim();
    if (!instr) { toast('Escolha ao menos uma opção.'); return; }
    if (!nome) { toast('Dê um nome para salvar.'); return; }
    await salvarMeuPrompt({ nome, descricao: 'Prompt do construtor guiado.', instrucao: instr });
    toast('Prompt salvo em Meus prompts.');
    if (opts.aoSalvar) opts.aoSalvar(); else fecharModal();
  });
}

function abrirMeusPrompts() {
  fecharModal();
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'modalOverlay';
  ov.innerHTML = `
    <div class="modal" style="max-width:640px">
      <div class="modal-h"><div class="t">Meus prompts</div><button class="btn ghost sm fechar">✕</button></div>
      <div class="modal-b">
        <p class="muted" style="margin-bottom:12px">Crie técnicas próprias de reescrita. Você pode começar do zero, usar o construtor guiado ou <b>partir de um prompt da plataforma</b> e fazer a sua versão. Sua edição vira um prompt novo e <b>nunca sobrescreve o original</b>. Aparecem junto de P1..P6 na conversão; ficam no navegador e, com login, na nuvem.</p>
        <div id="mpLista"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
          <button class="btn sm" id="mpConstrutor">✨ Montar com o construtor guiado</button>
        </div>
        <div class="field"><label>Partir de um prompt da plataforma (opcional)</label>
          <select id="mpBase" class="field-select"><option value="">— começar do zero —</option>${PROMPTS.filter((p) => !p.usuario && p.codigo && p.codigo !== 'P7').map((p) => `<option value="${escapar(p.codigo)}">${escapar(p.codigo)} · ${escapar(p.nome)}</option>`).join('')}</select>
        </div>
        <div class="field" style="margin-top:8px"><label>Nome</label><input id="mpNome" type="text" placeholder="ex.: Tom mais direto ao cidadão" maxlength="80"></div>
        <div class="field"><label>Instrução</label><textarea id="mpInstr" class="campo-texto" rows="4" placeholder="O que a IA deve fazer com o parágrafo…"></textarea></div>
        <input type="hidden" id="mpEditId">
        <div style="display:flex;gap:8px"><button class="btn sm primary" id="mpSalvar">Salvar prompt</button><button class="btn sm ghost" id="mpLimpar">Limpar campos</button></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('.fechar').addEventListener('click', fecharModal);
  ov.addEventListener('click', (e) => { if (e.target === ov) fecharModal(); });
  const renderLista = () => {
    const el = ov.querySelector('#mpLista');
    if (!PROMPTS_USUARIO.length) { el.innerHTML = '<div class="muted" style="margin-bottom:10px">Nenhum prompt próprio ainda.</div>'; return; }
    el.innerHTML = PROMPTS_USUARIO.map((p) => `<div class="mine" data-id="${p.id}"><div class="mine-main"><div class="mine-t">${escapar(p.nome)}</div><div class="mine-sub">${escapar((p.instrucao || '').slice(0, 90))}${(p.instrucao || '').length > 90 ? '…' : ''}</div></div><button class="btn sm" data-a="editar">Editar</button><button class="btn sm ghost" data-a="excluir">Excluir</button></div>`).join('');
    el.querySelectorAll('.mine').forEach((row) => {
      const id = row.dataset.id;
      row.querySelector('[data-a=editar]').addEventListener('click', () => {
        const p = PROMPTS_USUARIO.find((x) => x.id === id); if (!p) return;
        ov.querySelector('#mpNome').value = p.nome; ov.querySelector('#mpInstr').value = p.instrucao; ov.querySelector('#mpEditId').value = p.id;
      });
      row.querySelector('[data-a=excluir]').addEventListener('click', async () => { await excluirMeuPrompt(id); renderLista(); toast('Prompt excluído.'); });
    });
  };
  renderLista();
  // "Partir de um prompt da plataforma": copia nome+instrução do oficial para os
  // campos, como um NOVO prompt (sem id) — não sobrescreve o original.
  ov.querySelector('#mpBase').addEventListener('change', (e) => {
    const cod = e.target.value; if (!cod) return;
    const base = porCodigo(cod) || PROMPTS.find((x) => x.codigo === cod);
    if (!base) return;
    ov.querySelector('#mpNome').value = base.nome + ' (minha versão)';
    ov.querySelector('#mpInstr').value = base.instrucao || '';
    ov.querySelector('#mpEditId').value = ''; // garante novo prompt
    toast('Editando uma cópia de ' + cod + '. O original continua intacto.');
  });
  ov.querySelector('#mpConstrutor').addEventListener('click', () => abrirConstrutor({ aoSalvar: () => abrirMeusPrompts() }));
  ov.querySelector('#mpSalvar').addEventListener('click', async () => {
    const nome = ov.querySelector('#mpNome').value.trim();
    const instrucao = ov.querySelector('#mpInstr').value.trim();
    const id = ov.querySelector('#mpEditId').value || undefined;
    if (!nome || !instrucao) { toast('Preencha nome e instrução.'); return; }
    await salvarMeuPrompt({ id, nome, descricao: 'Prompt próprio.', instrucao });
    ov.querySelector('#mpNome').value = ''; ov.querySelector('#mpInstr').value = ''; ov.querySelector('#mpEditId').value = '';
    renderLista(); toast('Prompt salvo.');
  });
  ov.querySelector('#mpLimpar').addEventListener('click', () => {
    ov.querySelector('#mpNome').value = ''; ov.querySelector('#mpInstr').value = ''; ov.querySelector('#mpEditId').value = '';
  });
}

// ---------------------------------------------------------------------------
// Texto de demonstração
// ---------------------------------------------------------------------------
function carregarDemo() {
  const demo = [
    'Trata-se de processo de prestação de contas anual do exercício de 2024, autuado sob o nº TC-013176.989.26-7, no qual se examina a regularidade dos atos de gestão praticados pelo responsável, à luz da Lei nº 14.133/2021 e das normas de regência aplicáveis à espécie.',
    'Outrossim, cumpre destacar que a instrução processual, consubstanciada no relatório da DIPE, apontou a existência de falhas formais que, inobstante não configurarem dano ao erário, demandam a expedição de recomendações ao gestor, com vistas ao aprimoramento dos controles internos e à observância dos princípios que regem a Administração Pública, notadamente a legalidade, a impessoalidade, a moralidade, a publicidade e a eficiência.',
    'A aprovação da demonstração de receitas e despesas, hodiernamente exigida pela legislação, foi realizada.',
    'Ante o exposto, e considerando que as impropriedades detectadas não comprometem a escorreita aplicação dos recursos públicos, voto pela regularidade com ressalvas das contas em exame.'
  ].join('\n\n');
  carregarTexto(demo, 'digitado', 'exemplo-voto.txt');
}

iniciar();
