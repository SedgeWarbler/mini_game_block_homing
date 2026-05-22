GameGlobal.canvas = wx.createCanvas();

const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();

canvas.width = windowInfo.screenWidth;
canvas.height = windowInfo.screenHeight;

export const SCREEN_WIDTH = windowInfo.screenWidth;
export const SCREEN_HEIGHT = windowInfo.screenHeight;

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

export function loadImg(src) {
  const cached = _imgCache.get(src);
  if (cached) return cached.promise;

  const image = wx.createImage();
  const entry = {
    image,
    promise: new Promise((resolve) => {
      image.onload = () => resolve(image);
      image.onerror = () => {
        console.warn('图片加载失败', src);
        _imgCache.delete(src); // 删缓存让下次有机会重试，不让坏图永远占位
        resolve(null);
      };
      image.src = src;
    }),
  };
  _imgCache.set(src, entry);
  return entry.promise;
}