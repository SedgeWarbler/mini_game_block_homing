import { SCREEN_WIDTH, SCREEN_HEIGHT, img, loadImg } from '../render';

// 导出供 LoadingScene 统一预加载使用
export const HOME_IMAGE_PATHS = {
  bg: img('images/home/background.png'),
  startBtn: img('images/home/start_game.png'),
  continueBtn: img('images/home/continue_game.png'),
  continueBtnAsh: img('images/home/continue_game_ash.png'),
};

const ctx = canvas.getContext('2d');

/**
 * 首页场景
 */
export default class HomeScene {
  images = {};
  loaded = false;
  pressedKey = null;

  constructor(onStart, onContinue) {
    this.onStart = onStart;
    this.onContinue = onContinue;
    // 进入 HomeScene 之前 LoadingScene 已经把这 4 张图下完并写入 loadImg 缓存，
    // 这里 loadResources 实际上是同步命中缓存、当帧 resolve。
    this.loadResources().then(() => {
      this.loaded = true;
      this.bindEvents();
    });
  }

  loadResources() {
    return Promise.all(
      Object.entries(HOME_IMAGE_PATHS).map(([key, src]) =>
        loadImg(src).then((image) => {
          if (image) this.images[key] = image; // 加载失败时跳过，让 drawXxx 走"图缺失"分支
        })
      )
    );
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

  /**
   * 首页是否已经存在可继续的关卡进度。
   * 无进度 → "继续游戏"按钮置灰、不响应点击；
   * 有进度 → "继续游戏"在上方放大，"开始游戏"缩到下方。
   */
  hasProgress() {
    return !!(GameGlobal.databus && GameGlobal.databus.hasProgress);
  }

  getLayout() {
    const layout = {};
    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    const hasProgress = this.hasProgress();

    if (hasProgress) {
      // 已有进度：继续游戏（突出）在上，开始游戏（缩小）在下
      if (this.images.continueBtn) {
        const btnW = w * 0.65;
        const btnH = btnW * (this.images.continueBtn.height / this.images.continueBtn.width);
        layout.continue = {
          x: (w - btnW) / 2,
          y: h * 0.65,
          w: btnW,
          h: btnH,
        };
      }
      if (this.images.startBtn) {
        const btnW = w * 0.50; // 缩小
        const btnH = btnW * (this.images.startBtn.height / this.images.startBtn.width);
        layout.start = {
          x: (w - btnW) / 2,
          y: h * 0.78,
          w: btnW,
          h: btnH,
        };
      }
    } else {
      // 首次进入：开始游戏在上，继续游戏在下（置灰）
      if (this.images.startBtn) {
        const btnW = w * 0.65;
        const btnH = btnW * (this.images.startBtn.height / this.images.startBtn.width);
        layout.start = {
          x: (w - btnW) / 2,
          y: h * 0.64,
          w: btnW,
          h: btnH,
        };
      }
      // 置灰用 continueBtnAsh 素材的实际比例，避免跟普通版尺寸略有差异时被拉伸
      const ashImg = this.images.continueBtnAsh || this.images.continueBtn;
      if (ashImg) {
        const btnW = w * 0.65;
        const btnH = btnW * (ashImg.height / ashImg.width);
        layout.continue = {
          x: (w - btnW) / 2,
          y: h * 0.76,
          w: btnW,
          h: btnH,
        };
      }
    }

    return layout;
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
    }
  }

  drawBackground() {
    const img = this.images.bg;
    if (!img) return;
    const imgRatio = img.width / img.height;
    const screenRatio = SCREEN_WIDTH / SCREEN_HEIGHT;
    let dw, dh, dx, dy;
    if (imgRatio > screenRatio) {
      dh = SCREEN_HEIGHT;
      dw = dh * imgRatio;
      dx = (SCREEN_WIDTH - dw) / 2;
      dy = 0;
    } else {
      dw = SCREEN_WIDTH;
      dh = dw / imgRatio;
      dx = 0;
      dy = (SCREEN_HEIGHT - dh) / 2;
    }
    ctx.drawImage(img, dx, dy, dw, dh);
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
    if (!this.loaded) return; // LoadingScene 已确保资源就绪，这里几乎不会命中
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.drawBackground();
    const layout = this.getLayout();
    this.drawImageBtn('startBtn', 'start', layout);
    this.drawImageBtn('continueBtn', 'continue', layout);
  }
}
