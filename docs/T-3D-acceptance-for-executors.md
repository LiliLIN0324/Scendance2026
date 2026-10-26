# T-3D-* 验收细节（给 Trae / Qoder / DSH）

> 领队：平面图转3D空间 · **只写规格，不改本地 Scendance2026**  
> 卡号若与产品经理总表不一致，以总表为准，本文件按能力对齐。  
> 母规格：`floorplan-3d-ai-native-upgrade.md`

## 执行总闸

- DO：按 SceneV2 / `venue.site` / 下列验收句改；改前读 `domain.ts`、`reconstruction.ts`。  
- DON'T：本轮擅自改用户本地仓；另起数据模型；Agent 直接拧 Three/GLB；DWG 买 ODA；氛围 bake 进 GLB（氛围归场景氛围调研）。  
- 字段对齐氛围层：层高 = `venue.height`（默认 4.0，`heightSource`）；主入口 = `venue.site.mainEntrance.openingId`（不要平行造 `ceilingHeightM` 第二真相，若总表用别名须映射到此）。

---

### T-3D-01 摄入（图片底图 MVP）
**做**：`POST /assets/floorplan` 仅 PNG/JPEG；记 asset + 哈希；DXF/DWG/PDF → 明确拒绝文案（与现 `nonImageRejected` 一致）。  
**验收**：非图片上传被拒且有可读原因；图片可叠为底图。  
**禁**：假装已有 DXF 导入。

### T-3D-02 手输长宽矩形壳
**做**：用户输入 width/depth（米）→ 矩形 `venue` + 四面外墙（或等价壳）→ 可进布置。  
**验收**：3D 包围盒与手输长宽误差 ≤ 0.5%；底图按壳拉伸对齐。  
**禁**：未确认比例时用 `$INSUNITS` 静默定米。

### T-3D-03 比例确认闸（一键边长）
**做**：`propose_scale` 出最长外墙尺寸条；`confirm_scale` 写入 `DimensionConstraint` + `venue.site.scale.confidence=high`。  
**验收**：确认一边后，相对该边误差 ≤1%；`confidence` 可追溯。  
**人闸**：必现；Agent 不可跳过。

### T-3D-04 层高与主入口
**做**：默认层高 4.0 m 且 `heightSource=default`/`inferred`；多门时 `list_entrance_candidates` + `set_main_entrance(openingId)`。  
**验收**：漫游出生点可读到同一 `openingId`；层高改动能驱动眼高（氛围侧读此字段）。  
**禁**：`venue.entrances` 与 `mainEntrance` 双真相。

### T-3D-05 结构草稿（图片 CV / 现有重建）
**做**：墙/门/柱 → SceneV2 `structure`，`status=detected|inferred`，`evidence` 叠底图。  
**验收**：不确定项进 `explain_uncertainty` 清单且可点击定位；大模型不单独产出米制几何。  
**禁**：无商用权重硬塞进产品。

### T-3D-06 DXF 矢量导入（P2，新建层）
**做**：新建矢量管线（ezdxf/浏览器预览）；展开 INSERT；双线墙配对；单位交叉校验。  
**验收**：样例 DXF 单位判对后尺寸误差 ≈0（相对确认边）；图层冲突走人闸。  
**现状**：仓内**仅有 DXF 导出**，无导入——执行前须新建，勿改 export 冒充 import。

### T-3D-07 rebuild_glb
**做**：由 SceneV2 挤出 GLB；层级 Venue/Floor/Structure/Markers；节点 `类型_UUID`。  
**验收**：GLB 包围盒与 SceneV2 一致；改 structure 后旧 GLB 不脏读。  
**禁**：把 GLB 当编辑源回写。

### T-3D-08 Agent 空间工具面
**做**：暴露 `ingest_floorplan` / `parse_structure` / `propose_scale` / `confirm_scale` / `set_ceiling_height` / `set_main_entrance` / `apply_structure_patch` / `rebuild_glb` / `explain_uncertainty`。  
**验收**：每条建议可落到 SceneV2 且可撤销；`confidence≠high` 返回 `needs_user_confirm`。  
**禁**：Agent 代拖画布；直接 `set_mesh_transform`；静默删外墙环。

### T-3D-09 交付吐出（机读块）
**做**：导出块含 structure 快照、`venue.site`、顶视带比例尺、通道最窄处【估算+来源】、相对上版 diff。  
**验收**：交付 AI 能不打开 Three 拼进 PDF/清单。  
**文案**：疏散数字必须带「仅供参考，非合规认证」。

---

## 建议执行顺序（仍等用户点卡）

`T-3D-01 → 02 → 03 → 04 → 07`（MVP 壳）→ `05` → `08` → `09`；`06` 单开 CAD 里程碑。

用户点卡号之前：**不要动代码**。
