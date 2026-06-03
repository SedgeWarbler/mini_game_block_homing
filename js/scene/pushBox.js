import { SCREEN_WIDTH, SCREEN_HEIGHT, DPR, img, loadImg, easeOutCubic, inRect, drawCoverImage, LAYOUT_WIDTH, LAYOUT_OFFSET_X } from '../render';
import { generateSokobanLevel, markLevelCleared } from '../game/sokobanGenerator';
import SokobanBoard from '../game/sokobanBoard';

const ctx = canvas.getContext('2d');

/**
 * 推箱子场景所有需要的图片 URL。
 * 用于 LoadingScene 预加载。
 */
export function buildPushBoxPaths() {
  return {
    pbBg: img('images/push_box/background.png'),
    pbBlockBg: img('images/push_box/block_background.png'),
    pbBox: img('images/push_box/box.png'),
    pbBoxSuccess: img('images/push_box/box_success.png'),
    pbDestination: img('images/push_box/destination.png'),
    pbDirection: img('images/push_box/direction.png'),
    pbPeople: img('images/push_box/people.png'),
    pbStone: img('images/push_box/stone.png'),
    pbWithdraw: img('images/push_box/withdraw.png'),
    pbReset: img('images/push_box/reset.png'),
  };
}

/**
 * 推箱子游戏场景
 *
 * UI 布局参考设计图：
 *   - 顶部栏：返回按钮(左) | 关卡号(中) | 已走步数(右)
 *   - 中间：推箱子棋盘（石头围墙 + 地砖 + 箱子 + 人物 + 目标点）
 *   - 底部：十字方向键（上/下/左/右）
 */
export default class PushBoxScene {
  images = {};
  loaded = false;
  board = null;
  pressedBtn = null;
  pressedDir = null;

  // 关卡数据（无关卡号，每次随机）
  levelLoading = false;
  loadingAnimT = 0;

  // 撤回/重置
  undoRemaining = 1;      // 每关默认 1 次免费撤回
  adUndoUsed = false;     // 每关 1 次看广告机会
  pressedAction = null;   // 'undo' | 'reset'

  // 通关弹窗
  showWinPopup = false;
  winAlpha = 0;
  winScale = 0.7;
  winAnimating = false;
  winPressedKey = null;

  // 旋转后的方向键缓存 canvas
  _dirImages = {};

  constructor(onHome) {
    this.onHome = onHome;

    this.loadResources().then(() => {
      this.loaded = true;
      this._prepareDirectionImages();
      this.bindEvents();
      this.startNewLevel();
    });
  }

  /* ---------- 资源加载 ---------- */

  loadResources() {
    // 加载推箱子专用素材
    const pbPaths = buildPushBoxPaths();
    // 也加载通用的 game 场景素材（返回按钮、关卡背景、步数背景）
    const gamePaths = {
      returnBtn: img('images/game/return.png'),
      stepBg: img('images/game/step.png'),
    };
    // 加载通关弹窗素材
    const winPaths = {
      popupBg: img('images/push_box/level_cleared.png'),
      popupNext: img('images/success/next_level.png'),
      popupHome: img('images/success/back_home.png'),
    };

    const allPaths = { ...pbPaths, ...gamePaths, ...winPaths };
    return Promise.all(
      Object.entries(allPaths).map(([key, src]) =>
        loadImg(src).then((image) => {
          if (image) this.images[key] = image;
        })
      )
    );
  }

  /**
   * 将 direction.png（只有上箭头）旋转生成4个方向的离屏 canvas
   */
  _prepareDirectionImages() {
    const src = this.images.pbDirection;
    if (!src) return;

    const angles = {
      up: 0,
      right: Math.PI / 2,
      down: Math.PI,
      left: -Math.PI / 2,
    };

    for (const [dir, angle] of Object.entries(angles)) {
      const offCanvas = wx.createCanvas();
      offCanvas.width = src.width;
      offCanvas.height = src.height;
      const offCtx = offCanvas.getContext('2d');
      offCtx.translate(src.width / 2, src.height / 2);
      offCtx.rotate(angle);
      offCtx.drawImage(src, -src.width / 2, -src.height / 2);
      this._dirImages[dir] = offCanvas;
    }
  }

  /* ---------- 关卡控制 ---------- */

  startNewLevel() {
    this.board = null;
    this.showWinPopup = false;
    this.winAnimating = false;
    this.pressedBtn = null;
    this.pressedDir = null;
    this.pressedAction = null;
    this.levelLoading = true;
    this.loadingAnimT = 0;
    this._winPopupLayout = null;
    this._levelToken = Date.now();
    this.undoRemaining = 1; // 每关重置 1 次免费撤回
    this.adUndoUsed = false; // 每关重置广告机会
    this._currentLevelIndex = -1; // 当前关卡索引

    this.calcShellLayout();

    const token = this._levelToken;
    generateSokobanLevel(1).then((data) => {
      if (this._levelToken !== token) return;
      this._currentLevelIndex = data.levelIndex; // 记录关卡索引
      this.board = new SokobanBoard(data);
      this.levelLoading = false;
      this.calcLayout();
    });
  }

  restartLevel() {
    if (this.board) {
      this.board.reset();
      this.showWinPopup = false;
      this.winAnimating = false;
      this._winPopupLayout = null;
      this.undoRemaining = 1;  // 重置时恢复 1 次免费撤回
      this.adUndoUsed = false; // 重置时恢复广告机会
    }
  }

  /* ---------- 布局计算 ---------- */

  calcShellLayout() {
    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    const lw = LAYOUT_WIDTH;
    const ox = LAYOUT_OFFSET_X;

    this.topH = h * 0.085;

    // 顶部按钮布局（只有返回 + 步数，无关卡号）
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

    if (this.images.stepBg) {
      const sw = topIconH * (this.images.stepBg.width / this.images.stepBg.height);
      this.stepRect = {
        x: ox + lw - sideMargin - sw,
        y: iconCenterY - topIconH / 2,
        w: sw,
        h: topIconH,
      };
    }
  }

  calcLayout() {
    if (!this.board) return;

    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    const lw = LAYOUT_WIDTH;
    const ox = LAYOUT_OFFSET_X;

    this.topH = h * 0.085;

    // 方向键区域高度
    this.dpadH = h * 0.26;

    // 棋盘可用区域（撤回/重置已移至顶部栏，不再占中间空间）
    const availH = h - this.topH - this.dpadH - h * 0.01;
    const maxW = lw * 0.96;
    const maxH = availH * 0.96;

    // 根据行列计算单元格大小
    const cellByW = Math.floor(maxW / this.board.cols);
    const cellByH = Math.floor(maxH / this.board.rows);
    this.cellSize = Math.min(cellByW, cellByH);

    // 网格实际尺寸
    this.gridW = this.cellSize * this.board.cols;
    this.gridH = this.cellSize * this.board.rows;

    // 居中偏下（给顶部撤回/重置按钮留空间）
    this.gridX = (w - this.gridW) / 2;
    this.gridY = this.topH + (availH - this.gridH) / 2 + h * 0.03;

    // 顶部按钮布局：返回(左) | 撤回+重置(中) | 步数(右)
    this.btnLayout = {};
    const topIconH = this.topH * 0.58;
    const iconCenterY = this.topH * 0.78;
    const sideMargin = lw * 0.04;

    if (this.images.returnBtn) {
      const bw = topIconH * (this.images.returnBtn.width / this.images.returnBtn.height);
      this.btnLayout.return = {
        x: ox + sideMargin,
        y: iconCenterY - topIconH / 2,
        w: bw,
        h: topIconH,
      };
    }

    if (this.images.stepBg) {
      const sw = topIconH * (this.images.stepBg.width / this.images.stepBg.height);
      this.stepRect = {
        x: ox + lw - sideMargin - sw,
        y: iconCenterY - topIconH / 2,
        w: sw,
        h: topIconH,
      };
    }


    // 撤回 + 重置按钮放在顶部栏中间
    this._calcTopActionBtns(topIconH, iconCenterY);

    // 方向键布局
    this._calcDpadLayout();
  }

  _calcTopActionBtns(topIconH, iconCenterY) {
    const w = SCREEN_WIDTH;
    const lw = LAYOUT_WIDTH;
    const btnH = topIconH;
    const withdrawImg = this.images.pbWithdraw;
    const resetImg = this.images.pbReset;
    const gap = lw * 0.03;

    // 下移一个按钮高度，避免与步数重叠
    const actionY = iconCenterY + btnH * 1.3;

    // 计算两个按钮的总宽度，居中放置
    const wW = withdrawImg ? btnH * (withdrawImg.width / withdrawImg.height) : btnH * 1.8;
    const rW = resetImg ? btnH * (resetImg.width / resetImg.height) : btnH * 1.8;
    const totalW = wW + gap + rW;
    let startX = (w - totalW) / 2;

    this.undoBtnRect = { x: startX, y: actionY - btnH / 2, w: wW, h: btnH };
    startX += wW + gap;
    this.resetBtnRect = { x: startX, y: actionY - btnH / 2, w: rW, h: btnH };
  }

  _calcDpadLayout() {
    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    const lw = LAYOUT_WIDTH;
    const dpadTop = h - this.dpadH + h * 0.01;
    const dpadCenterX = w / 2;
    const dpadCenterY = dpadTop + this.dpadH / 2 - h * 0.03; // 整体上移

    const btnSize = Math.min(lw * 0.18, this.dpadH * 0.38);
    const gap = btnSize * 0.6;

    this.dpadBtns = {
      up: {
        x: dpadCenterX - btnSize / 2,
        y: dpadCenterY - btnSize - gap / 2,
        w: btnSize,
        h: btnSize,
      },
      down: {
        x: dpadCenterX - btnSize / 2,
        y: dpadCenterY + gap / 2,
        w: btnSize,
        h: btnSize,
      },
      left: {
        x: dpadCenterX - btnSize - gap,
        y: dpadCenterY - btnSize / 2,
        w: btnSize,
        h: btnSize,
      },
      right: {
        x: dpadCenterX + gap,
        y: dpadCenterY - btnSize / 2,
        w: btnSize,
        h: btnSize,
      },
    };
  }

  /* ---------- 通关弹窗布局 ---------- */

  _winPopupLayout = null;

  calcWinPopupLayout() {
    if (this._winPopupLayout) return this._winPopupLayout;

    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    const lw = LAYOUT_WIDTH;

    const bgImg = this.images.popupBg;
    if (!bgImg) return null;

    const bgRatio = bgImg.width / bgImg.height;
    const popupW = lw * 0.72;
    const popupH = popupW / bgRatio;

    const popupX = (w - popupW) / 2;
    const popupY = (h - popupH) / 2 + h * 0.02;

    const btnW = popupW * 0.65;
    const btnGap = popupH * 0.025;

    let nextRect = null;
    let homeRect = null;

    const nextImg = this.images.popupNext;
    const homeImg = this.images.popupHome;

    if (nextImg) {
      const btnRatio = nextImg.width / nextImg.height;
      const btnH = btnW / btnRatio;
      nextRect = {
        x: (w - btnW) / 2,
        y: popupY + popupH * 0.70,
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

    this._winPopupLayout = { popupX, popupY, popupW, popupH, nextRect, homeRect };
    return this._winPopupLayout;
  }

  /* ---------- 事件绑定 ---------- */

  bindEvents() {
    this._touchStart = this.handleTouchStart.bind(this);
    this._touchMove = this.handleTouchMove.bind(this);
    this._touchEnd = this.handleTouchEnd.bind(this);
    this._touchCancel = () => {
      this.pressedBtn = null;
      this.pressedDir = null;
      this.pressedAction = null;
      this.winPressedKey = null;
      this._swipeStartX = null;
      this._swipeStartY = null;
      this._swiped = false;
    };
    wx.onTouchStart(this._touchStart);
    wx.onTouchMove(this._touchMove);
    wx.onTouchEnd(this._touchEnd);
    wx.onTouchCancel(this._touchCancel);
  }

  destroy() {
    if (this._touchStart) wx.offTouchStart(this._touchStart);
    if (this._touchMove) wx.offTouchMove(this._touchMove);
    if (this._touchEnd) wx.offTouchEnd(this._touchEnd);
    if (this._touchCancel) wx.offTouchCancel(this._touchCancel);
  }


  handleTouchStart(e) {
    if (!this.loaded) return;
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;

    // loading 时只接受返回按钮
    if (this.levelLoading || !this.board) {
      if (this.btnLayout && this.btnLayout.return && inRect(x, y, this.btnLayout.return)) {
        this.pressedBtn = 'return';
      }
      return;
    }

    // 通关弹窗事件优先
    if (this.showWinPopup) {
      const layout = this.calcWinPopupLayout();
      if (!layout) return;
      if (layout.nextRect && inRect(x, y, layout.nextRect)) {
        this.winPressedKey = 'next';
      } else if (layout.homeRect && inRect(x, y, layout.homeRect)) {
        this.winPressedKey = 'home';
      }
      return;
    }

    // 操作按钮（撤回 / 重置）
    if (this.undoBtnRect && inRect(x, y, this.undoBtnRect)) {
      this.pressedAction = 'undo';
      return;
    }
    if (this.resetBtnRect && inRect(x, y, this.resetBtnRect)) {
      this.pressedAction = 'reset';
      return;
    }

    // 方向键
    if (this.dpadBtns) {
      for (const [dir, rect] of Object.entries(this.dpadBtns)) {
        if (inRect(x, y, rect)) {
          this.pressedDir = dir;
          return;
        }
      }
    }

    // 顶部按钮
    for (const [key, rect] of Object.entries(this.btnLayout)) {
      if (inRect(x, y, rect)) {
        this.pressedBtn = key;
        return;
      }
    }

    // 棋盘区域 → 准备滑动
    if (
      x >= this.gridX && x <= this.gridX + this.gridW &&
      y >= this.gridY && y <= this.gridY + this.gridH
    ) {
      this._swipeStartX = x;
      this._swipeStartY = y;
      this._swiped = false;
    }
  }

  handleTouchMove(e) {
    if (this.showWinPopup || this.levelLoading || !this.board) return;
    if (this._swipeStartX == null || this._swiped) return;
    if (this.board.isAnimating()) return;

    const touch = e.touches[0];
    const dx = touch.clientX - this._swipeStartX;
    const dy = touch.clientY - this._swipeStartY;
    const threshold = 20;

    if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
      this._swiped = true;
      let dir;
      if (Math.abs(dx) > Math.abs(dy)) {
        dir = dx > 0 ? 'right' : 'left';
      } else {
        dir = dy > 0 ? 'down' : 'up';
      }
      this._tryMove(dir);
    }
  }

  handleTouchEnd(e) {
    if (!this.loaded) return;
    const touch = e.changedTouches[0];
    const x = touch.clientX;
    const y = touch.clientY;

    // loading 时只接受返回
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

    // 通关弹窗
    if (this.showWinPopup) {
      const key = this.winPressedKey;
      this.winPressedKey = null;
      if (!key) return;
      const layout = this.calcWinPopupLayout();
      if (!layout) return;
      const rect = key === 'next' ? layout.nextRect : layout.homeRect;
      if (rect && inRect(x, y, rect)) {
        if (key === 'next') {
          this.startNewLevel();
        } else if (key === 'home' && this.onHome) {
          this.onHome();
        }
      }
      return;
    }

    // 操作按钮
    if (this.pressedAction) {
      const action = this.pressedAction;
      this.pressedAction = null;
      if (action === 'undo' && this.undoBtnRect && inRect(x, y, this.undoBtnRect)) {
        this._handleUndo();
      } else if (action === 'reset' && this.resetBtnRect && inRect(x, y, this.resetBtnRect)) {
        this.restartLevel();
      }
      return;
    }

    // 方向键
    if (this.pressedDir) {
      const dir = this.pressedDir;
      this.pressedDir = null;
      const rect = this.dpadBtns && this.dpadBtns[dir];
      if (rect && inRect(x, y, rect)) {
        this._tryMove(dir);
      }
      return;
    }

    // 顶部按钮
    if (this.pressedBtn) {
      const key = this.pressedBtn;
      this.pressedBtn = null;
      const rect = this.btnLayout[key];
      if (rect && inRect(x, y, rect)) {
        if (key === 'return' && this.onHome) {
          this.onHome();
        }
      }
      return;
    }

    this._swipeStartX = null;
    this._swipeStartY = null;
    this._swiped = false;
  }

  _tryMove(dir) {
    if (!this.board || this.board.isAnimating() || this.showWinPopup) return;
    const result = this.board.movePlayer(dir);
    if (result.moved) {
      this._pendingWinCheck = true;
    }
  }

  /**
   * 处理撤回操作
   */
  _handleUndo() {
    if (!this.board || this.board.isAnimating() || this.showWinPopup) return;
    if (this.board.history.length === 0) {
      wx.showToast({ title: '没有可撤回的步骤', icon: 'none' });
      return;
    }

    if (this.undoRemaining > 0) {
      // 有剩余撤回次数，直接使用
      if (this.board.undo()) {
        this.undoRemaining--;
      }
    } else {
      // 没有次数了，需要看广告获取
      this._showUndoRechargeModal();
    }
  }

  /**
   * 弹窗：广告获取撤回次数
   */
  _showUndoRechargeModal() {
    const ad = GameGlobal.rewardedVideoAd;
    if (ad && !this.adUndoUsed) {
      // 有广告且本局还没用过广告机会
      wx.showModal({
        title: '撤回次数不足',
        content: '观看广告可获得3次撤回机会（每局1次机会）',
        confirmText: '看广告',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            this._watchAdForUndo();
          }
        },
      });
    } else {
      // 无广告或本局广告机会已用
      wx.showToast({ title: '本局撤回次数已用完', icon: 'none' });
    }
  }

  /**
   * 观看广告获取撤回次数
   */
  _watchAdForUndo() {
    const ad = GameGlobal.rewardedVideoAd;
    if (!ad) {
      wx.showToast({ title: '广告不可用', icon: 'none' });
      return;
    }
    ad.show().catch(() => {
      ad.load().then(() => ad.show()).catch(() => {
        wx.showToast({ title: '广告加载失败', icon: 'none' });
      });
    });
    const onClose = (res) => {
      ad.offClose(onClose);
      if (res && res.isEnded) {
        this.undoRemaining += 3;
        this.adUndoUsed = true; // 标记本局广告机会已使用
        wx.showToast({ title: '获得3次撤回', icon: 'success' });
      } else {
        wx.showToast({ title: '需要看完广告才能获得撤回', icon: 'none' });
      }
    };
    ad.onClose(onClose);
  }

  /* ---------- 更新 ---------- */

  update() {
    if (this.levelLoading) {
      this.loadingAnimT += 1;
    }

    if (this.board) {
      this.board.updateAnim();

      // 动画结束时检查通关
      if (this._pendingWinCheck && !this.board.isAnimating()) {
        this._pendingWinCheck = false;
        if (this.board.isWin()) {
          // 通关后才标记该关卡为已完成
          if (this._currentLevelIndex >= 0) {
            markLevelCleared(this._currentLevelIndex);
          }
          setTimeout(() => {
            this.showWinPopup = true;
            this.winAnimating = true;
            this.winAlpha = 0;
            this.winScale = 0.7;
          }, 200);
        }
      }
    }

    // 通关弹窗入场动画
    if (this.winAnimating) {
      this.winAlpha = Math.min(1, this.winAlpha + 0.06);
      this.winScale = Math.min(1, this.winScale + 0.04);
      if (this.winAlpha >= 1 && this.winScale >= 1) {
        this.winAnimating = false;
      }
    }
  }

  /* ---------- 渲染 ---------- */

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
    this.drawBoard();
    this.drawActionBar();
    this.drawDpad();

    if (this.showWinPopup) {
      this.drawWinPopup();
    }
  }

  drawBackground() {
    drawCoverImage(ctx, this.images.pbBg, SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  drawLoading() {
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

    // 居中加载文字
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
    ctx.restore();
  }

  drawTopInfo() {
    // 返回按钮
    if (this.btnLayout.return && this.images.returnBtn) {
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

    // 步数（无关卡号，只显示步数）
    if (this.stepRect && this.images.stepBg && this.board) {
      ctx.drawImage(this.images.stepBg, this.stepRect.x, this.stepRect.y, this.stepRect.w, this.stepRect.h);
      ctx.fillStyle = '#E04A22';
      ctx.font = `bold ${Math.floor(this.stepRect.h * 0.40)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `已走 ${this.board.stepCount} 步`,
        this.stepRect.x + this.stepRect.w / 2,
        this.stepRect.y + this.stepRect.h / 2 + 1
      );
    }

  }

  drawBoard() {
    if (!this.board) return;

    const cs = this.cellSize;

    // 1. 逐格绘制：地砖背景 / 石头 / 目标点
    for (let r = 0; r < this.board.rows; r++) {
      for (let c = 0; c < this.board.cols; c++) {
        const x = this.gridX + c * cs;
        const y = this.gridY + r * cs;
        const cell = this.board.grid[r][c];

        // 围墙外部区域 → 不画任何东西，直接透出背景
        if (cell && cell.type === 'outside') {
          continue;
        }

        if (cell && cell.type === 'stone') {
          // 石头（墙壁）
          if (this.images.pbStone) {
            ctx.drawImage(this.images.pbStone, x, y, cs, cs);
          }
        } else {
          // 地砖
          if (this.images.pbBlockBg) {
            ctx.drawImage(this.images.pbBlockBg, x, y, cs, cs);
          }
          // 目标点
          if (cell && cell.type === 'target') {
            if (this.images.pbDestination) {
              const pad = cs * 0.15;
              ctx.drawImage(this.images.pbDestination, x + pad, y + pad, cs - pad * 2, cs - pad * 2);
            }
          }
        }
      }
    }

    // 2. 绘制箱子
    for (const box of this.board.boxes) {
      const pos = this.board.getBoxDrawPos(box);
      const x = this.gridX + pos.col * cs;
      const y = this.gridY + pos.row * cs;
      const onTarget = this.board.isBoxOnTarget(box);
      const boxImg = onTarget ? this.images.pbBoxSuccess : this.images.pbBox;
      if (boxImg) {
        ctx.drawImage(boxImg, x, y, cs, cs);
      }
    }

    // 3. 绘制玩家
    const playerPos = this.board.getPlayerDrawPos();
    const px = this.gridX + playerPos.col * cs;
    const py = this.gridY + playerPos.row * cs;
    if (this.images.pbPeople) {
      const peopleImg = this.images.pbPeople;
      // 人物图可能不是正方形，保持比例居中
      const imgRatio = peopleImg.width / peopleImg.height;
      let drawW, drawH;
      if (imgRatio > 1) {
        drawW = cs * 0.85;
        drawH = drawW / imgRatio;
      } else {
        drawH = cs * 0.85;
        drawW = drawH * imgRatio;
      }
      const dx = px + (cs - drawW) / 2;
      const dy = py + (cs - drawH) / 2;
      ctx.drawImage(peopleImg, dx, dy, drawW, drawH);
    }
  }

  drawActionBar() {
    // 撤回按钮
    if (this.undoBtnRect && this.images.pbWithdraw) {
      const rect = this.undoBtnRect;
      ctx.save();
      if (this.pressedAction === 'undo') {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        ctx.translate(cx, cy);
        ctx.scale(0.9, 0.9);
        ctx.translate(-cx, -cy);
      }
      ctx.drawImage(this.images.pbWithdraw, rect.x, rect.y, rect.w, rect.h);

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
    if (this.resetBtnRect && this.images.pbReset) {
      const rect = this.resetBtnRect;
      ctx.save();
      if (this.pressedAction === 'reset') {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        ctx.translate(cx, cy);
        ctx.scale(0.9, 0.9);
        ctx.translate(-cx, -cy);
      }
      ctx.drawImage(this.images.pbReset, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }
  }

  drawDpad() {
    if (!this.dpadBtns) return;

    for (const [dir, rect] of Object.entries(this.dpadBtns)) {
      const dirImg = this._dirImages[dir];
      if (!dirImg) continue;

      ctx.save();
      if (this.pressedDir === dir) {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        ctx.translate(cx, cy);
        ctx.scale(0.9, 0.9);
        ctx.translate(-cx, -cy);
      }
      ctx.drawImage(dirImg, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }
  }

  /* ---------- 通关弹窗 ---------- */

  drawWinPopup() {
    const layout = this.calcWinPopupLayout();
    if (!layout) return;

    ctx.save();
    ctx.globalAlpha = this.winAlpha;

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 弹窗整体缩放
    const cx = layout.popupX + layout.popupW / 2;
    const totalBottom = layout.homeRect
      ? layout.homeRect.y + layout.homeRect.h
      : layout.nextRect
        ? layout.nextRect.y + layout.nextRect.h
        : layout.popupY + layout.popupH;
    const cy = (layout.popupY + totalBottom) / 2;
    ctx.translate(cx, cy);
    ctx.scale(this.winScale, this.winScale);
    ctx.translate(-cx, -cy);

    // 弹窗背景
    const bgImg = this.images.popupBg;
    if (bgImg) {
      ctx.drawImage(bgImg, layout.popupX, layout.popupY, layout.popupW, layout.popupH);
    }

    // 下一关按钮
    this._drawPopupBtn('next', layout.nextRect, this.images.popupNext);
    // 返回首页按钮
    this._drawPopupBtn('home', layout.homeRect, this.images.popupHome);

    ctx.restore();
  }

  _drawPopupBtn(key, rect, btnImg) {
    if (!rect || !btnImg) return;
    ctx.save();
    if (this.winPressedKey === key) {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(0.92, 0.92);
      ctx.translate(-cx, -cy);
    }
    ctx.drawImage(btnImg, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }
}
