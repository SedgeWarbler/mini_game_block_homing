/**
 * SokobanBoard - 推箱子游戏板核心逻辑
 *
 * 管理玩家移动、箱子推动、步数统计、胜利判定。
 * 与 Board.js（方块归位）独立，因为推箱子的规则完全不同：
 *   - 玩家主动移动（一次一格），而非滑行
 *   - 玩家可以推动箱子（前方一格有箱子且箱子前方为空）
 *   - 不限步数，只记录已走步数
 */

const DIRS = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

export default class SokobanBoard {
  constructor(levelData) {
    this.rows = levelData.rows;
    this.cols = levelData.cols;
    this.grid = levelData.grid; // 二维数组: null | { type: 'stone' } | { type: 'target' }
    this.player = { row: levelData.player.row, col: levelData.player.col };
    this.boxes = levelData.boxes.map((b) => ({ ...b }));
    this.targets = levelData.targets.map((t) => ({ ...t }));
    this.level = levelData.level;

    // 步数统计（只增不减）
    this.stepCount = 0;

    // 移动历史（用于撤销）
    this.history = [];

    // 目标位置集合（快速查找）
    this.targetSet = new Set(this.targets.map((t) => `${t.row},${t.col}`));

    // 动画状态
    this.playerAnim = null;  // { fromR, fromC, toR, toC, progress, duration }
    this.boxAnim = null;     // { boxId, fromR, fromC, toR, toC, progress, duration }

    // 保存初始状态（用于重置）
    this._initPlayer = { row: levelData.player.row, col: levelData.player.col };
    this._initBoxes = levelData.boxes.map((b) => ({ ...b }));
  }

  /**
   * 获取指定位置的箱子
   */
  getBoxAt(r, c) {
    return this.boxes.find((b) => b.row === r && b.col === c);
  }

  /**
   * 检查某位置是否为石头/墙壁
   */
  isWall(r, c) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return true;
    const cell = this.grid[r][c];
    return cell && cell.type === 'stone';
  }

  /**
   * 检查某位置是否可通行（不是墙、不是箱子）
   */
  isFree(r, c) {
    if (this.isWall(r, c)) return false;
    if (this.getBoxAt(r, c)) return false;
    return true;
  }

  /**
   * 检查箱子是否在目标点上
   */
  isBoxOnTarget(box) {
    return this.targetSet.has(`${box.row},${box.col}`);
  }

  /**
   * 尝试移动玩家
   * @param {string} dir - 'up' | 'down' | 'left' | 'right'
   * @returns {Object} { moved, pushedBox }
   */
  movePlayer(dir) {
    if (this.playerAnim || this.boxAnim) {
      return { moved: false, pushedBox: false };
    }

    const [dr, dc] = DIRS[dir];
    const newR = this.player.row + dr;
    const newC = this.player.col + dc;

    // 检查是否撞墙
    if (this.isWall(newR, newC)) {
      return { moved: false, pushedBox: false };
    }

    // 检查前方是否有箱子
    const box = this.getBoxAt(newR, newC);
    if (box) {
      // 尝试推箱子：检查箱子前方是否可通行
      const boxNewR = newR + dr;
      const boxNewC = newC + dc;

      if (this.isWall(boxNewR, boxNewC) || this.getBoxAt(boxNewR, boxNewC)) {
        // 箱子前方有墙或另一个箱子，不能推
        return { moved: false, pushedBox: false };
      }

      // 记录历史（用于撤销）
      this.history.push({
        playerR: this.player.row,
        playerC: this.player.col,
        boxId: box.id,
        boxR: box.row,
        boxC: box.col,
      });

      // 启动箱子动画
      this.boxAnim = {
        boxId: box.id,
        fromR: box.row,
        fromC: box.col,
        toR: boxNewR,
        toC: boxNewC,
        progress: 0,
        duration: 4,
      };

      // 立即更新箱子数据位置
      box.row = boxNewR;
      box.col = boxNewC;

      // 启动玩家动画
      this.playerAnim = {
        fromR: this.player.row,
        fromC: this.player.col,
        toR: newR,
        toC: newC,
        progress: 0,
        duration: 4,
      };

      // 立即更新玩家数据位置
      this.player.row = newR;
      this.player.col = newC;

      this.stepCount++;
      return { moved: true, pushedBox: true };
    }

    // 前方是空地或目标点，直接移动

    // 记录历史
    this.history.push({
      playerR: this.player.row,
      playerC: this.player.col,
      boxId: null,
      boxR: null,
      boxC: null,
    });

    // 启动玩家动画
    this.playerAnim = {
      fromR: this.player.row,
      fromC: this.player.col,
      toR: newR,
      toC: newC,
      progress: 0,
      duration: 4,
    };

    // 立即更新数据位置
    this.player.row = newR;
    this.player.col = newC;

    this.stepCount++;
    return { moved: true, pushedBox: false };
  }

  /**
   * 撤销上一步
   */
  undo() {
    if (this.history.length === 0) return false;
    if (this.playerAnim || this.boxAnim) return false;

    const last = this.history.pop();
    this.player.row = last.playerR;
    this.player.col = last.playerC;

    if (last.boxId !== null) {
      const box = this.boxes.find((b) => b.id === last.boxId);
      if (box) {
        box.row = last.boxR;
        box.col = last.boxC;
      }
    }

    this.stepCount--;
    return true;
  }

  /**
   * 重置关卡到初始状态
   */
  reset() {
    if (this.playerAnim || this.boxAnim) return false;
    this.player.row = this._initPlayer.row;
    this.player.col = this._initPlayer.col;
    this.boxes = this._initBoxes.map((b) => ({ ...b }));
    this.stepCount = 0;
    this.history = [];
    this.playerAnim = null;
    this.boxAnim = null;
    return true;
  }

  /**
   * 更新动画
   */
  updateAnim() {
    if (this.playerAnim) {
      this.playerAnim.progress += 1 / this.playerAnim.duration;
      if (this.playerAnim.progress >= 1) {
        this.playerAnim = null;
      }
    }
    if (this.boxAnim) {
      this.boxAnim.progress += 1 / this.boxAnim.duration;
      if (this.boxAnim.progress >= 1) {
        this.boxAnim = null;
      }
    }
  }

  /**
   * 动画是否正在播放
   */
  isAnimating() {
    return !!(this.playerAnim || this.boxAnim);
  }

  /**
   * 获取玩家当前绘制位置（考虑动画插值）
   */
  getPlayerDrawPos() {
    if (this.playerAnim) {
      const p = this._easeOutCubic(Math.min(1, this.playerAnim.progress));
      return {
        row: this.playerAnim.fromR + (this.playerAnim.toR - this.playerAnim.fromR) * p,
        col: this.playerAnim.fromC + (this.playerAnim.toC - this.playerAnim.fromC) * p,
      };
    }
    return { row: this.player.row, col: this.player.col };
  }

  /**
   * 获取箱子当前绘制位置（考虑动画插值）
   */
  getBoxDrawPos(box) {
    if (this.boxAnim && this.boxAnim.boxId === box.id) {
      const p = this._easeOutCubic(Math.min(1, this.boxAnim.progress));
      return {
        row: this.boxAnim.fromR + (this.boxAnim.toR - this.boxAnim.fromR) * p,
        col: this.boxAnim.fromC + (this.boxAnim.toC - this.boxAnim.fromC) * p,
      };
    }
    return { row: box.row, col: box.col };
  }

  /**
   * 判定胜利：所有目标点上都有箱子
   */
  isWin() {
    return this.targets.every((t) => {
      return this.boxes.some((b) => b.row === t.row && b.col === t.col);
    });
  }

}
