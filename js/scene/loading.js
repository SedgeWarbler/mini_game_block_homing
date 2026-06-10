import { SCREEN_WIDTH, SCREEN_HEIGHT, DPR, img, loadImg, LAYOUT_WIDTH } from '../render';
import { buildGameSceneCorePaths, buildGameSceneDeferredPaths } from './game';
import { HOME_IMAGE_PATHS } from './home';
import { SKIN_IMAGE_PATHS } from './skin';
import { buildBlockSkinPaths } from './blockSkin';
import { buildStoneSkinPaths } from './stoneSkin';
import { buildPortalSkinPaths } from './portalSkin';
import { buildGridSkinPaths } from './gridSkin';
import { buildPushBoxPaths } from './pushBox';

const ctx = canvas.getContext('2d');

/**
 * 加载场景自己需要的素材：背景设计图 + 进度条边框 + 进度条填充。
 *
 * 注意：背景图 `background.png` 直接走本地相对路径，与小程序包一起发布 ——
 * 首次冷启动不需要等 OSS 网络回包就能立刻渲染出设计画面，杜绝"纯色占位帧"。
 * 进度条的两张小图体积小且非关键，继续走 OSS 即可。
 */
const LOADING_IMAGE_PATHS = {
  bg: 'images/loading/background.png',
  grid: 'images/loading/load_grid.png',
  bar: 'images/loading/progress_bar.png',
};

/**
 * 加载场景
 *
 * 流程：
 *   1. 启动后先并行下载加载场景自身的 3 张素材（背景 + 进度条框 + 填充），
 *      期间画面是纯色占位，避免黑屏。
 *   2. 自身素材就绪 → 渲染设计稿，并并行预下首页 + 游戏核心资源，
 *      按"已加载数 / 总数"推进进度条；同时后台下载延迟资源（不阻塞进度条）。
 *   3. 核心资源就绪且进度条平滑追上 100% → 触发 onComplete 回调切到首页。
 *
 * 进度条策略：
 *   - 显示进度从 0% 自然起步，前期有一个"假进度"匀速推进营造加载感。
 *   - 每帧用缓动逼近真实进度与假进度的较大值，让进度条平滑推进。
 *   - 真实 100% 后再用稍快的速率冲到 100%，给"加载完成"一个清晰的视觉收尾。
 */
export default class LoadingScene {
  images = {};
  progress = 0;           // 真实加载进度 0..1
  displayProgress = 0;    // 渲染用的平滑进度，从 0 开始
  _fakeProgress = 0;      // 假进度：模拟加载感，匀速推进到 ~80%
  _completed = false;
  _startTime = Date.now(); // 记录开始时间，用于超时兜底

  constructor(onComplete) {
    this.onComplete = onComplete;

    // 加载场景自己的 3 张素材：bg 走本地（几乎同步就绪），grid/bar 走 OSS。
    // 不再 "全部就绪才渲染"：每张图加载完即写入 this.images，render 时自带 Canvas 兜底，
    // 这样本地 bg 一好就能立刻显示设计画面，避免出现纯色等待帧。
    Object.entries(LOADING_IMAGE_PATHS).forEach(([key, src]) => {
      loadImg(src).then((image) => {
        if (image) this.images[key] = image;
      });
    });

    // 与上面同帧并行：把首页 + 游戏所有资源也排进 loadImg 队列
    this._startPreloadAll();
  }

  /**
   * 阶段 2：并行预下首页 + 游戏资源。
   *
   * 图片分级加载：
   *   - P0+P1（核心）：首页素材 + 游戏棋盘/方块/洞/石块/UI，进度条追踪这部分。
   *   - P2（延迟）：传送门帧动画、通关/失败/传送门提示/玩法提示弹窗素材，
   *     后台火并遗忘式下载，不阻塞进度条。首次触发弹窗时 loadImg 缓存通常已命中。
   *
   * 利用 loadImg 的全局缓存：home/game 场景之后调 loadResources 时会直接命中，
   * 几乎零等待。
   */
  _startPreloadAll() {
    // P0+P1: 首页 + 游戏核心 — 进度条追踪
    // 首页图片优先放在队列最前面，确保切换到首页时已全部命中缓存。
    // SKIN_IMAGE_PATHS 移至延迟加载：仅在进入皮肤场景时需要，不阻塞首页。
    const coreUrls = [
      ...Object.values(HOME_IMAGE_PATHS),          // P0: 首页素材（最优先）
      ...Object.values(buildGameSceneCorePaths()),  // P1: 游戏核心棋盘/方块/UI
    ];
    const total = coreUrls.length;
    if (total === 0) {
      this.progress = 1;
      return;
    }

    let done = 0;
    for (const src of coreUrls) {
      loadImg(src).then(() => {
        done++;
        this.progress = done / total;
      });
    }

    // P2: 延迟资源 — 火并遗忘式后台下载，不影响进度条
    // 包含：皮肤场景卡片图、传送门帧动画、通关/失败/弹窗素材、各皮肤详情图
    const deferredUrls = [
      ...Object.values(SKIN_IMAGE_PATHS),           // 皮肤分类选择场景（进入时才需要）
      ...Object.values(buildGameSceneDeferredPaths()),
      ...Object.values(buildBlockSkinPaths()),
      ...Object.values(buildStoneSkinPaths()),
      ...Object.values(buildPortalSkinPaths()),
      ...Object.values(buildGridSkinPaths()),
      ...Object.values(buildPushBoxPaths()),
    ];
    for (const src of deferredUrls) {
      loadImg(src); // 不 .then，不计入 progress
    }
  }

  destroy() {
    // 加载场景没有触摸交互，无需解绑
  }

  /** 加载场景始终需要全速渲染（进度条持续动画）*/
  isAnimating() {
    return !this._completed;
  }

  update() {
    // 假进度：从 0 匀速推进，前期快、中期渐慢，最终停在 ~80%，
    // 留出 80%~100% 的区间跟随真实下载进度，减少"卡住"感。
    if (this._fakeProgress < 0.8) {
      // 前 60% 快推，60%~80% 减速，模拟大文件加载的自然节奏
      const speed = this._fakeProgress < 0.6 ? 0.008 : 0.002;
      this._fakeProgress = Math.min(0.8, this._fakeProgress + speed);
    }

    // 超时兜底：如果总加载时间超过 10 秒，直接把真实进度拉满，不再等待慢速/失败资源。
    // （loadImg 本身有 6 秒单图超时，两层保护确保不会无限等待。）
    const elapsed = Date.now() - this._startTime;
    if (elapsed > 10000 && this.progress < 1) {
      this.progress = 1;
    }

    // 目标进度 = 假进度 与 真实进度 取较大值
    const target = Math.max(this._fakeProgress, this.progress);
    if (this.displayProgress < target) {
      // 距离 target 越近滚动越慢，但保证最小步进，防止"卡进度"
      const delta = Math.max(0.003, (target - this.displayProgress) * 0.08);
      this.displayProgress = Math.min(target, this.displayProgress + delta);
    }

    // 真实加载完成 + 显示进度也涨到 100% → 退场
    if (!this._completed && this.progress >= 1 && this.displayProgress >= 0.999) {
      this._completed = true;
      // 给"100%"留一点视觉停留时间再切首页
      setTimeout(() => {
        if (this.onComplete) this.onComplete();
      }, 250);
    }
  }

  render() {
    // 不再等"自身 3 张全部就绪"：drawBackground / drawProgressBar 都自带 Canvas 兜底，
    // 哪张图先到先用，缺失部分用纯色 / 圆角矩形顶上，画面始终在动，永远不黑屏。
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this._drawBackground();
    this._drawProgressBar();
  }

  /**
   * 设计稿背景图铺满整屏（cover-fit），不留黑边。
   * 素材缺失时画纯色背景兜底，不让画面黑屏或报错。
   */
  _drawBackground() {
    const bg = this.images.bg;
    if (!bg) {
      ctx.fillStyle = '#A6D8FF';
      ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
      return;
    }
    const imgRatio = bg.width / bg.height;
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
    ctx.drawImage(bg, dx, dy, dw, dh);
  }

  /**
   * 进度条画法：
   *   load_grid.png  —— 整张木牌（含底部静态文字"优先加载主要资源中，请稍候..."）
   *   progress_bar.png —— 独立的绿色圆角进度条，叠在木牌顶部
   *
   * 设计稿里绿条是"骑"在木牌顶端的：约一半在木牌上方、一半压在木牌上半部，
   * 木牌下半部留给静态文字。所以这里把它们当作两层独立元素来画，而不是"框 + 内嵌"。
   *
   * 微调参数（界面对不齐时只动这几个）：
   *   plaqueW                 木牌相对屏幕宽度比例
   *   plaqueCyOnScreen        木牌纵向中心在屏幕上的比例位置
   *   barWidthRatio           绿条宽 / 木牌宽
   *   barHeightRatio          绿条高 / 木牌高（无 bar 图时回退用）
   *   barCenterOffsetRatio    绿条中心 = 木牌顶 + 木牌高 × 这个值
   *                              0.0  → 绿条中心正好在木牌顶沿（一半在外、一半在牌上）
   *                              0.2  → 中心略陷入木牌（约 30% 上方 / 70% 牌上）
   *                              0.5  → 中心在木牌正中
   *                              负值 → 整个绿条在木牌上方
   */
  _drawProgressBar() {
    const grid = this.images.grid;
    const fill = this.images.bar;

    // ===== 1. 木牌 =====
    const plaqueW = LAYOUT_WIDTH * 0.84;
    const plaqueH = grid ? plaqueW * (grid.height / grid.width) : SCREEN_WIDTH * 0.16;
    const plaqueX = (SCREEN_WIDTH - plaqueW) / 2;
    const plaqueY = SCREEN_HEIGHT * 0.85 - plaqueH / 2;

    if (grid) {
      ctx.drawImage(grid, plaqueX, plaqueY, plaqueW, plaqueH);
    } else {
      const r = plaqueH / 4;
      ctx.save();
      ctx.fillStyle = '#5D4400';
      this._roundRect(plaqueX, plaqueY, plaqueW, plaqueH, r);
      ctx.fill();
      ctx.fillStyle = '#C99A4F';
      this._roundRect(plaqueX + 4, plaqueY + 4, plaqueW - 8, plaqueH - 8, r - 2);
      ctx.fill();
      ctx.restore();
    }

    // ===== 2. 绿色进度条 ── 骑在木牌顶端 =====
    const barWidthRatio = 0.78;
    const barHeightRatio = fill ? (fill.height / fill.width) : 0.55; // 优先用素材自身比例
    const barCenterOffsetRatio = 0.55; // 进度条中心居中于木牌凹槽

    const barW = plaqueW * barWidthRatio;
    const barH = fill ? barW * (fill.height / fill.width) : plaqueH * barHeightRatio;
    const barX = (SCREEN_WIDTH - barW) / 2;
    const barY = plaqueY + plaqueH * barCenterOffsetRatio - barH / 2;

    const fillW = barW * this.displayProgress;
    if (fillW > 0) {
      if (fill) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(barX, barY, fillW, barH);
        ctx.clip();
        ctx.drawImage(fill, barX, barY, barW, barH);
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = '#7BC960';
        this._roundRect(barX, barY, fillW, barH, barH / 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // ===== 3. 百分比文字 ── 暖金黄字 + 深棕粗描边 =====
    const percent = Math.floor(this.displayProgress * 100);
    const fs = Math.max(11, Math.floor(barH * 0.55));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${fs}px sans-serif`;
    const cx = barX + barW / 2;
    const cy = barY + barH / 2;
    const text = `资源加载中 ${percent}%`;
    ctx.strokeStyle = '#7A3B12';
    ctx.lineWidth = Math.max(2, fs * 0.18);
    ctx.lineJoin = 'round';
    ctx.strokeText(text, cx, cy);
    ctx.fillStyle = '#FFE15D';
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  _roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }
}
