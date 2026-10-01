// Load with node --import BEFORE DSH. The port must stay closed to requests while
// plugins start, if the security plugin is missing, and after it is unloaded.
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";

const createServer = http.createServer;
const ready = Symbol.for("kodbox.accountGuard.ready");
http.createServer = function (...args) {
  const server = createServer.apply(this, args);
  const emit = server.emit;
  server.emit = function (event, ...values) {
    if ((event === "request" || event === "upgrade") && this[ready] !== true) {
      if (event === "request") {
        const [, response] = values;
        response.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", connection: "close" });
        response.end("网盘账号隔离服务尚未就绪");
      } else values[1].end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return true;
    }
    return emit.call(this, event, ...values);
  };
  return server;
};
syncBuiltinESMExports();
