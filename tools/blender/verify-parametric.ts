/**
 * Feasibility harness: can Blender produce assets the Scendance backend accepts?
 *
 * For every sample parameter set this script
 *   1. validates the parameters with the shared `parametricParametersSchema`,
 *   2. runs `tools/blender/build_parametric.py` through a headless Blender,
 *   3. validates the produced GLB with the shared `validateModel`,
 *   4. compares the measured bounding box against the requested size.
 *
 * Step 4 reuses the same 1e-5 tolerance `buildParametricGlb` uses for its
 * `PARAMETRIC_BOUNDS_MISMATCH` check, so a pass here means the Blender output
 * could take the place of the TypeScript builders in that check.
 *
 * Usage:
 *   node --experimental-transform-types tools/blender/verify-parametric.ts
 *   BLENDER="C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" node --experimental-transform-types tools/blender/verify-parametric.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateModel } from '../../supabase/functions/_shared/models.ts';
import { parametricParametersSchema } from '../../supabase/functions/_shared/parametric-contract.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../..');
const buildScript = join(here, 'build_parametric.py');

/** `sourceSize` must match the request to within this, the tolerance parametric.ts already uses. */
const BOUNDS_TOLERANCE = 1e-5;

interface Sample {
  name: string;
  parameters: unknown;
}

const samples: Sample[] = [
  { name: 'table/rectangle/four', parameters: { family: 'table', width: 1.2, depth: 0.6, height: 0.75 } },
  { name: 'table/round/four', parameters: { family: 'table', width: 1.0, depth: 1.0, height: 0.75, variant: 'round' } },
  { name: 'table/round/pedestal', parameters: { family: 'table', width: 0.9, depth: 0.9, height: 1.05, variant: 'round', legs: 'pedestal' } },
  { name: 'chair/backed', parameters: { family: 'chair', width: 0.46, depth: 0.52, height: 0.88 } },
  { name: 'chair/stool', parameters: { family: 'chair', width: 0.4, depth: 0.4, height: 0.7, variant: 'stool' } },
  { name: 'counter/straight', parameters: { family: 'counter', width: 1.8, depth: 0.6, height: 1.0 } },
  { name: 'counter/l', parameters: { family: 'counter', width: 2.4, depth: 1.2, height: 1.0, variant: 'l', armDepth: 0.6 } },
  { name: 'platform', parameters: { family: 'platform', width: 2.4, depth: 1.8, height: 0.4 } },
  { name: 'backdrop', parameters: { family: 'backdrop', width: 3.0, depth: 0.6, height: 2.4 } },
  { name: 'cabinet/open/no-shelves', parameters: { family: 'cabinet', width: 1.0, depth: 0.45, height: 1.8, shelves: 0 } },
  { name: 'cabinet/closed/three-shelves', parameters: { family: 'cabinet', width: 1.0, depth: 0.45, height: 1.8, variant: 'closed', shelves: 3 } },
];

function findBlender(): string {
  const explicit = process.env.BLENDER;
  if (explicit && existsSync(explicit)) return explicit;
  try {
    const probe = execFileSync('blender', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (/^Blender\s/i.test(probe.trim())) return 'blender';
  } catch {
    // Not on PATH; fall through to the install locations below.
  }
  const roots = [
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Blender Foundation'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Blender Foundation'),
  ].filter((root): root is string => Boolean(root));
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).filter((name) => name.toLowerCase().startsWith('blender'))) {
      const candidate = join(root, entry, 'blender.exe');
      if (existsSync(candidate)) return candidate;
    }
  }
  return '';
}

interface RunResult {
  glb: Uint8Array;
  triangles: number;
  objects: number;
  blenderVersion: string;
  botBounds: { width: number; height: number; depth: number };
}

async function runBlender(blender: string, parameters: unknown, workDirectory: string): Promise<RunResult> {
  const paramsPath = join(workDirectory, 'params.json');
  const outPath = join(workDirectory, 'model.glb');
  writeFileSync(paramsPath, JSON.stringify(parameters), 'utf8');
  const stdout = execFileSync(blender, ['--background', '--python', buildScript, '--', '--params', paramsPath, '--out', outPath], {
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const marker = stdout.split(/\r?\n/).filter((line) => line.startsWith('SCENDANCE_PARAMETRIC_RESULT')).pop();
  if (!marker) throw new Error('build_parametric.py did not report a result line');
  const report = JSON.parse(marker.slice('SCENDANCE_PARAMETRIC_RESULT'.length)) as {
    triangles: number; objects: number; blenderVersion: string;
    measuredBounds: { width: number; height: number; depth: number };
  };
  return {
    glb: new Uint8Array(readFileSync(outPath)),
    triangles: report.triangles,
    objects: report.objects,
    blenderVersion: report.blenderVersion,
    botBounds: report.measuredBounds,
  };
}

interface Outcome {
  name: string;
  ok: boolean;
  detail: string;
}

async function main(): Promise<number> {
  const blender = findBlender();
  if (!blender) {
    console.error('Blender not found. Install it, or set BLENDER to the blender executable path.');
    return 2;
  }
  console.log(`Blender:  ${blender}`);
  console.log(`Contract: ${repoRoot}\n`);

  const workDirectory = mkdtempSync(join(tmpdir(), 'scendance-blender-'));
  const outcomes: Outcome[] = [];
  let blenderVersion = '';
  try {
    for (const sample of samples) {
      // The shared schema owns the defaults, so Blender only ever sees a fully resolved parameter set.
      const parameters = parametricParametersSchema.parse(sample.parameters) as unknown as Record<string, number>;
      const requested = {
        width: Number(parameters.width),
        depth: Number(parameters.depth),
        height: Number(parameters.height),
      };
      try {
        const result = await runBlender(blender, parameters, workDirectory);
        blenderVersion = result.blenderVersion || blenderVersion;
        const validated = await validateModel(result.glb);
        const drifts = (['width', 'height', 'depth'] as const).map((axis) => ({
          axis,
          delta: validated.sourceSize[axis] - requested[axis],
        }));
        const worst = drifts.reduce((a, b) => (Math.abs(a.delta) >= Math.abs(b.delta) ? a : b));
        const offCentre = [
          validated.bounds.min[0] + requested.width / 2,
          validated.bounds.min[1],
          validated.bounds.min[2] + requested.depth / 2,
        ].reduce((a, b) => (Math.abs(a) >= Math.abs(b) ? a : b));

        const problems: string[] = [];
        if (Math.abs(worst.delta) > BOUNDS_TOLERANCE) {
          problems.push(`${worst.axis} off by ${worst.delta.toExponential(2)} m (tolerance ${BOUNDS_TOLERANCE})`);
        }
        if (Math.abs(offCentre) > 1e-4) problems.push(`not centred on X/Z with base at Y=0 (offset ${offCentre.toExponential(2)} m)`);

        outcomes.push({
          name: sample.name,
          ok: problems.length === 0,
          detail: problems.length
            ? problems.join('; ')
            : `${validated.triangles} tris, ${validated.primitives} prims, ${(result.glb.byteLength / 1024).toFixed(1)} KB, drift ${worst.delta.toExponential(1)} m`,
        });
      } catch (error) {
        outcomes.push({ name: sample.name, ok: false, detail: (error as Error).message.split('\n').slice(-3).join(' ').slice(0, 300) });
      }
    }
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }

  const width = Math.max(...outcomes.map((outcome) => outcome.name.length));
  for (const outcome of outcomes) {
    console.log(`${outcome.ok ? 'PASS' : 'FAIL'}  ${outcome.name.padEnd(width)}  ${outcome.detail}`);
  }
  const failed = outcomes.filter((outcome) => !outcome.ok).length;
  console.log(`\n${outcomes.length - failed}/${outcomes.length} passed${blenderVersion ? ` (Blender ${blenderVersion})` : ''}`);
  return failed === 0 ? 0 : 1;
}

process.exitCode = await main();
