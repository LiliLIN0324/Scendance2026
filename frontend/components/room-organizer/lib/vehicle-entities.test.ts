import { describe, expect, it } from 'vitest';
import { planVehicleTypes } from '../../../../supabase/functions/_shared/site-plan';
import { VEHICLE_TYPES } from './vehicle-types';
import {
  MAX_VEHICLE_INSTANCES,
  vehicleCarrierFor,
  vehicleDefaultModelSlugFor,
  vehicleEntitySlots,
  vehicleKindFor,
  vehicleLabelOf,
  vehicleModelSlugOf,
  vehicleTypeEntry,
} from './vehicle-entities';

describe('vehicle-entities（车辆实体读取层）', () => {
  it('契约车型枚举与登记表逐条对齐（顺序与取值）', () => {
    expect(planVehicleTypes).toEqual(VEHICLE_TYPES.map((entry) => entry.id));
  });

  it('车型 → kind / carrier 从登记表派生；未登记返回 null 不猜', () => {
    expect(vehicleKindFor('coach')).toBe('vehicle');
    expect(vehicleKindFor('cleaning')).toBe('service');
    expect(vehicleCarrierFor('coach')).toBe('vehicle');
    expect(vehicleCarrierFor('bike')).toBe('vehicle'); // 自行车暂并入车辆载体
    // 未登记车型（旧数据 / 未来新增）不得回落到步行或别的档。
    expect(vehicleKindFor('spaceship' as never)).toBeNull();
    expect(vehicleCarrierFor('spaceship' as never)).toBeNull();
    expect(vehicleTypeEntry('spaceship' as never)).toBeNull();
  });

  it('vehicleLabelOf：登记表名字优先，未登记退回原始 type', () => {
    expect(vehicleLabelOf({ type: 'coach' })).toBe('服务大巴车');
    expect(vehicleLabelOf({ type: 'truck' })).toBe('货车');
    expect(vehicleLabelOf({ type: 'spaceship' as never })).toBe('spaceship');
  });

  it('vehicleModelSlugOf 只认实体自己的 modelSlug，绝不回落到登记表首项', () => {
    expect(vehicleModelSlugOf({ modelSlug: 'car-park-and-road-vehicle-fleet-box-truck-4574c765' }))
      .toBe('car-park-and-road-vehicle-fleet-box-truck-4574c765');
    expect(vehicleModelSlugOf({})).toBeNull();
    // 货车登记表里有默认模型，但实体没写就是没有——不能借来渲染。
    expect(vehicleDefaultModelSlugFor('truck')).toBe('car-park-and-road-vehicle-fleet-box-truck-4574c765');
    expect(vehicleModelSlugOf({})).not.toBe(vehicleDefaultModelSlugFor('truck'));
    // 待补车型连默认都没有。
    expect(vehicleDefaultModelSlugFor('coach')).toBeNull();
  });

  it('vehicleEntitySlots：单台居中、一排 6 台、超 6 折行、确定性', () => {
    const width = 1.9;
    const step = width + 0.6;
    expect(vehicleEntitySlots({ count: 1 }, width)).toEqual([{ index: 0, offsetX: 0, offsetY: 0 }]);
    const two = vehicleEntitySlots({ count: 2 }, width);
    expect(two.map((slot) => slot.offsetX)).toEqual([-step / 2, step / 2]);
    expect(two.every((slot) => slot.offsetY === 0)).toBe(true);

    const six = vehicleEntitySlots({ count: 6 }, width);
    expect(six).toHaveLength(6);
    expect(six.every((slot) => slot.offsetY === 0)).toBe(true);

    const seven = vehicleEntitySlots({ count: 7 }, width);
    expect(seven).toHaveLength(7);
    expect(seven[6]!.offsetY).toBeLessThan(0); // 第二行在落点后方
    expect(seven[6]!.offsetX).toBe(0); // 第二行只有一台 → 居中

    // 同一输入重复调用完全一致（刷新不跳）。
    expect(vehicleEntitySlots({ count: 7 }, width)).toEqual(seven);
  });

  it('vehicleEntitySlots：0/负数不虚构车，99 台按上限截断', () => {
    expect(vehicleEntitySlots({ count: 0 }, 1.9)).toEqual([]);
    expect(vehicleEntitySlots({ count: -3 }, 1.9)).toEqual([]);
    expect(vehicleEntitySlots({ count: 99 }, 1.9)).toHaveLength(MAX_VEHICLE_INSTANCES);
  });
});
