import { Worker } from 'node:worker_threads';

/** Parse legacy spreadsheets without shell commands or cloud conversion copies. */
export function readSpreadsheet(bytes, filePath, args = {}, signal) {
  if (bytes.length > 40 * 1024 * 1024) throw Error('附件不能超过 40 MiB');
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./spreadsheet-worker.cjs', import.meta.url), {
      workerData: { bytes, path: filePath, sheet: args.sheet, max_rows: args.max_rows },
      resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 4 }
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      void worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(signal.reason || Error('读取已取消'));
    const timer = setTimeout(() => finish(Error('表格解析超时，请缩小文件或拆分工作表；无需改名或创建副本。')), 15000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', message => finish(message.error ? Error(message.error) : null, message.value));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(Error(`表格解析进程退出 (${code})`)); });
  });
}
