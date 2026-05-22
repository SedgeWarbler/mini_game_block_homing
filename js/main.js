import DataBus from './databus';
import LoadingScene from './scene/loading';
import HomeScene from './scene/home';
import GameScene from './scene/game';
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
   * @param {string} name 'loading' | 'home' | 'game'
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
          () => this._handleContinueGame()
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

  loop() {
    const scene = this.currentScene;
    if (scene) {
      if (scene.update) scene.update();
      if (scene.render) scene.render();
    }
    requestAnimationFrame(this._loop);
  }
}
