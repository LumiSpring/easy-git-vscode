import { t } from "@i18n";

export function EmptyRepoSetup({
  folder,
  busy,
  disabled,
  onInit,
}: {
  folder?: string;
  busy: boolean;
  disabled: boolean;
  onInit: () => void;
}) {
  const name = folder?.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return (
    <div className="setup-panel">
      <div className="setup-title">{t("empty.title")}</div>
      {name ? (
        <div className="setup-path" title={folder}>
          {name}
        </div>
      ) : (
        <div className="setup-path">{t("empty.openFolder")}</div>
      )}
      <button type="button" className="primary setup-btn" disabled={disabled || !folder} onClick={onInit}>
        {busy ? "Initializing…" : "Initialize Git Repository…"}
      </button>
      <p className="setup-hint">{t("empty.hint")}</p>
    </div>
  );
}
