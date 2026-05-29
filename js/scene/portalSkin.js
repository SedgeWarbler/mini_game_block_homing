import { img } from '../render';
import SkinDetailScene, { buildSkinDetailPaths } from './skinDetail';

/**
 * 传送门皮肤数据
 * 图片在 images/game/portal/<file>
 * 默认解锁 blue_portal 和 purple_portal（当前使用的两个）
 */
const PORTAL_SKIN_CONFIG = {
  title: '传送门皮肤',
  skinType: 'portal',
  maxSelected: 2,
  defaultUnlocked: ['blue_portal', 'purple_portal'],
  skins: [
    { id: 'blue_portal',   file: 'blue_portal.png'  },
    { id: 'purple_portal', file: 'purple_portal.png' },
    { id: 'purple_skin1',  file: 'purple_skin1.png'  },
    { id: 'purple_skin2',  file: 'purple_skin2.png'  },
    { id: 'purple_skin3',  file: 'purple_skin3.png'  },
    { id: 'purple_skin4',  file: 'purple_skin4.png'  },
    { id: 'purple_skin5',  file: 'purple_skin5.png'  },
    { id: 'purple_skin6',  file: 'purple_skin6.png'  },
  ],
  imgPath: (s) => `images/game/portal/${s.file}`,
};

export function buildPortalSkinPaths() {
  return buildSkinDetailPaths(PORTAL_SKIN_CONFIG);
}

export default class PortalSkinScene extends SkinDetailScene {
  constructor(onBack) {
    super(PORTAL_SKIN_CONFIG, onBack);
  }
}
