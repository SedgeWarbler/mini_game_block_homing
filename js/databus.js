const STORAGE_KEY = 'block_home_data';

/** 皮肤系统：默认解锁的皮肤（始终免费，不需要存储） */
const DEFAULT_SKIN_UNLOCKED = {
  block: ['black', 'pink', 'yellow', 'purple', 'blue', 'red', 'green'],
  stone: ['default'],
  portal: ['blue_portal', 'purple_portal'],
  grid: ['default'],
};

/** 皮肤系统：首次进入时的默认选中 */
const DEFAULT_SKIN_SELECTED = {
  block: ['black', 'pink', 'yellow', 'purple', 'blue', 'red', 'green'],
  stone: ['default'],
  portal: ['blue_portal', 'purple_portal'],
  grid: ['default'],
};

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
    // 玩法提示是否已显示过（运行时标志，重新开始游戏时重置）
    this.gameplayPromptShown = false;

    // ---- 复活 & 广告 运行时状态（不持久化） ----
    // 每次「开始游戏」重置为 3，分享复活消耗 1 次
    this.shareResurrectionLeft = 3;
    // 当前关卡是否已用过广告复活（每关重置）
    this.adResurrectionUsedThisLevel = false;
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
    this.gameplayPromptShown = false;
    this.shareResurrectionLeft = 3;
    this.adResurrectionUsedThisLevel = false;
    this.save();
  }

  /* ---- 皮肤系统 ---- */

  /** 检查皮肤是否已解锁（默认皮肤始终返回 true） */
  isSkinUnlocked(type, skinId) {
    const defaults = DEFAULT_SKIN_UNLOCKED[type] || [];
    if (defaults.includes(skinId)) return true;
    const extra = (this.data.skinData && this.data.skinData.unlocked && this.data.skinData.unlocked[type]) || [];
    return extra.includes(skinId);
  }

  /** 解锁皮肤并持久化 */
  unlockSkin(type, skinId) {
    if (this.isSkinUnlocked(type, skinId)) return;
    if (!this.data.skinData) this.data.skinData = {};
    if (!this.data.skinData.unlocked) this.data.skinData.unlocked = {};
    if (!this.data.skinData.unlocked[type]) this.data.skinData.unlocked[type] = [];
    this.data.skinData.unlocked[type].push(skinId);
    this.save();
  }

  /** 获取选中的皮肤列表（返回副本） */
  getSelectedSkins(type) {
    const defaults = DEFAULT_SKIN_SELECTED[type] || [];
    if (this.data.skinData && this.data.skinData.selected && this.data.skinData.selected[type]) {
      return [...this.data.skinData.selected[type]];
    }
    return [...defaults];
  }

  /** 设置选中的皮肤列表并持久化 */
  setSelectedSkins(type, ids) {
    if (!this.data.skinData) this.data.skinData = {};
    if (!this.data.skinData.selected) this.data.skinData.selected = {};
    this.data.skinData.selected[type] = [...ids];
    this.save();
  }
}
