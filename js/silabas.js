// silabas.js — contagem aproximada de sílabas do português, por núcleos vocálicos.
// SPEC secao 6.3. Determinístico, sem IA, sem rede (principio P5).
//
// Regra:
//   1. Trabalhar em minúsculas.
//   2. Grupo de vogais consecutivas conta como UM núcleo, salvo a regra 3.
//   3. Contam como DOIS (hiato):
//        - vogal seguida de "í" ou "ú" (acentuadas);
//        - pares "ea", "eo", "oa", "oe" sem til;
//        - "ia" e "io" em final de palavra.
//   4. Contam como UM: ditongos ai, ei, oi, ui, au, eu, ou, iu e nasais ão, ãe, õe.
//      (já resultam de 1 pela regra base; a regra 4 garante que não sejam quebrados)
//   5. Mínimo de uma sílaba por palavra.
//
// Criterio de aceite (teste T2): diferença média < 3% numa lista de 200 palavras.

const VOGAIS = new Set([
  'a', 'e', 'i', 'o', 'u', 'y',
  'á', 'é', 'í', 'ó', 'ú',
  'à', 'è', 'ì', 'ò', 'ù',
  'â', 'ê', 'î', 'ô', 'û',
  'ã', 'õ',
  'ä', 'ë', 'ï', 'ö', 'ü'
]);

function ehVogal(ch) {
  return VOGAIS.has(ch);
}

// Decide se há fronteira de sílaba (hiato) entre duas vogais adjacentes x e y.
// finalDePalavra: true quando y é o último caractere da palavra.
function haFronteira(x, y, finalDePalavra) {
  // Regra 3, primeiro caso: vogal seguida de í ou ú acentuados -> hiato.
  if (y === 'í' || y === 'ú') return true;

  const par = x + y;

  // Regra 3, segundo caso: ea, eo, oa, oe sem til -> hiato.
  if (par === 'ea' || par === 'eo' || par === 'oa' || par === 'oe') return true;

  // Regra 3, terceiro caso: ia e io em final de palavra -> hiato.
  if ((par === 'ia' || par === 'io') && finalDePalavra) return true;

  // Todo o resto (ditongos, nasais, demais grupos) fica no mesmo núcleo.
  return false;
}

// Conta os núcleos vocálicos (sílabas) de uma palavra.
function contarSilabasPalavra(palavra) {
  const p = String(palavra || '').toLowerCase();
  if (!p) return 0;

  let silabas = 0;
  let dentroDeVogal = false;
  let vogalAnterior = '';

  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ehVogal(ch)) {
      if (!dentroDeVogal) {
        // Início de um novo grupo vocálico -> um núcleo.
        silabas += 1;
        dentroDeVogal = true;
      } else {
        // Continuação de grupo: decidir se é hiato (novo núcleo).
        const finalDePalavra = i === p.length - 1;
        if (haFronteira(vogalAnterior, ch, finalDePalavra)) {
          silabas += 1;
        }
      }
      vogalAnterior = ch;
    } else {
      dentroDeVogal = false;
      vogalAnterior = '';
    }
  }

  return Math.max(1, silabas); // regra 5
}

// Conta o total de sílabas de uma lista de palavras.
function contarSilabas(palavras) {
  let total = 0;
  for (const w of palavras) total += contarSilabasPalavra(w);
  return total;
}

export { contarSilabasPalavra, contarSilabas, ehVogal };
