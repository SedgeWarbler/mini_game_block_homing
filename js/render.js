GameGlobal.canvas = wx.createCanvas();

const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();

/**
 * 设备像素比（高清屏适配）。
 * canvas 物理尺寸 = 逻辑尺寸 × DPR，绘图坐标通过 ctx.scale(DPR, DPR) 保持逻辑坐标不变。
 *
 * 性能优化：将 DPR 限制在 2，避免高端手机（DPR=3）渲染 9× 像素量导致卡顿。
 * 视觉质量几乎不受影响（2× 已经非常清晰），但帧率提升明显。
 */
export const DPR = Math.min(windowInfo.pixelRatio || wx.getSystemInfoSync().pixelRatio || 2, 2);

canvas.width = windowInfo.screenWidth * DPR;
canvas.height = windowInfo.screenHeight * DPR;

export const SCREEN_WIDTH = windowInfo.screenWidth;
export const SCREEN_HEIGHT = windowInfo.screenHeight;

/**
 * 屏幕宽高比 & 宽屏适配。
 *
 * 手机竖屏比例约 0.45~0.52，较宽手机约 0.54~0.56，
 * iPad 约 0.75，Windows 微信窗口约 0.56~0.6，Windows 横屏 ≥1.0。
 *
 * IS_WIDE_SCREEN 为 true 时，用 LAYOUT_WIDTH 约束 UI 布局宽度，
 * 让内容区域保持竖屏手机比例，居中显示在屏幕中央。
 * 背景图和 clearRect 仍然使用 SCREEN_WIDTH / SCREEN_HEIGHT 铺满全屏。
 */
export const ASPECT_RATIO = SCREEN_WIDTH / SCREEN_HEIGHT;
export const IS_WIDE_SCREEN = ASPECT_RATIO > 0.57;
export const LAYOUT_WIDTH = IS_WIDE_SCREEN
  ? Math.min(SCREEN_WIDTH, SCREEN_HEIGHT * 0.48)
  : SCREEN_WIDTH;
export const LAYOUT_OFFSET_X = (SCREEN_WIDTH - LAYOUT_WIDTH) / 2;

// 调试：启动时输出屏幕适配参数，方便在开发者工具中排查
console.log(`[屏幕适配] ${SCREEN_WIDTH}×${SCREEN_HEIGHT} ratio=${ASPECT_RATIO.toFixed(3)} wide=${IS_WIDE_SCREEN} layoutW=${LAYOUT_WIDTH.toFixed(0)} offsetX=${LAYOUT_OFFSET_X.toFixed(0)}`);

/**
 * 图片资源 CDN 前缀。所有 `images/...` 路径都通过 `img(rel)` 包一层后再传给
 * `wx.createImage().src`。需要回退到本地资源时只把这里改成 '' 即可，调用方不动。
 *
 * 注意：微信小游戏从 CDN 加载图片，必须在「微信公众平台 → 开发管理 → 服务器域名」
 * 的 downloadFile 白名单里加上 `https://oss.wechat.axionterra.top`，否则会被拦截。
 */
export const IMAGE_BASE = 'https://oss.wechat.axionterra.top/block_homing/';

export function img(rel) {
  return IMAGE_BASE + rel;
}

/**
 * 全局图片缓存：
 *   - 同一个 URL 永远只会创建一个 Image 实例，跨场景复用。
 *   - 调用 `loadImg(url)` 返回 Promise<Image | null>：成功 → Image 实例，失败 → null。
 *     **永远不会 reject**，让上层 Promise.all 不被单点失败拖垮。
 *   - 失败时把缓存清掉，后续再调可以触发重试（例如临时网络抖动一次后能恢复）。
 *
 * 用法约定：调用方都用 `if (image) this.images[key] = image;` 这种判空写法，
 * 把"坏图"挡在场景外，避免后续 drawImage 报 broken state。
 */
const _imgCache = new Map();

/**
 * 单图加载超时（毫秒）。超时后 resolve(null)，计入进度，不再阻塞整体加载条。
 * 图片仍在后台继续下载；下次调用 loadImg 时若已缓存则正常命中。
 *
 * 从 8000ms 降为 6000ms：让超时更快触发，首页进度条不再因个别慢图长时间卡住；
 * 缓存已清除后 loadImg 会在下一次调用时重试，通常网络恢复后能快速补全。
 */
const IMG_LOAD_TIMEOUT_MS = 6000;

export function loadImg(src) {
  const cached = _imgCache.get(src);
  if (cached) return cached.promise;

  const image = wx.createImage();
  const entry = {
    image,
    promise: new Promise((resolve) => {
      let settled = false;
      const settle = (val) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };

      // 超时保护：单张图超过 IMG_LOAD_TIMEOUT_MS 仍未加载，视为跳过
      const timer = setTimeout(() => {
        console.warn('图片加载超时，跳过', src);
        _imgCache.delete(src); // 允许后续重试
        settle(null);
      }, IMG_LOAD_TIMEOUT_MS);

      image.onload = () => {
        clearTimeout(timer);
        settle(image);
      };
      image.onerror = () => {
        clearTimeout(timer);
        console.warn('图片加载失败', src);
        _imgCache.delete(src); // 删缓存让下次有机会重试，不让坏图永远占位
        settle(null);
      };
      image.src = src;
    }),
  };
  _imgCache.set(src, entry);
  return entry.promise;
}

/* ---------- 公用工具函数 ---------- */

/**
 * 缓动函数：easeOutCubic，移动末尾减速。
 * 在 game.js / pushBox.js / sokobanBoard.js 中共用。
 */
export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * 判断点 (x, y) 是否在矩形 { x, y, w, h } 内。
 * 在所有场景的触摸处理中共用。
 */
export function inRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * 将图片以 cover 模式铺满指定区域（不留黑边），居中裁切。
 * 在 game / home / pushBox / skin 等场景的 drawBackground 中共用。
 */
export function drawCoverImage(ctx, image, w, h) {
  if (!image) return;
  const ratio = image.width / image.height;
  const sr = w / h;
  let dw, dh, dx, dy;
  if (ratio > sr) {
    dh = h;
    dw = dh * ratio;
    dx = (w - dw) / 2;
    dy = 0;
  } else {
    dw = w;
    dh = dw / ratio;
    dx = 0;
    dy = (h - dh) / 2;
  }
  ctx.drawImage(image, dx, dy, dw, dh);
}