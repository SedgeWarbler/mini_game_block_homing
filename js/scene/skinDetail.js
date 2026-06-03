import { SCREEN_WIDTH, SCREEN_HEIGHT, DPR, img, loadImg, inRect, drawCoverImage, LAYOUT_WIDTH, LAYOUT_OFFSET_X } from '../render';

const ctx = canvas.getContext('2d');

/**
 * 通用皮肤详情场景
 *
 * 接受配置对象：
 *   - title:           标题文字（如 "方块皮肤"）
 *   - skinType:        'block' | 'stone' | 'portal' | 'grid'
 *   - maxSelected:     最大可选皮肤数（方块 7，传送门 2，石块/网格 1）
 *   - defaultUnlocked: 默认解锁的皮肤 ID 列表
 *   - skins:           [{ id, file }]  皮肤列表
 *   - imgPath(s):      返回皮肤图路径的函数
 */
export function buildSkinDetailPaths(config) {
  const paths = {
    homeBg: img('images/home/background.png'),
    panelBg: img('images/skin/background.png'),
    returnBtn: img('images/game/return.png'),
    loadBearing: img('images/skin/load_bearing.png'),
    useBtn: img('images/skin/use_button.png'),
    inUseBtn: img('images/skin/in_use_button.png'),
    notUnlockedBtn: img('images/skin/click_to_unlock.png'),
    lockIcon: img('images/skin/lock.png'),
    inUseLabel: img('images/skin/in_use.png'),
  };
  config.skins.forEach((s) => {
    paths[`skin_${s.id}`] = img(config.imgPath(s));
  });
  return paths;
}

export default class SkinDetailScene {
  images = {};
  loaded = false;
  pressedKey = null;
  scrollY = 0;
  scrollVelocity = 0;
  maxScrollY = 0;
  _isDragging = false;
  _dragStartY = 0;
  _dragLastY = 0;
  _dragStartScroll = 0;
  /** 替换模式：待加入的皮肤 ID（非 null 时进入替换模式） */
  _replacePendingSkinId = null;

  /**
   * @param {Object} config  { title, skinType, maxSelected, defaultUnlocked, skins, imgPath }
   * @param {Function} onBack 返回回调
   */
  constructor(config, onBack) {
    this.config = config;
    this.onBack = onBack;

    // 从 DataBus 读取当前已保存的选中皮肤
    const db = GameGlobal.databus;
    const currentSelected = db ? db.getSelectedSkins(config.skinType) : (config.defaultUnlocked || []);
    this.pendingSelected = new Set(currentSelected);

    // 构建排序后的皮肤列表
    this._sortedSkins = this._buildSortedSkins();

    const paths = buildSkinDetailPaths(config);
    Promise.all(
      Object.entries(paths).map(([key, src]) =>
        loadImg(src).then((image) => {
          if (image) this.images[key] = image;
        })
      )
    ).then(() => {
      this.loaded = true;
      this._calcContentHeight();
      this.bindEvents();
    });
  }

  bindEvents() {
    this._touchStart = this.handleTouchStart.bind(this);
    this._touchMove = this.handleTouchMove.bind(this);
    this._touchEnd = this.handleTouchEnd.bind(this);
    this._touchCancel = () => { this.pressedKey = null; this._isDragging = false; };
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

  /* ---------- 布局 ---------- */

  _getLayoutConsts() {
    const w = SCREEN_WIDTH;
    const h = SCREEN_HEIGHT;
    const lw = LAYOUT_WIDTH;
    const ox = LAYOUT_OFFSET_X;
    const panelMarginX = lw * 0.04 + ox;
    const panelTop = h * 0.03;
    const panelW = w - panelMarginX * 2;
    const panelH = h * 0.88;
    const contentPadTop = panelH * 0.19;
    const contentPadBottom = panelH * 0.05;
    const contentPadX = panelW * 0.04;

    const cols = 3;
    const gridW = panelW - contentPadX * 2;
    const cellGap = gridW * 0.04;
    const cellW = (gridW - cellGap * (cols - 1)) / cols;
    const lbImg = this.images.loadBearing;
    const cellH = lbImg ? cellW * (lbImg.height / lbImg.width) * 0.85 : cellW * 1.2;

    const btnImg = this.images.useBtn;
    const statusBtnW = cellW * 0.78;
    const statusBtnH = btnImg ? statusBtnW * (btnImg.height / btnImg.width) : statusBtnW * 0.32;

    const rowGap = cellH * 0.08;
    const rowH = cellH + rowGap;

    // 返回按钮（与游戏场景一致）
    const topH = h * 0.085;
    const topIconH = topH * 0.58;
    const iconCenterY = topH * 0.78;
    const sideMargin = lw * 0.04;
    const retImg = this.images.returnBtn;
    const retBtnW = retImg ? topIconH * (retImg.width / retImg.height) : topIconH;
    const retBtnH = topIconH;
    const retX = ox + sideMargin;
    const retY = iconCenterY - topIconH / 2;

    const scrollAreaTop = panelTop + contentPadTop;
    const scrollAreaBottom = panelTop + panelH - contentPadBottom;
    const scrollAreaH = scrollAreaBottom - scrollAreaTop;

    return {
      w, h, panelMarginX, panelTop, panelW, panelH,
      contentPadTop, contentPadBottom, contentPadX,
      cols, gridW, cellGap, cellW, cellH,
      statusBtnW, statusBtnH, rowGap, rowH,
      retBtnH, retBtnW, retX, retY,
      scrollAreaTop, scrollAreaBottom, scrollAreaH,
    };
  }

  _calcContentHeight() {
    const c = this._getLayoutConsts();
    const totalRows = Math.ceil(this._sortedSkins.length / c.cols);
    const gridTopMargin = c.cellH * 0.12;
    const contentH = gridTopMargin + totalRows * c.rowH - c.rowGap;
    this.maxScrollY = Math.max(0, contentH - c.scrollAreaH);
  }

  _getItemRect(index) {
    const c = this._getLayoutConsts();
    const col = index % c.cols;
    const row = Math.floor(index / c.cols);
    const gridStartX = c.panelMarginX + c.contentPadX;
    const x = gridStartX + col * (c.cellW + c.cellGap);
    const gridTopMargin = c.cellH * 0.12;
    const y = c.scrollAreaTop + gridTopMargin + row * c.rowH - this.scrollY;
    const btnY = y + c.cellH * 0.83 - c.statusBtnH / 2;
    return {
      cardX: x, cardY: y, cardW: c.cellW, cardH: c.cellH,
      btnX: x + (c.cellW - c.statusBtnW) / 2,
      btnY: btnY, btnW: c.statusBtnW, btnH: c.statusBtnH,
    };
  }

  /* ---------- 触摸 ---------- */


  handleTouchStart(e) {
    if (!this.loaded) return;
    const touch = e.touches[0];
    const x = touch.clientX, y = touch.clientY;
    const c = this._getLayoutConsts();
    this.pressedKey = null;
    this._isDragging = false;
    this._dragStartY = y;
    this._dragLastY = y;
    this._dragStartScroll = this.scrollY;
    this.scrollVelocity = 0;

    if (inRect(x, y, { x: c.retX, y: c.retY, w: c.retBtnW, h: c.retBtnH })) { this.pressedKey = 'return'; return; }
  }

  handleTouchMove(e) {
    if (!this.loaded) return;
    const y = e.touches[0].clientY;
    const dy = y - this._dragStartY;
    if (!this._isDragging && Math.abs(dy) > 6) { this._isDragging = true; this.pressedKey = null; }
    if (this._isDragging) {
      this.scrollVelocity = this._dragLastY - y;
      this._dragLastY = y;
      this.scrollY = this._dragStartScroll - dy;
      this._clampScroll();
    }
  }

  handleTouchEnd(e) {
    if (!this.loaded) return;
    const touch = e.changedTouches[0];
    const x = touch.clientX, y = touch.clientY;
    const c = this._getLayoutConsts();

    if (this._isDragging) { this._isDragging = false; return; }
    const key = this.pressedKey;
    this.pressedKey = null;

    if (key === 'return') {
      if (inRect(x, y, { x: c.retX, y: c.retY, w: c.retBtnW, h: c.retBtnH }) && this.onBack) this.onBack();
      return;
    }

    const skins = this._sortedSkins;
    for (let i = 0; i < skins.length; i++) {
      const skin = skins[i];
      const r = this._getItemRect(i);
      if (inRect(x, y, { x: r.cardX, y: r.cardY, w: r.cardW, h: r.cardH })) {
        if (r.cardY + r.cardH > c.scrollAreaTop && r.cardY < c.scrollAreaBottom) {
          this._handleSkinTap(skin.id);
        }
        return;
      }
    }
  }

  /* ---------- 皮肤交互逻辑 ---------- */

  _isSkinUnlocked(skinId) {
    const db = GameGlobal.databus;
    if (!db) {
      const defaults = this.config.defaultUnlocked || [];
      return defaults.includes(skinId);
    }
    return db.isSkinUnlocked(this.config.skinType, skinId);
  }

  /**
   * 点击皮肤卡片的核心逻辑
   *
   * 1. 未解锁 → 弹窗确认解锁（分享/广告）
   * 2. 替换模式 → 点已选皮肤完成替换 / 点其他取消
   * 3. 已选中 → 取消选中（单选模式不允许取消）
   * 4. 未选中 → 选中 / 满额触发替换模式 / 单选自动替换
   */
  _handleSkinTap(skinId) {
    const unlocked = this._isSkinUnlocked(skinId);

    // 未解锁 → 弹窗确认
    if (!unlocked) {
      this._showUnlockDialog(skinId);
      return;
    }

    // 替换模式中
    if (this._replacePendingSkinId) {
      if (this.pendingSelected.has(skinId)) {
        // 点击已选皮肤 → 执行替换
        this.pendingSelected.delete(skinId);
        this.pendingSelected.add(this._replacePendingSkinId);
        this._replacePendingSkinId = null;
        this._autoSave();
      } else {
        // 点击其他 → 取消替换模式
        this._replacePendingSkinId = null;
      }
      return;
    }

    // 已选中 → 取消选中
    if (this.pendingSelected.has(skinId)) {
      if (this.config.maxSelected === 1) return; // 单选不允许取消
      this.pendingSelected.delete(skinId);
      this._autoSave();
      return;
    }

    // 未选中 → 尝试选中
    if (this.pendingSelected.size >= this.config.maxSelected) {
      if (this.config.maxSelected === 1) {
        // 单选模式：自动替换
        this.pendingSelected.clear();
        this.pendingSelected.add(skinId);
        this._autoSave();
      } else {
        // 多选模式：进入替换模式
        this._replacePendingSkinId = skinId;
        wx.showToast({ title: '请点击要替换的皮肤', icon: 'none', duration: 1500 });
      }
    } else {
      this.pendingSelected.add(skinId);
      this._autoSave();
    }
  }

  /* ---------- 解锁流程 ---------- */

  _showUnlockDialog(skinId) {
    const isAd = !!GameGlobal.trafficMasterEnabled;
    wx.showModal({
      title: '解锁皮肤',
      content: isAd ? '观看广告即可解锁该皮肤' : '分享给好友即可解锁该皮肤',
      confirmText: isAd ? '观看广告' : '分享解锁',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          if (isAd) {
            this._doAdUnlock(skinId);
          } else {
            this._doShareUnlock(skinId);
          }
        }
      },
    });
  }

  _doShareUnlock(skinId) {
    wx.shareAppMessage({ title: '方块归位 — 快来挑战吧！' });
    // 微信平台限制无法确认分享是否成功，行业惯例：调用即视为完成
    this._performUnlock(skinId);
  }

  _doAdUnlock(skinId) {
    const ad = GameGlobal.rewardedVideoAd;
    if (!ad) {
      wx.showToast({ title: '广告加载失败', icon: 'none' });
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
        this._performUnlock(skinId);
      } else {
        wx.showToast({ title: '需要看完广告才能解锁', icon: 'none' });
      }
    };
    ad.onClose(onClose);
  }

  _performUnlock(skinId) {
    const db = GameGlobal.databus;
    if (db) db.unlockSkin(this.config.skinType, skinId);
    // 解锁后重新排序皮肤列表
    this._sortedSkins = this._buildSortedSkins();
    this._calcContentHeight();
    wx.showToast({ title: '解锁成功！', icon: 'success', duration: 1500 });
  }

  /* ---------- 自动保存 & 排序 ---------- */

  /** 选中状态变更后立即保存到 DataBus */
  _autoSave() {
    const db = GameGlobal.databus;
    if (db) db.setSelectedSkins(this.config.skinType, [...this.pendingSelected]);
    // 选中状态变化后重新排序
    this._sortedSkins = this._buildSortedSkins();
    this._calcContentHeight();
  }

  /**
   * 构建排序后的皮肤列表：
   *   1. 使用中 — 自定义皮肤优先，默认皮肤其次
   *   2. 已解锁但未使用
   *   3. 未解锁
   */
  _buildSortedSkins() {
    const defaults = new Set(this.config.defaultUnlocked || []);
    return this.config.skins.slice().sort((a, b) => {
      const aInUse = this.pendingSelected.has(a.id) ? 1 : 0;
      const bInUse = this.pendingSelected.has(b.id) ? 1 : 0;
      if (aInUse !== bInUse) return bInUse - aInUse; // 使用中排前面

      const aUnlocked = this._isSkinUnlocked(a.id) ? 1 : 0;
      const bUnlocked = this._isSkinUnlocked(b.id) ? 1 : 0;
      if (aUnlocked !== bUnlocked) return bUnlocked - aUnlocked; // 已解锁排前面

      // 同为使用中：自定义皮肤排前面
      if (aInUse && bInUse) {
        const aCustom = defaults.has(a.id) ? 0 : 1;
        const bCustom = defaults.has(b.id) ? 0 : 1;
        if (aCustom !== bCustom) return bCustom - aCustom;
      }

      return 0; // 保持原始顺序
    });
  }

  _clampScroll() {
    if (this.scrollY < 0) this.scrollY = 0;
    if (this.scrollY > this.maxScrollY) this.scrollY = this.maxScrollY;
  }

  /* ---------- 更新 & 渲染 ---------- */

  update() {
    if (!this._isDragging && Math.abs(this.scrollVelocity) > 0.3) {
      this.scrollY += this.scrollVelocity;
      this.scrollVelocity *= 0.92;
      this._clampScroll();
      if (this.scrollY <= 0 || this.scrollY >= this.maxScrollY) this.scrollVelocity = 0;
    } else {
      this.scrollVelocity = 0;
    }
  }

  render() {
    if (!this.loaded) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this._drawBlurBg();
    this._drawPanel();
    this._drawScrollContent();
  }

  _drawBlurBg() {
    const bgImg = this.images.homeBg;
    if (!bgImg) { ctx.fillStyle = '#A6D8FF'; ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT); return; }
    ctx.save();
    try { ctx.filter = `blur(${Math.round(6 * DPR)}px)`; } catch (_) {}
    drawCoverImage(ctx, bgImg, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.restore();
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT); ctx.restore();
  }

  _drawPanel() {
    const c = this._getLayoutConsts();
    const panel = this.images.panelBg;
    if (panel) ctx.drawImage(panel, c.panelMarginX, c.panelTop, c.panelW, c.panelH);

    // 返回按钮
    const retImg = this.images.returnBtn;
    if (retImg) {
      ctx.save();
      if (this.pressedKey === 'return') {
        const cx = c.retX + c.retBtnW / 2, cy = c.retY + c.retBtnH / 2;
        ctx.translate(cx, cy); ctx.scale(0.9, 0.9); ctx.translate(-cx, -cy);
      }
      ctx.drawImage(retImg, c.retX, c.retY, c.retBtnW, c.retBtnH);
      ctx.restore();
    }

    // 标题文字
    const titleFontSize = c.panelW * 0.09;
    const titleY = c.panelTop + c.panelH * 0.12;
    const titleX = c.w / 2;
    ctx.save();
    ctx.font = `bold ${titleFontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#4A2000';
    ctx.lineWidth = titleFontSize * 0.22;
    ctx.strokeText(this.config.title, titleX, titleY + 2);
    ctx.strokeStyle = '#D4920A';
    ctx.lineWidth = titleFontSize * 0.12;
    ctx.strokeText(this.config.title, titleX, titleY);
    const grad = ctx.createLinearGradient(titleX - titleFontSize, titleY - titleFontSize * 0.5, titleX + titleFontSize, titleY + titleFontSize * 0.5);
    grad.addColorStop(0, '#FFFDE0');
    grad.addColorStop(0.5, '#FFD54F');
    grad.addColorStop(1, '#FFFDE0');
    ctx.fillStyle = grad;
    ctx.fillText(this.config.title, titleX, titleY);
    ctx.restore();
  }

  _drawScrollContent() {
    const c = this._getLayoutConsts();
    ctx.save();
    const clipInset = c.panelW * 0.02;
    ctx.beginPath();
    ctx.rect(c.panelMarginX + clipInset, c.scrollAreaTop, c.panelW - clipInset * 2, c.scrollAreaH);
    ctx.clip();

    const skins = this._sortedSkins;
    for (let i = 0; i < skins.length; i++) {
      const skin = skins[i];
      const r = this._getItemRect(i);
      if (r.cardY + r.cardH < c.scrollAreaTop) continue;
      if (r.cardY > c.scrollAreaBottom) continue;
      this._drawSkinCard(skin, r);
    }
    ctx.restore();
  }

  _drawSkinCard(skin, r) {
    const unlocked = this._isSkinUnlocked(skin.id);
    const isInUse = this.pendingSelected.has(skin.id);
    const isReplacePending = this._replacePendingSkinId === skin.id;
    const isReplaceTarget = !!this._replacePendingSkinId && isInUse;

    // 卡片背景（含高亮效果）
    const lbImg = this.images.loadBearing;
    if (lbImg) {
      ctx.save();
      if (isReplacePending) {
        // 替换模式：待加入的皮肤 — 绿色高亮
        ctx.shadowColor = '#4CAF50';
        ctx.shadowBlur = 14;
      } else if (isReplaceTarget) {
        // 替换模式：已选皮肤 — 脉冲闪烁提示"点我替换"
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);
        ctx.shadowColor = `rgba(255, 107, 107, ${pulse})`;
        ctx.shadowBlur = 12;
      } else if (isInUse) {
        // 正常选中 — 金色高亮
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 12;
      }
      ctx.drawImage(lbImg, r.cardX, r.cardY, r.cardW, r.cardH);
      ctx.restore();
    }

    // 皮肤图片
    const skinImg = this.images[`skin_${skin.id}`];
    if (skinImg) {
      const imgAreaH = r.cardH * 0.65;
      const imgPad = r.cardW * 0.10;
      const imgSize = Math.min(r.cardW - imgPad * 2, imgAreaH - imgPad * 0.5);
      const imgX = r.cardX + (r.cardW - imgSize) / 2;
      const imgY = r.cardY + (imgAreaH - imgSize) / 2 + r.cardH * 0.03;
      ctx.save();
      if (!unlocked) ctx.globalAlpha = 0.5;
      ctx.drawImage(skinImg, imgX, imgY, imgSize, imgSize);
      ctx.restore();
    }

    // 锁定图标
    if (!unlocked) {
      const lockImg = this.images.lockIcon;
      if (lockImg) {
        const lockSize = r.cardW * 0.25;
        ctx.drawImage(lockImg, r.cardX + (r.cardW - lockSize) / 2, r.cardY + r.cardH * 0.05, lockSize, lockSize);
      }
    }

    // "使用中" 标签
    if (isInUse) {
      const inUseImg = this.images.inUseLabel;
      if (inUseImg) {
        const labelW = r.cardW * 0.52;
        const labelH = labelW * (inUseImg.height / inUseImg.width);
        ctx.drawImage(inUseImg, r.cardX - labelW * 0.05, r.cardY - labelH * 0.15, labelW, labelH);
      }
    }

    // 底部按钮
    let btnImg;
    if (isInUse) btnImg = this.images.inUseBtn;
    else if (unlocked) btnImg = this.images.useBtn;
    else btnImg = this.images.notUnlockedBtn;
    if (btnImg) ctx.drawImage(btnImg, r.btnX, r.btnY, r.btnW, r.btnH);
  }


}
