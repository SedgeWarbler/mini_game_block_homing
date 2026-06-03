import { SCREEN_WIDTH, SCREEN_HEIGHT, DPR, img, loadImg, easeOutCubic, inRect, drawCoverImage, LAYOUT_WIDTH, LAYOUT_OFFSET_X } from '../render';
import preloader from '../game/levelPreloader';
import Board from '../game/board';

const ctx = canvas.getContext('2d');


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
export function buildGameSceneCorePaths() {
  const db = GameGlobal.databus;
  const selectedBlock = db ? db.getSelectedSkins('block') : ['black', 'blue', 'green', 'pink', 'purple', 'red', 'yellow'];
  const selectedStone = db ? db.getSelectedSkins('stone') : ['default'];
  const selectedPortal = db ? db.getSelectedSkins('portal') : ['blue_portal', 'purple_portal'];
  const selectedGrid = db ? db.getSelectedSkins('grid') : ['default'];

  const paths = {
    bg: img('images/game/background.png'),
    returnBtn: img('images/game/return.png'),
    levelBg: img('images/game/level.png'),
    stepBg: img('images/game/step.png'),
    prompt: img('images/game/prompt.png'),
    gridBg: img(`images/game/grid/${selectedGrid[0]}.png`),
    smallSquare: img(`images/game/square/${selectedGrid[0]}.png`),
    stone: img(`images/game/stone/${selectedStone[0]}.png`),
    // 撤回 & 重置按钮复用推箱子素材
    withdrawBtn: img('images/push_box/withdraw.png'),
    resetBtn: img('images/push_box/reset.png'),
  };
  // 按选中的皮肤加载方块三态图（block / hole / success）
  selectedBlock.forEach((skinId) => {
    paths[`skinBlock_${skinId}`] = img(`images/game/block/${skinId}/${skinId}.png`);
    paths[`skinHole_${skinId}`] = img(`images/game/block/${skinId}/${skinId}_hole.png`);
    paths[`skinSuccess_${skinId}`] = img(`images/game/block/${skinId}/${skinId}_success.png`);
  });
  // 按选中的皮肤加载传送门
  selectedPortal.forEach((skinId) => {
    paths[`skinPortal_${skinId}`] = img(`images/game/portal/${skinId}.png`);
  });
  return paths;
}

/**
 * 可延迟加载的图片路径 — 传送门帧动画、通关/失败/传送门提示/玩法提示弹窗素材。
 * 这些图片不影响游戏主棋盘渲染，在需要时由 loadImg 缓存命中或即时下载。
 * LoadingScene 会在后台火并遗忘地发起下载，但不阻塞进度条。
 */
export function buildGameSceneDeferredPaths() {
  const paths = {};
  paths.popupBg = img('images/success/background.png');
  paths.popupNext = img('images/success/next_level.png');
  paths.popupHome = img('images/success/back_home.png');
  paths.failBg = img('images/fail/background.png');
  paths.failRestart = img('images/fail/restart.png');
  paths.failHome = img('images/fail/back_home.png');
  paths.failAdGray = img('images/fail/ad_resurrection_gray_out.png');
  paths.failShareGray = img('images/fail/share_resurrection_gray_out.png');
  paths.failAd = img('images/fail/ad_resurrection.png');
  paths.failShare = img('images/fail/share_resurrection.png');
  paths.portalPromptBg = img('images/game/portal/portal_prompt.png');
  paths.portalPromptSee = img('images/game/portal/see.png');
  // 玩法提示弹窗素材
  paths.gameplayBg = img('images/game/gameplay/background.png');
  paths.gameplaySkip = img('images/game/gameplay/skip.png');
  paths.gameplayNext = img('images/game/gameplay/next_page.png');
  paths.gameplayPrev = img('images/game/gameplay/previous_page.png');
  paths.gameplayDotOn = img('images/game/gameplay/selected_round.png');
  paths.gameplayDotOff = img('images/game/gameplay/not_selected_round.png');
  for (let i = 1; i <= 3; i++) {
    paths[`gameplayPrompt_${i}`] = img(`images/game/gameplay/prompt_${i}.png`);
  }
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

  // 撤回 & 重置
  undoRemaining = 1;       // 每关 1 次免费撤回
  pressedAction = null;    // 'undo' | 'reset'
  undoBtnRect = null;
  resetBtnRect = null;

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

  // 玩法提示弹窗状态
  showGameplayPrompt = false;
  gameplayPromptAlpha = 0;
  gameplayPromptScale = 0.7;
  gameplayPromptAnimating = false;
  gameplayPromptPage = 0;           // 当前页 0-based
  gameplayPromptTotal = 3;          // 总页数
  gameplayPromptPressedBtn = null;  // 'prev' | 'next' | 'skip'
  gameplayPromptImages = {};

  // 弹窗布局只依赖屏幕尺寸 + 图片比例，整个场景生命周期内不变 —— 计算一次后缓存。
  _successPopupLayout = null;
  _failPopupLayout = null;
  _portalPromptLayout = null;
  _gameplayPromptLayout = null;

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
    const corePaths = buildGameSceneCorePaths();
    const deferredPaths = buildGameSceneDeferredPaths();
    const allPaths = { ...corePaths, ...deferredPaths };
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
          } else if (key.startsWith('gameplay')) {
            this.gameplayPromptImages[key] = image;
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
    // 每关重置广告复活机会 & 失败弹窗布局缓存
    const db = GameGlobal.databus;
    if (db) db.adResurrectionUsedThisLevel = false;
    this._failPopupLayout = null;
    this.initialData = null;
    // 重置撤回次数
    this.undoRemaining = 1;

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
    this._buildColorSkinMap();
    this.calcLayout();

    // 首次进入第一关时弹出玩法提示
    const db = GameGlobal.databus;
    if (db && !db.gameplayPromptShown && this.level === 1) {
      this.triggerGameplayPrompt();
      db.gameplayPromptShown = true;
    }

    // 首次遇到传送门时弹出提示
    if (db && !db.portalPromptShown && this.board.portals && this.board.portals.length > 0) {
      this.triggerPortalPrompt();
      db.portalPromptShown = true;
    }
  }

  /**
   * 构建游戏颜色 → 皮肤 ID 映射
   *
   * 自定义皮肤优先分配给当前关卡实际使用的颜色，
   * 保证玩家解锁的皮肤在游戏中一定能看到。
   */
  _buildColorSkinMap() {
    const db = GameGlobal.databus;
    const GAME_COLORS = ['black', 'blue', 'green', 'pink', 'purple', 'red', 'yellow'];
    const selected = db ? db.getSelectedSkins('block') : GAME_COLORS;
    const DEFAULTS = new Set(GAME_COLORS);

    // 分离自定义皮肤和默认皮肤
    const customSkins = selected.filter((s) => !DEFAULTS.has(s));
    const defaultSkins = selected.filter((s) => DEFAULTS.has(s));
    // 打乱默认皮肤顺序增加随机性
    for (let i = defaultSkins.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [defaultSkins[i], defaultSkins[j]] = [defaultSkins[j], defaultSkins[i]];
    }
    // 自定义皮肤排在前面，优先分配给关卡实际使用的颜色
    const skinPool = [...customSkins, ...defaultSkins];

    // 关卡实际使用的颜色排在前面
    const usedColorSet = this.board
      ? new Set(this.board.blocks.map((b) => b.color))
      : new Set();
    const usedColors = [...usedColorSet];
    const unusedColors = GAME_COLORS.filter((c) => !usedColorSet.has(c));
    const orderedColors = [...usedColors, ...unusedColors];

    this.colorSkinMap = {};
    orderedColors.forEach((color, i) => {
      this.colorSkinMap[color] = skinPool[i] || color;
    });

    // 传送门皮肤映射
    const selectedPortal = db ? db.getSelectedSkins('portal') : ['blue_portal', 'purple_portal'];
    this.portalSkinMap = {
      blue: selectedPortal[0] || 'blue_portal',
      purple: selectedPortal[1] || 'purple_portal',
    };
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
    this._failPopupLayout = null;
    // 重开关卡时重置广告复活机会
    const db = GameGlobal.databus;
    if (db) db.adResurrectionUsedThisLevel = false;
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
    const lw = LAYOUT_WIDTH;
    const ox = LAYOUT_OFFSET_X;
    this.topH = h * 0.085;
    this.promptH = h * 0.045;
    this.bottomH = h * 0.11;

    const topIconH = this.topH * 0.58;
    const iconCenterY = this.topH * 0.78;
    const sideMargin = lw * 0.04;

    this.btnLayout = this.btnLayout || {};

    if (this.images.returnBtn) {
      const bw = topIconH * (this.images.returnBtn.width / this.images.returnBtn.height);
      this.btnLayout.return = {
        x: ox + sideMargin,
        y: iconCenterY - topIconH / 2,
        w: bw,
        h: topIconH,
      };
    }

    if (this.images.levelBg) {
      const levelW = topIconH * (this.images.levelBg.width / this.images.levelBg.height);
      this.levelRect = {
        x: ox + (lw - levelW) / 2,
        y: iconCenterY - topIconH / 2,
        w: levelW,
        h: topIconH,
      };
    }
  }

  calcLayout() {
    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    const lw = LAYOUT_WIDTH;
    const ox = LAYOUT_OFFSET_X;

    this.topH = h * 0.085;
    this.promptH = h * 0.045;
    this.bottomH = h * 0.11;

    // 撤回/重置按钮高度 + 上下间距，在提示栏和棋盘之间预留空间
    const actionBtnH = this.topH * 0.58;
    const actionBarH = actionBtnH + h * 0.02; // 按钮高度 + 上下间距

    const availH = h - this.topH - this.promptH - actionBarH - this.bottomH;
    const maxW = lw * 0.92;
    const maxH = availH * 0.96;

    // 根据行列计算单元格大小
    // 注意：boardPadding = cellSize * 0.38（每侧），所以总 boardW = cellSize * (cols + 0.76)
    // cellByW 必须把 padding 计入，否则 boardW 会溢出 maxW
    const cellByW = Math.floor(maxW / (this.board.cols + 0.76));
    const cellByH = Math.floor(maxH / this.board.rows);
    this.cellSize = Math.min(cellByW, cellByH);

    // 网格实际尺寸
    this.innerW = this.cellSize * this.board.cols;
    this.innerH = this.cellSize * this.board.rows;

    // 底板含边距（模拟木质边框）
    this.boardPadding = this.cellSize * 0.38;
    this.boardW = this.innerW + this.boardPadding * 2;
    this.boardH = this.innerH + this.boardPadding * 2;

    // 棋盘起始 Y：提示栏 + 操作按钮栏之后的可用区域居中
    const boardAreaTop = this.topH + this.promptH + actionBarH;
    this.boardX = (w - this.boardW) / 2;
    this.boardY = boardAreaTop + (availH - this.boardH) / 2;
    this.innerX = this.boardX + this.boardPadding;
    this.innerY = this.boardY + this.boardPadding;

    this.btnLayout = {};

    /* ---- 顶部信息栏：返回(左) | 关卡(中) | 步数(右) ---- */

    const topIconH = this.topH * 0.58;
    const iconCenterY = this.topH * 0.78;
    const sideMargin = lw * 0.04;

    // 返回按钮（左，与其他素材统一高度）
    if (this.images.returnBtn) {
      const bw = topIconH * (this.images.returnBtn.width / this.images.returnBtn.height);
      this.btnLayout.return = {
        x: ox + sideMargin,
        y: iconCenterY - topIconH / 2,
        w: bw,
        h: topIconH,
      };
    }

    // 关卡标题背景（居中，与步数等高保持平行）
    if (this.images.levelBg) {
      const levelW = topIconH * (this.images.levelBg.width / this.images.levelBg.height);
      this.levelRect = {
        x: ox + (lw - levelW) / 2,
        y: iconCenterY - topIconH / 2,
        w: levelW,
        h: topIconH,
      };
    }

    // 步数背景（右）
    if (this.images.stepBg) {
      const sw = topIconH * (this.images.stepBg.width / this.images.stepBg.height);
      this.stepRect = {
        x: ox + lw - sideMargin - sw,
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

    /* ---- 底部操作栏：撤回 + 重置 ---- */
    this._calcActionBtns();
  }

  /**
   * 计算撤回 & 重置按钮布局（放在提示栏和棋盘之间的预留区域居中）
   */
  _calcActionBtns() {
    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    const btnH = this.topH * 0.58;
    const gap = LAYOUT_WIDTH * 0.08;

    // 提示栏底部位置
    const promptBottom = this.topH + this.promptH;
    // 按钮区域居中于提示栏底部与棋盘顶部之间
    const actionCenterY = (promptBottom + this.boardY) / 2;

    const withdrawImg = this.images.withdrawBtn;
    const resetImg = this.images.resetBtn;
    const wW = withdrawImg ? btnH * (withdrawImg.width / withdrawImg.height) : btnH * 1.8;
    const rW = resetImg ? btnH * (resetImg.width / resetImg.height) : btnH * 1.8;
    const totalW = wW + gap + rW;
    let startX = (w - totalW) / 2;

    this.undoBtnRect = { x: startX, y: actionCenterY - btnH / 2, w: wW, h: btnH };
    startX += wW + gap;
    this.resetBtnRect = { x: startX, y: actionCenterY - btnH / 2, w: rW, h: btnH };
  }

  /* ---------- 通关弹窗布局计算（缓存） ---------- */

  calcSuccessPopupLayout() {
    if (this._successPopupLayout) return this._successPopupLayout;

    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    const lw = LAYOUT_WIDTH;

    const bgImg = this.successImages.popupBg;
    if (!bgImg) return null;

    // 弹窗背景按原始比例缩小显示
    const bgRatio = bgImg.width / bgImg.height;
    // 弹窗宽度为布局宽度的 72%
    const popupW = lw * 0.72;
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
    this.pressedAction = null;
    this.successPressedKey = null;
    this.failPressedKey = null;
    this.portalPromptPressed = false;
    this.gameplayPromptPressedBtn = null;
    this.selectedBlockId = null;
    this.hasDragged = false;
    this.pendingDir = null;
  }

  /* ---------- 触摸处理 ---------- */


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
      if (this.btnLayout && this.btnLayout.return && inRect(x, y, this.btnLayout.return)) {
        this.pressedBtn = 'return';
      }
      return;
    }

    // 通关弹窗事件优先处理
    if (this.showSuccessPopup) {
      const layout = this.calcSuccessPopupLayout();
      if (!layout) return;
      if (layout.nextRect && inRect(x, y, layout.nextRect)) {
        this.successPressedKey = 'next';
      } else if (layout.homeRect && inRect(x, y, layout.homeRect)) {
        this.successPressedKey = 'home';
      }
      return; // 弹窗显示时屏蔽游戏触摸
    }

    // 失败弹窗事件优先处理
    if (this.showFailPopup) {
      const layout = this.calcFailPopupLayout();
      if (!layout) return;
      if (layout.restartRect && inRect(x, y, layout.restartRect)) {
        this.failPressedKey = 'restart';
      } else if (layout.homeRect && inRect(x, y, layout.homeRect)) {
        this.failPressedKey = 'home';
      } else if (layout.adRect && inRect(x, y, layout.adRect) && layout.adEnabled) {
        this.failPressedKey = 'ad';
      } else if (layout.shareRect && inRect(x, y, layout.shareRect) && layout.shareEnabled) {
        this.failPressedKey = 'share';
      }
      return; // 弹窗显示时屏蔽游戏触摸
    }

    // 玩法提示弹窗事件优先处理
    if (this.showGameplayPrompt) {
      const layout = this.calcGameplayPromptLayout();
      if (!layout) return;
      if (layout.skipRect && inRect(x, y, layout.skipRect)) {
        this.gameplayPromptPressedBtn = 'skip';
      } else if (layout.prevRect && inRect(x, y, layout.prevRect)) {
        this.gameplayPromptPressedBtn = 'prev';
      } else if (layout.nextRect && inRect(x, y, layout.nextRect)) {
        this.gameplayPromptPressedBtn = 'next';
      }
      return;
    }

    // 传送门提示弹窗事件优先处理
    if (this.showPortalPrompt) {
      const layout = this.calcPortalPromptLayout();
      if (layout && layout.seeRect && inRect(x, y, layout.seeRect)) {
        this.portalPromptPressed = true;
      }
      return;
    }

    if (this.blockAnim) return;

    for (const [key, rect] of Object.entries(this.btnLayout)) {
      if (inRect(x, y, rect)) {
        this.pressedBtn = key;
        return;
      }
    }

    // 撤回 & 重置按钮
    if (this.undoBtnRect && inRect(x, y, this.undoBtnRect)) {
      this.pressedAction = 'undo';
      return;
    }
    if (this.resetBtnRect && inRect(x, y, this.resetBtnRect)) {
      this.pressedAction = 'reset';
      return;
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
    if (this.showSuccessPopup || this.showFailPopup || this.showPortalPrompt || this.showGameplayPrompt) return;
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
        if (rect && inRect(x, y, rect) && this.onHome) {
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
      if (rect && inRect(x, y, rect)) {
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
      let rect = null;
      if (key === 'restart') rect = layout.restartRect;
      else if (key === 'home') rect = layout.homeRect;
      else if (key === 'ad') rect = layout.adRect;
      else if (key === 'share') rect = layout.shareRect;
      if (rect && inRect(x, y, rect)) {
        this.onFailClick(key);
      }
      return;
    }

    // 玩法提示弹窗按钮处理
    if (this.showGameplayPrompt) {
      const key = this.gameplayPromptPressedBtn;
      this.gameplayPromptPressedBtn = null;
      if (!key) return;
      const layout = this.calcGameplayPromptLayout();
      if (!layout) return;
      if (key === 'skip') {
        if (layout.skipRect && inRect(x, y, layout.skipRect)) {
          this.showGameplayPrompt = false;
          this.gameplayPromptAnimating = false;
        }
      } else if (key === 'prev') {
        if (layout.prevRect && inRect(x, y, layout.prevRect)) {
          // 无限轮播：到第一页再按上一页跳到最后一页
          this.gameplayPromptPage = (this.gameplayPromptPage - 1 + this.gameplayPromptTotal) % this.gameplayPromptTotal;
        }
      } else if (key === 'next') {
        if (layout.nextRect && inRect(x, y, layout.nextRect)) {
          // 无限轮播：到最后一页再按下一页跳到第一页
          this.gameplayPromptPage = (this.gameplayPromptPage + 1) % this.gameplayPromptTotal;
        }
      }
      return;
    }

    // 传送门提示弹窗按钮处理
    if (this.showPortalPrompt) {
      if (this.portalPromptPressed) {
        this.portalPromptPressed = false;
        const layout = this.calcPortalPromptLayout();
        if (layout && layout.seeRect && inRect(x, y, layout.seeRect)) {
          this.showPortalPrompt = false;
          this.portalPromptAnimating = false;
        }
      }
      return;
    }

    if (this.blockAnim) return;

    if (this.pressedBtn) {
      const rect = this.btnLayout[this.pressedBtn];
      if (rect && inRect(x, y, rect)) {
        this.onBtnClick(this.pressedBtn);
      }
      this.pressedBtn = null;
      return;
    }

    // 撤回 & 重置按钮释放
    if (this.pressedAction) {
      const action = this.pressedAction;
      this.pressedAction = null;
      if (action === 'undo' && this.undoBtnRect && inRect(x, y, this.undoBtnRect)) {
        this._handleUndo();
      } else if (action === 'reset' && this.resetBtnRect && inRect(x, y, this.resetBtnRect)) {
        this._handleReset();
      }
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
    if (key === 'share') {
      this._doShareResurrection();
    }
    if (key === 'ad') {
      this._doAdResurrection();
    }
  }

  /** 分享复活 */
  _doShareResurrection() {
    const db = GameGlobal.databus;
    if (!db || db.shareResurrectionLeft <= 0) return;
    wx.shareAppMessage({
      title: '方块归位 — 快来挑战吧！',
    });
    // 微信小游戏中 shareAppMessage 无回调确认分享成功，
    // 行业惯例：调用即视为完成（平台限制）
    this._applyResurrection('share');
  }

  /** 广告复活 */
  _doAdResurrection() {
    const db = GameGlobal.databus;
    if (!db || db.adResurrectionUsedThisLevel) return;
    const ad = GameGlobal.rewardedVideoAd;
    if (!ad) return;
    ad.show().catch(() => {
      // 广告拉取失败时尝试重新加载后展示
      ad.load().then(() => ad.show()).catch(() => {
        wx.showToast({ title: '广告加载失败', icon: 'none' });
      });
    });
    // 监听关闭回调（一次性）
    const onClose = (res) => {
      ad.offClose(onClose);
      if (res && res.isEnded) {
        this._applyResurrection('ad');
      } else {
        wx.showToast({ title: '需要看完广告才能复活', icon: 'none' });
      }
    };
    ad.onClose(onClose);
  }

  /** 执行复活：+3 步数，关闭弹窗 */
  _applyResurrection(type) {
    const db = GameGlobal.databus;
    if (!this.board || !db) return;
    this.board.addSteps(3);
    this.showFailPopup = false;
    this.failAnimating = false;
    this._failPopupLayout = null;
    if (type === 'share') {
      db.shareResurrectionLeft--;
    } else {
      db.adResurrectionUsedThisLevel = true;
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
    // 每次弹出失败弹窗时清掉布局缓存，让按钮状态（可用/灰化）根据最新数据重新计算
    this._failPopupLayout = null;
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

  /* ---------- 显示玩法提示弹窗 ---------- */

  triggerGameplayPrompt() {
    this.showGameplayPrompt = true;
    this.gameplayPromptAnimating = true;
    this.gameplayPromptAlpha = 0;
    this.gameplayPromptScale = 0.7;
    this.gameplayPromptPage = 0;
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
    }
  }

  /* ---------- 撤回 & 重置 ---------- */

  _handleUndo() {
    if (!this.board || this.blockAnim) return;
    if (!this.board.canUndo()) {
      wx.showToast({ title: '没有可撤回的步骤', icon: 'none' });
      return;
    }
    if (this.undoRemaining > 0) {
      if (this.board.undo()) {
        this.undoRemaining--;
        this.selectedBlockId = null;
      }
    } else {
      wx.showToast({ title: '本关撤回次数已用完', icon: 'none' });
    }
  }

  _handleReset() {
    if (!this.board || this.blockAnim) return;
    this.board.reset();
    this.selectedBlockId = null;
    this.blockAnim = null;
    this.undoRemaining = 1;
    this.showFailPopup = false;
    this.showSuccessPopup = false;
  }

  /* ---------- 渲染 ---------- */

  update() {
    if (this.board) this.board.updateShake();
    this.updateBlockAnim();


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

    // 玩法提示弹窗入场动画
    if (this.gameplayPromptAnimating) {
      this.gameplayPromptAlpha = Math.min(1, this.gameplayPromptAlpha + 0.06);
      this.gameplayPromptScale = Math.min(1, this.gameplayPromptScale + 0.04);
      if (this.gameplayPromptAlpha >= 1 && this.gameplayPromptScale >= 1) {
        this.gameplayPromptAnimating = false;
      }
    }
  }

  render() {
    if (!this.loaded) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
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
    this.drawActionBar();

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

    // 玩法提示弹窗覆盖在最上层
    if (this.showGameplayPrompt) {
      this.drawGameplayPrompt();
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
    ctx.fillText(`随机关卡生成中${dots}`, cx, cy);

    ctx.fillStyle = 'rgba(122, 59, 18, 0.6)';
    ctx.font = `${Math.floor(fs * 0.65)}px sans-serif`;
    ctx.fillText('（首次进入需稍等几秒）', cx, cy + fs * 1.2);
    ctx.restore();
  }

  drawBackground() {
    drawCoverImage(ctx, this.images.bg, SCREEN_WIDTH, SCREEN_HEIGHT);
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

    // 3. 洞、传送门、石块 — 合并为单次遍历
    for (let r = 0; r < this.board.rows; r++) {
      for (let c = 0; c < this.board.cols; c++) {
        const cell = this.board.grid[r][c];
        if (!cell) continue;
        const x = this.innerX + c * this.cellSize;
        const y = this.innerY + r * this.cellSize;
        if (cell.type === 'hole') {
          const skinId = this.colorSkinMap ? this.colorSkinMap[cell.color] : cell.color;
          const holeImg = this.images[`skinHole_${skinId}`];
          if (holeImg) ctx.drawImage(holeImg, x, y, this.cellSize, this.cellSize);
        } else if (cell.type === 'portal') {
          const skinId = this.portalSkinMap ? this.portalSkinMap[cell.color] : `${cell.color}_portal`;
          const portalImg = this.images[`skinPortal_${skinId}`];
          if (portalImg) ctx.drawImage(portalImg, x, y, this.cellSize, this.cellSize);
        } else if (cell.type === 'stone') {
          const stoneImg = this.images.stone;
          if (stoneImg) ctx.drawImage(stoneImg, x, y, this.cellSize, this.cellSize);
        }
      }
    }

    // 5. 入洞方块
    for (const block of this.board.blocks) {
      if (block.inHole) {
        const x = this.innerX + block.col * this.cellSize;
        const y = this.innerY + block.row * this.cellSize;
        const skinId = this.colorSkinMap ? this.colorSkinMap[block.color] : block.color;
        const img = this.images[`skinSuccess_${skinId}`];
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
    const skinId = this.colorSkinMap ? this.colorSkinMap[block.color] : block.color;
    const img = this.images[`skinBlock_${skinId}`];
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
  }


  drawActionBar() {
    // 撤回按钮
    if (this.undoBtnRect && this.images.withdrawBtn) {
      const rect = this.undoBtnRect;
      ctx.save();
      if (this.pressedAction === 'undo') {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        ctx.translate(cx, cy);
        ctx.scale(0.9, 0.9);
        ctx.translate(-cx, -cy);
      }
      ctx.drawImage(this.images.withdrawBtn, rect.x, rect.y, rect.w, rect.h);

      // 撤回次数角标
      const badgeR = rect.h * 0.22;
      const badgeX = rect.x + rect.w - badgeR * 0.3;
      const badgeY = rect.y + badgeR * 0.3;
      ctx.fillStyle = this.undoRemaining > 0 ? '#FF4444' : '#999999';
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.floor(badgeR * 1.3)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.undoRemaining.toString(), badgeX, badgeY);

      ctx.restore();
    }

    // 重置按钮
    if (this.resetBtnRect && this.images.resetBtn) {
      const rect = this.resetBtnRect;
      ctx.save();
      if (this.pressedAction === 'reset') {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        ctx.translate(cx, cy);
        ctx.scale(0.9, 0.9);
        ctx.translate(-cx, -cy);
      }
      ctx.drawImage(this.images.resetBtn, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }
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

  /* ---------- 失败弹窗布局计算（动态，每次弹出时重新计算） ---------- */

  calcFailPopupLayout() {
    if (this._failPopupLayout) return this._failPopupLayout;

    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    const lw = LAYOUT_WIDTH;
    const db = GameGlobal.databus;

    const bgImg = this.failImages.failBg;
    if (!bgImg) return null;

    // 弹窗背景按原始比例缩小显示
    const bgRatio = bgImg.width / bgImg.height;
    const popupW = lw * 0.78;
    const popupH = popupW / bgRatio;

    const popupX = (w - popupW) / 2;
    const popupY = (h - popupH) / 2 + h * 0.02;

    // 按钮布局 — 上下两排，每排两个按钮
    const btnW = popupW * 0.43;
    const btnGap = popupW * 0.03;
    const rowGap = popupH * 0.04;

    let restartRect = null;
    let homeRect = null;
    let adRect = null;
    let shareRect = null;

    // 状态判断
    const shareEnabled = db ? db.shareResurrectionLeft > 0 : false;
    const adEnabled = GameGlobal.trafficMasterEnabled && db && !db.adResurrectionUsedThisLevel;

    const restartImg = this.failImages.failRestart;
    const homeImg = this.failImages.failHome;

    // 第一排按钮起始于弹窗高度的 72% 处
    const row1Y = popupY + popupH * 0.72;
    const totalRowW = btnW * 2 + btnGap;
    const rowStartX = (w - totalRowW) / 2;

    // 统一按钮高度
    const refImg = restartImg || homeImg;
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

    // 第二排：广告复活 / 分享复活
    const row2Y = row1Y + btnH + rowGap;

    adRect = {
      x: rowStartX,
      y: row2Y,
      w: btnW,
      h: btnH,
    };

    shareRect = {
      x: rowStartX + btnW + btnGap,
      y: row2Y,
      w: btnW,
      h: btnH,
    };

    this._failPopupLayout = {
      popupX,
      popupY,
      popupW,
      popupH,
      restartRect,
      homeRect,
      adRect,
      shareRect,
      adEnabled,
      shareEnabled,
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
    const bottomRow = layout.shareRect || layout.adRect || layout.homeRect;
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

    // 第二排按钮：广告复活 / 分享复活（根据状态显示可用/灰化）
    const adImg = layout.adEnabled ? this.failImages.failAd : this.failImages.failAdGray;
    const shareImg = layout.shareEnabled ? this.failImages.failShare : this.failImages.failShareGray;
    this.drawFailBtn(layout.adEnabled ? 'ad' : null, layout.adRect, adImg, !layout.adEnabled);
    this.drawFailBtn(layout.shareEnabled ? 'share' : null, layout.shareRect, shareImg, !layout.shareEnabled);

    // 分享复活剩余次数徽标
    const db = GameGlobal.databus;
    if (layout.shareRect && db) {
      this._drawResurrectionBadge(layout.shareRect, db.shareResurrectionLeft, 3);
    }


    ctx.restore();
  }

  /**
   * 复活按钮右上角徽标：显示 "N/M" 剩余次数
   */
  _drawResurrectionBadge(rect, left, total) {
    const radius = Math.max(10, Math.min(rect.w * 0.12, rect.h * 0.28));
    const bx = rect.x + rect.w - radius * 0.4;
    const by = rect.y + radius * 0.4;

    ctx.save();

    ctx.beginPath();
    ctx.arc(bx, by, radius, 0, Math.PI * 2);
    ctx.fillStyle = left > 0 ? '#E74C3C' : '#999';
    ctx.fill();
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = Math.max(1.5, radius * 0.14);
    ctx.stroke();

    const fontSize = Math.floor(radius * 0.92);
    ctx.fillStyle = '#FFF';
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${left}`, bx, by + 1);

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
    const lw = LAYOUT_WIDTH;

    const bgImg = this.portalPromptImages.portalPromptBg;
    if (!bgImg) return null;

    // 弹窗背景按原始比例显示
    const bgRatio = bgImg.width / bgImg.height;
    const popupW = lw * 0.78;
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

  /* ---------- 玩法提示弹窗布局计算（缓存） ---------- */

  calcGameplayPromptLayout() {
    if (this._gameplayPromptLayout) return this._gameplayPromptLayout;

    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    const lw = LAYOUT_WIDTH;

    const bgImg = this.gameplayPromptImages.gameplayBg;
    if (!bgImg) return null;

    // 弹窗背景按原始比例显示，宽度占布局宽度 82%
    const bgRatio = bgImg.width / bgImg.height;
    const popupW = lw * 0.82;
    const popupH = popupW / bgRatio;

    const popupX = (w - popupW) / 2;
    const popupY = (h - popupH) / 2 - h * 0.04;

    // 内容区域（背景卡片内部，去掉边框和标题区域）
    const contentX = popupX + popupW * 0.08;
    const contentY = popupY + popupH * 0.12;
    const contentW = popupW * 0.84;
    const contentH = popupH * 0.78;

    // 跳过按钮 — 弹窗正下方居中
    let skipRect = null;
    const skipImg = this.gameplayPromptImages.gameplaySkip;
    if (skipImg) {
      const btnW = popupW * 0.42;
      const btnRatio = skipImg.width / skipImg.height;
      const btnH = btnW / btnRatio;
      skipRect = {
        x: (w - btnW) / 2,
        y: popupY + popupH + popupH * 0.02,
        w: btnW,
        h: btnH,
      };
    }

    // 上一页/下一页按钮 — 弹窗下方左右两侧，跳过按钮上方
    const arrowSize = popupW * 0.10;
    const arrowY = popupY + popupH - arrowSize - popupH * 0.04;
    let prevRect = null;
    let nextRect = null;

    const prevImg = this.gameplayPromptImages.gameplayPrev;
    const nextImg = this.gameplayPromptImages.gameplayNext;

    if (prevImg) {
      prevRect = {
        x: popupX + popupW * 0.06,
        y: arrowY,
        w: arrowSize,
        h: arrowSize,
      };
    }

    if (nextImg) {
      nextRect = {
        x: popupX + popupW - popupW * 0.06 - arrowSize,
        y: arrowY,
        w: arrowSize,
        h: arrowSize,
      };
    }

    // 圆点指示器 — 在箭头之间居中
    const dotSize = popupW * 0.04;
    const dotGap = dotSize * 1.0;

    this._gameplayPromptLayout = {
      popupX,
      popupY,
      popupW,
      popupH,
      contentX,
      contentY,
      contentW,
      contentH,
      skipRect,
      prevRect,
      nextRect,
      arrowY,
      dotSize,
      dotGap,
    };
    return this._gameplayPromptLayout;
  }

  /* ---------- 玩法提示弹窗渲染 ---------- */

  drawGameplayPrompt() {
    const layout = this.calcGameplayPromptLayout();
    if (!layout) return;

    ctx.save();
    ctx.globalAlpha = this.gameplayPromptAlpha;

    // 半透明灰色遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 弹窗整体缩放动画
    const cx = layout.popupX + layout.popupW / 2;
    const totalBottom = layout.skipRect
      ? layout.skipRect.y + layout.skipRect.h
      : layout.popupY + layout.popupH;
    const cy = (layout.popupY + totalBottom) / 2;
    ctx.translate(cx, cy);
    ctx.scale(this.gameplayPromptScale, this.gameplayPromptScale);
    ctx.translate(-cx, -cy);

    // 弹窗背景图
    const bgImg = this.gameplayPromptImages.gameplayBg;
    if (bgImg) {
      ctx.drawImage(
        bgImg,
        layout.popupX,
        layout.popupY,
        layout.popupW,
        layout.popupH
      );
    }

    // 右上角页码："1/3"
    const pageText = `${this.gameplayPromptPage + 1}/${this.gameplayPromptTotal}`;
    const pageFontSize = Math.floor(layout.popupW * 0.044);
    ctx.save();
    ctx.font = `bold ${pageFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 页码背景胶囊
    const pageTextW = ctx.measureText(pageText).width + pageFontSize * 1.2;
    const pageTextH = pageFontSize * 1.6;
    const pageX = layout.popupX + layout.popupW - layout.popupW * 0.08 - pageTextW / 2;
    const pageY = layout.popupY + layout.popupH * 0.10;
    const pillX = pageX - pageTextW / 2;
    const pillY = pageY - pageTextH / 2;
    const pillR = pageTextH / 2;
    ctx.fillStyle = 'rgba(255, 200, 120, 0.5)';
    ctx.beginPath();
    ctx.moveTo(pillX + pillR, pillY);
    ctx.lineTo(pillX + pageTextW - pillR, pillY);
    ctx.arcTo(pillX + pageTextW, pillY, pillX + pageTextW, pillY + pillR, pillR);
    ctx.lineTo(pillX + pageTextW, pillY + pageTextH - pillR);
    ctx.arcTo(pillX + pageTextW, pillY + pageTextH, pillX + pageTextW - pillR, pillY + pageTextH, pillR);
    ctx.lineTo(pillX + pillR, pillY + pageTextH);
    ctx.arcTo(pillX, pillY + pageTextH, pillX, pillY + pageTextH - pillR, pillR);
    ctx.lineTo(pillX, pillY + pillR);
    ctx.arcTo(pillX, pillY, pillX + pillR, pillY, pillR);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#A05A1A';
    ctx.fillText(pageText, pageX, pageY + 1);
    ctx.restore();

    // 当前页的提示图片 — 在背景卡片内容区域居中显示
    const promptImg = this.gameplayPromptImages[`gameplayPrompt_${this.gameplayPromptPage + 1}`];
    if (promptImg) {
      const imgRatio = promptImg.width / promptImg.height;
      let drawW = layout.contentW;
      let drawH = drawW / imgRatio;
      // 如果高度超出内容区域，按高度缩放
      if (drawH > layout.contentH) {
        drawH = layout.contentH;
        drawW = drawH * imgRatio;
      }
      const drawX = layout.contentX + (layout.contentW - drawW) / 2;
      const drawY = layout.contentY + (layout.contentH - drawH) / 2;
      ctx.drawImage(promptImg, drawX, drawY, drawW, drawH);
    }

    // 上一页按钮
    if (layout.prevRect) {
      const prevImg = this.gameplayPromptImages.gameplayPrev;
      if (prevImg) {
        ctx.save();
        if (this.gameplayPromptPressedBtn === 'prev') {
          const bx = layout.prevRect.x + layout.prevRect.w / 2;
          const by = layout.prevRect.y + layout.prevRect.h / 2;
          ctx.translate(bx, by);
          ctx.scale(0.88, 0.88);
          ctx.translate(-bx, -by);
        }
        ctx.drawImage(
          prevImg,
          layout.prevRect.x,
          layout.prevRect.y,
          layout.prevRect.w,
          layout.prevRect.h
        );
        ctx.restore();
      }
    }

    // 下一页按钮
    if (layout.nextRect) {
      const nextImg = this.gameplayPromptImages.gameplayNext;
      if (nextImg) {
        ctx.save();
        if (this.gameplayPromptPressedBtn === 'next') {
          const bx = layout.nextRect.x + layout.nextRect.w / 2;
          const by = layout.nextRect.y + layout.nextRect.h / 2;
          ctx.translate(bx, by);
          ctx.scale(0.88, 0.88);
          ctx.translate(-bx, -by);
        }
        ctx.drawImage(
          nextImg,
          layout.nextRect.x,
          layout.nextRect.y,
          layout.nextRect.w,
          layout.nextRect.h
        );
        ctx.restore();
      }
    }

    // 圆点指示器 — 在左右箭头之间居中
    const dotOn = this.gameplayPromptImages.gameplayDotOn;
    const dotOff = this.gameplayPromptImages.gameplayDotOff;
    if (dotOn || dotOff) {
      const totalDotsW = this.gameplayPromptTotal * layout.dotSize + (this.gameplayPromptTotal - 1) * layout.dotGap;
      const dotsStartX = layout.popupX + (layout.popupW - totalDotsW) / 2;
      const dotsY = layout.arrowY + (layout.prevRect ? layout.prevRect.h : layout.dotSize) / 2 - layout.dotSize / 2;

      for (let i = 0; i < this.gameplayPromptTotal; i++) {
        const dotImg = (i === this.gameplayPromptPage) ? dotOn : dotOff;
        if (dotImg) {
          const dx = dotsStartX + i * (layout.dotSize + layout.dotGap);
          ctx.drawImage(dotImg, dx, dotsY, layout.dotSize, layout.dotSize);
        }
      }
    }

    // 跳过按钮
    if (layout.skipRect) {
      const skipImg = this.gameplayPromptImages.gameplaySkip;
      if (skipImg) {
        ctx.save();
        if (this.gameplayPromptPressedBtn === 'skip') {
          const bx = layout.skipRect.x + layout.skipRect.w / 2;
          const by = layout.skipRect.y + layout.skipRect.h / 2;
          ctx.translate(bx, by);
          ctx.scale(0.92, 0.92);
          ctx.translate(-bx, -by);
        }
        ctx.drawImage(
          skipImg,
          layout.skipRect.x,
          layout.skipRect.y,
          layout.skipRect.w,
          layout.skipRect.h
        );
        ctx.restore();
      }
    }

    ctx.restore();
  }
}
