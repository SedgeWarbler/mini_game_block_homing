/**
 * 关卡预加载与持久缓存
 *
 * 设计目标：
 * 1. 玩家进入第 N 关时，后台开始异步生成第 N+1 关（"预取"），点击下一关无需等待。
 * 2. 关卡数据按"关卡号"为 key 永久缓存：一旦某关被生成出来，重玩、失败、回首页再进
 *    都拿到完全相同的数据（不会换一关）。
 * 3. 缓存写入 wx 本地存储，跨会话保留。即便玩家关闭小游戏再回来，已经预取好的下一关
 *    依然可以秒进。
 * 4. 同一关并发请求会合并到同一个 Promise（pending 去重），避免重复跑 BFS。
 */

import { generateLevelAsync } from './levelGenerator';

// 缓存键带版本号：调整关卡生成规则（如步数缓冲、难度梯度）时把版本号 +1，
// 让旧版本生成的缓存自动失效、自动重新生成符合新规则的关卡。
const STORAGE_KEY = 'block_level_cache_v5';
const LEGACY_STORAGE_KEYS = ['block_level_cache_v1', 'block_level_cache_v2', 'block_level_cache_v3', 'block_level_cache_v4'];
const MAX_KEEP = 4; // 内存里最多保留最近的关卡数据；过老的从内存中清理（仍可从 storage 恢复）

class LevelPreloader {
  constructor() {
    /** @type {Map<number, object>} 关卡号 → 关卡数据 */
    this.cache = new Map();
    /** @type {Map<number, Promise<object>>} 关卡号 → 正在生成的 Promise */
    this.pending = new Map();

    this._dropLegacy();
    this._loadFromStorage();
  }

  /**
   * 清掉旧版本缓存键，避免本地存储一直占用空间。
   * 每次升级 STORAGE_KEY 版本号时把过期的 key 追加进 LEGACY_STORAGE_KEYS 即可。
   */
  _dropLegacy() {
    for (const key of LEGACY_STORAGE_KEYS) {
      try { wx.removeStorageSync(key); } catch (e) {}
    }
  }

  /** 是否已经有可立即使用的数据 */
  hasCached(level) {
    return this.cache.has(level);
  }

  /** 是否正在生成中 */
  isPending(level) {
    return this.pending.has(level);
  }

  /**
   * 同步取一份关卡数据的深拷贝；如果没有缓存返回 null。
   * 玩家点击进入时若 hasCached(level)，可直接走这个 sync 路径，零等待。
   */
  takeCached(level) {
    if (!this.cache.has(level)) return null;
    return cloneLevelData(this.cache.get(level));
  }

  /**
   * 异步取数据：有缓存立刻返回，无缓存会启动生成并 await 完成。
   * 返回的是深拷贝，便于 Board 直接持有不污染缓存。
   */
  async getLevel(level) {
    if (this.cache.has(level)) {
      return cloneLevelData(this.cache.get(level));
    }
    const data = await this._ensure(level);
    return cloneLevelData(data);
  }

  /**
   * 后台预取：调用方不需要 await，结果会进缓存。
   * 已经在缓存或 pending 中的不会重复触发。
   */
  prefetch(level) {
    if (!Number.isFinite(level) || level < 1) return;
    if (this.cache.has(level) || this.pending.has(level)) return;
    this._ensure(level).catch((err) => {
      console.warn(`预生成关卡 ${level} 失败:`, err);
    });
  }

  _ensure(level) {
    if (this.pending.has(level)) return this.pending.get(level);

    const promise = generateLevelAsync(level).then((data) => {
      this.cache.set(level, data);
      this.pending.delete(level);
      this._trimMemory(level);
      this._save();
      return data;
    }).catch((err) => {
      this.pending.delete(level);
      throw err;
    });

    this.pending.set(level, promise);
    return promise;
  }

  /**
   * 内存里只保留最近 MAX_KEEP 个关卡。优先保留"离当前关卡近"的几个。
   * 注意：从内存中淘汰不会影响 storage 中的副本，回来时还能恢复。
   */
  _trimMemory(anchorLevel) {
    if (this.cache.size <= MAX_KEEP) return;
    const sorted = Array.from(this.cache.keys()).sort(
      (a, b) => Math.abs(a - anchorLevel) - Math.abs(b - anchorLevel)
    );
    while (sorted.length > MAX_KEEP) {
      const drop = sorted.pop();
      this.cache.delete(drop);
    }
  }

  _save() {
    try {
      const obj = {};
      for (const [level, data] of this.cache.entries()) {
        obj[level] = data;
      }
      wx.setStorageSync(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      // storage 写入失败不应该阻塞游戏流程，只是失去跨会话缓存能力
      console.warn('关卡缓存持久化失败:', e);
    }
  }

  _loadFromStorage() {
    try {
      const raw = wx.getStorageSync(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      for (const k of Object.keys(obj)) {
        const level = parseInt(k, 10);
        if (Number.isFinite(level) && obj[k]) {
          this.cache.set(level, obj[k]);
        }
      }
    } catch (e) {
      console.warn('关卡缓存读取失败:', e);
    }
  }

  /**
   * 清空内存缓存与本地持久化缓存。
   * 进行中的 pending Promise 会被遗弃（它们仍会跑完，但结果不再被任何人持有），
   * 玩家手动"重新开始"时调用。
   */
  clear() {
    this.cache.clear();
    this.pending.clear();
    try {
      wx.removeStorageSync(STORAGE_KEY);
    } catch (e) {
      // 移除失败不影响功能，下次 _save 会覆盖
    }
  }
}

/**
 * 手动浅拷贝关卡数据：grid 的每个 cell 是只读 plain object，row 级浅拷贝即可；
 * blocks/holes/portals 逐元素浅拷贝。比 JSON.parse(JSON.stringify()) 快数倍。
 */
function cloneLevelData(data) {
  return {
    ...data,
    grid: data.grid ? data.grid.map((row) => row.slice()) : data.grid,
    blocks: data.blocks ? data.blocks.map((b) => ({ ...b })) : data.blocks,
    holes: data.holes ? data.holes.map((h) => ({ ...h })) : data.holes,
    portals: data.portals ? data.portals.map((p) => ({ ...p })) : data.portals,
  };
}

const preloader = new LevelPreloader();
export default preloader;
