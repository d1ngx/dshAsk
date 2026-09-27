import path from "node:path";
import { lstat, realpath } from "node:fs/promises";

export function sessionUserId(sessionId) {
  return /^kodbox-u(\d+)-[A-Za-z0-9_-]+-\d{10,}$/.exec(String(sessionId || ""))?.[1] || "";
}

export function contained(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep));
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
