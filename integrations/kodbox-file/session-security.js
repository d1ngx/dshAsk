import { realpathSync } from "node:fs";
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";

export function sessionUserId(sessionId) {
  return /^kodbox-u(\d+)-[A-Za-z0-9_-]+-\d{10,}$/.exec(String(sessionId || ""))?.[1] || "";
}

export function contained(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep));
}

const cloudCreates = new Set(["write", "word_create", "excel_create", "ppt_create"]);
const cloudRevises = new Set(["word_update", "excel_update"]);

// Creates may replace a prefetched name. Revisions edit the file that is already there.
export function createsCloudFile(name) {
  return cloudCreates.has(name);
}

export function revisesCloudFile(name) {
  return cloudRevises.has(name);
}

export function isCitationCache(entry, rel) {
  const item = entry && entry.files && rel && entry.files[rel];
  return Boolean(item && !item.generated && !String(rel).startsWith(".."));
}

const realRoots = new Map();

// Compare canonical paths so a symlink root (/tmp -> /private/tmp) still contains its real workspace.
export function withinReal(root, target) {
  try {
    if (!root || typeof target !== "string" || !path.isAbsolute(target)) return false;
    let realRoot = realRoots.get(root);
    if (!realRoot) {
      realRoot = realpathSync(root);
      realRoots.set(root, realRoot);
    }
    return contained(realRoot, realpathSync(target));
  } catch {
    return false;
  }
}

// A tool execution can only use its own binding. Explicit tokens are for server handoffs.
export function boundToken(exec, entry, supplied) {
  const token = exec ? entry?.token : supplied;
  return typeof token === "string" && /^ask_[a-f0-9]{32}$/.test(token) ? token : "";
}

// Check both lexical traversal and real paths, including symlinked parents of new files.
export async function workspacePath(folder, requested, allowMissing = false) {
  if (!folder || typeof requested !== "string" || !requested || requested.includes("\0")) {
    throw new Error("请使用当前会话工作区里的文件路径。");
  }
  const root = await realpath(folder);
  const absolute = path.resolve(root, requested);
  if (!contained(root, absolute) && !contained(path.resolve(folder), absolute)) throw new Error("不能访问当前会话工作区以外的文件。");
  let existing = absolute;
  const missing = [];
  for (;;) {
    try {
      const resolved = path.resolve(await realpath(existing), ...missing);
      if (resolved === root || !contained(root, resolved)) throw new Error("不能访问当前会话工作区以外的文件。");
      return resolved;
    } catch (error) {
      if (!allowMissing || error.code !== "ENOENT") throw error;
      // A dangling symlink is not a missing directory: never follow it on a later write.
      const info = await lstat(existing).catch((failure) => { if (failure.code !== "ENOENT") throw failure; return null; });
      if (info?.isSymbolicLink()) throw new Error("不能写入失效的符号链接。");
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
}
