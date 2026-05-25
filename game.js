import Main from './js/main';

// —— 开启转发 / 分享能力 ——
wx.showShareMenu({
  withShareTicket: true,
  menus: ['shareAppMessage', 'shareTimeline'],
});

wx.onShareAppMessage(() => ({
  title: '方块归位 — 快来挑战吧！',
  // imageUrl: 'images/share_cover.png', // 如有分享封面图可取消注释
}));

// 分享到朋友圈（部分 Android 客户端支持）
wx.onShareTimeline && wx.onShareTimeline(() => ({
  title: '方块归位 — 快来挑战吧！',
}));

new Main();
