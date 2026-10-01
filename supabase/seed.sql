-- seed.sql — dados oficiais do LUCAS (prompts P1..P7 e verbetes do dicionario).
--
-- Rode UMA vez no editor SQL do projeto Supabase, com a chave de servico
-- (service_role), pois insere linhas oficiais (dono nulo) que o RLS proibe para
-- o cliente anonimo. NUNCA rode isto no navegador nem exponha a chave de servico.
--
-- Os textos abaixo vem de js/prompts.js (prompts) e dados/dicionario.json (verbetes).
-- Nenhuma coluna fora do esquema de supabase/migrations/001_esquema.sql e usada.
--
-- Idempotencia: como o esquema nao tem restricao unica em prompts.codigo nem em
-- verbetes.termo, cada insercao e protegida por WHERE NOT EXISTS, para que rodar
-- de novo nao gere duplicatas.

-- =====================================================================
-- Prompts oficiais (SPEC 7.2). oficial = true, dono = null.
-- =====================================================================

insert into prompts (dono, codigo, nome, descricao, instrucao, oficial)
select null, 'P1', 'Linguagem simples completa',
  'Reescrita completa em linguagem simples.',
  'Reescreva em linguagem simples: frases de até 25 palavras, ordem direta, voz ativa, verbo no lugar de substantivo, siglas por extenso na primeira menção, termos técnicos explicados, informação mais importante primeiro.',
  true
where not exists (select 1 from prompts where oficial = true and codigo = 'P1');

insert into prompts (dono, codigo, nome, descricao, instrucao, oficial)
select null, 'P2', 'Só quebrar frases longas',
  'Divide frases longas sem trocar palavras.',
  'Divida as frases com mais de 40 palavras em frases menores. Não troque palavras nem mude a ordem das ideias.',
  true
where not exists (select 1 from prompts where oficial = true and codigo = 'P2');

insert into prompts (dono, codigo, nome, descricao, instrucao, oficial)
select null, 'P3', 'Voz ativa e verbos',
  'Troca voz passiva e nominalizações.',
  'Troque a voz passiva por ativa quando o agente estiver no trecho. Troque substantivos derivados de verbo pelo verbo correspondente.',
  true
where not exists (select 1 from prompts where oficial = true and codigo = 'P3');

insert into prompts (dono, codigo, nome, descricao, instrucao, oficial)
select null, 'P4', 'Abrir siglas e explicar termos',
  'Abre siglas e explica termos técnicos.',
  'Escreva cada sigla por extenso na primeira menção, com a sigla entre parênteses. Dê uma explicação curta para os termos técnicos, mantendo o termo. Pode ficar maior que o original.',
  true
where not exists (select 1 from prompts where oficial = true and codigo = 'P4');

insert into prompts (dono, codigo, nome, descricao, instrucao, oficial)
select null, 'P5', 'Transformar em lista de ações',
  'Converte em lista de ações.',
  'Transforme o trecho em uma lista em que cada item começa com um verbo e indica quem faz o quê. Distinga determinação (obrigatória) de recomendação.',
  true
where not exists (select 1 from prompts where oficial = true and codigo = 'P5');

insert into prompts (dono, codigo, nome, descricao, instrucao, oficial)
select null, 'P6', 'Resumo em uma frase',
  'Resume o trecho em uma frase.',
  'Resuma o trecho em uma única frase de até 30 palavras, usando apenas informação presente no trecho.',
  true
where not exists (select 1 from prompts where oficial = true and codigo = 'P6');

insert into prompts (dono, codigo, nome, descricao, instrucao, oficial)
select null, 'P7', 'Reescrever frase com termo',
  'Usado pelo dicionário interativo.',
  'Reescreva apenas a frase indicada, substituindo o termo indicado pela alternativa simples informada e ajustando a concordância. Não altere o resto do trecho.',
  true
where not exists (select 1 from prompts where oficial = true and codigo = 'P7');

-- =====================================================================
-- Verbetes oficiais (dados/dicionario.json). oficial = true, dono = null.
-- Restricao simples_coerente: 'substituir' tem simples; 'explicar' tem simples NULL.
-- variantes e sinonimos entram como arrays de texto (text[]).
-- =====================================================================

insert into verbetes (dono, termo, variantes, tratamento, simples, explicacao, exemplo, sinonimos, categoria, fonte, oficial)
select null, 'outrossim', array['Outrossim'], 'substituir', 'além disso',
  'Conector que indica acréscimo. Não tem efeito jurídico próprio.',
  'Outrossim, destaco que → Além disso, destaco que',
  array['além disso', 'também', 'ademais', 'igualmente'], 'conector', 'corpus GCCCS 2026', true
where not exists (select 1 from verbetes where oficial = true and termo = 'outrossim');

insert into verbetes (dono, termo, variantes, tratamento, simples, explicacao, exemplo, sinonimos, categoria, fonte, oficial)
select null, 'inobstante', array['Inobstante', 'não obstante', 'Não obstante'], 'substituir', 'apesar disso',
  'Conector de oposição. Não tem efeito jurídico próprio.',
  'Inobstante o alegado → Apesar do que foi alegado',
  array['apesar disso', 'ainda assim', 'mesmo assim', 'contudo'], 'conector', 'corpus GCCCS 2026', true
where not exists (select 1 from verbetes where oficial = true and termo = 'inobstante');

insert into verbetes (dono, termo, variantes, tratamento, simples, explicacao, exemplo, sinonimos, categoria, fonte, oficial)
select null, 'destarte', array['Destarte'], 'substituir', 'assim',
  'Conector conclusivo. Não tem efeito jurídico próprio.',
  'Destarte, concluo → Assim, concluo',
  array['assim', 'dessa forma', 'portanto', 'logo'], 'conector', 'corpus GCCCS 2026', true
where not exists (select 1 from verbetes where oficial = true and termo = 'destarte');

insert into verbetes (dono, termo, variantes, tratamento, simples, explicacao, exemplo, sinonimos, categoria, fonte, oficial)
select null, 'ademais', array['Ademais'], 'substituir', 'além disso',
  'Conector de acréscimo. Não tem efeito jurídico próprio.',
  'Ademais, cumpre observar → Além disso, é preciso observar',
  array['além disso', 'também', 'outrossim'], 'conector', 'corpus GCCCS 2026', true
where not exists (select 1 from verbetes where oficial = true and termo = 'ademais');

insert into verbetes (dono, termo, variantes, tratamento, simples, explicacao, exemplo, sinonimos, categoria, fonte, oficial)
select null, 'consubstanciar', array['consubstancia', 'consubstanciado', 'consubstanciada', 'consubstanciam'], 'substituir', 'reunir',
  'Verbo que indica juntar ou dar forma concreta a algo.',
  'documento que consubstancia → documento que reúne',
  array['reunir', 'concretizar', 'materializar', 'conter'], 'verbo', 'corpus GCCCS 2026', true
where not exists (select 1 from verbetes where oficial = true and termo = 'consubstanciar');

insert into verbetes (dono, termo, variantes, tratamento, simples, explicacao, exemplo, sinonimos, categoria, fonte, oficial)
select null, 'exsurge', array['exsurgir', 'exsurgem'], 'substituir', 'surge',
  'Verbo pouco usado; significa surgir ou aparecer.',
  'do que exsurge → do que surge',
  array['surge', 'aparece', 'resulta', 'decorre'], 'verbo', 'corpus GCCCS 2026', true
where not exists (select 1 from verbetes where oficial = true and termo = 'exsurge');

insert into verbetes (dono, termo, variantes, tratamento, simples, explicacao, exemplo, sinonimos, categoria, fonte, oficial)
select null, 'escorreito', array['escorreita', 'escorreitos', 'escorreitas'], 'substituir', 'correto',
  'Adjetivo que significa correto, sem falhas.',
  'procedimento escorreito → procedimento correto',
  array['correto', 'regular', 'sem falhas', 'adequado'], 'adjetivo', 'corpus GCCCS 2026', true
where not exists (select 1 from verbetes where oficial = true and termo = 'escorreito');

insert into verbetes (dono, termo, variantes, tratamento, simples, explicacao, exemplo, sinonimos, categoria, fonte, oficial)
select null, 'hodierno', array['hodierna', 'hodiernos', 'hodiernas'], 'substituir', 'atual',
  'Adjetivo que significa atual, dos dias de hoje.',
  'no cenário hodierno → no cenário atual',
  array['atual', 'de hoje', 'presente', 'contemporâneo'], 'adjetivo', 'corpus GCCCS 2026', true
where not exists (select 1 from verbetes where oficial = true and termo = 'hodierno');

insert into verbetes (dono, termo, variantes, tratamento, simples, explicacao, exemplo, sinonimos, categoria, fonte, oficial)
select null, 'regularidade com ressalvas', array['Regularidade com ressalvas'], 'explicar', null,
  'Situação em que a decisão aprova as contas, mas registra restrições ou observações que devem ser corrigidas.',
  null,
  array[]::text[], 'termo jurídico', 'corpus GCCCS 2026', true
where not exists (select 1 from verbetes where oficial = true and termo = 'regularidade com ressalvas');

insert into verbetes (dono, termo, variantes, tratamento, simples, explicacao, exemplo, sinonimos, categoria, fonte, oficial)
select null, 'juízo de admissibilidade', array['Juízo de admissibilidade'], 'explicar', null,
  'Análise prévia que verifica se um recurso ou pedido preenche os requisitos para ser examinado no mérito.',
  null,
  array[]::text[], 'termo jurídico', 'corpus GCCCS 2026', true
where not exists (select 1 from verbetes where oficial = true and termo = 'juízo de admissibilidade');

insert into verbetes (dono, termo, variantes, tratamento, simples, explicacao, exemplo, sinonimos, categoria, fonte, oficial)
select null, 'embargos de declaração', array['embargo de declaração', 'embargos declaratórios'], 'explicar', null,
  'Recurso que pede ao próprio órgão que julgou para esclarecer contradição, obscuridade ou omissão da decisão.',
  null,
  array[]::text[], 'termo jurídico', 'corpus GCCCS 2026', true
where not exists (select 1 from verbetes where oficial = true and termo = 'embargos de declaração');

insert into verbetes (dono, termo, variantes, tratamento, simples, explicacao, exemplo, sinonimos, categoria, fonte, oficial)
select null, 'trânsito em julgado', array['transitou em julgado', 'transitada em julgado'], 'explicar', null,
  'Momento em que a decisão não pode mais ser mudada por recurso e passa a valer em definitivo.',
  null,
  array[]::text[], 'termo jurídico', 'corpus GCCCS 2026', true
where not exists (select 1 from verbetes where oficial = true and termo = 'trânsito em julgado');
