import { createHash } from "node:crypto";

const digest = value => createHash("sha256").update(value).digest("hex").slice(0, 16);
const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decode = value => value.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (_all, numeric, named) => {
  if (numeric) return String.fromCodePoint(numeric[0].toLowerCase() === "x" ? parseInt(numeric.slice(1), 16) : Number(numeric));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named.toLowerCase()];
});

// Only direct body paragraphs are editable. Tables, drawings, fields, hyperlinks,
// breaks and tracked changes remain untouched; nested paragraphs must never be
// mistaken for body text. Spellcheck marks and bookmarks do not block an edit.
const markTags = new Set(["w:rPr", "w:rFonts", "w:b", "w:i", "w:bCs", "w:iCs", "w:u", "w:color", "w:sz", "w:szCs", "w:lang", "w:spacing", "w:shd", "w:highlight", "w:vertAlign", "w:strike", "w:dstrike", "w:em", "w:caps", "w:smallCaps", "w:vanish", "w:kern", "w:position", "w:w", "w:fitText", "w:noProof", "w:webHidden", "w:rtl", "w:cs", "w:specVanish", "w:bdr", "w:eastAsianLayout"]);
const propTags = new Set(["w:pPr", "w:pStyle", "w:jc", "w:ind", "w:numPr", "w:ilvl", "w:numId", "w:keepNext", "w:keepLines", "w:widowControl", "w:contextualSpacing", "w:kinsoku", "w:overflowPunct", "w:autoSpaceDE", "w:autoSpaceDN", "w:adjustRightInd", "w:snapToGrid", "w:textAlignment", "w:outlineLvl", "w:tabs", "w:tab", ...markTags]);
const bodyTags = new Set(["w:p", "w:r", "w:t", "w:proofErr", "w:bookmarkStart", "w:bookmarkEnd", "w:lastRenderedPageBreak", ...markTags]);
const tagsOf = fragment => [...fragment.matchAll(/<\/?([\w:.-]+)\b/g)].map(match => match[1]);
function paragraphMarkup(raw) {
  const props = raw.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>|<w:pPr\b[^>]*\/>/)?.[0] || "";
  return { props, body: props ? raw.replace(props, "") : raw };
}
function paragraphs(xml) {
  const rows = [];
  const stack = [];
  let current;
  for (const match of xml.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?([\w:.-]+)\b[^>]*>/g)) {
    if (!match[1]) continue;
    const tag = match[1], closing = match[0].startsWith("</"), empty = match[0].endsWith("/>");
    if (closing) {
      if (tag === "w:p" && current && stack.length === current.depth) {
        current.end = match.index + match[0].length;
        rows.push(current); current = undefined;
      }
      if (stack.pop() !== tag) throw Error("Word XML 结构不完整，无法安全编辑。");
    } else {
      if (tag === "w:p" && stack.at(-1) === "w:body") {
        current = { start: match.index, depth: stack.length + 1 };
        if (empty) { current.end = match.index + match[0].length; rows.push(current); current = undefined; }
      }
      if (!empty) stack.push(tag);
    }
  }
  return rows.map((row, index) => {
    const raw = xml.slice(row.start, row.end);
    const text = [...raw.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => decode(m[1])).join("");
    const { props, body } = paragraphMarkup(raw);
    const editable = tagsOf(props).every(tag => propTags.has(tag)) && tagsOf(body).every(tag => bodyTags.has(tag));
    return { ...row, raw, text, editable, id: `p${index + 1}-${digest(raw)}` };
  });
}

export function readWordParagraphs(xml) {
  return paragraphs(xml).map(({ id, text, editable }) => ({ id, text, editable }));
}

export function editWordParagraphs(xml, edits) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 1000) throw Error("请提供 1～1000 条段落修改。");
  const rows = paragraphs(xml), used = new Set(), patches = [];
  for (const edit of edits) {
    const row = rows.find(item => item.id === edit.id);
    if (!row || row.text !== edit.expected_text) throw Error("段落已变化，请用 word_read 的 paragraphs 格式重新读取后再修改。");
    if (used.has(row.id)) throw Error("同一批修改不能重复定位同一段落。");
    used.add(row.id);
    if (!["replace", "delete", "insert_before", "insert_after"].includes(edit.action)) throw Error("不支持的段落操作。");
    if (!row.editable) throw Error("该段落包含复杂格式或对象，不能安全修改；请保留原段落或另建修订版。");
    if (edit.action !== "delete" && (typeof edit.text !== "string" || edit.text.length > 100000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/u.test(edit.text))) throw Error("段落文本无效或过长。");
    const { props, body } = paragraphMarkup(row.raw);
    const run = body.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>|<w:r\b[^>]*\/>/)?.[0] || "";
    const runProps = run.match(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>|<w:rPr\b[^>]*\/>/)?.[0] || "";
    const paragraph = edit.action === "delete" ? "" : `<w:p>${props}<w:r>${runProps}<w:t xml:space="preserve">${escape(edit.text)}</w:t></w:r></w:p>`;
    const content = edit.action === "insert_before" ? paragraph + row.raw : edit.action === "insert_after" ? row.raw + paragraph : paragraph;
    patches.push({ ...row, content });
  }
  for (const patch of patches.sort((a, b) => b.start - a.start)) xml = xml.slice(0, patch.start) + patch.content + xml.slice(patch.end);
  if (!paragraphs(xml).length) throw Error("不能删除全部正文段落，请至少保留一个段落。");
  return xml;
}
