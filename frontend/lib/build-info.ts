/** 关于页复制的构建身份。值由 next.config 在构建时注入；缺省不编造版本号。 */
export interface BuildInfo {
  version: string;
  commit: string;
}

export function readBuildInfo(): BuildInfo {
  return {
    version: (process.env.NEXT_PUBLIC_SCENDANCE_VERSION ?? '').trim(),
    commit: (process.env.NEXT_PUBLIC_SCENDANCE_COMMIT ?? '').trim(),
  };
}

export function formatBuildInfo(info: BuildInfo = readBuildInfo()): string {
  const version = info.version || '版本未写入这次构建';
  const commit = info.commit || '提交未写入这次构建';
  return `Scendance ${version}\n提交 ${commit}`;
}
