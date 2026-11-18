from pathlib import Path
p = Path(r'C:\Users\13266\.dsh\bot\workspace\Scendance2026\deliverables\oneplan-replica-geo-report-2026-11-17.html')
s = p.read_text(encoding='utf-8')
before = s
s = s.replace('1 案已描图配准，42 案为精确锚点并已核对', '2 案已描图配准，41 案为精确锚点并已核对')
s = s.replace('OnePlan 经典案例 · 底图核对报告（43 案 · Scotiabank 复核）',
              'OnePlan 经典案例 · 底图核对报告（43 案 · 首末两案复核）')
s = s.replace('<title>OnePlan 经典案例 · 底图核对报告（43 案 · Scotiabank 复核）</title>',
              '<title>OnePlan 经典案例 · 底图核对报告（43 案 · 首末两案复核）</title>')
p.write_text(s, encoding='utf-8')
print('changed', len(before) != len(s), 'bytes', p.stat().st_size)
