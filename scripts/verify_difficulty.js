/**
 * 验证关卡难度曲线的数值输出
 * 运行: node scripts/verify_difficulty.js
 */

// 从 levelGenerator.js 复制核心函数用于验证

function getConfig(level) {
  let rows, cols, blockCount, stoneCount, portalPairs;

  if (level <= 2) {
    rows = 6; cols = 5;
    blockCount = level;
    stoneCount = level + 1;
    portalPairs = 0;
  } else if (level <= 4) {
    rows = 7; cols = 6;
    blockCount = 2 + (level >= 4 ? 1 : 0);
    stoneCount = 3 + level - 3;
    portalPairs = level >= 4 ? 1 : 0;
  } else if (level <= 7) {
    rows = 7; cols = 6;
    blockCount = 3;
    stoneCount = 4 + Math.floor((level - 5) / 2);
    portalPairs = 1 + (level >= 7 ? 1 : 0);
  } else if (level <= 10) {
    rows = 7; cols = 7;
    blockCount = 3 + (level >= 9 ? 1 : 0);
    stoneCount = 5 + Math.floor((level - 8) / 2);
    portalPairs = 2;
  } else if (level <= 15) {
    rows = 8; cols = 7;
    blockCount = 4;
    stoneCount = 6 + Math.floor((level - 11) / 2);
    portalPairs = 2;
  } else if (level <= 20) {
    rows = 8; cols = 8;
    blockCount = 4 + (level >= 17 ? 1 : 0);
    stoneCount = 6 + Math.floor((level - 16) / 2);
    portalPairs = 2;
  } else if (level <= 30) {
    rows = 9; cols = 8 + (level >= 26 ? 1 : 0);
    blockCount = 5;
    stoneCount = 5 + Math.floor((level - 21) / 3);
    portalPairs = 2;
  } else if (level <= 45) {
    rows = 9 + (level >= 38 ? 1 : 0);
    cols = 9;
    blockCount = 5 + (level >= 35 ? 1 : 0);
    stoneCount = 7 + Math.floor((level - 31) / 4);
    portalPairs = 2;
  } else if (level <= 60) {
    rows = 10; cols = 10;
    blockCount = 6 + (level >= 52 ? 1 : 0);
    stoneCount = 9 + Math.floor((level - 46) / 4);
    portalPairs = 2;
  } else if (level <= 80) {
    rows = 11; cols = 11;
    blockCount = 6 + (level >= 70 ? 1 : 0);
    stoneCount = Math.min(14, 10 + Math.floor((level - 61) / 5));
    portalPairs = 2;
  } else {
    rows = 12; cols = 12;
    blockCount = 7;
    stoneCount = Math.min(16, 12 + Math.floor((level - 81) / 6));
    portalPairs = 2;
  }

  blockCount = Math.min(blockCount, 7);
  const maxPortalPairs = rows >= 7 ? 2 : rows >= 6 ? 1 : 0;
  portalPairs = Math.min(portalPairs, maxPortalPairs);

  const perBlock = level < 10 ? 7 + Math.floor(level / 12)
                              : 9 + Math.floor(level / 8);
  const levelBonus = level < 10 ? Math.min(12 + Math.floor(level / 2), 45)
                                : Math.min(18 + Math.floor(level / 1.5), 55);
  const reverseMoves = blockCount * perBlock + levelBonus;

  return { rows, cols, blockCount, stoneCount, portalPairs, reverseMoves };
}

function getMinStepsFloor(level, blockCount) {
  if (level <= 2) return blockCount;
  if (level <= 5) return blockCount + 2;
  if (level <= 9) return blockCount + 4;

  let hardFloor;
  if (level <= 12) hardFloor = 3;
  else if (level <= 16) hardFloor = 5;
  else if (level <= 20) hardFloor = 7;
  else if (level <= 25) hardFloor = 9;
  else if (level <= 30) hardFloor = 11;
  else if (level <= 40) hardFloor = 13;
  else if (level <= 50) hardFloor = 15;
  else if (level <= 60) hardFloor = 17;
  else if (level <= 80) hardFloor = 19;
  else hardFloor = 21;

  return Math.max(hardFloor, blockCount + 2);
}

function computeSteps(level, minSteps) {
  let bufferRatio, bufferMin;
  if (level <= 3) { bufferRatio = 0.60; bufferMin = 3; }
  else if (level <= 7) { bufferRatio = 0.40; bufferMin = 3; }
  else if (level <= 12) { bufferRatio = 0.30; bufferMin = 2; }
  else if (level <= 20) { bufferRatio = 0.22; bufferMin = 2; }
  else if (level <= 30) { bufferRatio = 0.18; bufferMin = 2; }
  else { bufferRatio = 0.12; bufferMin = 1; }
  return minSteps + Math.max(bufferMin, Math.ceil(minSteps * bufferRatio));
}

// 输出验证表
console.log('关卡 | 棋盘   | 方块 | 石块 | 传送门 | 反向步数 | 最少BFS步数 | 玩家步数(按最少) ');
console.log('-----|--------|------|------|--------|---------|------------|----------------');

const levels = [1, 2, 3, 5, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90];

for (const lv of levels) {
  const cfg = getConfig(lv);
  const minSteps = getMinStepsFloor(lv, cfg.blockCount);
  const playerSteps = computeSteps(lv, minSteps);
  console.log(
    `${String(lv).padStart(4)} | ${cfg.rows}×${String(cfg.cols).padEnd(4)} | ${String(cfg.blockCount).padStart(4)} | ${String(cfg.stoneCount).padStart(4)} | ${String(cfg.portalPairs).padStart(6)} | ${String(cfg.reverseMoves).padStart(7)} | ${String(minSteps).padStart(10)} | ${String(playerSteps).padStart(14)}`
  );
}
