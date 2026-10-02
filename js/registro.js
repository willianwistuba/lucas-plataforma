// registro.js — registro de revisão. Trilha de auditoria em memória,
// exportável em CSV (UTF-8 com BOM) e JSON. Evidencia a preservação do rigor
// (termos protegidos e conferência) e a transformação do texto (faixa antes/depois).

const COLUNAS = [
  'dataHora', 'documento', 'paragrafo', 'acao', 'promptCodigo', 'provedor', 'modelo',
  'faixaAntes', 'faixaDepois', 'facilidadeAntes', 'facilidadeDepois',
  'alertas', 'decisao', 'revisor', 'observacao'
];

const registro = [];

function adicionar(entrada) {
  const linha = {};
  for (const c of COLUNAS) linha[c] = entrada[c] != null ? entrada[c] : '';
  if (Array.isArray(linha.alertas)) linha.alertas = linha.alertas.map((a) => a.id ? `${a.id}: ${a.texto}` : a).join(' | ');
  if (!linha.dataHora) linha.dataHora = new Date().toISOString();
  registro.push(linha);
  return linha;
}

function limpar() { registro.length = 0; }
function todos() { return registro.slice(); }

function escaparCSV(v) {
  let s = String(v == null ? '' : v);
  // Anti-injeção de fórmula: campo iniciado por = + - @ (ou tab/CR) pode ser
  // executado como fórmula ao abrir no Excel/Sheets. Neutraliza com apóstrofo.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function paraCSV() {
  const cab = COLUNAS.join(';');
  const linhas = registro.map((r) => COLUNAS.map((c) => escaparCSV(r[c])).join(';'));
  return '﻿' + [cab, ...linhas].join('\r\n'); // BOM para o Excel abrir UTF-8
}

function paraJSON() {
  return JSON.stringify(registro, null, 2);
}

function baixar(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baixarCSV(nome = 'registro-lucas.csv') { baixar(nome, paraCSV(), 'text/csv;charset=utf-8'); }
function baixarJSON(nome = 'registro-lucas.json') { baixar(nome, paraJSON(), 'application/json'); }

export { adicionar, limpar, todos, paraCSV, paraJSON, baixarCSV, baixarJSON, baixar };
