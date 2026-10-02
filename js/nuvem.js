// nuvem.js — camada opcional de nuvem do LUCAS (SPEC secao 10).
// O Supabase apenas arquiva e compartilha; nunca processa texto nem guarda chaves de API.
// Login por e-mail e senha (sem magic link). A leitura de verbetes oficiais e permitida
// sem login, protegida por RLS. Toda escrita depende do auth.uid() do usuario logado.

// ---------------------------------------------------------------------------
// Configuracao. Preencha com os dados publicos do seu projeto Supabase.
// URL e ANON_KEY sao publicas por natureza (vao para o navegador) e a seguranca
// vem das politicas de RLS definidas em supabase/migrations/001_esquema.sql.
// ---------------------------------------------------------------------------
const URL = 'https://fedycfavzrqrbbdcyhau.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlZHljZmF2enJxcmJiZGN5aGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MTU3MjQsImV4cCI6MjA5ODA5MTcyNH0.feOT9wOw4Rv6qB-spkNwPJC5NHAMNzb4bF7mpACZM_o';

// Cliente unico (singleton), criado sob demanda.
let _cliente = null;

// Retorna o cliente Supabase, criando-o na primeira chamada.
// Lanca erro claro se o supabase-js (window.supabase) nao estiver carregado por CDN.
function sb() {
  if (_cliente) return _cliente;
  if (typeof window === 'undefined' || !window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('Supabase nao carregado. Inclua o supabase-js v2 por CDN antes de usar a nuvem.');
  }
  _cliente = window.supabase.createClient(URL, ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  return _cliente;
}

// Extrai a mensagem de um erro do Supabase e a relanca como Error padrao.
function lancar(erro) {
  const msg = (erro && (erro.message || erro.error_description || erro.msg)) || 'Erro desconhecido na nuvem.';
  throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Autenticacao (e-mail e senha)
// ---------------------------------------------------------------------------

// Acesso restrito ao dominio institucional (validado tambem no backend, por
// gatilho no auth.users — ver supabase/migrations/002_auth_tcesp.sql).
const DOMINIO = '@tce.sp.gov.br';
function validarDominio(email) {
  if (!/^[^@\s]+@tce\.sp\.gov\.br$/i.test(String(email || '').trim())) {
    throw new Error('Use um e-mail institucional ' + DOMINIO + '.');
  }
}

// Faz login com e-mail e senha. Retorna a sessao.
async function loginEmailSenha(email, senha) {
  validarDominio(email);
  const { data, error } = await sb().auth.signInWithPassword({ email: String(email).trim(), password: senha });
  if (error) lancar(error);
  return data;
}

// Cadastra novo usuario (signUp) apenas com e-mail e senha, sem link nem codigo.
// O nome vai no metadado e o perfil e criado pelo gatilho handle_new_user.
async function cadastrarEmailSenha(email, senha, nome) {
  validarDominio(email);
  const { data, error } = await sb().auth.signUp({
    email: String(email).trim(),
    password: senha,
    options: { data: { nome: String(nome || '').trim() } }
  });
  if (error) lancar(error);
  return data;
}

// Encerra a sessao atual.
async function sair() {
  const { error } = await sb().auth.signOut();
  if (error) lancar(error);
  return true;
}

// Retorna a sessao atual (ou null se nao houver).
async function sessaoAtual() {
  const { data, error } = await sb().auth.getSession();
  if (error) lancar(error);
  return data ? data.session : null;
}

// Retorna o usuario autenticado (ou null se nao houver).
async function usuarioAtual() {
  const { data, error } = await sb().auth.getUser();
  if (error) lancar(error);
  return data ? data.user : null;
}

// ---------------------------------------------------------------------------
// Documentos (arquivo do usuario; somente o dono acessa, por RLS)
// ---------------------------------------------------------------------------

// Arquiva um documento. O dono e sempre o usuario autenticado (auth.uid()).
// Campos conforme a tabela documentos: titulo, origem, estado (jsonb), metricas (jsonb).
async function arquivarDocumento({ titulo, origem, estado, metricas }) {
  const usuario = await usuarioAtual();
  if (!usuario) throw new Error('Faca login para arquivar documentos.');
  const { data, error } = await sb()
    .from('documentos')
    .insert({ dono: usuario.id, titulo, origem, estado, metricas })
    .select()
    .single();
  if (error) lancar(error);
  return data;
}

// Lista os documentos do usuario, mais recentes primeiro.
async function listarMeusDocumentos() {
  const { data, error } = await sb()
    .from('documentos')
    .select('id, titulo, origem, metricas, criado_em, atualizado_em')
    .order('atualizado_em', { ascending: false })
    .limit(1000);
  if (error) lancar(error);
  return data || [];
}

// Abre um documento pelo id (com o estado completo).
async function abrirDocumento(id) {
  const { data, error } = await sb()
    .from('documentos')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) lancar(error);
  return data;
}

// Exclui um documento pelo id (RLS garante que so o dono consegue).
async function excluirDocumento(id) {
  const { error } = await sb()
    .from('documentos')
    .delete()
    .eq('id', id);
  if (error) lancar(error);
  return true;
}

// ---------------------------------------------------------------------------
// Registro de revisao (trilha de auditoria; somente insercao, por RLS)
// ---------------------------------------------------------------------------

// Insere uma linha na trilha de auditoria. O dono e sempre o usuario autenticado.
// `linha` deve conter apenas colunas da tabela registro_revisao.
async function inserirRegistro(linha) {
  const usuario = await usuarioAtual();
  if (!usuario) throw new Error('Faca login para registrar revisoes.');
  const { data, error } = await sb()
    .from('registro_revisao')
    .insert({ ...linha, dono: usuario.id })
    .select()
    .single();
  if (error) lancar(error);
  return data;
}

// ---------------------------------------------------------------------------
// Prompts do usuario (nao oficiais). RLS: cada um so ve/edita os seus.
// ---------------------------------------------------------------------------

async function listarMeusPrompts() {
  const usuario = await usuarioAtual();
  if (!usuario) return [];
  const { data, error } = await sb()
    .from('prompts')
    .select('id, nome, descricao, instrucao, compartilhado')
    .eq('oficial', false)
    .eq('dono', usuario.id)
    .order('criado_em', { ascending: true })
    .limit(1000);
  if (error) lancar(error);
  return data || [];
}

// Insere (sem nuvemId) ou atualiza (com nuvemId) um prompt do usuario.
async function salvarPromptNuvem(p) {
  const usuario = await usuarioAtual();
  if (!usuario) throw new Error('Faca login para salvar na nuvem.');
  if (p.nuvemId) {
    const { data, error } = await sb().from('prompts')
      .update({ nome: p.nome, descricao: p.descricao || '', instrucao: p.instrucao, compartilhado: !!p.compartilhado })
      .eq('id', p.nuvemId).eq('dono', usuario.id).select().single();
    if (error) lancar(error);
    return data;
  }
  const { data, error } = await sb().from('prompts')
    .insert({ dono: usuario.id, nome: p.nome, descricao: p.descricao || '', instrucao: p.instrucao, oficial: false, compartilhado: !!p.compartilhado })
    .select().single();
  if (error) lancar(error);
  return data;
}

async function excluirPromptNuvem(nuvemId) {
  const usuario = await usuarioAtual();
  if (!usuario) throw new Error('Faca login para excluir prompts.');
  const { error } = await sb().from('prompts').delete().eq('id', nuvemId).eq('dono', usuario.id);
  if (error) lancar(error);
  return true;
}

// Lista os prompts que outros usuarios compartilharam (area publica). A RLS
// (prompts_sel) permite ler quem tem compartilhado = true para autenticados.
async function listarPromptsPublicos() {
  const { data, error } = await sb()
    .from('prompts')
    .select('id, nome, descricao, instrucao, dono, criado_em')
    .eq('oficial', false)
    .eq('compartilhado', true)
    .order('criado_em', { ascending: false })
    .limit(1000);
  if (error) lancar(error);
  return data || [];
}

// Liga/desliga o compartilhamento publico de um prompt do proprio usuario.
async function definirCompartilhamentoPrompt(nuvemId, compartilhado) {
  const usuario = await usuarioAtual();
  if (!usuario) throw new Error('Faca login para alterar o compartilhamento.');
  const { data, error } = await sb()
    .from('prompts')
    .update({ compartilhado: !!compartilhado })
    .eq('id', nuvemId)
    .eq('dono', usuario.id)
    .select().single();
  if (error) lancar(error);
  return data;
}

// Salva um sinonimo/substituicao do usuario como verbete nao oficial.
async function salvarSinonimoNuvem(termo, simples) {
  const usuario = await usuarioAtual();
  if (!usuario) return null; // sem login: fica so no navegador
  const { data, error } = await sb().from('verbetes')
    .insert({ dono: usuario.id, termo, tratamento: 'substituir', simples, explicacao: 'Substituicao cadastrada pelo usuario.', oficial: false })
    .select().single();
  if (error) lancar(error);
  return data;
}

async function listarMeusVerbetes() {
  const { data, error } = await sb()
    .from('verbetes')
    .select('id, termo, simples')
    .eq('oficial', false)
    .eq('tratamento', 'substituir')
    .order('criado_em', { ascending: true })
    .limit(2000);
  if (error) lancar(error);
  return data || [];
}

// ---------------------------------------------------------------------------
// Acervo de vídeos "Linguagem Simples na Mídia" (leitura pública, por RLS).
// São ~80 registros: busca-se tudo de uma vez e o resto (busca, ordenação,
// paginação) é feito no navegador, o que deixa a pesquisa instantânea.
// ---------------------------------------------------------------------------
async function listarVideos() {
  const { data, error } = await sb()
    .from('videos')
    .select('n, categoria, titulo, canal, duracao_txt, duracao_seg, short, publicado, descricao, youtube_id, url')
    .order('publicado', { ascending: false })
    .limit(5000);
  if (error) lancar(error);
  return data || [];
}

// ---------------------------------------------------------------------------
// Verbetes oficiais (leitura permitida sem login, por RLS)
// ---------------------------------------------------------------------------

// Lista os verbetes oficiais do dicionario.
async function listarVerbetesOficiais() {
  const { data, error } = await sb()
    .from('verbetes')
    .select('*')
    .eq('oficial', true)
    .order('termo', { ascending: true })
    .limit(5000);
  if (error) lancar(error);
  return data || [];
}

// ---------------------------------------------------------------------------
// Utilitario opcional de armazenamento local (sempre em try/catch).
// Guardado aqui por conveniencia; nunca guarda chaves de API.
// ---------------------------------------------------------------------------

// Le um valor JSON do localStorage; retorna `padrao` em caso de falha.
function lerLocal(chave, padrao = null) {
  try {
    const bruto = window.localStorage.getItem(chave);
    return bruto == null ? padrao : JSON.parse(bruto);
  } catch (_e) {
    return padrao;
  }
}

// Grava um valor JSON no localStorage; devolve true/false conforme sucesso.
function gravarLocal(chave, valor) {
  try {
    window.localStorage.setItem(chave, JSON.stringify(valor));
    return true;
  } catch (_e) {
    return false;
  }
}

export {
  sb,
  loginEmailSenha,
  cadastrarEmailSenha,
  sair,
  sessaoAtual,
  usuarioAtual,
  arquivarDocumento,
  listarMeusDocumentos,
  abrirDocumento,
  excluirDocumento,
  inserirRegistro,
  listarMeusPrompts,
  salvarPromptNuvem,
  excluirPromptNuvem,
  listarPromptsPublicos,
  definirCompartilhamentoPrompt,
  salvarSinonimoNuvem,
  listarMeusVerbetes,
  listarVideos,
  listarVerbetesOficiais,
  lerLocal,
  gravarLocal
};
