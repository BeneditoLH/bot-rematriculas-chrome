// Leitor local de XLSX (ZIP/XML). Sem código remoto ou dependências externas.
const xml = text => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido na planilha. Salve novamente como .xlsx.');
  return doc;
};
const elements = (node, name) => [...node.getElementsByTagNameNS('*', name)];
/** Resolve caminhos internos do pacote XLSX para localizar os documentos XML relacionados. */
function pathJoin(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (base + '/' + target).split('/'), out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}
/** Lê entradas ZIP do XLSX respeitando os limites de tamanho e formatos suportados. */
async function unzip(buffer) {
  if (buffer.byteLength > 20 * 1024 * 1024) throw new Error('Use uma planilha de até 20 MB.');
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('O arquivo não é um XLSX válido ou está protegido.');
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('ZIP dividido não suportado.');
  const count = view.getUint16(end + 10, true);
  if (count > 3000) throw new Error('Planilha complexa demais. Exporte apenas as abas Contatos e Orientações.');
  let p = view.getUint32(end + 16, true), total = 0;
  const files = new Map(), decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP inválido.');
    const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true), expanded = view.getUint32(p + 24, true);
    const nameSize = view.getUint16(p + 28, true), extra = view.getUint16(p + 30, true), comment = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.slice(p + 46, p + 46 + nameSize));
    p += 46 + nameSize + extra + comment;
    if (flags & 1) throw new Error('Remova a senha da planilha antes de importar.');
    if (!name.startsWith('xl/') || !name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    total += expanded;
    if (total > 60 * 1024 * 1024 || expanded > 20 * 1024 * 1024) throw new Error('Conteúdo da planilha excede o limite.');
    if (offset + 30 > bytes.length || view.getUint32(offset, true) !== 0x04034b50) throw new Error('Entrada ZIP inválida.');
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    if (start + size > bytes.length) throw new Error('Arquivo incompleto.');
    let body = bytes.slice(start, start + size);
    if (method === 8) {
      const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader(), chunks = []; let length = 0;
      while (true) { const {done, value} = await reader.read(); if (done) break; length += value.length; if (length > expanded || length > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('Tamanho ZIP inconsistente.'); } chunks.push(value); }
      body = new Uint8Array(length); let at = 0; for (const chunk of chunks) { body.set(chunk, at); at += chunk.length; }
    } else if (method !== 0) throw new Error('Compressão não suportada. Salve novamente como XLSX.');
    if (body.length !== expanded) throw new Error('Conteúdo ZIP incompleto.');
    files.set(name, decoder.decode(body));
  }
  return files;
}
/** Extrai células das planilhas XML do XLSX no navegador, sem enviar o arquivo a um servidor. */
export async function readXlsx(buffer) {
  const files = await unzip(buffer);
  if (!files.has('xl/workbook.xml') || !files.has('xl/_rels/workbook.xml.rels')) throw new Error('Estrutura XLSX não encontrada.');
  const rels = new Map(elements(xml(files.get('xl/_rels/workbook.xml.rels')), 'Relationship').filter(r => r.getAttribute('TargetMode') !== 'External').map(r => [r.getAttribute('Id'), pathJoin('xl', r.getAttribute('Target'))]));
  const strings = files.has('xl/sharedStrings.xml') ? elements(xml(files.get('xl/sharedStrings.xml')), 'si').map(si => elements(si, 't').map(t => t.textContent).join('')) : [];
  const result = {};
  for (const sheet of elements(xml(files.get('xl/workbook.xml')), 'sheet')) {
    const name = sheet.getAttribute('name'); if (!['Contatos', 'Orientações'].includes(name)) continue;
    const id = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id');
    const file = files.get(rels.get(id)); if (!file) throw new Error('Aba não encontrada: ' + name);
    const cells = {};
    for (const c of elements(xml(file), 'c')) {
      const address = c.getAttribute('r'), type = c.getAttribute('t');
      let value = elements(c, 'v')[0]?.textContent ?? '';
      if (type === 's') value = strings[Number(value)] ?? '';
      if (type === 'inlineStr') value = elements(c, 't').map(t => t.textContent).join('');
      if (type === 'e') throw new Error('Erro na célula ' + name + '!' + address + ': ' + value);
      cells[address] = value;
    }
    result[name] = cells;
  }
  if (!result.Contatos || !result['Orientações']) throw new Error('A planilha precisa das abas Contatos e Orientações.');
  return result;
}
