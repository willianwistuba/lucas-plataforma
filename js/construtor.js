// construtor.js — fonte única do construtor guiado de prompt e do público-alvo.
// Compartilhado entre o Editor (editor.js) e a Biblioteca de prompts
// (biblioteca.js), para que as opções e a montagem da instrução não divirjam.
// Determinístico, sem IA e sem rede: só monta texto a partir das escolhas.

// Públicos destinatários (calibram a linguagem que a IA usa).
const PUBLICOS = [
  { id: 'partes', curto: 'Partes e interessados', rotulo: 'as partes e os interessados no processo, em geral sem formação jurídica' },
  { id: 'advogados', curto: 'Advogados e procuradores', rotulo: 'os advogados e procuradores das partes, que dominam o vocabulário jurídico' },
  { id: 'interno', curto: 'Público interno do Tribunal', rotulo: 'o público interno do Tribunal (servidores, assessores e autoridades)' },
  { id: 'imprensa', curto: 'Imprensa e sociedade', rotulo: 'a imprensa e a sociedade em geral, sem formação jurídica' }
];

// Dimensões do construtor guiado (enxuto).
const CONSTRUTOR_OBJETIVO = [
  { id: 'completa', txt: 'Linguagem simples completa', instr: 'Reescreva em linguagem simples jurídica, aplicando as diretrizes de frases curtas, ordem direta, voz ativa e termos explicados.' },
  { id: 'frases', txt: 'Quebrar frases longas', instr: 'Divida as frases longas em frases menores, com uma ideia por frase.' },
  { id: 'ativa', txt: 'Voz ativa e verbos', instr: 'Prefira a voz ativa, com o agente da ação visível, e troque substantivos derivados de verbo pelo verbo correspondente.' },
  { id: 'siglas', txt: 'Abrir siglas e explicar termos', instr: 'Escreva cada sigla por extenso na primeira menção (com a sigla entre parênteses) e explique os termos técnicos indispensáveis, mantendo o termo.' },
  { id: 'lista', txt: 'Lista de ações', instr: 'Quando fizer sentido, apresente as determinações como lista de ações (quem faz o quê), distinguindo o que é obrigatório do que é recomendação.' },
  { id: 'resumo', txt: 'Começar por um resumo', instr: 'Comece por uma frase curta que resuma o que foi decidido, antes dos detalhes.' }
];
const CONSTRUTOR_TOM = [
  { id: 'neutro', txt: 'Institucional neutro', instr: 'Use um tom institucional, neutro e respeitoso.' },
  { id: 'acolhedor', txt: 'Acolhedor ao cidadão', instr: 'Use um tom acolhedor e cordial, falando de forma direta com o leitor quando isso ajudar a compreensão.' },
  { id: 'didatico', txt: 'Didático', instr: 'Use um tom didático, explicando o porquê das coisas de forma simples.' },
  { id: 'direto', txt: 'Direto e objetivo', instr: 'Use um tom direto e objetivo, sem rodeios.' }
];
const CONSTRUTOR_FORMATO = [
  { id: 'corrido', txt: 'Texto corrido', instr: 'Mantenha o texto em parágrafos corridos.' },
  { id: 'subtitulos', txt: 'Com subtítulos por tema', instr: 'Organize o texto com subtítulos curtos por tema, em forma de afirmação ou pergunta, sem juridiquês.' },
  { id: 'topicos', txt: 'Lista de tópicos', instr: 'Sempre que o conteúdo permitir, use listas de tópicos.' },
  { id: 'perguntas', txt: 'Perguntas e respostas', instr: 'Estruture o conteúdo como perguntas e respostas que o leitor faria.' }
];
const CONSTRUTOR_PRESETS = [
  { id: 'cidadao', nome: 'Para o cidadão', objetivo: ['completa', 'siglas'], tom: 'acolhedor', formato: 'subtitulos', publicos: ['partes', 'imprensa'] },
  { id: 'imprensa', nome: 'Para a imprensa', objetivo: ['completa', 'resumo'], tom: 'direto', formato: 'subtitulos', publicos: ['imprensa'] },
  { id: 'resumo', nome: 'Resumo executivo', objetivo: ['resumo', 'frases'], tom: 'direto', formato: 'topicos', publicos: ['interno'] },
  { id: 'abnt', nome: 'Conforme ABNT (completa)', objetivo: ['completa', 'ativa', 'siglas'], tom: 'neutro', formato: 'subtitulos', publicos: ['partes'] }
];

// Concatena as escolhas numa instrução de conversão em texto.
function montarInstrucaoConstrutor(sel) {
  const linhas = [];
  (sel.objetivo || []).forEach((id) => { const o = CONSTRUTOR_OBJETIVO.find((x) => x.id === id); if (o) linhas.push(o.instr); });
  const t = CONSTRUTOR_TOM.find((x) => x.id === sel.tom); if (t) linhas.push(t.instr);
  const f = CONSTRUTOR_FORMATO.find((x) => x.id === sel.formato); if (f) linhas.push(f.instr);
  const pubs = (sel.publicos || []).map((id) => (PUBLICOS.find((p) => p.id === id) || {}).rotulo).filter(Boolean);
  if (pubs.length) linhas.push(`Escreva pensando em ${pubs.join('; ')}, priorizando o leitor com menos familiaridade jurídica, sem perder a precisão técnica.`);
  return linhas.join(' ');
}

export {
  PUBLICOS,
  CONSTRUTOR_OBJETIVO,
  CONSTRUTOR_TOM,
  CONSTRUTOR_FORMATO,
  CONSTRUTOR_PRESETS,
  montarInstrucaoConstrutor
};
