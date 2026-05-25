/**
 * Board - 游戏板核心逻辑
 * 管理方块移动计算、传送门、步数、撤回、胜利/失败判定
 * 注：方块实际移动由 GameScene 动画系统驱动，Board 只负责计算目标位置
 */

const DIRS = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

export default class Board {
  constructor(levelData) {
    this.rows = levelData.rows;
    this.cols = levelData.cols;
    this.grid = levelData.grid;
    this.blocks = levelData.blocks.map((b) => ({ ...b }));
    this.holes = levelData.holes;
    this.portals = levelData.portals;
    this.stepsLeft = levelData.steps;
    this.totalSteps = levelData.steps;
    this.level = levelData.level;

    // 撤回历史
    this.history = [];
    // 每局赠送 1 次免费撤回
    this.undoLeft = 1;

    // 抖动动画
    this.shakingBlockId = null;
    this.shakeFrame = 0;
    this.shakeOffset = { x: 0, y: 0 };

    // 传送门配对查找表
    this.portalMap = {};
    this.portals.forEach((p) => {
      if (!this.portalMap[p.color]) this.portalMap[p.color] = [];
      this.portalMap[p.color].push({ row: p.row, col: p.col });
    });
  }

  /** 复活时增加步数 */
  addSteps(n) {
    this.stepsLeft += n;
  }

  /** 看广告后增加撤回次数 */
  addUndos(n) {
    this.undoLeft += n;
  }

  getBlockAt(r, c) {
    return this.blocks.find((b) => !b.inHole && b.row === r && b.col === c);
  }

  saveState() {
    const snapshot = {
      blocks: this.blocks.map((b) => ({
        id: b.id,
        row: b.row,
        col: b.col,
        inHole: b.inHole,
      })),
      stepsLeft: this.stepsLeft,
    };
    this.history.push(snapshot);
  }

  undo() {
    if (this.undoLeft <= 0 || this.history.length === 0) return false;
    this.undoLeft--;
    const state = this.history.pop();
    state.blocks.forEach((s) => {
      const b = this.blocks.find((x) => x.id === s.id);
      if (b) {
        b.row = s.row;
        b.col = s.col;
        b.inHole = s.inHole;
      }
    });
    this.stepsLeft = state.stepsLeft;
    return true;
  }

  /**
   * 计算方块移动的分段路径（不修改状态）
   *
   * 与 solver.js 的 simMove 语义保持一致：
   *   - 若一次滑动中尝试进入同一传送门两次（含被传送到的出口端），
   *     视为死循环，移动判定为非法 → 玩家不消耗步数，方块抖动反馈。
   *   - 设硬性保护计数器，避免任何意外的无限循环卡死游戏。
   *
   * @returns {Object} { moved, segments, enteredHole, reason? }
   *   segments: [{ type:'slide'|'portal', fromR, fromC, toR, toC, color? }]
   */
  computeMove(blockId, dir) {
    const block = this.blocks.find((b) => b.id === blockId && !b.inHole);
    if (!block) return { moved: false, reason: 'no_block' };

    const [dr, dc] = DIRS[dir];
    let r = block.row;
    let c = block.col;
    let enteredHole = false;
    const segments = [];
    let lastR = r;
    let lastC = c;
    const visitedPortals = new Set();
    let loopDetected = false;
    let guard = 0;

    while (guard++ < 500) {
      const nr = r + dr;
      const nc = c + dc;

      if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) break;

      const other = this.blocks.find(
        (b) => b.id !== blockId && !b.inHole && b.row === nr && b.col === nc
      );
      if (other) break;

      const cell = this.grid[nr][nc];

      if (cell && cell.type === 'stone') break;

      if (cell && cell.type === 'hole') {
        if (cell.color === block.color) {
          r = nr;
          c = nc;
          enteredHole = true;
          if (r !== lastR || c !== lastC) {
            segments.push({ type: 'slide', fromR: lastR, fromC: lastC, toR: r, toC: c });
          }
          break;
        }
        break;
      }

      if (cell && cell.type === 'portal') {
        const key = `${nr},${nc}`;
        if (visitedPortals.has(key)) {
          loopDetected = true;
          break;
        }
        visitedPortals.add(key);

        const pair = (this.portalMap[cell.color] || []).find(
          (p) => p.row !== nr || p.col !== nc
        );

        r = nr;
        c = nc;
        if (r !== lastR || c !== lastC) {
          segments.push({ type: 'slide', fromR: lastR, fromC: lastC, toR: r, toC: c });
        }

        if (pair) {
          const pairKey = `${pair.row},${pair.col}`;
          if (visitedPortals.has(pairKey)) {
            loopDetected = true;
            break;
          }
          visitedPortals.add(pairKey);

          segments.push({
            type: 'portal',
            fromR: r,
            fromC: c,
            toR: pair.row,
            toC: pair.col,
            color: cell.color,
          });
          r = pair.row;
          c = pair.col;
          lastR = r;
          lastC = c;
        }
        continue;
      }

      r = nr;
      c = nc;
    }

    if (guard >= 500) loopDetected = true;

    if (loopDetected) {
      this.shakingBlockId = blockId;
      this.shakeFrame = 0;
      return { moved: false, reason: 'portal_loop' };
    }

    if (!enteredHole && (r !== lastR || c !== lastC)) {
      segments.push({ type: 'slide', fromR: lastR, fromC: lastC, toR: r, toC: c });
    }

    if (segments.length === 0) {
      this.shakingBlockId = blockId;
      this.shakeFrame = 0;
      return { moved: false, reason: 'blocked' };
    }

    return { moved: true, segments, enteredHole };
  }

  /**
   * 应用移动（动画完成后调用）
   */
  applyMove(blockId, targetR, targetC, enteredHole) {
    this.saveState();
    const block = this.blocks.find((b) => b.id === blockId);
    if (block) {
      block.row = targetR;
      block.col = targetC;
      if (enteredHole) {
        block.inHole = true;
      }
    }
    this.stepsLeft--;
  }

  isWin() {
    return this.blocks.every((b) => b.inHole);
  }

  isFail() {
    return this.stepsLeft <= 0 && !this.isWin();
  }

  updateShake() {
    if (this.shakingBlockId === null) return;
    this.shakeFrame++;
    const intensity = 3 * (1 - this.shakeFrame / 15);
    this.shakeOffset.x = Math.sin(this.shakeFrame * 1.5) * intensity;
    this.shakeOffset.y = Math.cos(this.shakeFrame * 2.0) * intensity;
    if (this.shakeFrame >= 15) {
      this.shakingBlockId = null;
      this.shakeOffset = { x: 0, y: 0 };
    }
  }
}
