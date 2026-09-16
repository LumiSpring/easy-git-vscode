import { menuHint } from "@i18n";

export const MENU_HINTS: Record<string, string> = new Proxy(
  {},
  {
    get(_target, key) {
      return typeof key === "string" ? menuHint(key) : undefined;
    },
  },
);
