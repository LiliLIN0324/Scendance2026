#!/usr/bin/env python3
"""Export the merged, verified catalogue with Chinese folder and file names."""
import argparse
import csv
import io
import json
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
index = json.loads((root / 'assets/library/merged.json').read_text())
categories = {row['key']: row['label'] for row in index['buckets']}
manifest = io.StringIO(newline='')
writer = csv.writer(manifest)
writer.writerow(['中文名称', '分类', '文件路径', '英文原名', '宽度（米）', '进深（米）', '高度（米）', '字节数', 'SHA256', '来源', '许可', '说明'])
args.output.parent.mkdir(parents=True, exist_ok=True)
used = set()
with zipfile.ZipFile(args.output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for model in index['models']:
        name = model['name'].replace('/', '／').replace('\\', '＼')
        folder = categories[model['bucket']]
        stem = f'{folder}/{name}'
        if stem in used:
            stem += '—' + model['slug'].split('-')[-1]
        if stem in used:
            raise ValueError(f'Duplicate export filename: {stem}')
        used.add(stem)
        path = f'模型/{stem}.glb'
        archive.write(root / model['glb'].removeprefix('/showcase/'), path)
        archive.write(root / model['thumb'].removeprefix('/showcase/'), f'预览图/{stem}.webp')
        writer.writerow([model['name'], folder, path, model['originalName'], model['width'], model['depth'], model['height'], model['bytes'], model['sha256'], model['page'], model['license'], model.get('blockedReason', '')])
    archive.writestr('模型清单.csv', '\ufeff' + manifest.getvalue())
    archive.writestr('使用说明.txt', f'''幕景统一模型库\n\n共 {index['count']} 个不重复 GLB 模型，分为 {len(index['buckets'])} 类。\n模型与预览图均使用中文文件名；同名不同款式保留原始标识后缀。\n单位：米；Y 轴向上。清单尺寸顺序为宽、深、高。\n来源：3DAssets.dev；许可：CC0 1.0 Universal。逐项来源与 SHA256 见模型清单.csv。\n24 个原始文件存在截断，已按原文件前缀核对并从原站补齐。\n巧克力工坊生产线为完整场景（240036 个三角形），超过网站单件物料限制；可在三维软件中打开处理。\n网站可调用目录包含 528 项，其余超限完整场景保留于此归档。\n''')
print(f'{args.output}: {index["count"]} models, {args.output.stat().st_size} bytes')
