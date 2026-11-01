import { Boxes, Camera, Image as ImageIcon, Scan } from 'lucide-react';
import type { AholoDirectKind } from '../lib/aholo-assets';

/**
 * 同一概念全站只用一个图标：物料=Boxes、场地=Scan、图片建模=ImageIcon、场地重建=Camera。
 * 生成条的「你可以做什么」芯片、「+」菜单、观感面板的两张卡都从这里取，别再各写一个。
 */
export const KIND_ICONS: Record<AholoDirectKind, typeof Boxes> = {
  text: Boxes,
  image: ImageIcon,
  world: Scan,
  recon: Camera,
};