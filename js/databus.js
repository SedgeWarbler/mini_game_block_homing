const STORAGE_KEY = 'block_home_data';

/**
 * 全局数据管理器
 * 负责关卡进度、设置等持久化存储
 */
export default class DataBus {
  data = {};

  constructor() {
    this.load();
  }

  load() {
    try {
      const raw = wx.getStorageSync(STORAGE_KEY);
      this.data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      this.data = {};
    }
    if (!this.data.currentLevel) this.data.currentLevel = 1;
    if (!this.data.maxLevel) this.data.maxLevel = 1;
    // 老版本兼容：之前没有 hasProgress 字段，依据 currentLevel/maxLevel 推断。
    // 只要曾经推进过任何一关，就视为有进度。
    if (typeof this.data.hasProgress === 'undefined') {
      this.data.hasProgress = this.data.currentLevel > 1 || this.data.maxLevel > 1;
    }
    // 传送门提示是否已显示过（运行时标志，重新开始游戏时重置）
    this.portalPromptShown = false;
  }

  save() {
    try {
      wx.setStorageSync(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {}
  }

  get currentLevel() {
    return this.data.currentLevel;
  }

  set currentLevel(v) {
    this.data.currentLevel = v;
    this.save();
  }

  get maxLevel() {
    return this.data.maxLevel;
  }

  set maxLevel(v) {
    this.data.maxLevel = v;
    this.save();
  }

  /**
   * 是否已经存在可继续的关卡进度。
   *   - 首次进入小程序：false（首页"继续游戏"按钮置灰）
   *   - 点过开始游戏之后：永远 true（除非主动 resetProgress）
   */
  get hasProgress() {
    return !!this.data.hasProgress;
  }

  set hasProgress(v) {
    this.data.hasProgress = !!v;
    this.save();
  }

  /**
   * 重置整体进度：清空 currentLevel/maxLevel/hasProgress。
   * 调用方在重置后还应该主动清掉 levelPreloader 的缓存，使新一轮游戏拿到全新生成的关卡。
   */
  resetProgress() {
    this.data.currentLevel = 1;
    this.data.maxLevel = 1;
    this.data.hasProgress = false;
    this.portalPromptShown = false;
    this.save();
  }
}
