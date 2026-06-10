import { SCREEN_WIDTH, SCREEN_HEIGHT, DPR, img, loadImg, inRect, drawCoverImage, LAYOUT_WIDTH, LAYOUT_OFFSET_X } from '../render';

// 导出供 LoadingScene 统一预加载使用
export const SKIN_IMAGE_PATHS = {
  bg: img('images/home/background.png'),      // 复用首页背景
  logo: img('images/skin/logo.png'),           // "皮肤分类"标题
  enter: img('images/skin/enter.png'),         // "进入"按钮
  block: img('images/skin/block.png'),         // 方块皮肤卡片
  stone: img('images/skin/stone.png'),         // 石头皮肤卡片
  portal: img('images/skin/portald.png'),      // 传送门皮肤卡片
  grid: img('images/skin/grid.png'),           // 网格皮肤卡片
  returnBtn: img('images/game/return.png'),    // 返回按钮（复用游戏场景的）
};

const ctx = canvas.getContext('2d');

/**
 * 皮肤分类选择场景
 *
 * 按设计稿：
 *   - 顶部 "皮肤分类" logo
 *   - 左上角返回按钮
 *   - 右上角金币显示（12,345 + "+"）
 *   - 4 张卡片 2×2 网格排列，每张卡片底部一个 "进入" 按钮
 *   - 背景复用首页背景
 */
export default class SkinScene {
  images = {};
  loaded = false;
  pressedKey = null;

  // 卡片悬浮动画
  _cardAnimT = 0;

  constructor(onBack, onEnterCategory) {
    this.onBack = onBack;
    this.onEnterCategory = onEnterCategory;
    this.loadResources().then(() => {
      this.loaded = true;
      this.bindEvents();
    });
  }

  loadResources() {
    return Promise.all(
      Object.entries(SKIN_IMAGE_PATHS).map(([key, src]) =>
        loadImg(src).then((image) => {
          if (image) this.images[key] = image;
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
    if (this._touchStart) wx.offTouchStart(this._touchStart);
    if (this._touchEnd) wx.offTouchEnd(this._touchEnd);
    if (this._touchCancel) wx.offTouchCancel(this._touchCancel);
  }

  /* ---------- 布局计算 ---------- */

  getLayout() {
    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    const lw = LAYOUT_WIDTH;
    const ox = LAYOUT_OFFSET_X;
    const layout = {};

    // 返回按钮 — 左上角（与游戏场景一致）
    const topH = h * 0.085;
    const topIconH = topH * 0.58;
    const iconCenterY = topH * 0.78;
    if (this.images.returnBtn) {
      const ratio = this.images.returnBtn.width / this.images.returnBtn.height;
      const btnW = topIconH * ratio;
      layout.returnBtn = {
        x: ox + lw * 0.04,
        y: iconCenterY - topIconH / 2,
        w: btnW,
        h: topIconH,
      };
    }

    // Logo "皮肤分类" — 顶部居中，向下偏移
    if (this.images.logo) {
      const logoW = lw * 0.60;
      const logoH = logoW * (this.images.logo.height / this.images.logo.width);
      layout.logo = {
        x: ox + (lw - logoW) / 2,
        y: h * 0.08,
        w: logoW,
        h: logoH,
      };
    }

    // 4 张卡片 — 2×2 网格布局
    const cards = [
      { key: 'block', imgKey: 'block' },
      { key: 'stone', imgKey: 'stone' },
      { key: 'portal', imgKey: 'portal' },
      { key: 'grid', imgKey: 'grid' },
    ];

    const cardGap = lw * 0.025;           // 卡片间距
    const sideMargin = lw * 0.025;        // 左右留白
    const cardW = (lw - sideMargin * 2 - cardGap) / 2; // 两列
    const cardStartY = h * 0.20;         // 卡片区起始 Y（logo 下方留空）

    // "进入" 按钮 — 放大尺寸
    const enterW = cardW * 0.66;
    const enterH = this.images.enter
      ? enterW * (this.images.enter.height / this.images.enter.width)
      : enterW * 0.33;

    // 取第一张卡片的宽高比作为参考（所有卡片比例基本一致）
    const refImg = this.images.block || this.images.stone;
    const cardH = refImg ? cardW * (refImg.height / refImg.width) : cardW * 1.35;

    // 行高 = 卡片高 + 行间距（按钮完全在卡片内部，不额外占高度）
    const rowH = cardH + cardGap;

    cards.forEach((card, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const imgRef = this.images[card.imgKey];
      const thisCardH = imgRef ? cardW * (imgRef.height / imgRef.width) : cardH;
      const x = ox + sideMargin + col * (cardW + cardGap);
      const y = cardStartY + row * rowH;
      layout[card.key] = { x, y, w: cardW, h: thisCardH };
    });

    // "进入" 按钮 — 完全在卡片内部，位于卡片底部区域
    cards.forEach((card) => {
      const cardRect = layout[card.key];
      if (cardRect) {
        const btnY = cardRect.y + cardRect.h * 0.83 - enterH / 2;
        layout[`enter_${card.key}`] = {
          x: cardRect.x + (cardRect.w - enterW) / 2,
          y: btnY,
          w: enterW,
          h: enterH,
        };
      }
    });

    return layout;
  }

  /* ---------- 触摸处理 ---------- */


  handleTouchStart(e) {
    if (!this.loaded) return;
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    const layout = this.getLayout();

    // 检测返回按钮
    if (layout.returnBtn && inRect(x, y, layout.returnBtn)) {
      this.pressedKey = 'returnBtn';
      return;
    }

    // 检测各 "进入" 按钮 或 卡片区域
    const cardKeys = ['block', 'stone', 'portal', 'grid'];
    for (const key of cardKeys) {
      const enterKey = `enter_${key}`;
      if (layout[enterKey] && inRect(x, y, layout[enterKey])) {
        this.pressedKey = enterKey;
        return;
      }
      // 整张卡片也可点击
      if (layout[key] && inRect(x, y, layout[key])) {
        this.pressedKey = enterKey; // 统一映射到 enter_xxx
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

    if (key === 'returnBtn') {
      const rect = layout.returnBtn;
      if (rect && inRect(x, y, rect) && this.onBack) {
        this.onBack();
      }
      return;
    }

    // "进入" 按钮 / 卡片点击 — 检查手指是否仍在卡片或按钮区域内
    if (key.startsWith('enter_')) {
      const skinName = key.replace('enter_', '');
      const enterRect = layout[key];
      const cardRect = layout[skinName];
      const inEnter = enterRect && inRect(x, y, enterRect);
      const inCard = cardRect && inRect(x, y, cardRect);
      if (!inEnter && !inCard) return;

      // 所有分类均可进入详情页
      const sceneMap = {
        block: 'blockSkin',
        stone: 'stoneSkin',
        portal: 'portalSkin',
        grid: 'gridSkin',
      };
      if (sceneMap[skinName] && this.onEnterCategory) {
        this.onEnterCategory(sceneMap[skinName]);
      }
    }
  }

  /* ---------- 渲染 ---------- */

  update() {
    this._cardAnimT += 0.02;
  }

  render() {
    if (!this.loaded) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.drawBackground();

    const layout = this.getLayout();

    // 返回按钮
    this.drawImageBtn('returnBtn', 'returnBtn', layout);

    // Logo
    this.drawImage('logo', layout);

    // 4 张卡片 + "进入" 按钮
    const cardKeys = ['block', 'stone', 'portal', 'grid'];
    cardKeys.forEach((key, i) => {
      this.drawCard(key, layout, i);
      this.drawEnterBtn(key, layout);
    });
  }

  drawBackground() {
    const bgImg = this.images.bg;
    if (!bgImg) {
      const grd = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
      grd.addColorStop(0, '#7EC8E3');
      grd.addColorStop(1, '#A8E6CF');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
      return;
    }

    // 模糊背景
    ctx.save();
    try { ctx.filter = `blur(${Math.round(6 * DPR)}px)`; } catch (_) { /* 低版本不支持 filter */ }
    drawCoverImage(ctx, bgImg, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.restore();

    // 半透明遮罩增强模糊/磨砂质感
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.restore();
  }

  drawImage(key, layout) {
    const rect = layout[key];
    const image = this.images[key];
    if (!rect || !image) return;
    ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
  }

  drawImageBtn(imgKey, layoutKey, layout) {
    const rect = layout[layoutKey];
    const image = this.images[imgKey];
    if (!rect || !image) return;
    ctx.save();
    if (this.pressedKey === layoutKey) {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(0.92, 0.92);
      ctx.translate(-cx, -cy);
    }
    ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }

  /**
   * 绘制卡片：带微小浮动动画 + 按下缩放
   */
  drawCard(key, layout, index) {
    const rect = layout[key];
    const image = this.images[key];
    if (!rect || !image) return;

    ctx.save();

    // 微浮动：每张卡片有不同的相位偏移
    const floatOffset = Math.sin(this._cardAnimT + index * 1.2) * 1.5;

    // 按下时缩放
    const enterKey = `enter_${key}`;
    if (this.pressedKey === enterKey) {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2 + floatOffset;
      ctx.translate(cx, cy);
      ctx.scale(0.96, 0.96);
      ctx.translate(-cx, -cy);
    }

    ctx.drawImage(image, rect.x, rect.y + floatOffset, rect.w, rect.h);
    ctx.restore();
  }

  /**
   * 绘制 "进入" 按钮
   */
  drawEnterBtn(cardKey, layout) {
    const enterKey = `enter_${cardKey}`;
    const rect = layout[enterKey];
    const image = this.images.enter;
    if (!rect || !image) return;

    ctx.save();
    if (this.pressedKey === enterKey) {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      ctx.translate(cx, cy);
      ctx.scale(0.92, 0.92);
      ctx.translate(-cx, -cy);
    }
    ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }
}
