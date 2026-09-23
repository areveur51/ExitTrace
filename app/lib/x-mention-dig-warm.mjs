/**
 * Long-lived dig helper for the worker host.
 * The process stays up. It runs MENTION_DIG_INNER only when a client sends one row.
 * Digs are sequential. This file does not choose cites.
 */

import fs from "fs";
import net from "node:net";
import path from "path";
import readline from "node:readline";
import { DIG_TIMEOUT_MS, runDigCommand } from "./x-mention-worker.mjs";

export { DIG_TIMEOUT_MS };

function oneLine(socket) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: socket });
    const fail = (err) => {
      rl.close();
      reject(err);
    };
    rl.once("line", (line) => resolve(line));
    socket.once("error", fail);
  });
}

export function callWarmDig({ socketPath, row, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("warm_timeout"));
    }, timeoutMs);
    const finish = (err, value) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };
    socket.once("error", (err) => finish(err));
    oneLine(socket).then(
      (line) => {
        try {
          finish(null, JSON.parse(line));
        } catch (err) {
          finish(err);
        } finally {
          socket.end();
        }
      },
      (err) => finish(err),
    );
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(row)}\n`);
    });
  });
}

export function serveWarmDig({
  socketPath,
  command,
  timeoutMs = DIG_TIMEOUT_MS,
  env = process.env,
} = {}) {
  if (!command) throw new Error("MENTION_DIG_INNER is unset");
  fs.rmSync(socketPath, { force: true });
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  let chain = Promise.resolve();
  let started = 0;
  const server = net.createServer((socket) => {
    const incoming = oneLine(socket);
    chain = chain
      .then(async () => {
        const text = await incoming;
        let row = {};
        try {
          row = JSON.parse(text);
        } catch {
          socket.write(`${JSON.stringify({ outcome: "fail_closed", error_reason: "dig_failed" })}\n`);
          socket.end();
          return;
        }
        started += 1;
        let envelope;
        try {
          envelope = await runDigCommand(row, { command, timeoutMs, env });
        } catch (err) {
          const reason = err?.message === "dig_timeout" ? "dig_timeout" : "dig_failed";
          envelope = { outcome: "fail_closed", error_reason: reason };
        }
        socket.write(`${JSON.stringify(envelope || { outcome: "fail_closed", error_reason: "dig_failed" })}\n`);
        socket.end();
      })
      .catch(() => {
        socket.end();
      });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      resolve({
        socketPath,
        get started() {
          return started;
        },
        close() {
          return new Promise((done) => {
            server.close(() => {
              fs.rmSync(socketPath, { force: true });
              done();
            });
          });
        },
      });
    });
  });
}
