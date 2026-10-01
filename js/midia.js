// midia.js — "Linguagem Simples na Mídia". Lista de vídeos do YouTube com busca,
// filtro por categoria, ordenação e paginação, tudo no navegador (instantâneo):
// os ~80 registros são buscados uma vez do Supabase e o resto roda em memória.
// Assistir abre uma tela dentro da própria plataforma (embed), sem sair do LUCAS.

import * as nuvem from './nuvem.js';

const app = document.querySelector('#app');
const POR_PAGINA = 12;
let TODOS = [];
let CATEGORIAS = [];
const estado = { q: '', cat: '', ord: 'recentes', pag: 1 };

function escapar(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function thumb(id) { return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; }
function dataBR(iso) { if (!iso) return ''; const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso; }

const ORDENS = {
  recentes: (a, b) => String(b.publicado || '').localeCompare(String(a.publicado || '')),
  antigos: (a, b) => String(a.publicado || '').localeCompare(String(b.publicado || '')),
  titulo: (a, b) => a.titulo.localeCompare(b.titulo, 'pt'),
  canal: (a, b) => String(a.canal || '').localeCompare(String(b.canal || ''), 'pt') || String(b.publicado || '').localeCompare(String(a.publicado || '')),
  curtos: (a, b) => (a.duracao_seg || 0) - (b.duracao_seg || 0),
  longos: (a, b) => (b.duracao_seg || 0) - (a.duracao_seg || 0)
};

function filtrados() {
  const q = fold(estado.q.trim());
  let arr = TODOS.filter((v) => {
    if (estado.cat && v.categoria !== estado.cat) return false;
    if (!q) return true;
    return fold(`${v.titulo} ${v.canal} ${v.descricao} ${v.categoria}`).includes(q);
  });
  return arr.slice().sort(ORDENS[estado.ord] || ORDENS.recentes);
}

const ICON_PLAY = '<svg width="22" height="22" viewBox="0 0 24 24" fill="#16307A"><path d="M8 5v14l11-7z"/></svg>';

function cardHtml(v) {
  return `
    <article class="vcard" data-id="${escapar(v.youtube_id)}" tabindex="0" role="button" aria-label="Assistir: ${escapar(v.titulo)}">
      <div class="vthumb">
        <img src="${thumb(v.youtube_id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        ${v.short ? '<span class="vshort">SHORT</span>' : ''}
        ${v.duracao_txt ? `<span class="vdur">${escapar(v.duracao_txt)}</span>` : ''}
        <div class="play"><span>${ICON_PLAY}</span></div>
      </div>
      <div class="vbody">
        <span class="vcat">${escapar(v.categoria)}</span>
        <div class="vtitle">${escapar(v.titulo)}</div>
        <div class="vmeta">${escapar(v.canal || '')}${v.publicado ? ' · ' + dataBR(v.publicado) : ''}</div>
        ${v.descricao ? `<div class="vdesc">${escapar(v.descricao)}</div>` : ''}
      </div>
    </article>`;
}

// ---- Lista ----
function mostrarLista() {
  const chips = ['<button class="chip' + (estado.cat === '' ? ' on' : '') + '" data-cat="">Todas</button>']
    .concat(CATEGORIAS.map((c) => `<button class="chip${estado.cat === c ? ' on' : ''}" data-cat="${escapar(c)}">${escapar(c)}</button>`)).join('');
  app.innerHTML = `
    <div class="head">
      <h1>Linguagem Simples na Mídia</h1>
      <p>Um acervo de vídeos sobre linguagem simples nos Tribunais de Contas, no Judiciário, no Ministério Público e no setor público. Busque, filtre e assista sem sair da plataforma.</p>
    </div>
    <div class="ctrls">
      <label class="search">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="q" type="search" placeholder="Buscar por título, canal, tema…" value="${escapar(estado.q)}" autocomplete="off">
      </label>
      <select id="ord" class="field" title="Ordenar">
        <option value="recentes">Mais recentes</option>
        <option value="antigos">Mais antigos</option>
        <option value="titulo">Título (A–Z)</option>
        <option value="canal">Canal (A–Z)</option>
        <option value="curtos">Duração (menor)</option>
        <option value="longos">Duração (maior)</option>
      </select>
    </div>
    <div class="chips" id="chips">${chips}</div>
    <div class="count" id="count"></div>
    <div class="vgrid" id="grid"></div>
    <div class="pag" id="pag"></div>`;

  const inp = app.querySelector('#q');
  inp.addEventListener('input', () => { estado.q = inp.value; estado.pag = 1; atualizar(); });
  const ord = app.querySelector('#ord'); ord.value = estado.ord;
  ord.addEventListener('change', () => { estado.ord = ord.value; estado.pag = 1; atualizar(); });
  app.querySelector('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    estado.cat = b.dataset.cat; estado.pag = 1;
    app.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.cat === estado.cat));
    atualizar();
  });
  atualizar();
  setTimeout(() => inp.focus(), 0);
}

function atualizar() {
  const arr = filtrados();
  const totalPag = Math.max(1, Math.ceil(arr.length / POR_PAGINA));
  if (estado.pag > totalPag) estado.pag = totalPag;
  const ini = (estado.pag - 1) * POR_PAGINA;
  const pagina = arr.slice(ini, ini + POR_PAGINA);

  const grid = app.querySelector('#grid');
  grid.innerHTML = pagina.length ? pagina.map(cardHtml).join('')
    : '<div class="vazio">Nenhum vídeo encontrado. Tente outra busca ou categoria.</div>';
  grid.querySelectorAll('.vcard').forEach((el) => {
    const abrir = () => { location.hash = '#/v/' + el.dataset.id; };
    el.addEventListener('click', abrir);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
  });

  app.querySelector('#count').textContent = arr.length
    ? `${arr.length} vídeo${arr.length > 1 ? 's' : ''}${estado.cat ? ' em “' + estado.cat + '”' : ''}${estado.q ? ' para “' + estado.q + '”' : ''}`
    : '';

  app.querySelector('#pag').innerHTML = paginacaoHtml(totalPag);
  app.querySelector('#pag').querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    estado.pag = parseInt(b.dataset.p, 10); atualizar();
    app.querySelector('.ctrls').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function paginacaoHtml(total) {
  if (total <= 1) return '';
  const p = estado.pag;
  const nums = new Set([1, total, p, p - 1, p + 1]);
  const seq = [...nums].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  let html = `<button data-p="${Math.max(1, p - 1)}" ${p === 1 ? 'disabled' : ''}>‹</button>`;
  let ant = 0;
  for (const n of seq) {
    if (n - ant > 1) html += '<button disabled>…</button>';
    html += `<button data-p="${n}" class="${n === p ? 'on' : ''}">${n}</button>`;
    ant = n;
  }
  html += `<button data-p="${Math.min(total, p + 1)}" ${p === total ? 'disabled' : ''}>›</button>`;
  return html;
}

// ---- Assistir ----
function mostrarAssistir(id) {
  const v = TODOS.find((x) => x.youtube_id === id);
  if (!v) { location.hash = ''; return; }
  const src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?rel=0&autoplay=1&modestbranding=1`;
  app.innerHTML = `
    <div class="watch">
      <button class="btn sm ghost voltar" id="voltar">‹ Voltar ao acervo</button>
      <div class="embed">
        <iframe src="${src}" title="${escapar(v.titulo)}" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
      </div>
      <h1>${escapar(v.titulo)}</h1>
      <div class="wmeta">
        <span class="vcat">${escapar(v.categoria)}</span>
        <span>${escapar(v.canal || '')}</span>
        ${v.publicado ? '<span>· ' + dataBR(v.publicado) + '</span>' : ''}
        ${v.duracao_txt ? '<span>· ' + escapar(v.duracao_txt) + '</span>' : ''}
        ${v.short ? '<span>· Short</span>' : ''}
      </div>
      ${v.descricao ? `<div class="wdesc">${escapar(v.descricao)}</div>` : ''}
      <div class="wlinks">
        <a class="btn sm" href="${escapar(v.url)}" target="_blank" rel="noopener noreferrer">Abrir no YouTube ↗</a>
        <a class="btn sm ghost" href="#">‹ Voltar ao acervo</a>
      </div>
    </div>`;
  app.querySelector('#voltar').addEventListener('click', () => { location.hash = ''; });
  window.scrollTo(0, 0);
}

// ---- Roteamento ----
function rotear() {
  const m = location.hash.match(/^#\/v\/([A-Za-z0-9_-]{6,})$/);
  if (m) mostrarAssistir(m[1]); else mostrarLista();
}

async function iniciar() {
  app.innerHTML = '<div class="muted" style="padding:40px;text-align:center">Carregando o acervo…</div>';
  try {
    TODOS = await nuvem.listarVideos();
    CATEGORIAS = [...new Set(TODOS.map((v) => v.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
  } catch (e) {
    app.innerHTML = `<div class="vazio" style="margin-top:30px">Não consegui carregar o acervo agora. Tente recarregar a página.<br><span class="muted" style="font-size:12px">${escapar((e && e.message) || e)}</span></div>`;
    return;
  }
  window.addEventListener('hashchange', rotear);
  rotear();
}
iniciar();
