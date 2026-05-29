import { img } from '../render';
import SkinDetailScene, { buildSkinDetailPaths } from './skinDetail';

/**
 * 网格皮肤数据
 * 图片在 images/game/grid/<file>
 * 默认只解锁 default
 */
const GRID_SKIN_CONFIG = {
  title: '网格皮肤',
  skinType: 'grid',
  maxSelected: 1,
  defaultUnlocked: ['default'],
  skins: [
    { id: 'default', file: 'default.png' },
    { id: 'skin1',   file: 'skin1.png'   },
  ],
  imgPath: (s) => `images/game/grid/${s.file}`,
};

export function buildGridSkinPaths() {
  return buildSkinDetailPaths(GRID_SKIN_CONFIG);
}

export default class GridSkinScene extends SkinDetailScene {
  constructor(onBack) {
    super(GRID_SKIN_CONFIG, onBack);
  }
}
