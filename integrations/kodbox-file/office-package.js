import path from 'node:path';
import { readZipEntries } from './office-bytes.js';

// Package graph checks, not a replacement for full OOXML schema/Office validation.
const PREFIX = 'application/vnd.openxmlformats-officedocument.';
const typedParts = [
  [/^xl\/worksheets\/[^/]+\.xml$/, PREFIX + 'spreadsheetml.worksheet+xml'],
  [/^xl\/styles\.xml$/, PREFIX + 'spreadsheetml.styles+xml'],
  [/^word\/document\.xml$/, PREFIX + 'wordprocessingml.document.main+xml'],
  [/^ppt\/slides\/[^/]+\.xml$/, PREFIX + 'presentationml.slide+xml'],
  [/^ppt\/notesSlides\/[^/]+\.xml$/, PREFIX + 'presentationml.notesSlide+xml']
];
function decode(value) {
  return value.replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:]+)\s*=\s*(["'])(.*?)\2/g)].map(m => [m[1], decode(m[3])]));
}
export function validateOfficeParts(parts) {
  const files = new Map();
  for (const part of parts) {
    if (files.has(part.name)) throw Error(`Office 包包含重复部件：${part.name}`);
    files.set(part.name, part.content ?? part.data?.toString('utf8') ?? '');
  }
  const types = files.get('[Content_Types].xml');
  if (!types || !files.has('_rels/.rels')) throw Error('Office 包缺少内容类型或根关系声明');
  const overrides = new Map(), defaults = new Map();
  for (const match of types.matchAll(/<(?:\w+:)?(Override|Default)\b[^>]*>/g)) {
    const a = attributes(match[0]);
    if (match[1] === 'Override') {
      const name = a.PartName?.replace(/^\//, '');
      if (!files.has(name)) throw Error(`Office 类型声明指向不存在的部件：${name}`);
      overrides.set(name, a.ContentType);
    } else defaults.set(a.Extension, a.ContentType);
  }
  for (const [name] of files) {
    if (name === '[Content_Types].xml') continue;
    const type = overrides.get(name) || defaults.get(name.endsWith('.rels') ? 'rels' : path.posix.extname(name).slice(1));
    if (!type) throw Error(`Office 部件缺少内容类型：${name}`);
    const expected = typedParts.find(([pattern]) => pattern.test(name))?.[1];
    if (expected && type !== expected) throw Error(`Office 部件内容类型不正确：${name}`);
  }
  for (const [name, xml] of files) {
    if (!name.endsWith('.rels')) continue;
    const base = name === '_rels/.rels' ? '' : path.posix.dirname(path.posix.dirname(name));
    const ids = new Set();
    for (const match of xml.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
      const a = attributes(match[0]);
      if (!a.Id || ids.has(a.Id)) throw Error(`Office 关系 ID 缺失或重复：${name}`);
      ids.add(a.Id);
      if (a.TargetMode === 'External') continue;
      const target = decodeURIComponent((a.Target || '').split('#')[0]);
      const resolved = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(base, target));
      if (!files.has(resolved)) throw Error(`Office 关系指向不存在的部件：${name} → ${resolved}`);
    }
  }
  return true;
}
export function validateOfficePackage(bytes) {
  return validateOfficeParts(readZipEntries(bytes));
}
