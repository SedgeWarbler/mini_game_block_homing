import { img } from '../render';
import SkinDetailScene, { buildSkinDetailPaths } from './skinDetail';

/**
 * 石头皮肤数据
 * 图片在 images/game/stone/<file>
 * 默认只解锁 default
 */
const STONE_SKIN_CONFIG = {
  title: '石头皮肤',
  skinType: 'stone',
  maxSelected: 1,
  defaultUnlocked: ['default'],
  skins: [
    { id: 'default', file: 'default.png' },
    { id: 'skin1',   file: 'skin1.png'   },
    { id: 'skin2',   file: 'skin2.png'   },
    { id: 'skin3',   file: 'skin3.png'   },
  ],
  imgPath: (s) => `images/game/stone/${s.file}`,
};

export function buildStoneSkinPaths() {
  return buildSkinDetailPaths(STONE_SKIN_CONFIG);
}

export default class StoneSkinScene extends SkinDetailScene {
  constructor(onBack) {
    super(STONE_SKIN_CONFIG, onBack);
  }
}
