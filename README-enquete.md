# LUCAS · Enquetes de Linguagem Simples

App web para enquetes colaborativas de **Linguagem Simples**: alguém propõe um termo ou frase difícil, o grupo vota em qual reescrita ficou mais clara e pode sugerir versões novas. Sem login, sem instalação — funciona no navegador e se compartilha por um link.

É um único `index.html` (HTML + CSS + JS, sem build) falando com um banco **Supabase**. Dá pra rodar localmente abrindo o arquivo e publicar de graça na Vercel.

---

## O que tem na pasta

```
lucas-ep/
├── index.html            ← o app inteiro (é isto que vai pro ar)
├── supabase/
│   └── schema.sql         ← cria tabelas, segurança e funções no banco
├── README.md              ← este arquivo
└── .gitignore
```

---

## Passo a passo (uns 10 minutos)

### 1. Crie o projeto no Supabase

1. Entre em [supabase.com](https://supabase.com) e faça login.
2. **New project**. Dê um nome (ex.: `lucas`), escolha uma senha de banco (guarde) e a região mais perto (South America / São Paulo).
3. Espere o projeto subir (1–2 min).

> No plano Free dá pra ter **2 projetos ativos** por organização. Se já tiver 2, crie uma organização nova (também grátis) ou pause um projeto inativo.

### 2. Rode o schema

1. No projeto, menu lateral → **SQL Editor** → **New query**.
2. Abra o arquivo `supabase/schema.sql`, copie **tudo** e cole no editor.
3. **Run**. Deve terminar sem erro (vários "Success"). Isso cria as 5 tabelas, liga a segurança e instala as funções.

### 3. Pegue as credenciais

1. Menu lateral → **Project Settings** (engrenagem) → **API**.
2. Copie dois valores:
   - **Project URL** (algo como `https://xxxxxxxx.supabase.co`)
   - **anon public** (uma chave longa, na seção *Project API keys*)

> A `anon key` é **pública por natureza** — pode versionar e expor no front sem problema. A segurança não depende de escondê-la: as tabelas estão trancadas e todo acesso passa pelas funções. (A chave **service_role**, essa sim é secreta — não use no app, não coloque em lugar nenhum do `index.html`.)

### 4. Plugue no app

Abra o `index.html` num editor e, no topo do `<script>`, preencha as duas linhas:

```js
const SUPABASE_URL      = 'https://xxxxxxxx.supabase.co';   // sua Project URL
const SUPABASE_ANON_KEY = 'sua_anon_key_aqui';              // sua anon public
```

Salve. Se você abrir o app sem preencher isso, ele mostra uma tela avisando exatamente o que falta.

### 5. Teste local

Abra o `index.html` no navegador (clique duplo já serve). Crie uma enquete de teste, copie o link, abra numa aba anônima e vote. Confira a checklist mais abaixo.

### 6. Publique na Vercel

No terminal, dentro da pasta `lucas-ep/`:

```bash
npx vercel        # primeira vez: faz login e cria o projeto
npx vercel --prod # publica em produção
```

A Vercel te dá uma URL pública. Como é um site estático, não precisa configurar nada de build. Pronto: é esse link que você manda no grupo.

> **No ar:** https://plataformalucas.vercel.app/ — os links de enquete saem com este domínio automaticamente (o gerador usa `location.origin`, sem domínio fixo no código).

> Alternativas igualmente simples: arrastar a pasta no [app.netlify.com/drop](https://app.netlify.com/drop), ou usar GitHub Pages.

---

## Checklist de teste (vale a pena fazer uma vez)

A segurança aqui depende do **RLS** (Row Level Security) do Supabase, que é onde a maioria dos projetos furа. Neste app ele está blindado: as tabelas têm RLS ligado **sem nenhuma policy** (ninguém lê tabela direto) e todo acesso passa por funções controladas. Confirme assim:

- [ ] **Criar funciona**: crie uma enquete; você recebe um link e uma chave `LS-XXXXXX-XXXXXX`.
- [ ] **Votar funciona**: abra o link numa aba anônima, marque uma versão, confirme.
- [ ] **Voto não duplica**: vote de novo no mesmo navegador — substitui, não soma.
- [ ] **Resultado respeita a regra**: numa enquete "só no fim" e ainda aberta, o público **não** vê o resultado; você (com a chave) vê.
- [ ] **Sugestão entra como pendente**: sugira uma versão votando; ela só aparece pra todos depois que você aprova no painel.
- [ ] **Chave errada é barrada**: tente abrir o painel com uma chave inventada — recusa.
- [ ] **Encerrar funciona**: encerre pela chave; novos votos são bloqueados e o resultado fica visível.

Se quiser checar no banco que nada vaza: no **Table Editor**, a tabela `enquetes` tem a coluna `chave_hash` — ela **nunca** é devolvida pra quem vota (a função `obter_para_votar` não a inclui). E-mails dos autores idem.

---

## Como funciona (resumo)

- **Identidade sem login.** Quem vota é identificado por um *token de dispositivo* no `localStorage` (1 voto por navegador). Quem cria recebe uma *chave de autor* (`LS-CODIGO-SEGREDO`) que é guardada no banco só como **hash bcrypt** — o segredo aparece uma vez e some.
- **Tudo via funções.** O front nunca toca nas tabelas direto: chama funções (`criar_enquete`, `registrar_voto`, `obter_resultado`…) que devolvem só o necessário. Por isso o `index.html` pode ser público sem risco.
- **Voto de aprovação.** Por padrão cada pessoa marca quantas versões quiser (a mais aceita vence). Dá pra configurar "escolher uma só" na criação.
- **Curadoria.** Sugestões de quem vota entram como *pendentes*; só o autor aprova ou recusa.
- **Teto de 8 versões** por enquete, pra tela de votar não virar uma lista interminável.

---

## Resgate de chave (quando alguém perde)

Não existe tela de admin no app — é de propósito, pra não virar superfície de ataque. Quando alguém perder a chave, você resolve direto no painel do Supabase:

1. **Table Editor → `autores`**: ache a pessoa por nome/e-mail.
2. **Table Editor → `enquetes`**: ache a enquete dela e anote o `codigo`.
3. **SQL Editor**, rode:
   ```sql
   select admin_reemitir_chave('CODIGO_AQUI');
   ```
4. O retorno é a **chave nova** — entregue pra pessoa. A antiga deixa de funcionar na hora.

---

## Próximos passos (ideias para v2)

- **PWA**: adicionar `manifest.json` + service worker pra instalar como app no celular.
- **Tempo real**: o painel do autor atualizar sozinho quando chegam votos/sugestões (Supabase Realtime).
- **Comentários por voto**: já há campo no banco (`votos.comentario`), falta só a UI.
- **Domínio próprio**: apontar um domínio na Vercel.

---

Feito com HTML, CSS e JS puro. Sem framework, sem build, sem dependência além do cliente do Supabase (carregado por CDN).
