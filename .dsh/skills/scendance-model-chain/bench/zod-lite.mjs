/**
 * zod-lite — a deliberately small, auditable subset of the zod v4 runtime API.
 *
 * WHY THIS EXISTS
 * The bench must score every response with the *real* production rule, not a paraphrase of it.
 * The production rule lives in `_shared/brief-extract-contract.ts` (zod 4.6.5). Zod is not
 * installed in this workspace and installing from the network would make the bench depend on
 * package resolution rather than on the contract. So instead of re-writing the contract's
 * logic, `contract.real.ts` (a byte-identical copy with only its two import lines rewritten)
 * is executed verbatim by Node's native TypeScript type-stripping, and this file supplies the
 * small slice of zod that it uses.
 *
 * SEMANTICS REPLICATED (zod v4):
 *  - `.optional()` / `.nullable()` / `.nullish()`  → non-mutating, return a new schema.
 *  - `.strict()`                                   → non-mutating, returns a NEW strict copy.
 *    This matters: `conversationModelSchema` uses `briefSlotSchema.strict()`, and the extract
 *    path uses `briefSlotSchema` itself. If `.strict()` mutated in place, the extract path
 *    would also reject unknown slot keys. It does not (verified by selftest.mjs case S3/S4).
 *  - z.object  strips unknown keys; z.strictObject / .strict() reject them.
 *  - z.number() rejects NaN; .int() requires Number.isInteger.
 *  - .min/.max on number|string|array; .length; .trim() (transform, runs in call order).
 *  - .refine(fn) passes on truthy; .superRefine(fn) receives (value, ctx) with ctx.addIssue.
 *  - enum / literal / union / array / object / strictObject.
 *  - parse() throws on the first failing level (all issues collected within a level).
 *
 * NOT replicated (never used by the contract): coercion, defaults, records, maps, tuples,
 * discriminated unions, async refinements, error messages/typing, .parseAsync, prettifyError.
 */
export class ZodError extends Error {
  constructor(issues) {
    super(`ZodError: ${issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')}`);
    this.name = 'ZodError';
    this.issues = issues;
  }
}

const issue = (code, path, message) => ({ code, path, message });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

class Schema {
  constructor(kind, def = {}) {
    this.kind = kind;
    this.def = def;
    this._optional = false;
    this._nullable = false;
    this._strict = false;
    this._passthrough = false;
    this._checks = [];
    this._refines = [];
    this._superRefines = [];
  }

  _clone(patch = {}) {
    const next = new Schema(this.kind, this.def);
    next._optional = patch._optional ?? this._optional;
    next._nullable = patch._nullable ?? this._nullable;
    next._strict = patch._strict ?? this._strict;
    next._passthrough = patch._passthrough ?? this._passthrough;
    next._checks = patch._checks ?? this._checks.slice();
    next._refines = patch._refines ?? this._refines.slice();
    next._superRefines = patch._superRefines ?? this._superRefines.slice();
    return next;
  }

  optional() { return this._clone({ _optional: true }); }
  nullable() { return this._clone({ _nullable: true }); }
  nullish() { return this._clone({ _optional: true, _nullable: true }); }
  strict() { return this._clone({ _strict: true }); }
  passthrough() { return this._clone({ _passthrough: true }); }
  describe() { return this; }
  min(n) { return this._clone({ _checks: [...this._checks, { t: 'min', n }] }); }
  max(n) { return this._clone({ _checks: [...this._checks, { t: 'max', n }] }); }
  length(n) { return this._clone({ _checks: [...this._checks, { t: 'length', n }] }); }
  int() { return this._clone({ _checks: [...this._checks, { t: 'int' }] }); }
  trim() { return this._clone({ _checks: [...this._checks, { t: 'trim' }] }); }
  refine(fn, message) { return this._clone({ _refines: [...this._refines, { fn, message: message ?? 'invalid' }] }); }
  superRefine(fn) { return this._clone({ _superRefines: [...this._superRefines, fn] }); }

  parse(value) {
    const r = this._parse(value, []);
    if (!r.ok) throw new ZodError(r.issues);
    return r.value;
  }

  safeParse(value) {
    const r = this._parse(value, []);
    return r.ok ? { success: true, data: r.value } : { success: false, error: new ZodError(r.issues) };
  }

  _parse(value, path) {
    if (value === undefined) {
      return this._optional ? { ok: true, value: undefined } : { ok: false, issues: [issue('invalid_type', path, 'Required')] };
    }
    if (value === null) {
      return this._nullable ? { ok: true, value: null } : { ok: false, issues: [issue('invalid_type', path, 'Expected non-null')] };
    }
    const inner = this._inner(value, path);
    if (!inner.ok) return inner;
    let v = inner.value;

    const issues = [];
    for (const c of this._checks) {
      switch (c.t) {
        case 'trim':
          if (typeof v !== 'string') issues.push(issue('invalid_type', path, 'Expected string'));
          else v = v.trim();
          break;
        case 'int':
          if (typeof v !== 'number' || !Number.isInteger(v)) issues.push(issue('invalid_type', path, 'Expected integer'));
          break;
        case 'min':
          if (typeof v === 'string' || Array.isArray(v)) {
            if (v.length < c.n) issues.push(issue('too_small', path, `min ${c.n}`));
          } else if (typeof v === 'number' && !(v >= c.n)) {
            issues.push(issue('too_small', path, `min ${c.n}`));
          }
          break;
        case 'max':
          if (typeof v === 'string' || Array.isArray(v)) {
            if (v.length > c.n) issues.push(issue('too_big', path, `max ${c.n}`));
          } else if (typeof v === 'number' && !(v <= c.n)) {
            issues.push(issue('too_big', path, `max ${c.n}`));
          }
          break;
        case 'length':
          if (v.length !== c.n) issues.push(issue('too_big', path, `length ${c.n}`));
          break;
        default:
          issues.push(issue('custom', path, `unknown check ${c.t}`));
      }
    }
    if (issues.length) return { ok: false, issues };

    for (const r of this._refines) {
      let passed = false;
      try { passed = Boolean(r.fn(v)); } catch { passed = false; }
      if (!passed) return { ok: false, issues: [issue('custom', path, r.message)] };
    }

    if (this._superRefines.length) {
      const superIssues = [];
      const ctx = { addIssue: (i) => superIssues.push(issue(i?.code ?? 'custom', i?.path ?? path, i?.message ?? 'custom')) };
      for (const sr of this._superRefines) {
        try { sr(v, ctx); } catch (e) { superIssues.push(issue('custom', path, `superRefine threw: ${e?.message ?? e}`)); }
      }
      if (superIssues.length) return { ok: false, issues: superIssues };
    }

    return { ok: true, value: v };
  }

  _inner(value, path) {
    switch (this.kind) {
      case 'string':
        return typeof value === 'string' ? { ok: true, value } : { ok: false, issues: [issue('invalid_type', path, 'Expected string')] };
      case 'number':
        return typeof value === 'number' && !Number.isNaN(value)
          ? { ok: true, value }
          : { ok: false, issues: [issue('invalid_type', path, 'Expected number')] };
      case 'boolean':
        return typeof value === 'boolean' ? { ok: true, value } : { ok: false, issues: [issue('invalid_type', path, 'Expected boolean')] };
      case 'enum':
        return this.def.values.includes(value)
          ? { ok: true, value }
          : { ok: false, issues: [issue('invalid_enum_value', path, `Expected ${this.def.values.join('|')}`)] };
      case 'literal':
        return value === this.def.value
          ? { ok: true, value }
          : { ok: false, issues: [issue('invalid_literal', path, `Expected ${JSON.stringify(this.def.value)}`)] };
      case 'array': {
        if (!Array.isArray(value)) return { ok: false, issues: [issue('invalid_type', path, 'Expected array')] };
        const out = [];
        const issues = [];
        value.forEach((item, i) => {
          const r = this.def.inner._parse(item, [...path, i]);
          if (r.ok) out.push(r.value);
          else issues.push(...r.issues);
        });
        return issues.length ? { ok: false, issues } : { ok: true, value: out };
      }
      case 'union': {
        for (const opt of this.def.options) {
          const r = opt._parse(value, path);
          if (r.ok) return r;
        }
        return { ok: false, issues: [issue('invalid_union', path, 'No union option matched')] };
      }
      case 'object': {
        if (!isObject(value)) return { ok: false, issues: [issue('invalid_type', path, 'Expected object')] };
        const shape = this.def.shape;
        const out = {};
        const issues = [];
        for (const [k, s] of Object.entries(shape)) {
          const r = s._parse(value[k], [...path, k]);
          if (r.ok) {
            if (r.value !== undefined) out[k] = r.value;
          } else issues.push(...r.issues);
        }
        for (const k of Object.keys(value)) {
          if (k in shape) continue;
          if (this._strict) issues.push(issue('unrecognized_keys', [...path, k], 'Unrecognized key'));
          else if (this._passthrough) out[k] = value[k];
        }
        return issues.length ? { ok: false, issues } : { ok: true, value: out };
      }
      default:
        return { ok: false, issues: [issue('custom', path, `unknown kind ${this.kind}`)] };
    }
  }
}

export const z = {
  string: () => new Schema('string'),
  number: () => new Schema('number'),
  boolean: () => new Schema('boolean'),
  enum: (values) => new Schema('enum', { values: [...values] }),
  literal: (value) => new Schema('literal', { value }),
  array: (inner) => new Schema('array', { inner }),
  object: (shape) => new Schema('object', { shape }),
  strictObject: (shape) => new Schema('object', { shape }).strict(),
  union: (options) => new Schema('union', { options }),
};

export default z;
