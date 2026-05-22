import { SCREEN_WIDTH, SCREEN_HEIGHT, img, loadImg } from '../render';
import preloader from '../game/levelPreloader';
import Board from '../game/board';

const ctx = canvas.getContext('2d');

/**
 * 缓动函数：easeOutCubic，移动末尾减速
 */
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * 列举游戏场景所有需要的图片 URL（含通关/失败/传送门提示弹窗素材）。
 * 抽出来导出，是为了让 LoadingScene 能复用同一份 URL 清单统一预加载。
 *
 * key 命名约定（解析时不再写复杂正则，直接看前缀）：
 *   - `popup*`         → 通关弹窗素材
 *   - `fail*`          → 失败弹窗素材
 *   - `portalPrompt*`  → 传送门提示弹窗素材
 *   - 其余             → 主棋盘/UI/方块/洞/传送门帧
 */
export function buildGameScenePaths() {
  const paths = {
    bg: img('images/game/background.png'),
    returnBtn: img('images/game/return.png'),
    levelBg: img('images/game/level.png'),
    stepBg: img('images/game/step.png'),
    prompt: img('images/game/prompt.png'),
    withdraw: img('images/game/withdraw.png'),
    restart: img('images/game/come_back.png'),
    gridBg: img('images/game/large_grid.png'),
    smallSquare: img('images/game/small_square.png'),
    stone: img('images/game/stone.png'),
  };
  ['red', 'blue', 'green', 'yellow', 'purple'].forEach((c) => {
    paths[`block_${c}`] = img(`images/game/${c}/${c}.png`);
    paths[`hole_${c}`] = img(`images/game/${c}/${c}_hole.png`);
    paths[`success_${c}`] = img(`images/game/${c}/${c}_success.png`);
  });
  ['blue', 'purple', 'yellow'].forEach((c) => {
    paths[`portal_${c}`] = img(`images/game/portal/${c}_portal.png`);
    for (let i = 1; i <= 6; i++) {
      paths[`portal_${c}_${i}`] = img(`images/game/portal/${c}_portal_${i}.png`);
    }
  });
  paths.popupBg = img('images/success/background.png');
  paths.popupNext = img('images/success/next_level.png');
  paths.popupHome = img('images/success/back_home.png');
  paths.failBg = img('images/fail/background.png');
  paths.failRestart = img('images/fail/restart.png');
  paths.failHome = img('images/fail/back_home.png');
  paths.failAdGray = img('images/fail/ad_resurrection_gray_out.png');
  paths.failShareGray = img('images/fail/share_resurrection_gray_out.png');
  paths.portalPromptBg = img('images/game/portal/portal_prompt.png');
  paths.portalPromptSee = img('images/game/portal/see.png');
  return paths;
}

/**
 * 游戏主场景
 * 修复：按钮缩小、边框层级、方块平滑移动动画、传送门特效
 */
export default class GameScene {
  images = {};
  loaded = false;
  board = null;
  selectedBlockId = null;
  pressedBtn = null;
  hasDragged = false;
  pendingDir = null;
  dragStartX = 0;
  dragStartY = 0;

  // 方块移动动画
  blockAnim = null;

  // 传送门帧动画
  portalAnimFrame = 0;

  // 通关弹窗状态
  showSuccessPopup = false;
  successAlpha = 0;
  successScale = 0.7;
  successAnimating = false;
  successPressedKey = null;
  successImages = {};

  // 失败弹窗状态
  showFailPopup = false;
  failAlpha = 0;
  failScale = 0.7;
  failAnimating = false;
  failPressedKey = null;
  failImages = {};

  // 关卡数据加载状态
  levelLoading = false;
  loadingAnimT = 0;

  // 传送门提示弹窗状态
  showPortalPrompt = false;
  portalPromptAlpha = 0;
  portalPromptScale = 0.7;
  portalPromptAnimating = false;
  portalPromptPressed = false;
  portalPromptImages = {};

  // 弹窗布局只依赖屏幕尺寸 + 图片比例，整个场景生命周期内不变 —— 计算一次后缓存。
  _successPopupLayout = null;
  _failPopupLayout = null;
  _portalPromptLayout = null;

  constructor(onWin, onHome, data) {
    this.onWin = onWin;
    this.onHome = onHome;
    this.level = (data && data.level) || 1;

    this.loadResources().then(() => {
      this.loaded = true;
      this.bindEvents();
      this.startLevel(this.level);
    });
  }

  /* ---------- 资源加载 ---------- */

  loadResources() {
    const allPaths = buildGameScenePaths();
    return Promise.all(
      Object.entries(allPaths).map(([key, src]) =>
        loadImg(src).then((image) => {
          if (!image) return; // 单图加载失败时跳过，drawXxx 自身已有 if (!img) 早返回
          if (key.startsWith('popup')) {
            this.successImages[key] = image;
          } else if (key.startsWith('fail')) {
            this.failImages[key] = image;
          } else if (key.startsWith('portalPrompt')) {
            this.portalPromptImages[key] = image;
          } else {
            this.images[key] = image;
          }
        })
      )
    );
  }

  /* ---------- 关卡控制 ---------- */

  /**
   * 启动指定关卡：
   *   - 缓存命中：同步建立 Board，无 loading 帧；
   *   - 未命中：标记 levelLoading=true，await 异步生成，期间渲染"生成中"占位；
   * 数据就绪后，立刻顺手把下一关排进预取队列。
   */
  startLevel(level) {
    this.level = level;
    this.showSuccessPopup = false;
    this.successAnimating = false;
    this.showFailPopup = false;
    this.failAnimating = false;
    this.selectedBlockId = null;
    this.blockAnim = null;
    this.board = null;
    this.initialData = null;

    if (preloader.hasCached(level)) {
      const data = preloader.takeCached(level);
      this._applyLevelData(data);
      preloader.prefetch(level + 1);
      return;
    }

    this.levelLoading = true;
    this.calcShellLayout();
    const myLevel = level;
    preloader.getLevel(level).then((data) => {
      // 防御：如果在 await 期间用户已经切到别的关，不要覆盖
      if (this.level !== myLevel) return;
      this._applyLevelData(data);
      this.levelLoading = false;
      preloader.prefetch(level + 1);
    }).catch((err) => {
      console.error(`加载关卡 ${level} 失败:`, err);
      this.levelLoading = false;
    });
  }

  _applyLevelData(data) {
    this.initialData = JSON.parse(JSON.stringify(data));
    this.board = new Board(data);
    this.selectedBlockId = null;
    this.blockAnim = null;
    this._winCommitted = false;
    this.calcLayout();

    // 首次遇到传送门时弹出提示
    const db = GameGlobal.databus;
    if (db && !db.portalPromptShown && this.board.portals && this.board.portals.length > 0) {
      this.triggerPortalPrompt();
      db.portalPromptShown = true;
    }
  }

  /**
   * 通关时把进度落地到 databus，同时把下一关排进预取。
   * 幂等：同一关重复触发只会执行一次。
   */
  _commitWin() {
    if (this._winCommitted) return;
    this._winCommitted = true;

    const db = GameGlobal.databus;
    if (!db) return;

    const nextLevel = this.level + 1;
    db.currentLevel = nextLevel;
    if (nextLevel > db.maxLevel) {
      db.maxLevel = nextLevel;
    }
    db.hasProgress = true;

    preloader.prefetch(nextLevel);
  }

  restartLevel() {
    // 关卡数据还没就绪时点击重开应当被忽略
    if (this.levelLoading || !this.initialData) return;
    const data = JSON.parse(JSON.stringify(this.initialData));
    this.board = new Board(data);
    this.selectedBlockId = null;
    this.blockAnim = null;
    this._winCommitted = false;
    // 统一清掉所有可能残留的弹窗状态，避免遗漏（如失败弹窗的 restart 入口已手动清，
    // 但底部"重新开始"按钮在未来若被其他路径调用时也保持一致）
    this.showSuccessPopup = false;
    this.successAnimating = false;
    this.showFailPopup = false;
    this.failAnimating = false;
    this.calcLayout();
  }

  /* ---------- 布局计算 ---------- */

  /**
   * 仅计算顶部栏 + 返回按钮的简化布局，loading 状态下使用。
   * 主棋盘布局依赖 board.rows/cols，loading 阶段尚不可用。
   */
  calcShellLayout() {
    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    this.topH = h * 0.085;
    this.promptH = h * 0.045;
    this.bottomH = h * 0.11;

    const topIconH = this.topH * 0.58;
    const iconCenterY = this.topH * 0.78;
    const sideMargin = w * 0.04;

    this.btnLayout = this.btnLayout || {};

    if (this.images.returnBtn) {
      const bw = topIconH * (this.images.returnBtn.width / this.images.returnBtn.height);
      this.btnLayout.return = {
        x: sideMargin,
        y: iconCenterY - topIconH / 2,
        w: bw,
        h: topIconH,
      };
    }

    if (this.images.levelBg) {
      const lw = topIconH * (this.images.levelBg.width / this.images.levelBg.height);
      this.levelRect = {
        x: (w - lw) / 2,
        y: iconCenterY - topIconH / 2,
        w: lw,
        h: topIconH,
      };
    }
  }

  calcLayout() {
    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;

    this.topH = h * 0.085;
    this.promptH = h * 0.045;
    this.bottomH = h * 0.11;

    const availH = h - this.topH - this.promptH - this.bottomH;
    const maxW = w * 0.92;
    const maxH = availH * 0.96;

    // 根据行列计算单元格大小
    const cellByW = Math.floor(maxW / this.board.cols);
    const cellByH = Math.floor(maxH / this.board.rows);
    this.cellSize = Math.min(cellByW, cellByH);

    // 网格实际尺寸
    this.innerW = this.cellSize * this.board.cols;
    this.innerH = this.cellSize * this.board.rows;

    // 底板含边距（模拟木质边框）
    this.boardPadding = this.cellSize * 0.38;
    this.boardW = this.innerW + this.boardPadding * 2;
    this.boardH = this.innerH + this.boardPadding * 2;

    // 居中
    this.boardX = (w - this.boardW) / 2;
    this.boardY = this.topH + this.promptH + (availH - this.boardH) / 2;
    this.innerX = this.boardX + this.boardPadding;
    this.innerY = this.boardY + this.boardPadding;

    this.btnLayout = {};

    /* ---- 顶部信息栏：返回(左) | 关卡(中) | 步数(右) ---- */

    const topIconH = this.topH * 0.58;
    const iconCenterY = this.topH * 0.78;
    const sideMargin = w * 0.04;

    // 返回按钮（左，与其他素材统一高度）
    if (this.images.returnBtn) {
      const bw = topIconH * (this.images.returnBtn.width / this.images.returnBtn.height);
      this.btnLayout.return = {
        x: sideMargin,
        y: iconCenterY - topIconH / 2,
        w: bw,
        h: topIconH,
      };
    }

    // 关卡标题背景（居中，与步数等高保持平行）
    if (this.images.levelBg) {
      const lw = topIconH * (this.images.levelBg.width / this.images.levelBg.height);
      this.levelRect = {
        x: (w - lw) / 2,
        y: iconCenterY - topIconH / 2,
        w: lw,
        h: topIconH,
      };
    }

    // 步数背景（右）
    if (this.images.stepBg) {
      const sw = topIconH * (this.images.stepBg.width / this.images.stepBg.height);
      this.stepRect = {
        x: w - sideMargin - sw,
        y: iconCenterY - topIconH / 2,
        w: sw,
        h: topIconH,
      };
    }

    /* ---- 提示栏：匹配棋盘宽度 ---- */

    if (this.images.prompt) {
      const pw = this.boardW * 0.88;
      const ph = pw * (this.images.prompt.height / this.images.prompt.width);
      this.promptRect = {
        x: (w - pw) / 2,
        y: this.topH + this.promptH * 0.35,
        w: pw,
        h: ph,
      };
    }

    /* ---- 底部按钮：大圆角按钮 ---- */

    const btnW = w * 0.24;
    const btnGap = w * 0.10;
    const totalBtnW = btnW * 2 + btnGap;
    const btnStartX = (w - totalBtnW) / 2;
    const btnAreaTop = h - this.bottomH;

    if (this.images.withdraw) {
      const ratio = this.images.withdraw.height / this.images.withdraw.width;
      const bh = btnW * ratio;
      this.btnLayout.withdraw = {
        x: btnStartX,
        y: btnAreaTop + (this.bottomH * 0.28 - bh) / 2,
        w: btnW,
        h: bh,
      };
    }

    if (this.images.restart) {
      const ratio = this.images.restart.height / this.images.restart.width;
      const bh = btnW * ratio;
      this.btnLayout.restart = {
        x: btnStartX + btnW + btnGap,
        y: btnAreaTop + (this.bottomH * 0.28 - bh) / 2,
        w: btnW,
        h: bh,
      };
    }
  }

  /* ---------- 通关弹窗布局计算（缓存） ---------- */

  calcSuccessPopupLayout() {
    if (this._successPopupLayout) return this._successPopupLayout;

    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;

    const bgImg = this.successImages.popupBg;
    if (!bgImg) return null;

    // 弹窗背景按原始比例缩小显示
    const bgRatio = bgImg.width / bgImg.height;
    // 弹窗宽度为屏幕宽度的 72%
    const popupW = w * 0.72;
    const popupH = popupW / bgRatio;

    const popupX = (w - popupW) / 2;
    // 居中偏下一点，防止弹窗太靠上
    const popupY = (h - popupH) / 2 + h * 0.02;

    // 按钮布局 — 两个按钮都在弹窗背景卡片内部的下半空白区域
    // 按钮宽度为弹窗宽度的 65%，让按钮更大更易点击
    const btnW = popupW * 0.65;
    const btnGap = popupH * 0.025;

    let nextRect = null;
    let homeRect = null;

    const nextImg = this.successImages.popupNext;
    const homeImg = this.successImages.popupHome;

    if (nextImg) {
      const btnRatio = nextImg.width / nextImg.height;
      const btnH = btnW / btnRatio;
      // 按钮起始于弹窗高度的 63% 处（背景图下半空白区域内）
      nextRect = {
        x: (w - btnW) / 2,
        y: popupY + popupH * 0.66,
        w: btnW,
        h: btnH,
      };
    }

    if (homeImg) {
      const btnRatio = homeImg.width / homeImg.height;
      const btnH = btnW / btnRatio;
      const nextBottom = nextRect ? nextRect.y + nextRect.h : popupY + popupH * 0.58;
      homeRect = {
        x: (w - btnW) / 2,
        y: nextBottom + btnGap,
        w: btnW,
        h: btnH,
      };
    }

    this._successPopupLayout = {
      popupX,
      popupY,
      popupW,
      popupH,
      nextRect,
      homeRect,
    };
    return this._successPopupLayout;
  }

  /* ---------- 事件绑定 ---------- */

  bindEvents() {
    this._touchStart = this.handleTouchStart.bind(this);
    this._touchMove = this.handleTouchMove.bind(this);
    this._touchEnd = this.handleTouchEnd.bind(this);
    this._touchCancel = this.handleTouchCancel.bind(this);
    wx.onTouchStart(this._touchStart);
    wx.onTouchMove(this._touchMove);
    wx.onTouchEnd(this._touchEnd);
    wx.onTouchCancel(this._touchCancel);
  }

  destroy() {
    // 资源若还没加载完事件未绑定，直接传 undefined 会把同类回调"全清掉"，
    // 污染下一场景，因此这里做绑定检查。
    if (this._touchStart) wx.offTouchStart(this._touchStart);
    if (this._touchMove) wx.offTouchMove(this._touchMove);
    if (this._touchEnd) wx.offTouchEnd(this._touchEnd);
    if (this._touchCancel) wx.offTouchCancel(this._touchCancel);
  }

  /**
   * 系统中断（来电/系统弹窗）时的兜底：清掉所有"按下"状态，
   * 防止指头被强制松开后仍残留按下高亮。
   */
  handleTouchCancel() {
    this.pressedBtn = null;
    this.successPressedKey = null;
    this.failPressedKey = null;
    this.portalPromptPressed = false;
    this.selectedBlockId = null;
    this.hasDragged = false;
    this.pendingDir = null;
  }

  /* ---------- 触摸处理 ---------- */

  inRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  pixelToCell(x, y) {
    if (!this.board) return null;
    if (x < this.innerX || x > this.innerX + this.innerW) return null;
    if (y < this.innerY || y > this.innerY + this.innerH) return null;
    const c = Math.floor((x - this.innerX) / this.cellSize);
    const r = Math.floor((y - this.innerY) / this.cellSize);
    if (r < 0 || r >= this.board.rows || c < 0 || c >= this.board.cols) return null;
    return { r, c };
  }

  handleTouchStart(e) {
    if (!this.loaded) return;

    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;

    // loading 期间只接受"返回"按钮，让玩家能随时退出
    if (this.levelLoading || !this.board) {
      if (this.btnLayout && this.btnLayout.return && this.inRect(x, y, this.btnLayout.return)) {
        this.pressedBtn = 'return';
      }
      return;
    }

    // 通关弹窗事件优先处理
    if (this.showSuccessPopup) {
      const layout = this.calcSuccessPopupLayout();
      if (!layout) return;
      if (layout.nextRect && this.inRect(x, y, layout.nextRect)) {
        this.successPressedKey = 'next';
      } else if (layout.homeRect && this.inRect(x, y, layout.homeRect)) {
        this.successPressedKey = 'home';
      }
      return; // 弹窗显示时屏蔽游戏触摸
    }

    // 失败弹窗事件优先处理
    if (this.showFailPopup) {
      const layout = this.calcFailPopupLayout();
      if (!layout) return;
      if (layout.restartRect && this.inRect(x, y, layout.restartRect)) {
        this.failPressedKey = 'restart';
      } else if (layout.homeRect && this.inRect(x, y, layout.homeRect)) {
        this.failPressedKey = 'home';
      }
      return; // 弹窗显示时屏蔽游戏触摸
    }

    // 传送门提示弹窗事件优先处理
    if (this.showPortalPrompt) {
      const layout = this.calcPortalPromptLayout();
      if (layout && layout.seeRect && this.inRect(x, y, layout.seeRect)) {
        this.portalPromptPressed = true;
      }
      return;
    }

    if (this.blockAnim) return;

    for (const [key, rect] of Object.entries(this.btnLayout)) {
      if (this.inRect(x, y, rect)) {
        this.pressedBtn = key;
        return;
      }
    }

    const cell = this.pixelToCell(x, y);
    if (cell) {
      const block = this.board.getBlockAt(cell.r, cell.c);
      if (block) {
        this.selectedBlockId = block.id;
        this.dragStartX = x;
        this.dragStartY = y;
        this.hasDragged = false;
        this.pendingDir = null;
        return;
      }
    }

    this.selectedBlockId = null;
  }

  handleTouchMove(e) {
    if (this.showSuccessPopup || this.showFailPopup || this.showPortalPrompt) return;
    if (this.selectedBlockId === null || this.hasDragged || !this.board || this.blockAnim) return;
    const touch = e.touches[0];
    const dx = touch.clientX - this.dragStartX;
    const dy = touch.clientY - this.dragStartY;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
      this.hasDragged = true;
      this.pendingDir =
        Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? 'right'
            : 'left'
          : dy > 0
            ? 'down'
            : 'up';
    }
  }

  handleTouchEnd(e) {
    if (!this.loaded) return;

    const touch = e.changedTouches[0];
    const x = touch.clientX;
    const y = touch.clientY;

    // loading 期间只接受"返回"按钮
    if (this.levelLoading || !this.board) {
      if (this.pressedBtn === 'return') {
        const rect = this.btnLayout && this.btnLayout.return;
        if (rect && this.inRect(x, y, rect) && this.onHome) {
          this.onHome();
        }
      }
      this.pressedBtn = null;
      return;
    }

    // 通关弹窗按钮处理
    if (this.showSuccessPopup) {
      const key = this.successPressedKey;
      this.successPressedKey = null;
      if (!key) return;
      const layout = this.calcSuccessPopupLayout();
      if (!layout) return;
      const rect = key === 'next' ? layout.nextRect : layout.homeRect;
      if (rect && this.inRect(x, y, rect)) {
        this.onSuccessClick(key);
      }
      return;
    }

    // 失败弹窗按钮处理
    if (this.showFailPopup) {
      const key = this.failPressedKey;
      this.failPressedKey = null;
      if (!key) return;
      const layout = this.calcFailPopupLayout();
      if (!layout) return;
      const rect = key === 'restart' ? layout.restartRect : layout.homeRect;
      if (rect && this.inRect(x, y, rect)) {
        this.onFailClick(key);
      }
      return;
    }

    // 传送门提示弹窗按钮处理
    if (this.showPortalPrompt) {
      if (this.portalPromptPressed) {
        this.portalPromptPressed = false;
        const layout = this.calcPortalPromptLayout();
        if (layout && layout.seeRect && this.inRect(x, y, layout.seeRect)) {
          this.showPortalPrompt = false;
          this.portalPromptAnimating = false;
        }
      }
      return;
    }

    if (this.blockAnim) return;

    if (this.pressedBtn) {
      const rect = this.btnLayout[this.pressedBtn];
      if (rect && this.inRect(x, y, rect)) {
        this.onBtnClick(this.pressedBtn);
      }
      this.pressedBtn = null;
      return;
    }

    if (this.selectedBlockId !== null && this.hasDragged && this.pendingDir) {
      this.triggerMove(this.selectedBlockId, this.pendingDir);
      this.selectedBlockId = null;
      this.hasDragged = false;
      this.pendingDir = null;
      return;
    }

    this.hasDragged = false;
    this.pendingDir = null;
  }

  /* ---------- 通关弹窗按钮处理 ---------- */

  onSuccessClick(key) {
    if (key === 'next' && this.onWin) {
      this.onWin();
    }
    if (key === 'home' && this.onHome) {
      this.onHome();
    }
  }

  /* ---------- 失败弹窗按钮处理 ---------- */

  onFailClick(key) {
    if (key === 'restart') {
      this.showFailPopup = false;
      this.failAnimating = false;
      this.restartLevel();
    }
    if (key === 'home' && this.onHome) {
      this.onHome();
    }
  }

  /* ---------- 显示通关弹窗 ---------- */

  triggerSuccessPopup() {
    this.showSuccessPopup = true;
    this.successAnimating = true;
    this.successAlpha = 0;
    this.successScale = 0.7;
  }

  /* ---------- 显示失败弹窗 ---------- */

  triggerFailPopup() {
    this.showFailPopup = true;
    this.failAnimating = true;
    this.failAlpha = 0;
    this.failScale = 0.7;
  }

  /* ---------- 显示传送门提示弹窗 ---------- */

  triggerPortalPrompt() {
    this.showPortalPrompt = true;
    this.portalPromptAnimating = true;
    this.portalPromptAlpha = 0;
    this.portalPromptScale = 0.7;
  }

  /* ---------- 方块移动动画（含传送门多段效果） ---------- */

  triggerMove(blockId, dir) {
    const result = this.board.computeMove(blockId, dir);
    if (!result.moved) return;

    // 为每段计算合适的 duration（单位：帧）
    const segments = result.segments.map((seg) => {
      if (seg.type === 'portal') {
        return { ...seg, duration: 18 }; // 传送段：约 300ms，慢速展示传送特效
      }
      // 滑行段：每格 3 帧，最少 6 帧 —— 跟手且不至于"嗖"地消失
      const dist = Math.abs(seg.toR - seg.fromR) + Math.abs(seg.toC - seg.fromC);
      return { ...seg, duration: Math.max(6, dist * 3) };
    });

    this.blockAnim = {
      blockId,
      segments,
      currentSeg: 0,
      segProgress: 0,
      enteredHole: result.enteredHole,
    };
  }

  updateBlockAnim() {
    if (!this.blockAnim) return;

    const anim = this.blockAnim;
    const seg = anim.segments[anim.currentSeg];
    anim.segProgress += 1 / seg.duration;

    if (anim.segProgress >= 1) {
      anim.currentSeg++;
      anim.segProgress = 0;

      if (anim.currentSeg >= anim.segments.length) {
        // 全部段完成，应用最终状态
        const lastSeg = anim.segments[anim.segments.length - 1];
        this.board.applyMove(anim.blockId, lastSeg.toR, lastSeg.toC, anim.enteredHole);
        this.blockAnim = null;

        if (this.board.isWin()) {
          // 通关时立即推进进度并预取下一关：保证无论玩家从弹窗点"下一关"还是"返回首页"，
          // databus.currentLevel 都已经指向下一关 —— 用户再从首页点继续游戏就是新关。
          this._commitWin();
          setTimeout(() => {
            this.triggerSuccessPopup();
          }, 150);
        } else if (this.board.isFail()) {
          setTimeout(() => {
            this.triggerFailPopup();
          }, 150);
        }
      }
    }
  }

  onBtnClick(key) {
    switch (key) {
      case 'return':
        if (this.onHome) this.onHome();
        break;
      case 'withdraw':
        if (this.board) this.board.undo();
        break;
      case 'restart':
        this.restartLevel();
        break;
    }
  }

  /* ---------- 渲染 ---------- */

  update() {
    if (this.board) this.board.updateShake();
    this.updateBlockAnim();

    // 传送门帧动画计数器
    this.portalAnimFrame++;

    if (this.levelLoading) {
      this.loadingAnimT += 1;
    }

    // 通关弹窗入场动画
    if (this.successAnimating) {
      this.successAlpha = Math.min(1, this.successAlpha + 0.06);
      this.successScale = Math.min(1, this.successScale + 0.04);
      if (this.successAlpha >= 1 && this.successScale >= 1) {
        this.successAnimating = false;
      }
    }

    // 失败弹窗入场动画
    if (this.failAnimating) {
      this.failAlpha = Math.min(1, this.failAlpha + 0.06);
      this.failScale = Math.min(1, this.failScale + 0.04);
      if (this.failAlpha >= 1 && this.failScale >= 1) {
        this.failAnimating = false;
      }
    }

    // 传送门提示弹窗入场动画
    if (this.portalPromptAnimating) {
      this.portalPromptAlpha = Math.min(1, this.portalPromptAlpha + 0.06);
      this.portalPromptScale = Math.min(1, this.portalPromptScale + 0.04);
      if (this.portalPromptAlpha >= 1 && this.portalPromptScale >= 1) {
        this.portalPromptAnimating = false;
      }
    }
  }

  render() {
    if (!this.loaded) return;
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.drawBackground();

    if (this.levelLoading || !this.board) {
      this.drawLoading();
      return;
    }

    this.drawTopInfo();
    this.drawPrompt();
    this.drawBoard();
    this.drawButtons();

    // 通关弹窗覆盖在游戏画面之上
    if (this.showSuccessPopup) {
      this.drawSuccessPopup();
    }

    // 失败弹窗覆盖在游戏画面之上
    if (this.showFailPopup) {
      this.drawFailPopup();
    }

    // 传送门提示弹窗覆盖在游戏画面之上
    if (this.showPortalPrompt) {
      this.drawPortalPrompt();
    }
  }

  /**
   * 关卡尚未生成完毕时的占位画面：顶栏 + 返回按钮 + 居中"生成中"提示。
   */
  drawLoading() {
    // 顶栏背景与关卡号
    if (this.levelRect && this.images.levelBg) {
      ctx.drawImage(
        this.images.levelBg,
        this.levelRect.x,
        this.levelRect.y,
        this.levelRect.w,
        this.levelRect.h
      );
      ctx.fillStyle = '#7A3B12';
      ctx.font = `bold ${Math.floor(this.levelRect.h * 0.42)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `第 ${this.level} 关`,
        this.levelRect.x + this.levelRect.w / 2,
        this.levelRect.y + this.levelRect.h * 0.56
      );
    }

    // 返回按钮
    if (this.btnLayout && this.btnLayout.return && this.images.returnBtn) {
      const rect = this.btnLayout.return;
      ctx.save();
      if (this.pressedBtn === 'return') {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        ctx.translate(cx, cy);
        ctx.scale(0.9, 0.9);
        ctx.translate(-cx, -cy);
      }
      ctx.drawImage(this.images.returnBtn, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }

    // 居中文字 + 简易圆点动画
    const cx = SCREEN_WIDTH / 2;
    const cy = SCREEN_HEIGHT / 2;
    const fs = Math.floor(SCREEN_WIDTH * 0.055);

    ctx.save();
    ctx.fillStyle = '#7A3B12';
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const dots = '.'.repeat(1 + Math.floor(this.loadingAnimT / 18) % 3);
    ctx.fillText(`关卡生成中${dots}`, cx, cy);

    ctx.fillStyle = 'rgba(122, 59, 18, 0.6)';
    ctx.font = `${Math.floor(fs * 0.65)}px sans-serif`;
    ctx.fillText('（首次进入需稍等几秒）', cx, cy + fs * 1.2);
    ctx.restore();
  }

  drawBackground() {
    const img = this.images.bg;
    if (!img) return;
    const ratio = img.width / img.height;
    const sr = SCREEN_WIDTH / SCREEN_HEIGHT;
    let dw, dh, dx, dy;
    if (ratio > sr) {
      dh = SCREEN_HEIGHT;
      dw = dh * ratio;
      dx = (SCREEN_WIDTH - dw) / 2;
      dy = 0;
    } else {
      dw = SCREEN_WIDTH;
      dh = dw / ratio;
      dx = 0;
      dy = (SCREEN_HEIGHT - dh) / 2;
    }
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  drawTopInfo() {
    if (this.levelRect && this.images.levelBg) {
      ctx.drawImage(
        this.images.levelBg,
        this.levelRect.x,
        this.levelRect.y,
        this.levelRect.w,
        this.levelRect.h
      );
      ctx.fillStyle = '#7A3B12';
      ctx.font = `bold ${Math.floor(this.levelRect.h * 0.42)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `第 ${this.level} 关`,
        this.levelRect.x + this.levelRect.w / 2,
        this.levelRect.y + this.levelRect.h * 0.56
      );
    }

    if (this.stepRect && this.images.stepBg && this.board) {
      ctx.drawImage(
        this.images.stepBg,
        this.stepRect.x,
        this.stepRect.y,
        this.stepRect.w,
        this.stepRect.h
      );
      ctx.fillStyle = '#E04A22';
      ctx.font = `bold ${Math.floor(this.stepRect.h * 0.45)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `步数 ${this.board.stepsLeft}`,
        this.stepRect.x + this.stepRect.w / 2,
        this.stepRect.y + this.stepRect.h / 2 + 1
      );
    }
  }

  drawPrompt() {
    if (this.promptRect && this.images.prompt) {
      ctx.drawImage(
        this.images.prompt,
        this.promptRect.x,
        this.promptRect.y,
        this.promptRect.w,
        this.promptRect.h
      );
    }
  }

  drawBoard() {
    // 1. 棋盘底板
    if (this.images.gridBg) {
      ctx.drawImage(
        this.images.gridBg,
        this.boardX,
        this.boardY,
        this.boardW,
        this.boardH
      );
    }

    // 2. 小方格背景
    if (this.images.smallSquare) {
      for (let r = 0; r < this.board.rows; r++) {
        for (let c = 0; c < this.board.cols; c++) {
          const x = this.innerX + c * this.cellSize;
          const y = this.innerY + r * this.cellSize;
          ctx.drawImage(this.images.smallSquare, x, y, this.cellSize, this.cellSize);
        }
      }
    }

    // 3. 洞与传送门
    for (let r = 0; r < this.board.rows; r++) {
      for (let c = 0; c < this.board.cols; c++) {
        const cell = this.board.grid[r][c];
        if (!cell) continue;
        const x = this.innerX + c * this.cellSize;
        const y = this.innerY + r * this.cellSize;
        if (cell.type === 'hole') {
          const img = this.images[`hole_${cell.color}`];
          if (img) ctx.drawImage(img, x, y, this.cellSize, this.cellSize);
        } else if (cell.type === 'portal') {
          // 传送门动态帧：每 14 帧切换一张，循环 1~6
          const frameIndex = (Math.floor(this.portalAnimFrame / 14) % 6) + 1;
          const animImg = this.images[`portal_${cell.color}_${frameIndex}`];
          const img = animImg || this.images[`portal_${cell.color}`];
          if (img) ctx.drawImage(img, x, y, this.cellSize, this.cellSize);
        }
      }
    }

    // 4. 石块
    for (let r = 0; r < this.board.rows; r++) {
      for (let c = 0; c < this.board.cols; c++) {
        const cell = this.board.grid[r][c];
        if (cell && cell.type === 'stone') {
          const x = this.innerX + c * this.cellSize;
          const y = this.innerY + r * this.cellSize;
          const img = this.images.stone;
          if (img) ctx.drawImage(img, x, y, this.cellSize, this.cellSize);
        }
      }
    }

    // 5. 入洞方块
    for (const block of this.board.blocks) {
      if (block.inHole) {
        const x = this.innerX + block.col * this.cellSize;
        const y = this.innerY + block.row * this.cellSize;
        const img = this.images[`success_${block.color}`];
        if (img) ctx.drawImage(img, x, y, this.cellSize, this.cellSize);
      }
    }

    // 6. 普通方块（含动画）
    for (const block of this.board.blocks) {
      if (!block.inHole) {
        this.drawBlock(block);
      }
    }
  }

  drawBlock(block) {
    const img = this.images[`block_${block.color}`];
    if (!img) return;

    let drawR = block.row;
    let drawC = block.col;
    let scale = 1;
    let alpha = 1;

    if (this.blockAnim && this.blockAnim.blockId === block.id) {
      const anim = this.blockAnim;
      const seg = anim.segments[anim.currentSeg];
      const p = anim.segProgress;

      if (seg.type === 'slide') {
        const eased = easeOutCubic(p);
        drawR = seg.fromR + (seg.toR - seg.fromR) * eased;
        drawC = seg.fromC + (seg.toC - seg.fromC) * eased;
      } else if (seg.type === 'portal') {
        // 传送效果：入口缩小消失 → 出口放大出现
        if (p < 0.45) {
          drawR = seg.fromR;
          drawC = seg.fromC;
          const t = p / 0.45;
          scale = 1 - t * 0.88; // 1.0 -> 0.12
          alpha = 1 - t * 0.95; // 1.0 -> 0.05
        } else if (p < 0.55) {
          // 中间短暂完全消失
          scale = 0;
          alpha = 0;
        } else {
          drawR = seg.toR;
          drawC = seg.toC;
          const t = (p - 0.55) / 0.45;
          scale = 0.12 + t * 0.88; // 0.12 -> 1.0
          alpha = 0.05 + t * 0.95; // 0.05 -> 1.0
        }
      }
    }

    let offX = 0;
    let offY = 0;
    if (this.board.shakingBlockId === block.id && !this.blockAnim) {
      offX = this.board.shakeOffset.x;
      offY = this.board.shakeOffset.y;
    }

    const baseX = this.innerX + drawC * this.cellSize + offX;
    const baseY = this.innerY + drawR * this.cellSize + offY;
    const size = this.cellSize * scale;
    const x = baseX + (this.cellSize - size) / 2;
    const y = baseY + (this.cellSize - size) / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, x, y, size, size);
    ctx.restore();

    // 选中高亮（动画中不显示）
    if (this.selectedBlockId === block.id && !this.blockAnim) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.95)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = Date.now() / 20 % 10;
      const pad = 2;
      ctx.strokeRect(baseX - pad, baseY - pad, this.cellSize + pad * 2, this.cellSize + pad * 2);
      ctx.restore();
    }
  }

  drawButtons() {
    const imgMap = {
      return: 'returnBtn',
      withdraw: 'withdraw',
      restart: 'restart',
    };
    for (const [key, rect] of Object.entries(this.btnLayout)) {
      const img = this.images[imgMap[key]];
      if (!img || !rect) continue;
      ctx.save();
      if (this.pressedBtn === key) {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        ctx.translate(cx, cy);
        ctx.scale(0.9, 0.9);
        ctx.translate(-cx, -cy);
      }
      ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }

    // 撤回按钮上方数字徽标
    this.drawWithdrawBadge();
  }

  drawWithdrawBadge() {
    const rect = this.btnLayout.withdraw;
    if (!rect || !this.board) return;

    const count = this.board.undoLeft;

    const radius = Math.max(10, Math.min(Math.min(rect.w, rect.h) * 0.16, rect.h * 0.22));
    const bx = rect.x + rect.w - radius * 0.55;
    const by = rect.y + radius * 0.55;

    ctx.save();

    ctx.beginPath();
    ctx.arc(bx, by, radius, 0, Math.PI * 2);
    // 有剩余次数时红色，用完后灰色
    ctx.fillStyle = count > 0 ? '#E74C3C' : '#999';
    ctx.fill();

    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = Math.max(2, radius * 0.16);
    ctx.stroke();

    const fontSize = Math.floor(radius * 1.15);
    ctx.fillStyle = '#FFF';
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(count), bx, by + 1);

    ctx.restore();
  }

  /* ---------- 通关弹窗渲染 ---------- */

  drawSuccessPopup() {
    const layout = this.calcSuccessPopupLayout();
    if (!layout) return;

    ctx.save();
    ctx.globalAlpha = this.successAlpha;

    // 半透明灰色遮罩（不是全黑）
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 弹窗整体缩放动画
    const cx = layout.popupX + layout.popupW / 2;
    // 以弹窗+按钮整体中心为缩放原点
    const totalBottom = layout.homeRect
      ? layout.homeRect.y + layout.homeRect.h
      : layout.nextRect
        ? layout.nextRect.y + layout.nextRect.h
        : layout.popupY + layout.popupH;
    const cy = (layout.popupY + totalBottom) / 2;
    ctx.translate(cx, cy);
    ctx.scale(this.successScale, this.successScale);
    ctx.translate(-cx, -cy);

    // 弹窗背景图（直接按比例绘制，包含标题、方块插图、鼓励文字）
    const bgImg = this.successImages.popupBg;
    if (bgImg) {
      ctx.drawImage(
        bgImg,
        layout.popupX,
        layout.popupY,
        layout.popupW,
        layout.popupH
      );
    }

    // "下一关"按钮
    this.drawSuccessBtn('next', layout.nextRect, this.successImages.popupNext);

    // "返回首页"按钮
    this.drawSuccessBtn('home', layout.homeRect, this.successImages.popupHome);

    ctx.restore();
  }

  drawSuccessBtn(key, rect, img) {
    if (!rect || !img) return;

    ctx.save();
    if (this.successPressedKey === key) {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(0.92, 0.92);
      ctx.translate(-cx, -cy);
    }
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }

  /* ---------- 失败弹窗布局计算（缓存） ---------- */

  calcFailPopupLayout() {
    if (this._failPopupLayout) return this._failPopupLayout;

    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;

    const bgImg = this.failImages.failBg;
    if (!bgImg) return null;

    // 弹窗背景按原始比例缩小显示（与通关弹窗一致的宽度）
    const bgRatio = bgImg.width / bgImg.height;
    const popupW = w * 0.78;
    const popupH = popupW / bgRatio;

    const popupX = (w - popupW) / 2;
    const popupY = (h - popupH) / 2 + h * 0.02;

    // 按钮布局 — 上下两排，每排两个按钮
    // 第一排：重新开始 / 返回首页
    // 第二排：看广告复活(灰) / 分享复活(灰)
    const btnW = popupW * 0.43;
    const btnGap = popupW * 0.03;
    const rowGap = popupH * 0.04;

    let restartRect = null;
    let homeRect = null;
    let adGrayRect = null;
    let shareGrayRect = null;

    const restartImg = this.failImages.failRestart;
    const homeImg = this.failImages.failHome;
    const adGrayImg = this.failImages.failAdGray;
    const shareGrayImg = this.failImages.failShareGray;

    // 第一排按钮起始于弹窗高度的 72% 处
    const row1Y = popupY + popupH * 0.72;
    const totalRowW = btnW * 2 + btnGap;
    const rowStartX = (w - totalRowW) / 2;

    // 统一按钮高度：以重新开始按钮的比例为基准，四个按钮大小一致
    const refImg = restartImg || homeImg || adGrayImg || shareGrayImg;
    const btnH = refImg ? btnW / (refImg.width / refImg.height) : popupH * 0.08;

    if (restartImg) {
      restartRect = {
        x: rowStartX,
        y: row1Y,
        w: btnW,
        h: btnH,
      };
    }

    if (homeImg) {
      homeRect = {
        x: rowStartX + btnW + btnGap,
        y: row1Y,
        w: btnW,
        h: btnH,
      };
    }

    // 第二排：灰色按钮
    const row2Y = row1Y + btnH + rowGap;

    if (adGrayImg) {
      adGrayRect = {
        x: rowStartX,
        y: row2Y,
        w: btnW,
        h: btnH,
      };
    }

    if (shareGrayImg) {
      shareGrayRect = {
        x: rowStartX + btnW + btnGap,
        y: row2Y,
        w: btnW,
        h: btnH,
      };
    }

    this._failPopupLayout = {
      popupX,
      popupY,
      popupW,
      popupH,
      restartRect,
      homeRect,
      adGrayRect,
      shareGrayRect,
    };
    return this._failPopupLayout;
  }

  /* ---------- 失败弹窗渲染 ---------- */

  drawFailPopup() {
    const layout = this.calcFailPopupLayout();
    if (!layout) return;

    ctx.save();
    ctx.globalAlpha = this.failAlpha;

    // 半透明灰色遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 弹窗整体缩放动画
    const cx = layout.popupX + layout.popupW / 2;
    // 以弹窗+按钮整体中心为缩放原点
    const bottomRow = layout.shareGrayRect || layout.adGrayRect || layout.homeRect;
    const totalBottom = bottomRow
      ? bottomRow.y + bottomRow.h
      : layout.popupY + layout.popupH;
    const cy = (layout.popupY + totalBottom) / 2;
    ctx.translate(cx, cy);
    ctx.scale(this.failScale, this.failScale);
    ctx.translate(-cx, -cy);

    // 弹窗背景图
    const bgImg = this.failImages.failBg;
    if (bgImg) {
      ctx.drawImage(
        bgImg,
        layout.popupX,
        layout.popupY,
        layout.popupW,
        layout.popupH
      );
    }

    // 第一排按钮：重新开始 / 返回首页
    this.drawFailBtn('restart', layout.restartRect, this.failImages.failRestart);
    this.drawFailBtn('home', layout.homeRect, this.failImages.failHome);

    // 第二排按钮：灰色（暂不可用）
    this.drawFailBtn(null, layout.adGrayRect, this.failImages.failAdGray, true);
    this.drawFailBtn(null, layout.shareGrayRect, this.failImages.failShareGray, true);

    ctx.restore();
  }

  drawFailBtn(key, rect, img, disabled) {
    if (!rect || !img) return;

    ctx.save();
    if (!disabled && this.failPressedKey === key) {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(0.92, 0.92);
      ctx.translate(-cx, -cy);
    }
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }

  /* ---------- 传送门提示弹窗布局计算（缓存） ---------- */

  calcPortalPromptLayout() {
    if (this._portalPromptLayout) return this._portalPromptLayout;

    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;

    const bgImg = this.portalPromptImages.portalPromptBg;
    if (!bgImg) return null;

    // 弹窗背景按原始比例显示
    const bgRatio = bgImg.width / bgImg.height;
    const popupW = w * 0.78;
    const popupH = popupW / bgRatio;

    const popupX = (w - popupW) / 2;
    const popupY = (h - popupH) / 2;

    // "知道了"按钮布局 — 在弹窗下方居中
    let seeRect = null;
    const seeImg = this.portalPromptImages.portalPromptSee;
    if (seeImg) {
      const btnW = popupW * 0.55;
      const btnRatio = seeImg.width / seeImg.height;
      const btnH = btnW / btnRatio;
      seeRect = {
        x: (w - btnW) / 2,
        y: popupY + popupH + popupH * 0.03,
        w: btnW,
        h: btnH,
      };
    }

    this._portalPromptLayout = {
      popupX,
      popupY,
      popupW,
      popupH,
      seeRect,
    };
    return this._portalPromptLayout;
  }

  /* ---------- 传送门提示弹窗渲染 ---------- */

  drawPortalPrompt() {
    const layout = this.calcPortalPromptLayout();
    if (!layout) return;

    ctx.save();
    ctx.globalAlpha = this.portalPromptAlpha;

    // 半透明灰色遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 弹窗整体缩放动画
    const cx = layout.popupX + layout.popupW / 2;
    const totalBottom = layout.seeRect
      ? layout.seeRect.y + layout.seeRect.h
      : layout.popupY + layout.popupH;
    const cy = (layout.popupY + totalBottom) / 2;
    ctx.translate(cx, cy);
    ctx.scale(this.portalPromptScale, this.portalPromptScale);
    ctx.translate(-cx, -cy);

    // 弹窗背景图
    const bgImg = this.portalPromptImages.portalPromptBg;
    if (bgImg) {
      ctx.drawImage(
        bgImg,
        layout.popupX,
        layout.popupY,
        layout.popupW,
        layout.popupH
      );
    }

    // "知道了"按钮
    if (layout.seeRect) {
      const seeImg = this.portalPromptImages.portalPromptSee;
      if (seeImg) {
        ctx.save();
        if (this.portalPromptPressed) {
          const bx = layout.seeRect.x + layout.seeRect.w / 2;
          const by = layout.seeRect.y + layout.seeRect.h / 2;
          ctx.translate(bx, by);
          ctx.scale(0.92, 0.92);
          ctx.translate(-bx, -by);
        }
        ctx.drawImage(
          seeImg,
          layout.seeRect.x,
          layout.seeRect.y,
          layout.seeRect.w,
          layout.seeRect.h
        );
        ctx.restore();
      }
    }

    ctx.restore();
  }
}
