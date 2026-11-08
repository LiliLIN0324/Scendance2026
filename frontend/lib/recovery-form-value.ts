/** Exact, synchronous comparison for plain IndexedDB form records. No JSON loss of undefined or array holes. */
export function sameRecoveryFormValue(left: unknown, right: unknown): boolean {
  const seen = new Set<object>();
  function encode(value: unknown): string {
    if (value === undefined) return 'u';
    if (value === null) return 'n';
    if (typeof value === 'string') return `s${JSON.stringify(value)}`;
    if (typeof value === 'boolean') return value ? 'b1' : 'b0';
    if (typeof value === 'number' && Number.isFinite(value)) return `d${Object.is(value,-0)?'-0':String(value)}`;
    if (typeof value !== 'object' || seen.has(value)) throw new Error('恢复表单包含不支持的数据。');
    if (!Array.isArray(value) && Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null) throw new Error('恢复表单包含不支持的数据。');
    if (Object.getOwnPropertySymbols(value).length) throw new Error('恢复表单包含不支持的数据。');
    const descriptors=Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some(descriptor=>!('value' in descriptor))) throw new Error('恢复表单包含不支持的取值器。');
    seen.add(value);
    try {
      const keys=Object.keys(value).sort();
      const fields=keys.map(key=>`${JSON.stringify(key)}:${encode((value as Record<string,unknown>)[key])}`).join(',');
      return Array.isArray(value)?`a${value.length}{${fields}}`:`o{${fields}}`;
    } finally { seen.delete(value); }
  }
  return encode(left)===encode(right);
}
