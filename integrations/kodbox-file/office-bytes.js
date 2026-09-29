import { deflateRawSync, inflateRawSync } from "node:zlib";
import { rename, unlink, writeFile } from "node:fs/promises";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let state = 4294967295;
  for (let index = 0; index < bytes.length; index += 1) {
    state = (CRC_TABLE[(state ^ bytes[index]) & 255] ^ state >>> 8) >>> 0;
  }
  return (state ^ 4294967295) >>> 0;
}

function u16(target, offset, value) {
  target[offset] = value & 255;
  target[offset + 1] = value >>> 8 & 255;
}

function u32(target, offset, value) {
  target[offset] = value & 255;
  target[offset + 1] = value >>> 8 & 255;
  target[offset + 2] = value >>> 16 & 255;
  target[offset + 3] = value >>> 24 & 255;
}

// Stored or deflated zip. Unchanged entries keep their original compressed bytes.
export function buildBinaryZip(parts) {
  if (!parts.length) throw new Error("office package is empty");
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const part of parts) {
    const name = encoder.encode(part.name);
    if (name.length > 65535) throw new Error(`zip entry name is too long: ${part.name}`);
    let method;
    let compressed;
    let size;
    let crc;
    if (part.compressed) {
      method = part.method;
      compressed = part.compressed;
      size = part.uncompressedSize;
      crc = part.crc >>> 0;
    } else {
      const data = part.data;
      size = data.length;
      crc = crc32(data);
      const deflated = deflateRawSync(data);
      if (deflated.length < data.length) {
        method = 8;
        compressed = deflated;
      } else {
        method = 0;
        compressed = data;
      }
    }
    const local = new Uint8Array(30 + name.length);
    u32(local, 0, 0x04034b50);
    u16(local, 4, 20);
    u16(local, 8, method);
    u32(local, 14, crc);
    u32(local, 18, compressed.length);
    u32(local, 22, size);
    u16(local, 26, name.length);
    local.set(name, 30);
    locals.push(local, compressed);
    const central = new Uint8Array(46 + name.length);
    u32(central, 0, 0x02014b50);
    u16(central, 4, 20);
    u16(central, 6, 20);
    u16(central, 10, method);
    u32(central, 16, crc);
    u32(central, 20, compressed.length);
    u32(central, 24, size);
    u16(central, 28, name.length);
    u32(central, 42, offset);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length + compressed.length;
  }
  const directory = concat(centrals);
  const eocd = new Uint8Array(22);
  u32(eocd, 0, 0x06054b50);
  u16(eocd, 8, parts.length);
  u16(eocd, 10, parts.length);
  u32(eocd, 12, directory.length);
  u32(eocd, 16, offset);
  return Buffer.from(concat([...locals, directory, eocd]));
}

function concat(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

export function readZipEntries(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : Buffer.from(bytes);
  let eocd = -1;
  const scanStart = Math.max(0, view.length - 22 - 65535);
  for (let index = view.length - 22; index >= scanStart; index -= 1) {
    if (view[index] === 80 && view[index + 1] === 75 && view[index + 2] === 5 && view[index + 3] === 6) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip has no central directory");
  const total = view[eocd + 10] | view[eocd + 11] << 8;
  let cursor = (view[eocd + 16] | view[eocd + 17] << 8 | view[eocd + 18] << 16 | view[eocd + 19] << 24) >>> 0;
  const entries = [];
  for (let count = 0; count < total; count += 1) {
    const method = view[cursor + 10] | view[cursor + 11] << 8;
    const crc = (view[cursor + 16] | view[cursor + 17] << 8 | view[cursor + 18] << 16 | view[cursor + 19] << 24) >>> 0;
    const compressedSize = (view[cursor + 20] | view[cursor + 21] << 8 | view[cursor + 22] << 16 | view[cursor + 23] << 24) >>> 0;
    const uncompressedSize = (view[cursor + 24] | view[cursor + 25] << 8 | view[cursor + 26] << 16 | view[cursor + 27] << 24) >>> 0;
    const nameLength = view[cursor + 28] | view[cursor + 29] << 8;
    const extraLength = view[cursor + 30] | view[cursor + 31] << 8;
    const commentLength = view[cursor + 32] | view[cursor + 33] << 8;
    const localOffset = (view[cursor + 42] | view[cursor + 43] << 8 | view[cursor + 44] << 16 | view[cursor + 45] << 24) >>> 0;
    const name = new TextDecoder().decode(view.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    const nameLen = view[localOffset + 26] | view[localOffset + 27] << 8;
    const extraLen = view[localOffset + 28] | view[localOffset + 29] << 8;
    const start = localOffset + 30 + nameLen + extraLen;
    const compressed = view.subarray(start, start + compressedSize);
    const data = method === 0 ? compressed : inflateRawSync(compressed);
    entries.push({ name, method, crc, compressed, uncompressedSize, data: Buffer.from(data) });
  }
  return entries;
}

export async function writeOfficeFile(absolute, bytes, signal) {
  if (signal) signal.throwIfAborted();
  const tmp = `${absolute}.${process.pid}.office.tmp`;
  await writeFile(tmp, bytes);
  try {
    if (signal) signal.throwIfAborted();
    await rename(tmp, absolute);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

function escapeXml(value) {
  return String(value).replace(/[&<>]/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;");
}

export function cellMarkup(address, value, styleId) {
  const style = styleId ? ` s="${styleId}"` : "";
  if (value === null || value === undefined) return `<c r="${address}"${style} t="inlineStr"><is><t/></is></c>`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`cell ${address} holds a non-finite number`);
    return `<c r="${address}"${style}><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") return `<c r="${address}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = String(value);
  if (text.startsWith("=")) return `<c r="${address}"${style}><f>${escapeXml(text.slice(1))}</f></c>`;
  if (text === "") return `<c r="${address}"${style} t="inlineStr"><is><t/></is></c>`;
  return `<c r="${address}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

export function replaceSheetData(worksheetXml, replacementWorksheetXml) {
  const data = String(replacementWorksheetXml).match(/<sheetData\b[^>]*>[\s\S]*<\/sheetData>|<sheetData\b[^>]*\/>/);
  if (!data) throw new Error("replacement sheet has no sheetData");
  const dimension = String(replacementWorksheetXml).match(/<dimension\b[^>]*\/>/);
  let next = String(worksheetXml);
  if (/<sheetData\b[^>]*>[\s\S]*<\/sheetData>/.test(next)) next = next.replace(/<sheetData\b[^>]*>[\s\S]*<\/sheetData>/, data[0]);
  else if (/<sheetData\b[^>]*\/>/.test(next)) next = next.replace(/<sheetData\b[^>]*\/>/, data[0]);
  else next = next.replace(/<\/worksheet>/, `${data[0]}</worksheet>`);
  if (dimension && /<dimension\b[^>]*\/>/.test(next)) next = next.replace(/<dimension\b[^>]*\/>/, dimension[0]);
  return next;
}

export function upsertCell(xml, address, value) {
  if (!/^[A-Z]+[1-9][0-9]*$/.test(address)) throw new Error(`invalid cell address "${address}"`);
  const found = xml.match(new RegExp(`<c\\b([^>]*\\sr="${address}"[^>]*)`));
  const style = found && found[1].match(/\ss="(\d+)"/);
  const cell = cellMarkup(address, value, style && style[1]);
  const element = new RegExp(`<c\\b[^>]*\\sr="${address}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
  if (element.test(xml)) return xml.replace(element, cell);
  const row = Number.parseInt(address.match(/[1-9][0-9]*$/)[0], 10);
  const rowPattern = new RegExp(`(<row\\b[^>]*\\sr="${row}"[^>]*>)([\\s\\S]*?)(</row>)`);
  if (rowPattern.test(xml)) return xml.replace(rowPattern, (_whole, open, body, close) => open + body + cell + close);
  const rowXml = `<row r="${row}">${cell}</row>`;
  if (xml.includes("</sheetData>")) return xml.replace("</sheetData>", `${rowXml}</sheetData>`);
  return xml.replace("</worksheet>", `<sheetData>${rowXml}</sheetData></worksheet>`);
}

function escapeAttr(value) {
  return escapeXml(value).replace(/"/g, "&quot;");
}

export function addWorkbookSheet(bundle, sheetName, worksheetXml) {
  const ids = [...bundle.workbook.matchAll(/sheetId="(\d+)"/g)].map((match) => Number(match[1]));
  const sheetId = (ids.length ? Math.max(...ids) : 0) + 1;
  const numbers = [...bundle.rels.matchAll(/Target="worksheets\/sheet(\d+)\.xml"/g)].map((match) => Number(match[1]));
  const number = (numbers.length ? Math.max(...numbers) : 0) + 1;
  const rids = [...bundle.rels.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  const rid = `rId${(rids.length ? Math.max(...rids) : 0) + 1}`;
  const part = `xl/worksheets/sheet${number}.xml`;
  if (!bundle.workbook.includes("</sheets>")) throw new Error("workbook has no sheets list");
  const workbook = bundle.workbook.replace("</sheets>", `<sheet name="${escapeAttr(sheetName)}" sheetId="${sheetId}" r:id="${rid}"/></sheets>`);
  const rels = bundle.rels.replace("</Relationships>", `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${number}.xml"/></Relationships>`);
  const types = bundle.types.replace("</Types>", `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  return { workbook, rels, types, part, worksheetXml };
}
