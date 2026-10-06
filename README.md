# LUCAS · Plataforma de Linguagem Simples

O LUCAS é uma plataforma web de linguagem simples para o Gabinete do Conselheiro Carlos Cezar do Tribunal de Contas do Estado de São Paulo (TCESP). Ajuda a aplicar linguagem simples a produtos técnicos como decisões e votos, sem perder o rigor jurídico. O principal recurso é o **Conversor**: gera uma versão em linguagem simples de uma decisão ou voto — um produto acessório, **sem valor jurídico**, para acompanhar ou ser publicado ao lado do documento oficial, sem substituí-lo. A plataforma reúne ainda um **editor** de apoio ao redator (análise de facilidade de leitura por parágrafo e trilha de revisão), enquetes de validação, materiais para aprender e uma metodologia aberta.

A plataforma é uma aplicação estática (HTML, CSS e JavaScript puro, sem etapa de build). Roda inteira no navegador. O Supabase é usado apenas como backend opcional das enquetes e do arquivamento, e as chamadas de IA do editor usam a chave do próprio usuário (BYOK, do inglês "traga sua própria chave"), que nunca sai do navegador.

---

## Estrutura de pastas

```
LUCAS-Plataforma/
├── index.html            # SPA da plataforma: home, enquetes, aprender, artigos, cursos, contato
├── conversor.html        # Conversor: versão em linguagem simples, sem valor jurídico
├── editor.html           # editor de apoio ao redator (análise por parágrafo, trilha de revisão)
├── jogar.html            # jogo de linguagem simples
├── metodologia.html      # metodologia aberta: fórmula, faixas, detectores, referências
├── antecipa.html         # página mantida, sem link na navegação
├── vercel.json           # configuração da publicação estática e cabeçalhos de segurança
├── README.md             # este arquivo
├── README-enquete.md     # guia específico do módulo de enquetes (não substituir)
├── NOTAS.md              # registro de decisões do módulo de enquetes
├── schema.sql            # esquema do banco das enquetes (Supabase)
├── js/                   # módulos ES do editor
│   ├── metricas.js       # motor de métricas por parágrafo e por documento (determinístico)
│   ├── silabas.js        # contagem aproximada de sílabas por núcleos vocálicos
│   ├── detectores.js     # detectores de frase longa, nominalização, voz passiva, siglas etc.
│   ├── dicionario.js     # busca de termos no texto e menu de ações do dicionário
│   ├── conversao.js      # painel de conversão por IA
│   ├── prompts.js        # biblioteca de prompts oficiais e instrução de sistema
│   ├── conferencia.js    # conferência automática das versões geradas por IA
│   ├── provedores.js     # camada de provedores de IA (BYOK, com streaming)
│   ├── registro.js       # registro de revisão (trilha de auditoria)
│   ├── editor.js         # orquestração e estado do editor
│   ├── conversor.js      # módulo Conversor: orquestra a conversão e a exportação
│   ├── importar/
│   │   ├── docx.js       # importação de DOCX, preservando o arquivo para reexportação
│   │   └── pdf.js        # importação de PDF, com reconstrução de parágrafos
│   └── exportar/
│       ├── docx.js       # exportação DOCX do editor (comentários, notas de rodapé, glossário)
│       └── conversor.js  # exportação do Conversor (DOCX/TXT/PDF) com disclaimer e vocabulário
├── lib/                  # bibliotecas auto-hospedadas
│   ├── jszip.min.js      # leitura e escrita de DOCX
│   ├── pdf.min.mjs       # pdf.js (Mozilla), extração de texto
│   └── pdf.worker.min.mjs# worker do pdf.js (exige worker-src 'self' blob:)
├── dados/
│   ├── dicionario.json   # verbetes do dicionário
│   └── sinonimos.json    # base de sinônimos
├── supabase/
│   └── migrations/       # migrações do banco
├── amostras/             # decisões de exemplo para testar o editor
└── testes/               # página de testes e valores esperados
    ├── testes.html
    └── esperado.json
```

O Supabase é carregado por CDN (`cdn.jsdelivr.net`); as fontes vêm do Google Fonts. As demais bibliotecas (JSZip e pdf.js) são auto-hospedadas em `lib/`, para não depender de terceiros na hora de ler e gravar arquivos.

---

## Funcionalidades

### Conversor

O Conversor gera uma **versão em linguagem simples** de uma decisão ou voto — um produto acessório, **sem valor jurídico**, pensado para acompanhar ou ser publicado ao lado do documento oficial, sem substituí-lo.

- **Entrada:** um ou mais documentos (DOCX, PDF, TXT) — cada um vira um produto independente — ou um parágrafo colado.
- **Prompt:** escolha da técnica de conversão (padrão: norma ABNT NBR ISO 24495 / Lei 15.263), com personalização guiada e opção de salvar o prompt na biblioteca.
- **Público-alvo:** calibra o vocabulário e o nível de explicação para quem vai ler.
- **Conversão por IA com BYOK:** a chave fica só no navegador. O resultado é editável por humano; dá para converter de novo pedindo ajustes.
- **Vocabulário:** anexa, opcionalmente, os termos da decisão que constam do dicionário, com a versão simples/explicação.
- **Exportação (DOCX, TXT, PDF):** sai sempre com um aviso de que é uma versão em linguagem simples, sem validade jurídica, que não substitui o documento oficial; mais o link do documento oficial e o responsável pela validação humana (com textos-padrão de ressalva quando não informados).

### Editor (apoio ao redator)

- **Importação:** carrega DOCX (guardando o arquivo original para reexportar), PDF com camada de texto (reconstruindo linhas e parágrafos a partir das posições), ou TXT, além de colar e escrever direto na tela.
- **Índice por parágrafo:** cada parágrafo é analisado por um motor de métricas determinístico. Ao lado, numa margem parecida com a de comentários do Word, aparecem a faixa de facilidade de leitura e os motivos concretos que puxam a faixa para baixo (frase longa demais, nominalização, voz passiva, sigla sem abertura, termo com alternativa simples, entre outros).
- **Dicionário interativo:** termos do dicionário aparecem sublinhados no texto. Ao clicar num termo, o usuário pode trocá-lo pela versão simples, reescrever a frase com IA, criar uma nota de rodapé, incluir o termo no glossário do apêndice ou consultar sinônimos. Termos com efeito jurídico próprio podem ser explicados, nunca trocados.
- **Conversão por IA com BYOK:** um painel propõe versões em linguagem simples ao lado do original, usando o provedor de IA escolhido pelo usuário e a chave dele. A chave fica só no navegador (`localStorage`) e nunca vai para o servidor.
- **Conferência automática:** toda versão gerada por IA passa por verificações antes de aparecer (número que sumiu ou apareceu, termo protegido removido, versão maior que o original, frase ainda longa, resposta em formato inesperado). Nada é aceito sem decisão da pessoa.
- **Registro de revisão:** cada alteração de texto gera uma linha na trilha, com faixa antes e depois, prompt, provedor, alertas e a decisão tomada. É exportável em CSV e JSON.
- **Exportação DOCX:** o texto revisado sai em DOCX com comentários nativos do Word, notas de rodapé nativas e um glossário em tabela ao final. Documentos importados de PDF são exportados como DOCX gerado.

### Enquetes (validação social)

Enquetes colaborativas de linguagem simples: alguém propõe um texto difícil, o grupo vota em qual reescrita ficou mais clara e pode sugerir versões novas. Sem login, o voto é por dispositivo; quem cria recebe uma chave de autor. É o mecanismo de validação social da plataforma. O guia completo do módulo está em `README-enquete.md`, e o esquema do banco em `schema.sql`.

### Aprender e Metodologia

A página Aprender reúne conteúdo introdutório, artigos e cursos. A página Metodologia (`metodologia.html`) documenta, em linguagem simples, como o índice é calculado, o que cada faixa significa, o que cada detector aponta, onde a IA entra e onde não entra, o que fica no navegador e o que vai para o servidor, além das limitações conhecidas e das referências.

### Jogar

Um jogo de linguagem simples (`jogar.html`), para praticar a identificação e a reescrita de trechos difíceis de forma leve.

### Dicionário

Base de verbetes (`dados/dicionario.json`) com termos difíceis, tratamento (substituir ou explicar), versão simples, explicação, exemplos e sinônimos. Alimenta o dicionário interativo do editor e a base de sinônimos (`dados/sinonimos.json`).

---

## Índice de facilidade de leitura

O editor calcula um índice de facilidade por parágrafo e para o documento inteiro, apresentado por faixa e cor, não por número solto, para não virar meta de desempenho.

**Fórmula:**

```
Facilidade = 248,835 − 1,015 × (palavras ÷ frases) − 84,6 × (sílabas ÷ palavras)
```

**Origem:**

1. Flesch (1948): `206,835 − 1,015 × ASL − 84,6 × ASW`, com coeficientes obtidos por regressão e escala multiplicada por 10.
2. Martins, Ghiraldelo, Nunes e Oliveira Jr. (1996): adaptação para o português, com acréscimo de 42 pontos.
3. `206,835 + 42 = 248,835`, forma implementada pelo NILC (Núcleo Interinstitucional de Linguística Computacional, USP).

As faixas (muito fácil, fácil, razoavelmente difícil, muito difícil) seguem Martins et al. (1996). O índice mede o esforço que o texto exige de quem lê, não se o leitor entendeu. Serve para priorizar a revisão, nunca para dar nota ao texto.

---

## Índice de Clareza (legibilidade + avaliação por IA)

O índice de facilidade acima mede só o **esforço de leitura** (tamanho de frases e palavras). Ele não diz se o texto está de fato **claro** segundo as diretrizes de linguagem simples jurídica. Para isso, o editor oferece o **Índice de Clareza**, que combina duas medidas complementares numa nota única de 0 a 100:

- **A — Legibilidade (Flesch-Martins):** a fórmula determinística acima, objetiva e reproduzível, mas que só enxerga o tamanho de frases e palavras.
- **B — Avaliação de clareza por IA:** cada parágrafo é analisado à luz da Lei nº 15.263/2025 e da ABNT NBR ISO 24495 (partes 1 e 2) e recebe uma nota de 0 a 100. A IA aponta o que pode melhorar; **não reescreve nem decide**.

**Fórmula:**

```
Índice de Clareza = wL × Legibilidade (Flesch) + wI × Nota de clareza (IA)
```

Os pesos `wL` e `wI` são **definidos pelo usuário**. O padrão é **40 para a legibilidade e 60 para a avaliação por IA** (normalizados para somar 1, isto é, 0,4 e 0,6). O padrão dá peso maior à avaliação por IA porque ela contempla mais critérios de linguagem simples do que a legibilidade sozinha. Quando o usuário não executa a avaliação por IA, o índice recai apenas na legibilidade e é rotulado como tal.

O **Índice de Clareza é uma construção dos próprios autores do LUCAS**, não uma métrica científica consagrada: não existe proporção com precisão científica entre a legibilidade estrutural e a compreensão de fato. Justamente por isso o LUCAS **não fixa** essa proporção e deixa os pesos **ajustáveis** por quem revisa — os valores escolhidos são persistidos e informados ao modelo na avaliação. As faixas de cor são: Muito claro (75 a 100), Claro (50 a 75), Clareza razoável (25 a 50) e Pouco claro (abaixo de 25).

A parte determinística (Flesch) segue fórmula pública e fixa; a parte por IA usa um prompt de avaliação aberto — o botão **ver prompt**, no editor, mostra exatamente os critérios e as instruções enviados ao modelo. A IA é sempre apoio à revisão humana, nunca a palavra final.

---

## Licença

Distribuído sob a licença MIT.
