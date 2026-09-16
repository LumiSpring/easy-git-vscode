import { dirName, fileName, formatMovedFrom, statusHint, statusLetter } from "./format";

export function FileChangeLabel({
  status,
  path,
  oldPath,
  hideDir = false,
  modules = [],
}: {
  status: string;
  path: string;
  oldPath?: string;
  hideDir?: boolean;
  modules?: Array<{ path: string; name: string }>;
}) {
  const moved = (status === "renamed" || status === "copied") && oldPath;
  const hint = moved ? `${statusHint(status)}\n${oldPath}` : statusHint(status);
  return (
    <>
      <span className={`letter ${status}`} title={hint}>
        {statusLetter(status)}
      </span>
      <span className="path" title={moved ? `${path}\n${oldPath}` : path}>
        <span className="name">{fileName(path)}</span>
        {moved ? (
          <span className="dir">{formatMovedFrom(oldPath ?? "", modules)}</span>
        ) : !hideDir ? (
          <span className="dir">{dirName(path)}</span>
        ) : null}
      </span>
    </>
  );
}
