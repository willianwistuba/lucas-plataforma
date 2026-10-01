// painel.js — gera o HTML do "Retrato do documento" (visão geral) do editor.
// Módulo puro: recebe os parágrafos e devolve uma STRING de HTML para injetar
// dentro de um modal (.modal-b). Não manipula DOM nem faz rede.

import { metricasDocumento, nomeFaixa } from './metricas.js';

// Cores das faixas (SPEC). Usadas nas barras da distribuição.
const COR_FAIXA = {
  'muito-facil': '#15803D',
  'facil': '#4D9A5F',
  'razoavel': '#B45309',
  'dificil': '#C0392B',
  'neutra': '#8893A4'
};

// Ordem de exibição das faixas na distribuição.
const ORDEM_FAIXAS = ['muito-facil', 'facil', 'razoavel', 'dificil', 'neutra'];

// Escapa texto para inserção segura em HTML.
function escapar(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Formata número com uma casa decimal, no padrão brasileiro (vírgula).
function numBr(n) {
  return Number(n).toFixed(1).replace('.', ',');
}

// Corta o texto num limite de caracteres, adicionando reticências.
function trecho(texto, limite = 140) {
  const t = String(texto || '').trim();
  if (t.length <= limite) return t;
  return t.slice(0, limite).trim() + '…';
}

// Gera o HTML do retrato do documento a partir dos parágrafos.
export function painelHtml(paragrafos) {
  const lista = Array.isArray(paragrafos) ? paragrafos : [];
  const m = metricasDocumento(lista);

  // Faixa geral: pílula + índice em texto menor. Neutra vira travessão só na pílula.
  const rotuloIndice = m.faixa === 'neutra'
    ? '—'
    : 'índice ' + numBr(m.facilidade);
  const pilulaGeral =
    `<span class="faixa ${m.faixa}">${escapar(nomeFaixa(m.faixa))}</span>`;

  // Contagens gerais.
  const totalParagrafos = lista.length;
  const totalPalavras = m.palavras || 0;

  // Barras da distribuição, proporcionais à maior contagem.
  const maxContagem = ORDEM_FAIXAS.reduce(
    (max, f) => Math.max(max, m.distribuicao[f] || 0), 0
  ) || 1;

  const barras = ORDEM_FAIXAS.map((f) => {
    const n = m.distribuicao[f] || 0;
    const pct = Math.round((n / maxContagem) * 100);
    const cor = COR_FAIXA[f];
    const rotulo = f === 'neutra' ? 'Sem índice' : nomeFaixa(f);
    return `
      <div style="display:flex;align-items:center;gap:10px;margin:6px 0;">
        <span style="width:150px;flex:none;font-size:12.5px;color:#334155;">${escapar(rotulo)}</span>
        <span style="flex:1;background:#EEF1F5;border-radius:6px;height:10px;overflow:hidden;">
          <span style="display:block;height:10px;width:${pct}%;background:${cor};border-radius:6px;"></span>
        </span>
        <span style="width:34px;flex:none;text-align:right;font-size:12.5px;color:#334155;font-variant-numeric:tabular-nums;">${n}</span>
      </div>`;
  }).join('');

  // Parágrafo que mais precisa de atenção (pior índice), se houver.
  let blocoPior = '';
  if (m.pior) {
    const alvo = lista.find((p) => p.id === m.pior.id);
    const textoTrecho = alvo ? trecho(alvo.texto, 140) : '';
    blocoPior = `
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line-2);">
      <h4 style="margin:0 0 8px;">Parágrafo que mais precisa de atenção</h4>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span class="faixa ${m.pior.faixa}">${escapar(nomeFaixa(m.pior.faixa))}</span>
        <span style="font-size:12.5px;color:var(--ink-3);font-variant-numeric:tabular-nums;">índice ${numBr(m.pior.facilidade)}</span>
      </div>
      <p style="margin:0;font-size:13.5px;color:var(--ink-2);line-height:1.5;">${escapar(textoTrecho)}</p>
    </div>`;
  }

  // Montagem final. Só o conteúdo interno do modal (sem html/head).
  return `
    <div style="display:flex;align-items:center;gap:12px;margin:2px 0 14px;">
      ${pilulaGeral}
      <span style="font-size:12.5px;color:#64748B;font-variant-numeric:tabular-nums;">${escapar(rotuloIndice)}</span>
    </div>

    <div style="display:flex;gap:28px;margin:14px 0;font-size:13.5px;color:#334155;">
      <span>Parágrafos, <strong style="font-variant-numeric:tabular-nums;">${totalParagrafos}</strong></span>
      <span>Palavras, <strong style="font-variant-numeric:tabular-nums;">${totalPalavras}</strong></span>
    </div>

    <h4 style="margin:18px 0 6px;">Distribuição das faixas</h4>
    <div>${barras}
    </div>
    ${blocoPior}`;
}
