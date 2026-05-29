import { img } from '../render';
import SkinDetailScene, { buildSkinDetailPaths } from './skinDetail';

/**
 * 方块皮肤数据
 * 每个方块在 images/game/block/<folder>/<folder>_success.png
 * 默认 7 色已解锁且使用中
 */
const BLOCK_SKIN_CONFIG = {
  title: '方块皮肤',
  skinType: 'block',
  maxSelected: 7,
  defaultUnlocked: ['black', 'pink', 'yellow', 'purple', 'blue', 'red', 'green'],
  skins: [
    { id: 'black',  file: 'black/black_success.png'  },
    { id: 'pink',   file: 'pink/pink_success.png'    },
    { id: 'yellow', file: 'yellow/yellow_success.png' },
    { id: 'purple', file: 'purple/purple_success.png' },
    { id: 'blue',   file: 'blue/blue_success.png'    },
    { id: 'red',    file: 'red/red_success.png'      },
    { id: 'green',  file: 'green/green_success.png'  },
    { id: 'skin1',  file: 'skin1/skin1_success.png'  },
    { id: 'skin2',  file: 'skin2/skin2_success.png'  },
    { id: 'skin3',  file: 'skin3/skin3_success.png'  },
    { id: 'skin4',  file: 'skin4/skin4_success.png'  },
    { id: 'skin5',  file: 'skin5/skin5_success.png'  },
    { id: 'skin6',  file: 'skin6/skin6_success.png'  },
    { id: 'skin7',  file: 'skin7/skin7_success.png'  },
  ],
  imgPath: (s) => `images/game/block/${s.file}`,
};

export function buildBlockSkinPaths() {
  return buildSkinDetailPaths(BLOCK_SKIN_CONFIG);
}

export default class BlockSkinScene extends SkinDetailScene {
  constructor(onBack) {
    super(BLOCK_SKIN_CONFIG, onBack);
  }
}
