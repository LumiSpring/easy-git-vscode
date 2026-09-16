import type { HostAction, HostToWebview, WebviewToHost } from "@ipc";
import { t } from "@i18n";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const pending = new Map<string, Pending>();

export function post(message: WebviewToHost): void {
  vscode.postMessage(message);
}

export function request<T = unknown>(action: HostAction, payload?: unknown): Promise<T> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    post({ type: "request", id, action, payload });
  });
}

export function consumeResult(message: HostToWebview): boolean {
  if (message.type !== "result") {
    return false;
  }
  const waiter = pending.get(message.id);
  if (!waiter) {
    return true;
  }
  pending.delete(message.id);
  if (message.ok) {
    waiter.resolve(message.data);
  } else {
    waiter.reject(new Error(message.error || t("error.actionFailed")));
  }
  return true;
}

export function ready(view: "commit" | "log" | "merge"): void {
  post({ type: "ready", view });
}
