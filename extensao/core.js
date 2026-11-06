export const normalizeName = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
export const normalizeText = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/[\u200b-\u200f\ufeff]/g, '').split('\n').map(s => s.trimEnd()).join('\n').trim();
// WhatsApp may turn a leading '- ' list marker into '* ' or '• ' when editing/rendering.
// Normalize markers before collapsing whitespace; retain all other punctuation.
const comparableMessage = value => normalizeText(value).replace(/^[ \t]*[-*•](?=[ \t]+\S)/gm, '-').replace(/\s+/g, ' ');
export const messagesMatch = (actual, expected) => comparableMessage(actual) === comparableMessage(expected);
/** Compara textos normalizados e descreve a primeira divergência. O retorno pode conter conteúdo privado: não publique diagnósticos reais. */
export function draftDiagnostic(actual, expected) {
  const read = comparableMessage(actual), preview = comparableMessage(expected);
  let index=0;
  while(index<read.length&&index<preview.length&&read[index]===preview[index])index++;
  const matches=read===preview;
  const excerpt=text=>text.slice(Math.max(0,index-40),index+80);
  const codePoints=text=>Array.from(text.slice(index,index+8)).map(c=>'U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0'));
  return {matches,firstDifference:matches?null:index,readExcerpt:matches?null:excerpt(read),expectedExcerpt:matches?null:excerpt(preview),readCodePoints:matches?[]:codePoints(read),expectedCodePoints:matches?[]:codePoints(preview),readText:String(actual??''),expectedText:String(expected??'')};
}
/** Normaliza um celular brasileiro e rejeita formato incompatível; não verifica se existe uma conta WhatsApp. */
export function phoneNumber(value) {
  let phone = String(value ?? '').replace(/[\s()+.-]/g, '');
  if (/^\d{11}$/.test(phone)) phone = '55' + phone;
  if (!/^55[1-9]\d9\d{8}$/.test(phone)) throw new Error('Celular deve ter 55 + DDD + 9 dígitos.');
  return phone;
}
/** Produz SHA-256 para identificar a operação de forma estável entre importações. */
export async function digest(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
/** Converte as células do XLSX em itens validados, substitui variáveis e identifica contatos compartilhados. Não envia mensagens. */
export async function buildQueue(workbook) {
  const cells = workbook.Contatos, guide = workbook['Orientações'];
  const columns = {};
  for (const [address, value] of Object.entries(cells)) { const match = /^([A-Z]+)1$/.exec(address); if (match) columns[value] = match[1]; }
  const required = ['Enviar?', 'Aluno', 'Responsável', 'WhatsApp', 'Turma de destino', 'Condições de pagamento', 'Mensagem personalizada', 'Condição 2026'];
  for (const h of required) if (!columns[h]) throw new Error('Coluna ausente: ' + h);
  const template = normalizeText(guide.B9);
  if (!template) throw new Error('Preencha o Modelo padrão em Orientações, célula B9.');
  const rowNumbers = [...new Set(Object.keys(cells).map(a => Number(a.match(/\d+$/)?.[0])).filter(r => r > 1))].sort((a,b) => a-b);
  const get = (row, heading) => String(cells[columns[heading] + row] ?? '').trim();
  const rows = [], seen = new Set();
  for (const row of rowNumbers) {
    const aluno = get(row, 'Aluno'); if (!aluno) continue;
    const flag = normalizeName(get(row, 'Enviar?'));
    if (!['SIM', 'NAO', ''].includes(flag)) throw new Error('Enviar? inválido na linha ' + row);
    const selected = flag === 'SIM', nameKey = normalizeName(aluno);
    if (seen.has(nameKey)) throw new Error('Aluno duplicado na planilha: ' + aluno);
    seen.add(nameKey);
    const item = {row, aluno, responsavel: get(row, 'Responsável'), phone: get(row, 'WhatsApp'), selected, errors: [], message: '', source2026: get(row, 'Condição 2026'), source2027: get(row, 'Condições de pagamento')};
    try { item.phone = phoneNumber(item.phone); } catch(e) { item.errors.push(e.message); }
    if (!item.responsavel) item.errors.push('Responsável vazio.');
    let message = get(row, 'Mensagem personalizada') || template;
    const variables = {aluno, responsavel:item.responsavel, turma_destino:get(row,'Turma de destino'), condicao_2026:item.source2026, condicoes_pagamento:item.source2027};
    for (const match of message.matchAll(/\{([^{}]+)\}/g)) {
      if (!(match[1] in variables)) item.errors.push('Campo desconhecido: ' + match[0]);
      else if (!variables[match[1]]) item.errors.push('Campo vazio: ' + match[1]);
    }
    message = message.replace(/\{([^{}]+)\}/g, (all,key) => variables[key] ?? all);
    item.message = normalizeText(message);
    item.id = await digest('rematriculas-2027|' + nameKey);
    rows.push(item);
  }
  const count = new Map();
  rows.filter(r=>r.selected).forEach(r=>count.set(r.phone,(count.get(r.phone)||0)+1));
  for (const item of rows) {
    item.shared = item.selected && count.get(item.phone) > 1;
    if (item.shared && !normalizeName(item.message).includes(normalizeName(item.aluno))) item.message = 'Aluno: ' + item.aluno + '\n\n' + item.message;
    if (item.message.length > 8000) item.errors.push('Mensagem acima de 8.000 caracteres.');
    item.hash = await digest(item.phone + '\n' + item.message);
  }
  if (!rows.length) throw new Error('A aba Contatos está vazia.');
  return {rows, template, importedAt: new Date().toISOString()};
}
/** Resolve o estado exibido a partir da linha importada e do histórico persistido. */
export function stateFor(row, ledger) {
  if (!row.selected) return 'Não selecionado';
  if (row.errors.length) return 'Corrigir planilha';
  return ledger[row.id]?.state ?? 'Pendente';
}
/** Determina se um item selecionado e válido ainda pode ser enviado sem repetir uma tentativa registrada. */
export function canSend(row, ledger) {
  return row.selected && !row.errors.length && !['Enviado', 'Envio acionado', 'Tentativa incerta'].includes(ledger[row.id]?.state);
}
