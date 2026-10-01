# NOTAS — estado do projeto LUCAS

> Registro de decisões e estado atual. A **fonte da verdade é o código**
> (`index.html` + `schema.sql`); este arquivo é o mapa para retomar rápido.

## O que é
App de enquetes de **Linguagem Simples**: alguém propõe um texto difícil, o
grupo vota em qual reescrita ficou mais clara e pode sugerir versões novas.
Tudo num **único `index.html`** (HTML+CSS+JS, sem build) falando com **Supabase**
via funções RPC. Sem login.

## Configuração atual
- **Supabase URL/anon key**: já preenchidos no topo do `<script>` em `index.html`.
  (Projeto `fedycfavzrqrbbdcyhau`.)
- A `anon key` é pública por natureza — segurança está no RLS + RPCs, não em
  escondê-la.

## ⚠️ Sempre que mexer no `schema.sql`
1. Rodar o arquivo **inteiro** no SQL Editor do Supabase (é idempotente/auto-migrável).
2. Recarregar o app com **Ctrl+Shift+R**.

---

## Decisões de produto (REGRAS — não quebrar sem combinar)

1. **Integridade da votação acima de tudo.** Depois de criada, a enquete tem
   **título e versões IMUTÁVEIS**. Mudar o que está em jogo depois de gente votar
   desprestigia a votação.
   - O autor só pode **editar o CONTEXTO** (texto explicativo, não votado).
   - O autor pode **TIRAR uma versão da votação** (não dar prestígio a algo ruim),
     mas **nunca ALTERAR** o texto proposto por outra pessoa.
   - Para mudar o texto/as versões → **criar nova enquete** (votos descartados).

2. **Chave de autor desacoplada do link.** A chave usa um `chave_codigo` próprio,
   **independente** do `codigo` público que vai no link `?e=CODIGO`. O link não
   contém nenhum pedaço da chave. (Enquetes antigas: `chave_codigo = codigo`.)

3. **Anti-troll na sugestão.** Quem sugere precisa informar **nome + e-mail**
   (o e-mail só o autor vê, no painel). Quem só vota não precisa.

4. **Teto de 800 caracteres** em todos os campos de conteúdo (título, contexto,
   versões, sugestões, comentário). Travado no **front (`maxlength`)** e, o que
   importa, **no servidor** (as RPCs rejeitam > 800). Nome/e-mail seguem curtos.

5. **Prazo flexível**: dias/horas/min, **mín. 5 minutos, máx. 7 dias**. Guardado
   em minutos; servidor faz `clamp` entre 5 e 10080.

6. **Voto de aprovação** (marcar várias) é o padrão; "escolher uma" é opção.
   Resultado "no fim" (padrão) ou "ao vivo". Até **8 versões** por enquete.

7. **Fluxo único na tela de votar**: um só botão "Confirmar". Dá pra **votar,
   sugerir, ou os dois** — e dá pra **sugerir sem marcar nada** (não gostou de
   nenhuma).

---

## Schema (`schema.sql`) — RPCs

**Públicas (anon):**
- `criar_enquete(titulo, contexto, nome, email, redacoes[], tipo_voto, mostrar_resultado, prazo_min)` → `{codigo, chave}`
- `obter_para_votar(codigo)`
- `registrar_voto(codigo, token, redacao_ids[], nome, comentario)`
- `sugerir_redacao(codigo, texto, nome, email)` — nome+email obrigatórios
- `obter_painel(chave)` — pendentes trazem `sugerido_email`
- `curar_redacao(chave, redacao_id, acao)` — aprovar/recusar
- `encerrar_enquete(chave)`
- `editar_enquete(chave, contexto)` — **só contexto**
- `remover_redacao(chave, redacao_id)` — não deixa a votação sem nenhuma
- `excluir_enquete(chave)` — cascata
- `status_enquetes(codigos[])` → `[{codigo, titulo, encerrada}]` (lista do aparelho)
- `obter_resultado(codigo, chave?)`

**Internas / admin (NÃO anon):**
- `_validar_chave`, `gerar_codigo`, `admin_reemitir_chave(codigo)` (resgate de chave,
  só no SQL Editor).

**Segurança:** 5 tabelas com RLS ligado e **sem policies**; todo acesso passa pelas
RPCs `SECURITY DEFINER`. Chave guardada só como hash bcrypt.

---

## Front-end (`index.html`) — telas
`onboarding`, `home`, `votar`, `votado`, `criar`, `chaveGerada`, `painel`,
`resultado`, `gerenciar` (Minhas enquetes).

**Pontos de UX já decididos:**
- **Cabeçalhos fixos**: a `.screen` não rola; quem rola é `.body`/`.center`
  (`overflow-y:auto` + `min-height:0`). Header é flex-shrink:0.
- **Botão Início** é injetado dentro de cada cabeçalho interno por
  `montarBotoesHome()` (não é mais flutuante — ficava torto).
- **Modais próprios** (`modalConfirmar`/`modalPrompt`) no lugar de
  `alert/confirm/prompt` nativos.
- **Navegação**: `voltar()` usa histórico (`navHist`); `go(tela)` reseta scroll.
- **Paleta minimalista**: neutro frio + UM acento índigo (`--indigo:#4338ca`).
  Sem segunda cor de marca. Status: **NO AR** (vermelho pulsante) / **FINALIZADA**
  (cinza).
- **Minhas enquetes** (tela `gerenciar`): abrir por **chave** + lista das criadas
  **neste aparelho** (localStorage), com **filtro** (Todas/No ar/Finalizadas) e
  ações **editar**(→painel) / **excluir**.
- Tela de votar com **divisores cinza** entre blocos; "O texto a ser melhorado",
  "Versões em votação", nome+e-mail lado a lado.

---

## Roadmap / ideias (não feito ainda)
- E-mail automático ao criar (link + chave) — usa o e-mail já coletado; mata o
  problema de chave perdida.
- OpenGraph/preview ao compartilhar o link + `navigator.share()`.
- Acessibilidade real nas opções de voto (teclado/ARIA).
- Mostrar comentários/justificativas ao autor.
- Relatório de resultado imprimível (CSS de impressão).
- Realtime no painel · PWA · domínio próprio.
