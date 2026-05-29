import DataBus from './databus';
import LoadingScene from './scene/loading';
import HomeScene from './scene/home';
import GameScene from './scene/game';
import SkinScene from './scene/skin';
import BlockSkinScene from './scene/blockSkin';
import StoneSkinScene from './scene/stoneSkin';
import PortalSkinScene from './scene/portalSkin';
import GridSkinScene from './scene/gridSkin';
import preloader from './game/levelPreloader';

/**
 * 游戏主入口 / 场景管理器
 *
 * 启动顺序：loading → home → game
 *   - LoadingScene 负责把首页 + 游戏 + 弹窗的全部资源图都下完，全部就绪才切到 home，
 *     避免之前"home 黑屏 / 进入游戏卡顿"的体验。
 *   - HomeScene 之后的资源访问都走 loadImg 缓存，几乎零等待。
 */
export default class Main {
  currentScene = null;
  databus = new DataBus();

  constructor() {
    GameGlobal.databus = this.databus;

    // ---- 流量主 & 激励视频广告 ----
    // 将此标志设为 true 以启用广告复活 / 广告撤回功能
    GameGlobal.trafficMasterEnabled = false;
    GameGlobal.rewardedVideoAd = null;

    if (GameGlobal.trafficMasterEnabled && wx.createRewardedVideoAd) {
      GameGlobal.rewardedVideoAd = wx.createRewardedVideoAd({
        adUnitId: 'your-ad-unit-id', // 替换为实际广告位 ID
      });
      // 预加载广告
      GameGlobal.rewardedVideoAd.load().catch(() => {});
    }

    // 启动时就把"玩家下一步要进的那一关"排进后台预生成队列，
    // 这样从首页点击"继续游戏"通常已经是缓存命中，无需 loading。
    preloader.prefetch(this.databus.currentLevel);

    // 入口固定走 loading 场景 —— 加载完成后内部回调切到 home
    this.switchScene('loading');

    this._loop = this.loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /**
   * 切换场景
   * @param {string} name 'loading' | 'home' | 'game' | 'skin' | 'blockSkin' | 'stoneSkin' | 'portalSkin' | 'gridSkin'
   * @param {Object} [data] 场景间传递的数据
   */
  switchScene(name, data) {
    if (this.currentScene && this.currentScene.destroy) {
      this.currentScene.destroy();
    }

    switch (name) {
      case 'loading':
        this.currentScene = new LoadingScene(() => this.switchScene('home'));
        break;

      case 'home':
        this.currentScene = new HomeScene(
          () => this._handleStartGame(),
          () => this._handleContinueGame(),
          {
            onPushBox: () => this._handleEntryClick('推箱子'),
            onSkin: () => this.switchScene('skin'),
            onSpecialMode: () => this._handleEntryClick('特殊模式'),
          }
        );
        break;

      case 'game':
        this.currentScene = new GameScene(
          // 通关 → 直接进入下一关。GameScene 内部已经在赢得弹窗触发时
          // 把 databus.currentLevel 推进到下一关并预取，这里仅负责跳场景。
          () => this.switchScene('game', { level: this.databus.currentLevel }),
          // 返回首页
          () => this.switchScene('home'),
          data
        );
        break;

      case 'skin':
        this.currentScene = new SkinScene(
          () => this.switchScene('home'),
          (skinType) => this.switchScene(skinType)
        );
        break;

      case 'blockSkin':
        this.currentScene = new BlockSkinScene(
          () => this.switchScene('skin')
        );
        break;

      case 'stoneSkin':
        this.currentScene = new StoneSkinScene(
          () => this.switchScene('skin')
        );
        break;

      case 'portalSkin':
        this.currentScene = new PortalSkinScene(
          () => this.switchScene('skin')
        );
        break;

      case 'gridSkin':
        this.currentScene = new GridSkinScene(
          () => this.switchScene('skin')
        );
        break;
    }
  }

  /**
   * 首页"开始游戏"按钮：
   *   - 没进度：标记 hasProgress=true，currentLevel=1，直接进入第一关；
   *   - 已有进度：弹原生确认框，提示玩家会清空进度从第 1 关重新开始，确认后才执行重置。
   */
  _handleStartGame() {
    const doStart = () => {
      this.databus.currentLevel = 1;
      if (this.databus.maxLevel < 1) this.databus.maxLevel = 1;
      this.databus.hasProgress = true;
      this.databus.shareResurrectionLeft = 3;
      this.databus.adResurrectionUsedThisLevel = false;
      preloader.prefetch(1);
      this.switchScene('game', { level: 1 });
    };

    if (this.databus.hasProgress) {
      wx.showModal({
        title: '重新开始',
        content: '将清空当前进度，从第 1 关重新开始。是否继续？',
        confirmText: '重新开始',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            // 完全重置：进度清零 + 关卡内容缓存清空，下一轮拿到全新关卡
            preloader.clear();
            this.databus.resetProgress();
            doStart();
          }
        },
      });
    } else {
      doStart();
    }
  }

  /**
   * 首页"继续游戏"按钮：直接进入 currentLevel。
   * （HomeScene 侧已经保证无进度时不会触发到这里。）
   */
  _handleContinueGame() {
    if (!this.databus.hasProgress) return;
    this.switchScene('game', { level: this.databus.currentLevel });
  }

  /**
   * 底部入口按钮点击（推箱子 / 皮肤 / 特殊模式）。
   * 目前为占位提示，后续可替换为真实的场景跳转。
   */
  _handleEntryClick(name) {
    wx.showToast({ title: `${name} 即将开放`, icon: 'none', duration: 1500 });
  }

  loop() {
    const scene = this.currentScene;
    if (scene) {
      if (scene.update) scene.update();
      if (scene.render) scene.render();
    }
    requestAnimationFrame(this._loop);
  }
}
