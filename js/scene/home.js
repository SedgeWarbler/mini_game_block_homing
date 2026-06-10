import { SCREEN_WIDTH, SCREEN_HEIGHT, DPR, img, loadImg, drawCoverImage, LAYOUT_WIDTH, LAYOUT_OFFSET_X } from '../render';

// 导出供 LoadingScene 统一预加载使用
export const HOME_IMAGE_PATHS = {
  bg: img('images/home/background.png'),
  startBtn: img('images/home/start_game.png'),
  continueBtn: img('images/home/continue_game.png'),
  continueBtnAsh: img('images/home/continue_game_ash.png'),
  pushBox: img('images/home/push_box.png'),

  skin: img('images/home/skin.png'),
};

const ctx = canvas.getContext('2d');

/**
 * 首页场景
 */
export default class HomeScene {
  images = {};
  loaded = false;
  pressedKey = null;

  constructor(onStart, onContinue, { onSkin, onPushBox } = {}) {
    this.onStart = onStart;
    this.onContinue = onContinue;
    this.onSkin = onSkin;
    this.onPushBox = onPushBox;
    // 进入 HomeScene 之前 LoadingScene 已经把图下完并写入 loadImg 缓存，
    // 这里 loadResources 实际上是同步命中缓存、当帧 resolve。
    this.loadResources().then(() => {
      this.loaded = true;
      this._cachedLayout = null;
      this._cachedHasProgress = null;
      this.bindEvents();
    });
  }

  loadResources() {
    // 关键图片（决定能否响应点击）：背景 + 主操作按钮
    // 非关键图片（底部入口小图标）：后台静默加载，加载完毕后自动刷新布局
    const criticalKeys = new Set(['bg', 'startBtn', 'continueBtn', 'continueBtnAsh']);
    const criticalPromises = [];

    for (const [key, src] of Object.entries(HOME_IMAGE_PATHS)) {
      const p = loadImg(src).then((image) => {
        if (image) {
          this.images[key] = image;
          // 每张图到位后立即令布局缓存失效，下一帧自动重算并渲染新图标
          this._cachedLayout = null;
        }
      });
      if (criticalKeys.has(key)) {
        criticalPromises.push(p);
      }
      // 非关键图片：fire-and-forget，不阻塞 loaded 标志
    }

    return Promise.all(criticalPromises);
  }

  bindEvents() {
    this._touchStart = this.handleTouchStart.bind(this);
    this._touchEnd = this.handleTouchEnd.bind(this);
    this._touchCancel = () => { this.pressedKey = null; };
    wx.onTouchStart(this._touchStart);
    wx.onTouchEnd(this._touchEnd);
    wx.onTouchCancel(this._touchCancel);
  }

  destroy() {
    // 防御：资源未加载完 destroy 时事件可能没绑过；传 undefined 会把同名监听全清掉。
    if (this._touchStart) wx.offTouchStart(this._touchStart);
    if (this._touchEnd) wx.offTouchEnd(this._touchEnd);
    if (this._touchCancel) wx.offTouchCancel(this._touchCancel);
  }

  /** 首页渲染轻量（几张图），保持全速以确保按钮高亮即时响应 */
  isAnimating() {
    return true;
  }

  /**
   * 首页是否已经存在可继续的关卡进度。
   * 无进度 → "继续游戏"按钮置灰、不响应点击；
   * 有进度 → "继续游戏"在上方放大，"开始游戏"缩到下方。
   */
  hasProgress() {
    return !!(GameGlobal.databus && GameGlobal.databus.hasProgress);
  }

  getLayout() {
    const hp = this.hasProgress();
    if (this._cachedLayout && this._cachedHasProgress === hp) {
      return this._cachedLayout;
    }
    this._cachedHasProgress = hp;
    const layout = this._buildLayout(hp);
    this._cachedLayout = layout;
    return layout;
  }

  _buildLayout(hasProgress) {
    const layout = {};
    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    const lw = LAYOUT_WIDTH;       // 宽屏设备上约束布局宽度
    const ox = LAYOUT_OFFSET_X;    // 居中偏移

    if (hasProgress) {
      // 已有进度：继续游戏（突出）在上，开始游戏（缩小）在下
      if (this.images.continueBtn) {
        const btnW = lw * 0.65;
        const btnH = btnW * (this.images.continueBtn.height / this.images.continueBtn.width);
        layout.continue = {
          x: ox + (lw - btnW) / 2,
          y: h * 0.61,
          w: btnW,
          h: btnH,
        };
      }
      if (this.images.startBtn) {
        const btnW = lw * 0.50; // 缩小
        const btnH = btnW * (this.images.startBtn.height / this.images.startBtn.width);
        layout.start = {
          x: ox + (lw - btnW) / 2,
          y: h * 0.73,
          w: btnW,
          h: btnH,
        };
      }
    } else {
      // 首次进入：开始游戏在上，继续游戏在下（置灰）
      if (this.images.startBtn) {
        const btnW = lw * 0.65;
        const btnH = btnW * (this.images.startBtn.height / this.images.startBtn.width);
        layout.start = {
          x: ox + (lw - btnW) / 2,
          y: h * 0.60,
          w: btnW,
          h: btnH,
        };
      }
      // 置灰用 continueBtnAsh 素材的实际比例，避免跟普通版尺寸略有差异时被拉伸
      const ashImg = this.images.continueBtnAsh || this.images.continueBtn;
      if (ashImg) {
        const btnW = lw * 0.65;
        const btnH = btnW * (ashImg.height / ashImg.width);
        layout.continue = {
          x: ox + (lw - btnW) / 2,
          y: h * 0.72,
          w: btnW,
          h: btnH,
        };
      }
    }

    // ---- 底部入口按钮 ----
    this._buildEntryLayout(layout, lw, h, ox);

    return layout;
  }

  /**
   * 底部两入口：推箱子 | 皮肤，水平等距排列。
   * 使用素材自身宽高比来计算按钮尺寸。
   */
  _buildEntryLayout(layout, lw, h, ox) {
    const entries = [
      { key: 'pushBox',     imgKey: 'pushBox' },
      { key: 'skin',        imgKey: 'skin' },
    ];

    const btnSize = lw * 0.24;
    const gap = lw * 0.10;
    const totalW = btnSize * entries.length + gap * (entries.length - 1);
    const startX = ox + (lw - totalW) / 2;
    const btnY = h * 0.82;

    entries.forEach((entry, i) => {
      const img = this.images[entry.imgKey];
      const btnW = btnSize;
      const btnH = img ? btnW * (img.height / img.width) : btnSize;
      layout[entry.key] = {
        x: startX + i * (btnSize + gap),
        y: btnY,
        w: btnW,
        h: btnH,
      };
    });
  }

  handleTouchStart(e) {
    if (!this.loaded) return;
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    const layout = this.getLayout();
    const hasProgress = this.hasProgress();
    for (const [key, rect] of Object.entries(layout)) {
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
        // 没进度时"继续游戏"是置灰状态，不响应点击
        if (key === 'continue' && !hasProgress) return;
        this.pressedKey = key;
        return;
      }
    }
  }

  handleTouchEnd(e) {
    if (!this.loaded) return;
    const touch = e.changedTouches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    const layout = this.getLayout();
    const key = this.pressedKey;
    this.pressedKey = null;
    if (!key) return;
    if (key === 'continue' && !this.hasProgress()) return;
    const rect = layout[key];
    if (!rect) return;
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
      this.onButtonClick(key);
    }
  }

  onButtonClick(key) {
    switch (key) {
      case 'start':
        if (this.onStart) this.onStart();
        break;
      case 'continue':
        if (this.onContinue) this.onContinue();
        break;
      case 'pushBox':
        if (this.onPushBox) this.onPushBox();
        break;
      case 'skin':
        if (this.onSkin) this.onSkin();
        break;
    }
  }

  drawBackground() {
    drawCoverImage(ctx, this.images.bg, SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  drawImageBtn(imgKey, layoutKey, layout) {
    const rect = layout[layoutKey];
    if (!rect) return;

    // 继续游戏按钮在无进度时使用专门的置灰素材；置灰按钮不响应按下缩放
    const grayed = layoutKey === 'continue' && !this.hasProgress();
    const img = grayed
      ? (this.images.continueBtnAsh || this.images[imgKey])
      : this.images[imgKey];
    if (!img) return;

    ctx.save();
    if (!grayed && this.pressedKey === layoutKey) {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(0.95, 0.95);
      ctx.translate(-cx, -cy);
    }
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }

  update() {}

  render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 背景优先渲染：bg 一就绪就显示，不等其他图标（drawCoverImage 内部对 null 图片做了兜底）
    this.drawBackground();

    // 关键按钮需要图片尺寸来计算布局，且事件绑定在 loaded=true 之后才生效；
    // loaded=false 时仅展示背景占位，避免黑屏；通常此情况极短暂（缓存命中时为 0 帧）
    if (!this.loaded) return;

    const layout = this.getLayout();
    this.drawImageBtn('startBtn', 'start', layout);
    this.drawImageBtn('continueBtn', 'continue', layout);
    // 底部入口（后台加载，到位后自动出现）
    this.drawImageBtn('pushBox', 'pushBox', layout);
    this.drawImageBtn('skin', 'skin', layout);
  }
}
