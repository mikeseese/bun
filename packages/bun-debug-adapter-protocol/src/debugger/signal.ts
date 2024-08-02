import { tmpdir, type as getOSType } from "node:os";
import { join } from "node:path";
import type { Server } from "node:net";
import { createServer } from "node:net";
import { WebSocketServer } from "ws";
import { EventEmitter } from "node:events";
import { DefaultWebSocketDebugPort } from "./adapter";

const isDebug = process.env.NODE_ENV === "development";

export type DebugSignalEventMap = {
  "Signal.listening": [string];
  "Signal.error": [Error];
  "Signal.received": [string];
  "Signal.closed": [];
};

/**
 * Starts a server that listens for signals on a UNIX domain socket or WebSockets.
 */
export class DebugSignal extends EventEmitter<DebugSignalEventMap> {
  #path: string;
  #server: Server | WebSocketServer;
  #ready: Promise<void>;

  constructor(path?: string | URL) {
    super();
    this.#path = path
      ? parseSignalPath(path)
      : isWindows()
        ? `localhost:${DefaultWebSocketDebugPort + 10000}`
        : randomUnixPath();
    if (isWindows()) {
      const url = new URL(this.url);
      this.#server = new WebSocketServer({
        port: parseInt(url.port, 10),
      });

      this.#server.on("listening", () => this.emit("Signal.listening", url.href));
      this.#server.on("error", error => this.emit("Signal.error", error));
      this.#server.on("close", () => this.emit("Signal.closed"));
      this.#server.on("connection", socket => {
        socket.on("message", data => {
          this.emit("Signal.received", data.toString());
        });
      });
      this.#ready = new Promise((resolve, reject) => {
        this.#server.on("listening", resolve);
        this.#server.on("error", reject);
      });
    } else {
      this.#server = createServer();
      this.#server.on("listening", () => this.emit("Signal.listening", this.#path));
      this.#server.on("error", error => this.emit("Signal.error", error));
      this.#server.on("close", () => this.emit("Signal.closed"));
      this.#server.on("connection", socket => {
        socket.on("data", data => {
          this.emit("Signal.received", data.toString());
        });
      });
      this.#ready = new Promise((resolve, reject) => {
        (this.#server as Server).on("listening", resolve);
        (this.#server as Server).on("error", reject);
      });
      this.#server.listen(this.#path);
    }
  }

  emit<E extends keyof DebugSignalEventMap>(event: E, ...args: DebugSignalEventMap[E]): boolean {
    if (isDebug) {
      console.log(event, ...args);
    }

    return super.emit(event, ...args);
  }

  /**
   * The path to the UNIX domain socket.
   */
  get url(): string {
    return `${isWindows() ? "ws" : "unix"}://${this.#path}`;
  }

  /**
   * Resolves when the server is listening or rejects if an error occurs.
   */
  get ready(): Promise<void> {
    return this.#ready;
  }

  /**
   * Closes the server.
   */
  close(): void {
    this.#server.close();
  }
}

export function randomUnixPath(): string {
  return join(tmpdir(), `${Math.random().toString(36).slice(2)}.sock`);
}

function parseSignalPath(path: string | URL): string {
  if (typeof path === "string" && path.startsWith("/")) {
    return path;
  }
  try {
    const { protocol, pathname } = new URL(path);
    if (typeof path === "string" && protocol === "ws:") {
      return path;
    }
    return pathname;
  } catch {
    throw new Error(`Invalid UNIX path: ${path}`);
  }
}

function isWindows(): boolean {
  return getOSType() === "Windows_NT";
}
