// biblioteca.js — Biblioteca de prompts do LUCAS (tópico à parte, seção 7 / D5).
// Três áreas: Oficiais (P1..P6, leitura), Meus prompts (privados, navegador +
// nuvem) e Comunidade (compartilhados por outros usuários). Integra com o editor
// pela mesma chave de localStorage: prompt salvo aqui vira técnica lá.

import { PROMPTS } from './prompts.js';
import * as nuvem from './nuvem.js';
import { CONSTRUTOR_OBJETIVO, CONSTRUTOR_TOM, CONSTRUTOR_FORMATO, CONSTRUTOR_PRESETS, PUBLICOS, montarInstrucaoConstrutor } from './construtor.js';

const $ = (s) => document.querySelector(s);
const CHAVE = 'lucas.prompts.usuario'; // mesma chave usada pelo editor
let usuario = null;
let aba = 'oficiais';
let publicosCache = null;

function escapar(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

// ------- armazenamento local (compartilhado com o editor) -------
function lerLocais() {
  try { return JSON.parse(localStorage.getItem(CHAVE) || '[]') || []; } catch (e) { return []; }
}
function gravarLocais(arr) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(arr.map((p) => ({
      id: p.id, nome: p.nome, descricao: p.descricao, instrucao: p.instrucao,
      nuvemId: p.nuvemId || null, compartilhado: !!p.compartilhado
    }))));
  } catch (e) { /* ignora */ }
}

async function salvarMeu(p) {
  const arr = lerLocais();
  if (!p.id) p.id = 'u' + Date.now() + Math.floor(Math.random() * 1e4);
  const idx = arr.findIndex((x) => x.id === p.id);
  if (idx >= 0) arr[idx] = Object.assign(arr[idx], p); else arr.push(p);
  gravarLocais(arr);
  if (usuario) {
    try {
      const salvo = await nuvem.salvarPromptNuvem(p);
      if (salvo && salvo.id) {
        const a = lerLocais(); const it = a.find((x) => x.id === p.id);
        if (it) { it.nuvemId = salvo.id; it.compartilhado = !!salvo.compartilhado; gravarLocais(a); }
      }
    } catch (e) { toast('Salvo no navegador; a nuvem falhou.'); }
  }
  return p.id;
}

async function excluirMeu(id) {
  const arr = lerLocais(); const it = arr.find((x) => x.id === id);
  gravarLocais(arr.filter((x) => x.id !== id));
  if (usuario && it && it.nuvemId) { try { await nuvem.excluirPromptNuvem(it.nuvemId); } catch (e) { /* ignora */ } }
}

// Puxa os prompts da nuvem e mescla nos locais (por nuvemId); atualiza o estado
// de compartilhamento dos que já existem.
async function sincronizar() {
  if (!usuario) return;
  try {
    const remotos = await nuvem.listarMeusPrompts();
    const arr = lerLocais();
    for (const r of remotos) {
      const ex = arr.find((p) => p.nuvemId === r.id);
      if (ex) { ex.compartilhado = !!r.compartilhado; ex.nome = r.nome; ex.instrucao = r.instrucao; }
      else arr.push({ id: 'u' + r.id, nome: r.nome, descricao: r.descricao, instrucao: r.instrucao, nuvemId: r.id, compartilhado: !!r.compartilhado });
    }
    gravarLocais(arr);
  } catch (e) { /* segue com os locais */ }
}

async function alternarCompartilhar(p) {
  if (!usuario) { toast('Entre para compartilhar.'); return; }
  const arr = lerLocais(); const it = arr.find((x) => x.id === p.id);
  if (!it) return;
  try {
    if (!it.nuvemId) { // ainda não está na nuvem: sobe primeiro
      const salvo = await nuvem.salvarPromptNuvem({ nome: it.nome, descricao: it.descricao, instrucao: it.instrucao, compartilhado: true });
      it.nuvemId = salvo.id; it.compartilhado = true;
    } else {
      await nuvem.definirCompartilhamentoPrompt(it.nuvemId, !it.compartilhado);
      it.compartilhado = !it.compartilhado;
    }
    gravarLocais(arr);
    toast(it.compartilhado ? 'Prompt compartilhado com a comunidade.' : 'Compartilhamento desativado.');
    render();
  } catch (e) { toast('Não consegui alterar: ' + ((e && e.message) || e)); }
}

function enviarAoEditor(p) {
  // garante que está em "Meus" (localStorage) e abre o editor
  const arr = lerLocais();
  if (!arr.some((x) => x.instrucao === p.instrucao && x.nome === p.nome)) {
    salvarMeu({ nome: p.nome, descricao: p.descricao || 'Prompt da biblioteca.', instrucao: p.instrucao });
  }
  toast('Enviado para o editor. Abrindo…');
  setTimeout(() => { window.location.href = 'editor.html'; }, 500);
}

// ------- render -------
function oficiais() {
  return PROMPTS.filter((p) => p.codigo && p.codigo !== 'P7' && !p.usuario)
    .map((p) => ({ codigo: p.codigo, nome: p.nome, descricao: p.descricao, instrucao: p.instrucao }));
}

function cardHtml(p, tipo) {
  const tags = [];
  if (tipo === 'oficial') tags.push('<span class="tag of">Oficial ' + escapar(p.codigo) + '</span>');
  if (tipo === 'meu' && p.compartilhado) tags.push('<span class="tag pub">Pública</span>');
  if (tipo === 'comunidade' && p.meu) tags.push('<span class="tag pub">Seu (público)</span>');
  return `
    <div class="card" data-id="${escapar(p.id || p.codigo || '')}">
      <div class="card-h"><span class="card-nome">${escapar(p.nome)}</span>${tags.join('')}</div>
      ${p.descricao ? `<div class="card-desc">${escapar(p.descricao)}</div>` : ''}
      <div class="card-instr">${escapar(p.instrucao)}</div>
      <div class="card-acoes">${acoesHtml(tipo, p)}</div>
    </div>`;
}

function acoesHtml(tipo, p) {
  if (tipo === 'oficial') return [
    '<button class="btn xs primary" data-a="branch">Criar minha versão</button>',
    '<button class="btn xs" data-a="copiar">Copiar instrução</button>'
  ].join('');
  if (tipo === 'meu') return [
    '<button class="btn xs primary" data-a="editor">Enviar para o editor</button>',
    '<button class="btn xs" data-a="editar">Editar</button>',
    `<button class="btn xs" data-a="share">${p.compartilhado ? 'Tornar privada' : 'Compartilhar'}</button>`,
    '<button class="btn xs danger" data-a="excluir">Excluir</button>'
  ].join('');
  // comunidade
  return [
    '<button class="btn xs primary" data-a="editor">Enviar para o editor</button>',
    '<button class="btn xs" data-a="copiar-meus">Copiar para meus</button>',
    '<button class="btn xs" data-a="copiar">Copiar instrução</button>'
  ].join('');
}

function render() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === aba));
  const barra = $('#barra'); const lista = $('#lista');
  barra.innerHTML = '';
  if (aba === 'meus') {
    barra.innerHTML = '<button class="btn sm primary" id="bNovo">Novo prompt</button><button class="btn sm" id="bConstr">✨ Construtor guiado</button>' +
      (usuario ? '' : '<span class="muted" style="font-size:12.5px">Entre para salvar na nuvem e compartilhar.</span>');
  } else if (aba === 'comunidade') {
    barra.innerHTML = '<button class="btn sm" id="bAtualizar">Atualizar</button><span class="muted" style="font-size:12.5px">Prompts que outros usuários do Gabinete tornaram públicos.</span>';
  }

  if (aba === 'oficiais') {
    const arr = oficiais();
    lista.innerHTML = arr.map((p) => cardHtml(p, 'oficial')).join('');
    ligarCards('oficial', arr);
  } else if (aba === 'meus') {
    const arr = lerLocais();
    lista.innerHTML = arr.length ? arr.map((p) => cardHtml(p, 'meu')).join('')
      : '<div class="vazio">Você ainda não tem prompts. Crie um do zero ou use o construtor guiado.</div>';
    ligarCards('meu', arr);
    const bn = $('#bNovo'); if (bn) bn.addEventListener('click', () => abrirForm(null));
    const bc = $('#bConstr'); if (bc) bc.addEventListener('click', () => abrirConstrutor());
  } else {
    // comunidade
    if (!usuario) { lista.innerHTML = '<div class="vazio">Entre com sua conta para ver os prompts compartilhados pela comunidade.</div>'; }
    else {
      lista.innerHTML = '<div class="muted" style="padding:14px">Carregando…</div>';
      carregarComunidade();
    }
    const ba = $('#bAtualizar'); if (ba) ba.addEventListener('click', () => { publicosCache = null; render(); });
  }
}

async function carregarComunidade() {
  try {
    if (!publicosCache) publicosCache = await nuvem.listarPromptsPublicos();
    const meuId = usuario ? usuario.id : null;
    const arr = publicosCache.map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, instrucao: p.instrucao, meu: p.dono === meuId }));
    $('#lista').innerHTML = arr.length ? arr.map((p) => cardHtml(p, 'comunidade')).join('')
      : '<div class="vazio">Ainda não há prompts compartilhados. Seja o primeiro: em “Meus prompts”, clique em Compartilhar.</div>';
    ligarCards('comunidade', arr);
  } catch (e) {
    $('#lista').innerHTML = `<div class="vazio">Não consegui carregar: ${escapar((e && e.message) || e)}</div>`;
  }
}

function ligarCards(tipo, arr) {
  document.querySelectorAll('#lista .card').forEach((card) => {
    const id = card.dataset.id;
    const p = arr.find((x) => String(x.id || x.codigo) === id);
    if (!p) return;
    card.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'copiar') { if (navigator.clipboard) navigator.clipboard.writeText(p.instrucao); toast('Instrução copiada.'); }
      else if (a === 'branch') abrirForm({ nome: p.nome + ' (minha versão)', descricao: 'Versão própria a partir de ' + (p.codigo || 'um prompt oficial') + '.', instrucao: p.instrucao });
      else if (a === 'editor') enviarAoEditor(p);
      else if (a === 'editar') abrirForm(p);
      else if (a === 'excluir') { if (confirm('Excluir este prompt?')) excluirMeu(p.id).then(render); }
      else if (a === 'share') alternarCompartilhar(p);
      else if (a === 'copiar-meus') { salvarMeu({ nome: p.nome + ' (cópia)', descricao: 'Copiado da comunidade.', instrucao: p.instrucao }).then(() => { toast('Copiado para Meus prompts.'); }); }
    }));
  });
}

// ------- formulário de criar/editar -------
function abrirModal(html) {
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.innerHTML = html;
  $('#modalRoot').innerHTML = ''; $('#modalRoot').appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) fecharModal(); });
  ov.querySelectorAll('.fechar').forEach((b) => b.addEventListener('click', fecharModal));
  return ov;
}
function fecharModal() { $('#modalRoot').innerHTML = ''; }

function abrirForm(p) {
  const editando = !!(p && p.id);
  const ov = abrirModal(`
    <div class="modal">
      <div class="modal-h"><div class="t">${editando ? 'Editar prompt' : 'Novo prompt'}</div><button class="btn ghost sm fechar">✕</button></div>
      <div class="modal-b">
        <div class="field"><label>Nome</label><input type="text" id="fNome" maxlength="80" value="${escapar((p && p.nome) || '')}" placeholder="ex.: Tom acolhedor ao cidadão"></div>
        <div class="field"><label>Instrução (o que a IA deve fazer)</label><textarea id="fInstr" class="campo-texto" rows="6" placeholder="Descreva a técnica de reescrita…">${escapar((p && p.instrucao) || '')}</textarea></div>
        <div style="margin:-2px 0 12px"><button class="btn sm" id="fConstr">✨ Montar com o construtor guiado</button></div>
        ${usuario ? `<label class="doctec-op" style="margin-bottom:12px"><input type="checkbox" id="fShare" ${p && p.compartilhado ? 'checked' : ''}><span>Compartilhar com a comunidade do Gabinete</span></label>` : '<div class="muted" style="font-size:12px;margin-bottom:12px">Entre com sua conta para salvar na nuvem e compartilhar.</div>'}
        <div style="display:flex;gap:8px"><button class="btn sm primary" id="fSalvar">Salvar</button><button class="btn sm ghost fechar">Cancelar</button></div>
      </div>
    </div>`);
  ov.querySelector('#fConstr').addEventListener('click', () => abrirConstrutor((instr, nomeSug) => {
    ov.querySelector('#fInstr').value = instr;
    const nomeEl = ov.querySelector('#fNome'); if (!nomeEl.value.trim() && nomeSug) nomeEl.value = nomeSug;
  }));
  ov.querySelector('#fSalvar').addEventListener('click', async () => {
    const nome = ov.querySelector('#fNome').value.trim();
    const instrucao = ov.querySelector('#fInstr').value.trim();
    const share = ov.querySelector('#fShare');
    if (!nome || !instrucao) { toast('Preencha nome e instrução.'); return; }
    await salvarMeu({ id: p && p.id, nome, descricao: (p && p.descricao) || 'Prompt próprio.', instrucao, compartilhado: share ? share.checked : (p && p.compartilhado) });
    fecharModal(); toast('Prompt salvo.'); render();
  });
}

// ------- construtor guiado (usa construtor.js) -------
function abrirConstrutor(aoConcluir) {
  const gCheck = (name, itens, sel) => itens.map((o) => `<label class="doctec-op"><input type="checkbox" name="${name}" value="${o.id}" ${sel.includes(o.id) ? 'checked' : ''}><span>${escapar(o.txt || o.curto)}</span></label>`).join('');
  const gRadio = (name, itens, val) => itens.map((o) => `<label class="doctec-op"><input type="radio" name="${name}" value="${o.id}" ${val === o.id ? 'checked' : ''}><span>${escapar(o.txt)}</span></label>`).join('');
  const presetsHtml = CONSTRUTOR_PRESETS.map((p) => `<button type="button" class="btn xs" data-preset="${p.id}">${escapar(p.nome)}</button>`).join('');
  const ov = abrirModal(`
    <div class="modal">
      <div class="modal-h"><div class="t">Construtor guiado de prompt</div><button class="btn ghost sm fechar">✕</button></div>
      <div class="modal-b">
        <div class="muted" style="font-size:12.5px;margin-bottom:10px">Escolha as opções e a instrução é montada automaticamente. Comece por um preset e ajuste.</div>
        <div class="label">Presets</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 14px">${presetsHtml}</div>
        <div class="label">Objetivo (pode combinar)</div>
        <div class="doctec-ops" style="margin:6px 0 14px">${gCheck('cObj', CONSTRUTOR_OBJETIVO, ['completa'])}</div>
        <div class="label">Tom</div>
        <div class="doctec-ops" style="margin:6px 0 14px">${gRadio('cTom', CONSTRUTOR_TOM, 'neutro')}</div>
        <div class="label">Formato de saída</div>
        <div class="doctec-ops" style="margin:6px 0 14px">${gRadio('cFmt', CONSTRUTOR_FORMATO, 'corrido')}</div>
        <div class="label">Público-alvo</div>
        <div class="doctec-ops" style="margin:6px 0 14px">${PUBLICOS.map((p) => `<label class="doctec-op"><input type="checkbox" name="cPub" value="${p.id}"><span>${escapar(p.curto)}</span></label>`).join('')}</div>
        <div class="label">Instrução montada</div>
        <textarea id="cPreview" class="campo-texto" rows="4" readonly></textarea>
        <div style="display:flex;gap:8px;margin-top:14px"><button class="btn sm primary" id="cUsar">Usar esta instrução</button><button class="btn sm ghost fechar">Cancelar</button></div>
      </div>
    </div>`);
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
    ov.__nomeSug = pr.nome; atualizar();
  }));
  ov.querySelector('#cUsar').addEventListener('click', () => {
    const instr = preview.value.trim();
    if (!instr) { toast('Escolha ao menos uma opção.'); return; }
    if (aoConcluir) { aoConcluir(instr, ov.__nomeSug || ''); fecharModal(); }
    else { fecharModal(); abrirForm({ nome: ov.__nomeSug || '', instrucao: instr }); }
  });
}

// ------- conta -------
async function atualizarConta() {
  try { usuario = await nuvem.usuarioAtual(); } catch (e) { usuario = null; }
  const b = $('#btnConta');
  b.textContent = usuario ? (usuario.email ? usuario.email.split('@')[0] : 'Conta') : 'Entrar';
}

function abrirConta() {
  if (usuario) {
    const ov = abrirModal(`
      <div class="modal" style="max-width:460px">
        <div class="modal-h"><div class="t">Sua conta</div><button class="btn ghost sm fechar">✕</button></div>
        <div class="modal-b">
          <div class="muted" style="margin-bottom:12px">Conectado como <b>${escapar(usuario.email)}</b></div>
          <button class="btn sm ghost danger" id="bSair">Sair</button>
        </div>
      </div>`);
    ov.querySelector('#bSair').addEventListener('click', async () => {
      try { await nuvem.sair(); } catch (e) { /* ignora */ }
      usuario = null; publicosCache = null; atualizarConta(); fecharModal(); render(); toast('Você saiu.');
    });
    return;
  }
  let modo = 'entrar';
  const ov = abrirModal(`
    <div class="modal" style="max-width:460px">
      <div class="modal-h"><div class="t">Entrar</div><button class="btn ghost sm fechar">✕</button></div>
      <div class="modal-b">
        <div style="display:flex;gap:6px;margin-bottom:14px">
          <button class="btn sm primary" data-m="entrar">Entrar</button>
          <button class="btn sm ghost" data-m="criar">Criar conta</button>
        </div>
        <div class="field" id="wNome" style="display:none"><label>Nome</label><input type="text" id="cNome"></div>
        <div class="field"><label>E-mail institucional (@tce.sp.gov.br)</label><input type="text" id="cEmail" placeholder="voce@tce.sp.gov.br"></div>
        <div class="field"><label>Senha</label><input type="text" id="cSenha" style="-webkit-text-security:disc"></div>
        <button class="btn sm primary" id="cEnviar">Entrar</button>
        <div class="msg" id="cMsg"></div>
      </div>
    </div>`);
  const aplicarModo = () => {
    ov.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('primary', b.dataset.m === modo));
    ov.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('ghost', b.dataset.m !== modo));
    ov.querySelector('#wNome').style.display = modo === 'criar' ? '' : 'none';
    ov.querySelector('#cEnviar').textContent = modo === 'criar' ? 'Criar conta' : 'Entrar';
  };
  ov.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { modo = b.dataset.m; aplicarModo(); }));
  aplicarModo();
  ov.querySelector('#cEnviar').addEventListener('click', async () => {
    const email = ov.querySelector('#cEmail').value.trim();
    const senha = ov.querySelector('#cSenha').value;
    const nome = ov.querySelector('#cNome').value.trim();
    const msg = ov.querySelector('#cMsg'); msg.style.color = ''; msg.textContent = '';
    if (!email || !senha) { msg.textContent = 'Preencha e-mail e senha.'; return; }
    if (modo === 'criar' && !nome) { msg.textContent = 'Informe seu nome.'; return; }
    try {
      if (modo === 'criar') await nuvem.cadastrarEmailSenha(email, senha, nome);
      else await nuvem.loginEmailSenha(email, senha);
      const u = await nuvem.usuarioAtual();
      if (u) { usuario = u; atualizarConta(); await sincronizar(); fecharModal(); render(); toast('Bem-vindo, ' + u.email.split('@')[0] + '.'); }
      else { msg.style.color = 'var(--good)'; msg.textContent = 'Conta criada. Agora entre com e-mail e senha.'; modo = 'entrar'; aplicarModo(); }
    } catch (e) { msg.style.color = 'var(--danger)'; msg.textContent = String((e && e.message) || e); }
  });
}

// ------- init -------
async function iniciar() {
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { aba = t.dataset.tab; render(); }));
  $('#btnConta').addEventListener('click', abrirConta);
  await atualizarConta();
  if (usuario) await sincronizar();
  render();
}
iniciar();
