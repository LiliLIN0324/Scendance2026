import { describe, expect, it } from 'vitest';
import { sceneSchema, type Scene } from '../supabase/functions/_shared/domain.ts';
import { migrateScene, SceneMigrationError } from '../supabase/functions/_shared/scene-migrate.ts';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function legacy(overrides: Record<string,unknown> = {}): Scene {
  return sceneSchema.parse({ schemaVersion:1, venue:{ shape:'rectangle', width:8, depth:6, height:3,
    entrances:[{ id:id(9), position:{ x:0, z:2 }, width:1.2 }] },
    objects:[{ id:id(1), materialId:'table', position:{ x:3, z:3 }, rotation:15,
      size:{ width:1.2, depth:0.8, height:0.75 }, color:'#ac8965', locked:false, notes:'洽谈桌' }],
    camera:'overview', lighting:'warm', ...overrides });
}

describe('scene version migration', () => {
  it('upgrades a saved v1 rectangle to v2 from its explicit boundary and entrances', () => {
    const result=migrateScene(legacy());
    expect(result).toMatchObject({ fromVersion:1, toVersion:2, changed:true });
    expect(result.scene.schemaVersion).toBe(2);
    expect(result.scene.venue).toMatchObject({ shape:'rectangle', width:8, depth:6, height:3,
      entrances:[{ id:id(9), position:{ x:0, z:2 }, width:1.2 }] });
    expect(result.scene.structure.walls).toHaveLength(4);
    expect(result.scene.structure.walls.every(wall=>wall.kind==='exterior'&&wall.status==='inferred'&&wall.height===3&&wall.thickness===0.16)).toBe(true);
    expect(result.scene.structure.walls.map(wall=>[wall.start,wall.end])).toEqual([
      [{x:0,z:0},{x:8,z:0}], [{x:8,z:0},{x:8,z:6}], [{x:8,z:6},{x:0,z:6}], [{x:0,z:6},{x:0,z:0}],
    ]);
    expect(result.scene.structure.openings).toEqual([{ id:id(9), wallId:result.scene.structure.walls[3]!.id,
      kind:'door', offset:3.4, width:1.2, height:2.2, sillHeight:0, status:'inferred' }]);
    expect(result.scene.objects).toEqual(legacy().objects);
    // Nothing that needs a human was invented.
    expect(result.scene.venue.site).toBeUndefined();
    expect(result.scene.sources).toEqual([]);
    expect(result.scene.dimensions).toEqual([]);
    expect(result.scene.design).toBeUndefined();
    expect(result.notes.join('')).toContain('inferred');
  });

  it('is deterministic and idempotent: the same input makes the same IDs and a second pass changes nothing', () => {
    const first=migrateScene(legacy()),second=migrateScene(legacy());
    expect(second.scene).toEqual(first.scene);
    expect(first.scene.structure.walls.map(wall=>wall.id)).toEqual(second.scene.structure.walls.map(wall=>wall.id));
    expect(new Set(first.scene.structure.walls.map(wall=>wall.id)).size).toBe(4);
    expect(first.scene.structure.walls.every(wall=>uuidPattern.test(wall.id))).toBe(true);
    expect(migrateScene(first.scene)).toMatchObject({ fromVersion:2, toVersion:2, changed:false, notes:[] });
    expect(migrateScene(first.scene).scene).toEqual(first.scene);
  });

  it('follows polygon edges instead of collapsing them to a bounding rectangle', () => {
    const result=migrateScene(legacy({ venue:{ shape:'polygon', width:10, depth:8, height:4,
      polygon:[{x:0,z:0},{x:10,z:0},{x:10,z:8},{x:0,z:8},{x:0,z:5}],
      entrances:[{ id:id(9), position:{ x:0, z:6 }, width:1.5 }] } }));
    expect(result.scene.structure.walls).toHaveLength(5);
    expect(result.scene.structure.walls.map(wall=>wall.height)).toEqual([4,4,4,4,4]);
    expect(result.scene.structure.openings[0]).toMatchObject({ wallId:result.scene.structure.walls[3]!.id,
      offset:1.25, width:1.5 });
  });

  it('refuses an entrance at a corner rather than moving or shrinking it', () => {
    expect(()=>migrateScene(legacy({ venue:{ shape:'rectangle', width:8, depth:6, height:3,
      entrances:[{ id:id(9), position:{ x:0, z:0 }, width:1.2 }] } }))).toThrow(SceneMigrationError);
    try { migrateScene(legacy({ venue:{ shape:'rectangle', width:8, depth:6, height:3,
      entrances:[{ id:id(9), position:{ x:0, z:0 }, width:1.2 }] } })); }
    catch(error) { expect(error).toMatchObject({ code:'ENTRANCE_REQUIRES_REVIEW' }); }
  });

  it('drops v1 wall references that have no wall identity to point at and records why', () => {
    const input=legacy();
    input.objects[0]!.wallId=id(77);
    const result=migrateScene(input);
    expect(result.scene.objects[0]).not.toHaveProperty('wallId');
    expect(result.notes.join('')).toContain('挂墙引用');
    expect(result.scene.objects[0]).toMatchObject({ id:id(1), notes:'洽谈桌' });
  });

  it('rejects data that is not a Scene instead of passing it through', () => {
    expect(()=>migrateScene({ schemaVersion:1, venue:{ width:8 } })).toThrow(SceneMigrationError);
    try { migrateScene({}); } catch(error) { expect(error).toMatchObject({ code:'INVALID_SCENE' }); }
  });
});
