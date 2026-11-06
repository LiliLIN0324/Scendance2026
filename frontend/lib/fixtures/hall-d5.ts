/**
 * 真实场地基准 fixture（纯数据，不引图片/PDF/外部资源）。
 *
 * 数据来源（主会话亲自抓官方 PDF 后人工录入，仅作排序参照，非消防/官方核定值）：
 * - 东京国际论坛 Hall D5：285㎡，官方剧院 200 / 课桌 120。
 *   课桌 1.8×0.6m；椅 0.49×0.57m；圆桌 Ø1.8m；
 *   剧院排距 900mm、走道 1000mm、台前留空 5000mm、三列块；
 *   课桌排距 1400mm、走道 1200mm、每桌 3 人、三列块、台前 5000mm。
 * - 广州增城保利皇冠假日会议室 6：12.9×7.1m / 93㎡，
 *   剧院 80 / 课桌 45 / 回型 42 / U 型 36。
 *
 * 红线：
 * - 门宽与开启方向在官方图上无数字 → widthM 不填（unknown），
 *   对应 violation 必须走四值 unknown，不得默认 pass；
 * - 南墙一排双开门按图推断位置，标 inferred:true（不是用户在画布上真实画的）；
 * - 西北角「非常口」应急口位置按图估，width/方向 unknown；
 * - roomSize 按图估 19m×15m，字段注释「估测，待场地方核实」；
 * - capacityReference 注释「参考值非消防核定」，文案不得称「消防已批准」。
 */

/** 米制房间尺寸（房间中心为原点；width=x 全宽、height=z 全深）。 */
export interface FixtureRoomSize {
  width: number;
  height: number;
  /** 字段注释：本尺寸是估测还是官方实测。 */
  note?: string;
}

/** 一扇门的标注（坐标与 PlanAnnotationGeometry door 同形）。 */
export interface FixtureDoor {
  id: string;
  wall: 'north' | 'south' | 'east' | 'west';
  /** 沿墙位置（x 向墙取 x、z 向墙取 z），房间中心为原点。 */
  position: number;
  label: string;
  /**
   * 门宽（米）。官方图上无数字时不填 → 管线按 unknown 走四值。
   * 不要为了让门弧测试绿而硬编一个 0.9。
   */
  widthM?: number;
  /**
   * 本门是从图纸推断的（不是用户在画布上真实画的）。
   * 南墙一排双开门标 true；西北应急口也按图估，同样 true。
   */
  inferred?: boolean;
  /** true = 消防应急出口（非常口），用于测试不堵应急口。 */
  isEmergency?: boolean;
}

/** 家具尺寸参考（米）。 */
export interface FixtureFurnitureRef {
  /** 课桌（1.8×0.6）。 */
  deskTable: { width: number; depth: number };
  /** 座椅（0.49×0.57）。 */
  deskChair: { width: number; depth: number };
  /** 圆桌直径（官方 1.8m；与 catalog 内 1.2m 圆桌是不同道具）。 */
  roundTableDiameterM: number;
}

/** 官方参考容量（非消防核定）。 */
export interface FixtureCapacityReference {
  theater?: number;
  classroom?: number;
  uShape?: number;
  roundtable?: number;
  notes: string;
}

/** 一个完整场地 fixture。 */
export interface VenueFixture {
  venueKey: string;
  label: string;
  roomSize: FixtureRoomSize;
  doors: FixtureDoor[];
  furniture: FixtureFurnitureRef;
  /** 官方布局参考常数（米）。 */
  layoutReference: {
    /** 剧院式排距（桌前沿到桌前沿）。 */
    theaterRowPitchM: number;
    /** 剧院式走道净宽。 */
    theaterAisleM: number;
    /** 课桌式排距。 */
    classroomRowPitchM: number;
    /** 课桌式走道净宽。 */
    classroomAisleM: number;
    /** 台前留空（第一排到舞台/讲台）。 */
    stageFrontClearM: number;
    /** 课桌每桌人数。 */
    chairsPerClassroomTable: number;
  };
  capacityReference: FixtureCapacityReference;
}

/**
 * 东京国际论坛 Hall D5（285㎡）。
 *
 * roomSize 19×15 = 285㎡ 是按图估算的外接矩形，
 * 实际厅形可能是矩形带切角，待场地方提供 CAD 后校准。
 */
export const HALL_D5: VenueFixture = {
  venueKey: 'tokyo-international-forum-hall-d5',
  label: '东京国际论坛 Hall D5',
  roomSize: {
    width: 19,
    height: 15,
    note: '估测，待场地方核实（按图外接矩形 19×15≈285㎡）',
  },
  doors: [
    {
      id: 'd5-south-double',
      wall: 'south',
      position: 0,
      label: '南墙主入口双开门（推断）',
      // 官方图上无门宽数字 → 不填 widthM，走 unknown。
      inferred: true,
    },
    {
      id: 'd5-northwest-emergency',
      wall: 'west',
      position: -15 / 2 + 1.2, // 西北墙角附近：z ≈ -6.3（西墙、靠北）
      label: '西北角非常口应急出口',
      // 门宽与开启方向图上无数字 → 不填。
      inferred: true,
      isEmergency: true,
    },
  ],
  furniture: {
    deskTable: { width: 1.8, depth: 0.6 },
    deskChair: { width: 0.49, depth: 0.57 },
    roundTableDiameterM: 1.8,
  },
  layoutReference: {
    theaterRowPitchM: 0.9,
    theaterAisleM: 1.0,
    classroomRowPitchM: 1.4,
    classroomAisleM: 1.2,
    stageFrontClearM: 5.0,
    chairsPerClassroomTable: 3,
  },
  capacityReference: {
    theater: 200,
    classroom: 120,
    notes: '官方参考值，非消防核定；本 fixture 用于排序参照',
  },
};

/**
 * 广州增城保利皇冠假日会议室 6（12.9×7.1m / 93㎡）。
 *
 * 官方参考容量：剧院 80 / 课桌 45 / 回型 42 / U 型 36。
 */
export const GUANGZHOU_MEETING_ROOM_6: VenueFixture = {
  venueKey: 'gz-zengcheng-poly-meeting-6',
  label: '广州增城保利会议室 6',
  roomSize: {
    width: 12.9,
    height: 7.1,
    note: '官方实测（12.9×7.1，标称 93㎡）',
  },
  doors: [
    {
      id: 'gz6-south-entry',
      wall: 'south',
      position: 0,
      label: '南墙入口（推断位置）',
      // 门宽官方图未标 → unknown。
      inferred: true,
    },
  ],
  furniture: {
    deskTable: { width: 1.8, depth: 0.6 },
    deskChair: { width: 0.49, depth: 0.57 },
    roundTableDiameterM: 1.8,
  },
  layoutReference: {
    theaterRowPitchM: 0.9,
    theaterAisleM: 1.0,
    classroomRowPitchM: 1.4,
    classroomAisleM: 1.2,
    stageFrontClearM: 5.0,
    chairsPerClassroomTable: 3,
  },
  capacityReference: {
    theater: 80,
    classroom: 45,
    uShape: 36,
    roundtable: 42,
    notes: '官方参考值，非消防核定',
  },
};

/** 全部 fixture 列表（便于遍历）。 */
export const ALL_VENUE_FIXTURES: readonly VenueFixture[] = [HALL_D5, GUANGZHOU_MEETING_ROOM_6];
