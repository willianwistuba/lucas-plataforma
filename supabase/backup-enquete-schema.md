# Backup do estado anterior — projeto `fedycfavzrqrbbdcyhau` (lucas_enquete)

Antes de repurposar o projeto para a plataforma LUCAS (unificada enquete + editor),
registro o estado do projeto anterior. Todas as 9 tabelas do app de enquetes
estavam **VAZIAS (0 linhas)** no momento do backup, então **nenhum dado foi perdido**.
As tabelas do LUCAS foram **acrescentadas** (não substituem nem alteram as do enquete).

Tabelas do enquete preservadas (schema `public`):

- **autores** (id uuid pk, nome, email, criado_em)
- **enquetes** (id, codigo, titulo, contexto, autor_id, chave_hash, tipo_voto='aprovacao', mostrar_resultado='fim', prazo, encerrada, criada_em, chave_codigo)
- **redacoes** (id, enquete_id, texto, status='aprovada', sugerida_por, criada_em, sugerido_email)
- **votos** (id, enquete_id, token, nome, comentario, criado_em)
- **voto_redacao** (voto_id, redacao_id)
- **artigos** (id, titulo, url, autor, fonte, publicado_em, ordem, criado_em)
- **cursos** (id, titulo, url, descricao, instituicao, carga, gratuito, certificado, ordem, criado_em)
- **jogo_pontuacoes** (id, nome, email, token, modo='rapido', acertos, total, pct, detalhes jsonb, criado_em)
- **contatos** (id, tipo, nome, email, material, titulo, url, mensagem, token, criado_em)

Todas com RLS habilitado. Snapshot capturado via information_schema em 2026 (restauração do projeto pausado).

Tabelas do LUCAS acrescentadas: ver `migrations/001_esquema.sql` (perfis, documentos,
prompts, verbetes, registro_revisao) e `migrations/002_auth_tcesp.sql` (trava de
domínio @tce.sp.gov.br + criação de perfil).
