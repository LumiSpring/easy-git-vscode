import type { UiLocale } from "../ipc/protocol";
import { catalogs, type MessageKey } from "./catalog";

export type { UiLocale, MessageKey };

let locale: UiLocale = "zh-cn";

export function parseLocale(value: unknown): UiLocale {
  return value === "en" ? "en" : "zh-cn";
}

export function setLocale(value: UiLocale): void {
  locale = value;
}

export function getLocale(): UiLocale {
  return locale;
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let text = catalogs[locale][key] ?? catalogs["zh-cn"][key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export function menuHint(id: string): string {
  const key = `hint.${id}` as MessageKey;
  if (key in catalogs["zh-cn"]) {
    return t(key);
  }
  return "";
}
