/**
 * 关卡生成器 — 反向生成 + BFS 正向验证
 *
 * 设计要点：
 * 1. 初始放置时严格保证「同一坐标只能存在一种道具」：
 *    - 先放洞，再放传送门，再放石块，全部依赖 randomEmptyPos 仅选空格。
 *    - 方块的初始坐标位于洞内（inHole=true），通过「反向移动」滑出。反向滑动
 *      在传送门/石块/洞/其他方块前停下，因此方块最终不会与任何道具或其他方块同坐标。
 * 2. 反向滑动语义与正向滑动「形状一致」：路径中遇到传送门即停止（不穿越），
 *    避免生成出依赖传送门连续滑动的反向轨迹（这种轨迹在正向游戏中可能形成
 *    传送门死循环导致无解）。
 * 3. 最终用与 board.js 完全一致的 BFS 求解器验证可解性，包括对传送门死循环
 *    的判定 —— 凡是会触发死循环的移动都被 simMove 视为非法，因此被求解器
 *    判定为可解的关卡，必定可以在真实游戏中按步数完成。
 * 4. 求解后用 solveWithPath 拿到最优路径，回放路径识别"被实际穿越"的传送门，
 *    把摆设型传送门从最终关卡中剔除 —— 即"用到几个显示几个"。
 * 5. 支持同色多块：从中等关卡开始，单一颜色可以出现多个方块 + 多个同色洞，
 *    任何同色块进入任何同色洞均算到位，BFS 通过状态规范化避免 n! 倍状态爆炸。
 */

import { solve, solveAsync, solveWithPath, solveWithPathAsync, tracePortalsForMoves, maybeYield, simulateMove, getPortalPairMap } from './solver.js';

const COLORS = ['black', 'blue', 'green', 'pink', 'purple', 'red', 'yellow'];
const PORTAL_COLORS = ['blue', 'purple'];
const DIRS = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};
const DIR_NAMES = ['up', 'down', 'left', 'right'];

/**
 * 根据关卡号获取难度配置
 *
 * - rows/cols：棋盘行列，越后期越大（最大 12×12）
 * - blockCount：方块总数（上限 7，对应 7 种颜色，每色唯一）
 * - stoneCount：石块数量
 * - portalPairs：生成阶段最多放置的传送门对数（最终只保留解法实际用到的对数）
 */
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
  } else if (level <= 29) {
    rows = 9; cols = 8 + (level >= 26 ? 1 : 0);
    blockCount = 5;
    stoneCount = 5 + Math.floor((level - 21) / 3);
    portalPairs = 2;
  } else if (level <= 39) {
    rows = 10; cols = 9;
    blockCount = 6;
    stoneCount = 6 + Math.floor((level - 30) / 3);
    portalPairs = 2;
  } else if (level <= 55) {
    rows = 10 + (level >= 48 ? 1 : 0);
    cols = 10;
    blockCount = 7;
    stoneCount = 8 + Math.floor((level - 40) / 4);
    portalPairs = 2;
  } else if (level <= 80) {
    rows = 11; cols = 11;
    blockCount = 7;
    stoneCount = Math.min(14, 10 + Math.floor((level - 56) / 5));
    portalPairs = 2;
  } else {
    rows = 12; cols = 12;
    blockCount = 7;
    stoneCount = Math.min(16, 12 + Math.floor((level - 81) / 6));
    portalPairs = 2;
  }

  // 方块数上限 7（对应 7 种颜色，不允许同色）
  blockCount = Math.min(blockCount, 7);

  // 放宽传送门上限：7行以上棋盘允许 2 对，6行允许 1 对
  const maxPortalPairs = rows >= 7 ? 2 : rows >= 6 ? 1 : 0;
  portalPairs = Math.min(portalPairs, maxPortalPairs);

  // 反向构造步数：第10关起显著增加，BFS 压缩后仍能留下足够多最优步数
  const perBlock = level < 10 ? 7 + Math.floor(level / 12)
                              : 10 + Math.floor(level / 6);
  const levelBonus = level < 10 ? Math.min(12 + Math.floor(level / 2), 45)
                                : Math.min(22 + Math.floor(level / 1.2), 65);
  const reverseMoves = blockCount * perBlock + levelBonus;
  // 第10关起传送门是必须使用的机制，标记 _portalRequired 阻止重试时减少传送门
  const _portalRequired = level >= 10;
  return { rows, cols, blockCount, stoneCount, portalPairs, reverseMoves, _portalRequired };
}

/**
 * 随尝试次数微调配置：逐步加大反向步数、必要时减少传送门对数（避免摆设传送门）。
 */
function buildAttemptConfig(baseConfig, attemptIndex) {
  const reverseBoost = Math.floor(attemptIndex / 35) * 15;
  // _portalRequired 时不减少传送门对数（传送门是必要通关机制）
  const portalReduce = baseConfig._portalRequired
    ? 0
    : Math.floor(attemptIndex / 70);
  return {
    ...baseConfig,
    reverseMoves: baseConfig.reverseMoves + reverseBoost,
    portalPairs: Math.max(0, baseConfig.portalPairs - portalReduce),
  };
}

/**
 * 关卡最少步数下限 — BFS 求解器算出的最优解必须 >= 这个值，否则关卡过于平凡，舍弃。
 * 这是保证"挑战性"的关键约束：反向构造可能产生彼此抵消的轨迹，BFS 会压缩到很短的最优解，
 * 单纯增加 reverseMoves 没用，必须在这里直接卡死。
 *
 * 后期数值平衡：BFS 受 maxStates 限制，实测在 5-6 方块的高难关卡上，可被验证的
 * minSteps 上限大约在 22-28（depend on grid 与方块数）。把下限定在这个区间，让生成
 * 既具挑战性又不会频繁触发"未完美达标"的兜底分支。
 */
function getMinStepsFloor(level, blockCount) {
  // 第 1-9 关：基于方块数的柔性下限（入门过渡期）
  if (level <= 2) return blockCount;
  if (level <= 5) return blockCount + 2;
  if (level <= 9) return blockCount + 4;

  // 第 10 关起：硬性最少步数下限，3 → 5 → 7 → … 越来越难
  // 同时保证 >= blockCount + 2 避免多方块关卡退化
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

/**
 * 每个方块在反向构造中至少要移动多少次 — 防止个别方块"原地未动"导致解法只剩 1-2 步。
 *
 * 这是 SOFT 阈值（数值低）：在密集障碍下让所有方块都移动 3+ 次很难，会让候选生成
 * 失败率飙升。真正的难度由 BFS minSteps 卡死，这里仅保证个别方块不要"完全没移动"
 * 即可。
 */
function getMinMovesPerBlock(level) {
  if (level <= 2) return 1;
  if (level <= 9) return 2;
  if (level <= 19) return 2;
  if (level <= 34) return 3;
  if (level <= 49) return 4;
  return 5;
}

/**
 * 每个方块的起始位置必须距离任意同色洞至少 N 格（曼哈顿）。
 * 防止生成出"方块就在洞口旁边、一步入洞"的廉价关卡。
 *
 * 注意：这里是"最近的同色洞"的距离 —— 同色多块时任意洞都可接收。
 *
 * 这个值是「预筛」指标，不需要太严苛；真正的难度由 BFS minStepsFloor 卡死。
 * 它仅用于在跑 BFS 之前刷掉那些一眼就能看出方块紧贴洞口的廉价候选。
 */
function getMinHoleDistance(level) {
  if (level <= 5) return 1;
  if (level <= 9) return 2;
  if (level <= 19) return 3;
  if (level <= 34) return 4;
  if (level <= 59) return 5;
  return 6;
}

/**
 * 整局所有方块到最近同色洞的曼哈顿距离总和的下限 —— 防止整体太"凑近"。
 * 这是一个比 minStepsFloor 廉价得多的预筛指标，能在跑 BFS 之前刷掉一大批
 * 注定无聊的候选，大幅加快关卡生成。
 */
function getTotalDistanceFloor(level, blockCount) {
  const perBlock = getMinHoleDistance(level);
  let bonus;
  if (level <= 10) bonus = 0;
  else if (level <= 19) bonus = 2;
  else if (level <= 30) bonus = 3;
  else if (level <= 45) bonus = 5;
  else if (level <= 60) bonus = 7;
  else bonus = 9;
  return blockCount * perBlock + bonus;
}

/**
 * 把"最少步数"换算成给玩家的实际步数 = minSteps + 缓冲。
 *
 * 缓冲档位按关卡梯度递减，但整体偏宽松：玩家允许走错一两步并通过撤回纠正，
 * 而不是逼着每一步都最优。前期更宽，后期收紧但仍留出试错空间。
 */
function computeSteps(level, minSteps) {
  let bufferRatio;
  let bufferMin;
  if (level <= 3) {
    bufferRatio = 0.60;
    bufferMin = 3;
  } else if (level <= 7) {
    bufferRatio = 0.40;
    bufferMin = 3;
  } else if (level <= 12) {
    bufferRatio = 0.30;
    bufferMin = 2;
  } else if (level <= 20) {
    bufferRatio = 0.22;
    bufferMin = 2;
  } else if (level <= 30) {
    bufferRatio = 0.18;
    bufferMin = 2;
  } else {
    bufferRatio = 0.12;
    bufferMin = 1;
  }
  return minSteps + Math.max(bufferMin, Math.ceil(minSteps * bufferRatio));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomEmptyPos(rows, cols, grid, blocks) {
  const isOccupiedByBlock = (r, c) =>
    !!(blocks && blocks.some((b) => !b.inHole && b.row === r && b.col === c));

  for (let attempt = 0; attempt < 300; attempt++) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    if (!grid[r][c] && !isOccupiedByBlock(r, c)) return { r, c };
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!grid[r][c] && !isOccupiedByBlock(r, c)) return { r, c };
    }
  }
  return null;
}

function cloneGrid(grid) {
  return grid.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

/**
 * 返回去掉所有传送门的副本网格（传送门格变成空地），用于验证传送门是否被最优解真正使用。
 * 若去掉传送门后仍能用同样少（或更少）的步数通关，说明传送门只是摆设，应当舍弃这个候选关卡。
 */
function gridWithoutPortals(grid) {
  return grid.map((row) =>
    row.map((cell) => (cell && cell.type === 'portal' ? null : cell))
  );
}

/**
 * 验证传送门是否为通关必须：去掉所有传送门后重新跑 BFS，
 * 如果无传送门版本不可解，则传送门是必须的。
 */
function isPortalNecessary(candidate, maxDepth, maxStates) {
  if (!candidate.portals || candidate.portals.length === 0) return false;
  const noPortalGrid = gridWithoutPortals(candidate.grid);
  const result = solve(
    candidate.rows, candidate.cols,
    noPortalGrid, candidate.blocks,
    maxDepth, maxStates
  );
  // 无传送门版本不可解（或超状态上限），说明传送门是必须的
  return !result.solvable;
}

/**
 * 异步版 isPortalNecessary：用 solveAsync 替代 solve，避免阻塞主线程。
 */
async function isPortalNecessaryAsync(candidate, maxDepth, maxStates) {
  if (!candidate.portals || candidate.portals.length === 0) return false;
  const noPortalGrid = gridWithoutPortals(candidate.grid);
  const result = await solveAsync(
    candidate.rows, candidate.cols,
    noPortalGrid, candidate.blocks,
    maxDepth, maxStates
  );
  return !result.solvable;
}

/**
 * 仅去掉指定坐标 key 集合中的传送门。用于"按使用情况精确剔除"——
 * 把没被解法使用的整对传送门变成空地，让最终关卡显示的传送门数量
 * 与玩家实际需要使用的数量一致。
 */
function gridWithPortalsRemoved(grid, keysToRemove) {
  if (!keysToRemove || keysToRemove.size === 0) return grid.map((row) => row.slice());
  return grid.map((row, r) =>
    row.map((cell, c) => {
      if (cell && cell.type === 'portal' && keysToRemove.has(`${r},${c}`)) return null;
      return cell;
    })
  );
}

/**
 * 反向滑动一步（不消耗传送门），用于由「方块在洞中」的终局状态向初始状态反向构造。
 *
 * - 校验：当前位置 + forwardDir 必须有合法 stopper（墙/石块/异色洞/其他方块），
 *   这样后续玩家正向滑动时，方块才会准确停在洞位置。
 * - 反向：沿 forwardDir 反方向滑到最远位置，路径上不允许出现石/洞/传送门/其他方块。
 */
function tryReverseMove(block, forwardDir, grid, blocks, rows, cols) {
  const [dr, dc] = DIRS[forwardDir];

  if (!block.inHole) {
    const sr = block.row + dr;
    const sc = block.col + dc;
    const isWall = sr < 0 || sr >= rows || sc < 0 || sc >= cols;
    if (!isWall) {
      const cell = grid[sr][sc];
      const isStone = !!(cell && cell.type === 'stone');
      const isDiffHole = !!(cell && cell.type === 'hole' && cell.color !== block.color);
      const isBlock = blocks.some(
        (b) => b.id !== block.id && !b.inHole && b.row === sr && b.col === sc
      );
      if (!isStone && !isDiffHole && !isBlock) return { moved: false };
    }
  }

  const revDr = -dr;
  const revDc = -dc;
  let nr = block.row;
  let nc = block.col;

  while (true) {
    const tr = nr + revDr;
    const tc = nc + revDc;
    if (tr < 0 || tr >= rows || tc < 0 || tc >= cols) break;
    const cell = grid[tr][tc];
    if (cell && cell.type === 'stone') break;
    if (cell && cell.type === 'hole') break;
    if (cell && cell.type === 'portal') break;
    const hitBlock = blocks.some(
      (b) => b.id !== block.id && !b.inHole && b.row === tr && b.col === tc
    );
    if (hitBlock) break;
    nr = tr;
    nc = tc;
  }

  if (nr === block.row && nc === block.col) return { moved: false };
  return { moved: true, row: nr, col: nc };
}

/**
 * 完整性校验：保证关卡数据中不存在「同一坐标多种道具/方块」的情况。
 *
 * 支持同色多块：
 *   - 同色方块允许出现多个，但同色洞数量必须 >= 同色方块数量（>= 以兼容同色多
 *     洞配置，等号留出极端情况下的弹性）。实际生成路径里两者保持相等。
 *   - 传送门仍要求每色恰好 2 个（一对）。
 */
function validatePlacement(candidate) {
  const { rows, cols, grid, blocks } = candidate;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (cell && !['hole', 'portal', 'stone'].includes(cell.type)) return false;
    }
  }

  const cellTypes = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c]) cellTypes[`${r},${c}`] = grid[r][c].type;
    }
  }

  const blockPositions = new Set();
  for (const b of blocks) {
    if (b.inHole) continue;
    const key = `${b.row},${b.col}`;
    if (blockPositions.has(key)) return false;
    blockPositions.add(key);

    const t = cellTypes[key];
    if (t === 'stone' || t === 'portal') return false;
    if (t === 'hole') {
      const cell = grid[b.row][b.col];
      if (cell.color !== b.color) return false;
    }
  }

  const portalsByColor = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (cell && cell.type === 'portal') {
        if (!portalsByColor[cell.color]) portalsByColor[cell.color] = 0;
        portalsByColor[cell.color]++;
      }
    }
  }
  for (const color in portalsByColor) {
    if (portalsByColor[color] !== 2) return false;
  }

  // 同色多块支持：按颜色计数 holes vs blocks
  const holesByColor = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (cell && cell.type === 'hole') {
        holesByColor[cell.color] = (holesByColor[cell.color] || 0) + 1;
      }
    }
  }
  const blocksByColor = {};
  for (const b of blocks) {
    blocksByColor[b.color] = (blocksByColor[b.color] || 0) + 1;
  }
  for (const color in blocksByColor) {
    if ((holesByColor[color] || 0) < blocksByColor[color]) return false;
  }

  return true;
}

/**
 * 计算关卡候选「每个方块到最近同色洞」的曼哈顿距离最小值，及总和。
 *
 * 用于在跑 BFS 之前快速筛掉一定无聊的候选（方块就在洞口旁边）。
 */
function evalBlockHoleDistances(candidate) {
  const holesByColor = {};
  for (const h of candidate.holes) {
    if (!holesByColor[h.color]) holesByColor[h.color] = [];
    holesByColor[h.color].push(h);
  }
  let minDist = Infinity;
  let totalDist = 0;
  for (const b of candidate.blocks) {
    if (b.inHole) continue;
    const list = holesByColor[b.color] || [];
    let best = Infinity;
    for (const h of list) {
      const d = Math.abs(b.row - h.row) + Math.abs(b.col - h.col);
      if (d < best) best = d;
    }
    if (best < minDist) minDist = best;
    totalDist += (best === Infinity ? 0 : best);
  }
  if (!isFinite(minDist)) minDist = 0;
  return { minDist, totalDist };
}

/**
 * 为关卡挑选颜色配置：返回 blockColors 数组（长度 = blockCount），
 * 每个元素是该方块/同色洞的颜色。
 *
 * 每个方块颜色必须不同，从 7 种颜色中随机取 blockCount 个。
 */
function pickColors(config, level) {
  const { blockCount } = config;
  const palette = shuffle(COLORS.slice());
  if (blockCount > palette.length) return null;
  return palette.slice(0, blockCount);
}

export const __dbgTryGenStats = {
  picked_null: 0,
  hole_no_pos: 0,
  reverse_stuck: 0,
  escape_failed: 0,
  too_few_moves: 0,
  zero_moves: 0,
  invalid_placement: 0,
  min_dist_fail: 0,
  total_dist_fail: 0,
  ok: 0,
};

/**
 * 尝试生成一个关卡候选
 */
function tryGenerate(config, level) {
  const { rows, cols, blockCount, stoneCount, portalPairs, reverseMoves } = config;

  const blockColors = pickColors(config, level);
  if (!blockColors) { __dbgTryGenStats.picked_null++; return null; }

  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));

  // 为每个方块各放一个同色洞（即使同色多块，也是每块对应一个独立洞）
  const holes = [];
  for (const color of blockColors) {
    const pos = randomEmptyPos(rows, cols, grid, null);
    if (!pos) { __dbgTryGenStats.hole_no_pos++; return null; }
    grid[pos.r][pos.c] = { type: 'hole', color };
    holes.push({ color, row: pos.r, col: pos.c });
  }

  const portals = [];
  const portalColorChoices = shuffle(PORTAL_COLORS.slice()).slice(0, portalPairs);
  for (const color of portalColorChoices) {
    const p1 = randomEmptyPos(rows, cols, grid, null);
    if (!p1) continue;
    grid[p1.r][p1.c] = { type: 'portal', color };
    const p2 = randomEmptyPos(rows, cols, grid, null);
    if (!p2) { grid[p1.r][p1.c] = null; continue; }
    grid[p2.r][p2.c] = { type: 'portal', color };
    portals.push({ color, row: p1.r, col: p1.c });
    portals.push({ color, row: p2.r, col: p2.c });
  }

  for (let i = 0; i < stoneCount; i++) {
    const pos = randomEmptyPos(rows, cols, grid, null);
    if (!pos) break;
    grid[pos.r][pos.c] = { type: 'stone' };
  }

  // 方块初始在自己的洞中（同色多块时一对一映射到洞）
  const blocks = holes.map((h, idx) => ({
    id: idx, color: h.color,
    row: h.row, col: h.col, inHole: true,
  }));

  let actualMoves = 0;
  let lastMovedId = -1;
  const moveCounts = new Map(blocks.map((b) => [b.id, 0]));
  const reverseLog = [];
  const minMovesPerBlock = getMinMovesPerBlock(level);

  // 每个方块"上一步反向方向"，用于鼓励直角拐弯
  // —— 反向中每次换方向，对应正向解法中就是一次"滑到底再换方向"的转折点，
  // 转折越多，BFS 的 minSteps 越大 → 关卡越难。
  const lastDirByBlock = new Map();

  /**
   * 计算"反向滑动后到该 block 同色最近洞的距离"。
   * 用于挑选反向方向时的优先级辅助项：距离越远越好。
   */
  const distAfterMove = (block, result) => {
    if (!result || !result.moved) return -1;
    const sameColorHoles = holes.filter((h) => h.color === block.color);
    let best = Infinity;
    for (const h of sameColorHoles) {
      const d = Math.abs(result.row - h.row) + Math.abs(result.col - h.col);
      if (d < best) best = d;
    }
    return isFinite(best) ? best : 0;
  };

  /**
   * 启发式打分：转向 +6（与上一步不同方向）；距离 +dist；
   * 直走 +0（与上一步相同方向）。
   * 这样在多数情况下选择转向，少数情况下走直，避免完全 deterministic。
   */
  const scoreOption = (block, dir, dist) => {
    const last = lastDirByBlock.get(block.id);
    const turnBonus = last && last !== dir ? 8 : 0;
    return turnBonus + dist * 2;
  };

  // 反向构造主循环：
  //   - 70% 概率选「移动次数最少 + 非上一次移动」的方块，强制让每块都参与；
  //   - 30% 概率从全部能动的方块里随机挑一个。
  //   - 选方向时：80% 概率挑得分最高的（转向 + 远离洞），20% 随机保留多样性。
  //   - 单次选块若 4 方向全不可动，标记为本轮 stuck，下一轮自动绕开。
  //   - stuck 集合随每次成功移动重置（其他方块移动可能解锁原本卡死的块）。
  let consecutiveStuck = 0;
  let stuckIds = new Set();
  for (let i = 0; i < reverseMoves * 12; i++) {
    if (actualMoves >= reverseMoves) break;

    let pool = blocks.filter((b) => !stuckIds.has(b.id));
    if (pool.length === 0) break;

    let block;
    if (Math.random() < 0.7) {
      const minCount = Math.min(...pool.map((b) => moveCounts.get(b.id)));
      let candidates = pool.filter((b) => moveCounts.get(b.id) === minCount);
      if (candidates.length > 1) {
        const excluded = candidates.filter((b) => b.id !== lastMovedId);
        if (excluded.length > 0) candidates = excluded;
      }
      block = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      block = pool[Math.floor(Math.random() * pool.length)];
    }

    const options = [];
    for (const dir of DIR_NAMES) {
      const result = tryReverseMove(block, dir, grid, blocks, rows, cols);
      if (result.moved) {
        const dist = distAfterMove(block, result);
        options.push({ dir, result, dist, score: scoreOption(block, dir, dist) });
      }
    }

    let moved = false;
    if (options.length > 0) {
      let choice;
      if (Math.random() < 0.8) {
        options.sort((a, b) => b.score - a.score);
        const topScore = options[0].score;
        const top = options.filter((o) => o.score === topScore);
        choice = top[Math.floor(Math.random() * top.length)];
      } else {
        choice = options[Math.floor(Math.random() * options.length)];
      }
      block.row = choice.result.row;
      block.col = choice.result.col;
      block.inHole = false;
      lastDirByBlock.set(block.id, choice.dir);
      lastMovedId = block.id;
      actualMoves++;
      reverseLog.push({ blockId: block.id, dir: choice.dir });
      moveCounts.set(block.id, moveCounts.get(block.id) + 1);
      moved = true;
    }

    if (moved) {
      consecutiveStuck = 0;
      stuckIds.clear();
    } else {
      stuckIds.add(block.id);
      if (++consecutiveStuck >= blocks.length * 6) break;
    }
  }

  // 保底：任何仍在洞中的方块至少要被挪出来一次（否则不需要操作就赢了）
  for (const b of blocks) {
    if (!b.inHole) continue;
    const dirs = shuffle(DIR_NAMES);
    let escaped = false;
    for (const dir of dirs) {
      const result = tryReverseMove(b, dir, grid, blocks, rows, cols);
      if (result.moved) {
        b.row = result.row;
        b.col = result.col;
        b.inHole = false;
        actualMoves++;
        reverseLog.push({ blockId: b.id, dir });
        moveCounts.set(b.id, moveCounts.get(b.id) + 1);
        escaped = true;
        break;
      }
    }
    if (!escaped) { __dbgTryGenStats.escape_failed++; return null; }
  }

  // SOFT 检查：要求至少 N% 的方块达到最低反向移动次数
  // 20 关起提高到 75%，确保大多数方块都经过充分的反向构造
  if (minMovesPerBlock > 1) {
    const requiredRatio = level >= 20 ? 0.75 : 0.5;
    const okCount = blocks.filter((b) => moveCounts.get(b.id) >= minMovesPerBlock).length;
    if (okCount < Math.ceil(blocks.length * requiredRatio)) {
      __dbgTryGenStats.too_few_moves++;
      return null;
    }
  }

  if (actualMoves < 1) { __dbgTryGenStats.zero_moves++; return null; }

  // 若方块整体仍太靠近洞口，追加若干次「远离洞」的反向移动
  const minDistTarget = level <= 15 ? 2 : level <= 19 ? 3 : level <= 34 ? 4 : level <= 59 ? 5 : 6;
  for (let extra = 0; extra < 40; extra++) {
    const { minDist } = evalBlockHoleDistances({
      rows, cols, grid, blocks,
      holes,
    });
    if (minDist >= minDistTarget) break;

    const farBlocks = blocks
      .filter((b) => !b.inHole)
      .map((b) => {
        const sameColorHoles = holes.filter((h) => h.color === b.color);
        let best = Infinity;
        for (const h of sameColorHoles) {
          const d = Math.abs(b.row - h.row) + Math.abs(b.col - h.col);
          if (d < best) best = d;
        }
        return { b, dist: best };
      })
      .filter((x) => x.dist < minDistTarget)
      .sort((a, b) => a.dist - b.dist);

    if (farBlocks.length === 0) break;
    const block = farBlocks[0].b;

    let bestChoice = null;
    for (const dir of DIR_NAMES) {
      const result = tryReverseMove(block, dir, grid, blocks, rows, cols);
      if (!result.moved) continue;
      const dist = distAfterMove(block, result);
      if (!bestChoice || dist > bestChoice.dist) {
        bestChoice = { dir, result, dist };
      }
    }
    if (!bestChoice) break;
    block.row = bestChoice.result.row;
    block.col = bestChoice.result.col;
    block.inHole = false;
    actualMoves++;
    reverseLog.push({ blockId: block.id, dir: bestChoice.dir });
    moveCounts.set(block.id, moveCounts.get(block.id) + 1);
  }

  const candidate = {
    rows, cols,
    grid: cloneGrid(grid),
    blocks: blocks.map((b) => ({ ...b })),
    holes,
    portals,
    steps: 0,
    level,
    constructionMoves: actualMoves,
    reverseLog: reverseLog.slice(),
  };

  if (!validatePlacement(candidate)) { __dbgTryGenStats.invalid_placement++; return null; }

  // 距离预筛：方块紧贴洞口的关卡直接舍弃
  const { minDist, totalDist } = evalBlockHoleDistances(candidate);
  const minDistFloor = getMinHoleDistance(level);
  const totalDistFloor = getTotalDistanceFloor(level, blockCount);
  const spreadFloor = minDistFloor;
  if (minDist < spreadFloor) { __dbgTryGenStats.min_dist_fail++; return null; }
  if (totalDist < totalDistFloor) { __dbgTryGenStats.total_dist_fail++; return null; }

  __dbgTryGenStats.ok++;
  return candidate;
}

/**
 * 收集"未被解法使用"的传送门坐标 key（'r,c'）。
 *
 * 规则：对每一对传送门（按颜色配对），只要任一端被 movesUsedKeys 命中，
 * 整对传送门保留；如果两端都没用到，整对剔除。
 */
/**
 * 用反向构造日志快速验证可解性（O(步数)，不依赖 BFS 状态上限）。
 */
function verifyConstructionPath(candidate) {
  const { rows, cols, grid, blocks, reverseLog } = candidate;
  if (!reverseLog || reverseLog.length === 0) return false;
  const portalMap = getPortalPairMap(grid, rows, cols);
  let state = blocks.map((b) => ({ ...b }));
  for (let i = reverseLog.length - 1; i >= 0; i--) {
    const { blockId, dir } = reverseLog[i];
    const bi = state.findIndex((b) => b.id === blockId);
    if (bi < 0) return false;
    const next = simulateMove(bi, dir, state, grid, rows, cols, portalMap);
    if (!next) return false;
    state = next;
  }
  return state.every((b) => b.inHole);
}

/**
 * BFS 因状态爆炸失败时，用反向步数估算最少步数下限（最优解通常远短于反向步数）。
 */
function estimateMinSteps(candidate) {
  const moves = candidate.constructionMoves || 0;
  return Math.max(1, Math.floor(moves * 0.38));
}

/**
 * 求解关卡：优先 BFS 最优解；若仅因状态上限失败且构造路径可验证，则退回估算步数。
 */
function resolveCandidateSteps(candidate, maxDepth, maxStates) {
  const result = solve(
    candidate.rows, candidate.cols,
    candidate.grid, candidate.blocks,
    maxDepth, maxStates
  );
  if (result.solvable) {
    return { solvable: true, minSteps: result.minSteps, estimated: false };
  }
  if (result.reason === 'state_limit' && verifyConstructionPath(candidate)) {
    return { solvable: true, minSteps: estimateMinSteps(candidate), estimated: true };
  }
  return { solvable: false, minSteps: 0, estimated: false };
}

async function resolveCandidateStepsAsync(candidate, maxDepth, maxStates) {
  const result = await solveAsync(
    candidate.rows, candidate.cols,
    candidate.grid, candidate.blocks,
    maxDepth, maxStates
  );
  if (result.solvable) {
    return { solvable: true, minSteps: result.minSteps, estimated: false };
  }
  if (result.reason === 'state_limit' && verifyConstructionPath(candidate)) {
    return { solvable: true, minSteps: estimateMinSteps(candidate), estimated: true };
  }
  return { solvable: false, minSteps: 0, estimated: false };
}

/**
 * 最终确认最少步数：优先精确 BFS，仅在状态爆炸时用构造路径估算。
 */
function confirmMinSteps(candidate, maxDepth, maxStates) {
  const deep = Math.max(maxDepth, 45);
  const states = Math.max(maxStates, 600000);
  const result = solve(
    candidate.rows, candidate.cols,
    candidate.grid, candidate.blocks,
    deep, states
  );
  if (result.solvable) return { minSteps: result.minSteps, estimated: false };
  if (verifyConstructionPath(candidate)) {
    return { minSteps: estimateMinSteps(candidate), estimated: true };
  }
  return null;
}

/**
 * 异步版 confirmMinSteps：用 solveAsync 替代 solve，避免阻塞主线程。
 */
async function confirmMinStepsAsync(candidate, maxDepth, maxStates) {
  const deep = Math.max(maxDepth, 45);
  const states = Math.max(maxStates, 600000);
  const result = await solveAsync(
    candidate.rows, candidate.cols,
    candidate.grid, candidate.blocks,
    deep, states
  );
  if (result.solvable) return { minSteps: result.minSteps, estimated: false };
  if (verifyConstructionPath(candidate)) {
    return { minSteps: estimateMinSteps(candidate), estimated: true };
  }
  return null;
}

function collectUnusedPortalKeys(candidate, usedKeys) {
  const portalsByColor = {};
  for (let r = 0; r < candidate.rows; r++) {
    for (let c = 0; c < candidate.cols; c++) {
      const cell = candidate.grid[r][c];
      if (cell && cell.type === 'portal') {
        if (!portalsByColor[cell.color]) portalsByColor[cell.color] = [];
        portalsByColor[cell.color].push(`${r},${c}`);
      }
    }
  }
  const toRemove = new Set();
  for (const color in portalsByColor) {
    const keys = portalsByColor[color];
    if (keys.length !== 2) continue;
    const anyUsed = keys.some((k) => usedKeys.has(k));
    if (!anyUsed) {
      keys.forEach((k) => toRemove.add(k));
    }
  }
  return toRemove;
}

/**
 * 把候选关卡按"实际使用的传送门"裁剪：
 *   - 用 solveWithPath 求最优路径；
 *   - 回放路径记录被穿越的传送门坐标；
 *   - 把整对未被使用的传送门从 grid + portals 里剔除；
 *   - 重新跑一次 BFS 确认剔除后仍可解，并拿到（可能更小的）新 minSteps。
 *
 * 返回 { candidate, minSteps }，失败返回 null（理论上不会发生）。
 *
 * 异步版可传 useAsyncSolver=true，触发 await solveAsync 让出主线程。
 */
async function finalizeCandidate(candidate, originalMinSteps, maxDepth, maxStates, useAsyncSolver) {
  const pathResult = useAsyncSolver
    ? await solveWithPathAsync(
        candidate.rows, candidate.cols,
        candidate.grid, candidate.blocks,
        Math.max(originalMinSteps + 1, maxDepth), maxStates
      )
    : solveWithPath(
        candidate.rows, candidate.cols,
        candidate.grid, candidate.blocks,
        Math.max(originalMinSteps + 1, maxDepth), maxStates
      );
  if (!pathResult.solvable) {
    return { candidate, minSteps: originalMinSteps };
  }

  const usedKeys = tracePortalsForMoves(
    candidate.rows, candidate.cols,
    candidate.grid, candidate.blocks,
    pathResult.moves
  );
  const toRemove = collectUnusedPortalKeys(candidate, usedKeys);
  if (toRemove.size === 0) {
    return { candidate, minSteps: pathResult.minSteps };
  }

  const newGrid = gridWithPortalsRemoved(candidate.grid, toRemove);
  const newPortals = candidate.portals.filter(
    (p) => !toRemove.has(`${p.row},${p.col}`)
  );
  const trimmed = {
    ...candidate,
    grid: newGrid,
    portals: newPortals,
  };

  const reResult = useAsyncSolver
    ? await solveAsync(
        trimmed.rows, trimmed.cols,
        trimmed.grid, trimmed.blocks,
        maxDepth, maxStates
      )
    : solve(
        trimmed.rows, trimmed.cols,
        trimmed.grid, trimmed.blocks,
        maxDepth, maxStates
      );
  if (!reResult.solvable) {
    return { candidate, minSteps: originalMinSteps };
  }

  return { candidate: trimmed, minSteps: reResult.minSteps };
}

function finalizeCandidateSync(candidate, originalMinSteps, maxDepth, maxStates) {
  const pathResult = solveWithPath(
    candidate.rows, candidate.cols,
    candidate.grid, candidate.blocks,
    Math.max(originalMinSteps + 1, maxDepth), maxStates
  );
  if (!pathResult.solvable) {
    return { candidate, minSteps: originalMinSteps };
  }

  const usedKeys = tracePortalsForMoves(
    candidate.rows, candidate.cols,
    candidate.grid, candidate.blocks,
    pathResult.moves
  );
  const toRemove = collectUnusedPortalKeys(candidate, usedKeys);
  if (toRemove.size === 0) {
    return { candidate, minSteps: pathResult.minSteps };
  }

  const newGrid = gridWithPortalsRemoved(candidate.grid, toRemove);
  const newPortals = candidate.portals.filter(
    (p) => !toRemove.has(`${p.row},${p.col}`)
  );
  const trimmed = { ...candidate, grid: newGrid, portals: newPortals };

  const reResult = solve(
    trimmed.rows, trimmed.cols,
    trimmed.grid, trimmed.blocks,
    maxDepth, maxStates
  );
  if (!reResult.solvable) {
    return { candidate, minSteps: originalMinSteps };
  }

  return { candidate: trimmed, minSteps: reResult.minSteps };
}

/**
 * 保底关卡 — 先用放宽条件再试一轮多方块生成，最后才用极简布局。
 */
function generateFallback(level) {
  const baseConfig = getConfig(level);
  const relaxedFloor = Math.max(
    baseConfig.blockCount + 3,
    Math.floor(getMinStepsFloor(level, baseConfig.blockCount) * 0.65)
  );
  const maxDepth = relaxedFloor + 12;
  const maxStates = computeMaxStates(baseConfig);

  // level >= 10 保底生成也保留传送门
  const fallbackPortalPairs = level >= 10 ? Math.max(1, baseConfig.portalPairs) : 0;

  for (let attempt = 0; attempt < 120; attempt++) {
    const config = buildAttemptConfig(
      { ...baseConfig, portalPairs: fallbackPortalPairs },
      attempt + 20
    );
    const candidate = tryGenerate(config, level);
    if (!candidate) continue;

    const result = solve(
      candidate.rows, candidate.cols,
      candidate.grid, candidate.blocks,
      maxDepth, maxStates
    );
    if (!result.solvable && !(result.reason === 'state_limit' && verifyConstructionPath(candidate))) {
      continue;
    }
    const minSteps = result.solvable ? result.minSteps : estimateMinSteps(candidate);
    if (minSteps < relaxedFloor) continue;

    const finalized = finalizeCandidateSync(
      candidate, minSteps, maxDepth, maxStates
    );

    // level >= 10 保底也要求传送门被实际使用
    if (level >= 10 && finalized.candidate.portals.length === 0) continue;

    finalized.candidate.steps = computeSteps(level, finalized.minSteps);
    return finalized.candidate;
  }

  // 极简布局保底
  const rows = Math.max(6, baseConfig.rows);
  const cols = Math.max(6, baseConfig.cols);
  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
  grid[rows - 1][cols - 1] = { type: 'hole', color: 'red' };
  grid[0][cols - 1] = { type: 'stone' };

  // level >= 10 极简保底也加入传送门
  if (level >= 10) {
    // 在棋盘中间放一对传送门，让方块必须穿过传送门才能到达洞
    const midR = Math.floor(rows / 2);
    grid[midR][0] = { type: 'portal', color: 'blue' };
    grid[midR][cols - 1] = { type: 'portal', color: 'blue' };
    // 在传送门行放石块阻隔直线通路，迫使玩家使用传送门
    grid[midR][Math.floor(cols / 2)] = { type: 'stone' };
    return {
      rows, cols, grid,
      blocks: [{ id: 0, color: 'red', row: 0, col: 0, inHole: false }],
      holes: [{ color: 'red', row: rows - 1, col: cols - 1 }],
      portals: [
        { color: 'blue', row: midR, col: 0 },
        { color: 'blue', row: midR, col: cols - 1 },
      ],
      steps: Math.max(10, rows + cols),
      level,
    };
  }

  return {
    rows, cols, grid,
    blocks: [{ id: 0, color: 'red', row: 0, col: 0, inHole: false }],
    holes: [{ color: 'red', row: rows - 1, col: cols - 1 }],
    portals: [],
    steps: Math.max(10, rows + cols),
    level,
  };
}

/**
 * 异步版保底关卡 — 用 solveAsync + maybeYield 替代 sync solve，避免阻塞主线程。
 */
async function generateFallbackAsync(level) {
  const baseConfig = getConfig(level);
  const relaxedFloor = Math.max(
    baseConfig.blockCount + 3,
    Math.floor(getMinStepsFloor(level, baseConfig.blockCount) * 0.65)
  );
  const maxDepth = relaxedFloor + 12;
  const maxStates = computeMaxStates(baseConfig);

  const fallbackPortalPairs = level >= 10 ? Math.max(1, baseConfig.portalPairs) : 0;

  for (let attempt = 0; attempt < 120; attempt++) {
    await maybeYield();

    const config = buildAttemptConfig(
      { ...baseConfig, portalPairs: fallbackPortalPairs },
      attempt + 20
    );
    const candidate = tryGenerate(config, level);
    if (!candidate) continue;

    const result = await solveAsync(
      candidate.rows, candidate.cols,
      candidate.grid, candidate.blocks,
      maxDepth, maxStates
    );
    if (!result.solvable && !(result.reason === 'state_limit' && verifyConstructionPath(candidate))) {
      continue;
    }
    const minSteps = result.solvable ? result.minSteps : estimateMinSteps(candidate);
    if (minSteps < relaxedFloor) continue;

    const finalized = await finalizeCandidate(
      candidate, minSteps, maxDepth, maxStates, true
    );

    if (level >= 10 && finalized.candidate.portals.length === 0) continue;

    finalized.candidate.steps = computeSteps(level, finalized.minSteps);
    return finalized.candidate;
  }

  // 极简布局保底（不需要 BFS，直接构造）
  const rows = Math.max(6, baseConfig.rows);
  const cols = Math.max(6, baseConfig.cols);
  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
  grid[rows - 1][cols - 1] = { type: 'hole', color: 'red' };
  grid[0][cols - 1] = { type: 'stone' };

  if (level >= 10) {
    const midR = Math.floor(rows / 2);
    grid[midR][0] = { type: 'portal', color: 'blue' };
    grid[midR][cols - 1] = { type: 'portal', color: 'blue' };
    grid[midR][Math.floor(cols / 2)] = { type: 'stone' };
    return {
      rows, cols, grid,
      blocks: [{ id: 0, color: 'red', row: 0, col: 0, inHole: false }],
      holes: [{ color: 'red', row: rows - 1, col: cols - 1 }],
      portals: [
        { color: 'blue', row: midR, col: 0 },
        { color: 'blue', row: midR, col: cols - 1 },
      ],
      steps: Math.max(10, rows + cols),
      level,
    };
  }

  return {
    rows, cols, grid,
    blocks: [{ id: 0, color: 'red', row: 0, col: 0, inHole: false }],
    holes: [{ color: 'red', row: rows - 1, col: cols - 1 }],
    portals: [],
    steps: Math.max(10, rows + cols),
    level,
  };
}

/**
 * BFS 求解器探索上限：按方块数量分档。
 *   - 每多一个方块，状态空间约扩大 50 倍（位置数 ^ 方块数）
 *   - 上限太小会让多方块关卡的合法候选被误判为不可解，触发保底关
 *   - 上限太大单次 solve 会跑数秒级，在主线程上表现为卡死
 * 这里是"识别可解性"与"实时性"之间的折中。
 *
 * 同色多块时由于状态规范化，等效状态空间小一些，可以放宽 maxStates。
 *
 * 内存估算：visited Set 每条 ~32B + 队列每条 ~80B → 500k 状态 ≈ 55MB，
 * 在 WeChat 小游戏的内存预算内仍可接受。
 */
function computeMaxStates(config) {
  const { blockCount, rows, cols } = config;
  const gridFactor = rows * cols > 100 ? 0.9 : 1;
  let base;
  if (blockCount <= 3) base = 80000;
  else if (blockCount === 4) base = 200000;
  else if (blockCount === 5) base = 400000;
  else if (blockCount === 6) base = 500000;
  else base = 600000;
  return Math.floor(base * gridFactor);
}

/**
 * 生成关卡（对外接口，同步版）
 */
export function generateLevel(level) {
  const baseConfig = getConfig(level);
  const minStepsFloor = getMinStepsFloor(level, baseConfig.blockCount);
  const maxAttempts = 320;
  const maxDepth = minStepsFloor + 10;
  const maxStates = computeMaxStates(baseConfig);

  let bestCandidate = null;
  let bestMinSteps = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const config = buildAttemptConfig(baseConfig, attempt);
    const candidate = tryGenerate(config, level);
    if (!candidate) continue;

    const result = resolveCandidateSteps(candidate, maxDepth, maxStates);
    if (!result.solvable) continue;

    let finalCandidate = candidate;
    let finalMinSteps = result.minSteps;

    if (!result.estimated) {
      const finalized = finalizeCandidateSync(
        candidate, result.minSteps, maxDepth, maxStates
      );
      finalCandidate = finalized.candidate;
      finalMinSteps = finalized.minSteps;
    } else if (candidate.portals.length > 0) {
      const pathResult = solveWithPath(
        candidate.rows, candidate.cols,
        candidate.grid, candidate.blocks,
        Math.max(maxDepth, 50), Math.max(maxStates, 600000)
      );
      if (pathResult.solvable) {
        const usedKeys = tracePortalsForMoves(
          candidate.rows, candidate.cols,
          candidate.grid, candidate.blocks,
          pathResult.moves
        );
        const toRemove = collectUnusedPortalKeys(candidate, usedKeys);
        if (toRemove.size > 0) {
          finalCandidate = {
            ...candidate,
            grid: gridWithPortalsRemoved(candidate.grid, toRemove),
            portals: candidate.portals.filter((p) => !toRemove.has(`${p.row},${p.col}`)),
          };
        }
      }
      // solveWithPath 也炸状态时保留所有传送门 —— 构造路径已证明可解，
      // 无法确定哪些传送门是多余的，就全部保留。
    }

    // 估算路径的候选已经通过 verifyConstructionPath 验证过可解性，
    // 直接使用估算的 minSteps，不再跑 confirmMinSteps（也会炸状态）。
    if (!result.estimated) {
      const confirmed = confirmMinSteps(finalCandidate, maxDepth, maxStates);
      if (!confirmed) continue;
      finalMinSteps = confirmed.minSteps;
    }

    // level >= 10 强制要求传送门存在且为通关必须
    if (level >= 10) {
      if (finalCandidate.portals.length === 0) continue;
      if (!isPortalNecessary(finalCandidate, maxDepth, maxStates)) continue;
    }

    if (finalMinSteps < minStepsFloor - 4 && finalMinSteps <= bestMinSteps) {
      continue;
    }

    if (finalMinSteps > bestMinSteps) {
      bestMinSteps = finalMinSteps;
      bestCandidate = finalCandidate;
    }

    if (finalMinSteps >= minStepsFloor) {
      finalCandidate.steps = computeSteps(level, finalMinSteps);
      return finalCandidate;
    }
  }

  // 兆底路径：level >= 10 也必须有传送门
  if (bestCandidate && bestMinSteps >= Math.max(10, Math.floor(minStepsFloor * 0.75))) {
    if (level >= 10 && (!bestCandidate.portals || bestCandidate.portals.length === 0)) {
      // 不接受无传送门的兆底候选，走 fallback
    } else {
      console.warn(
        `关卡 ${level} 未完美达标（下限 ${minStepsFloor}），使用最佳候选: minSteps=${bestMinSteps}`
      );
      bestCandidate.steps = computeSteps(level, bestMinSteps);
      return bestCandidate;
    }
  }

  console.warn(`关卡 ${level} 生成失败，使用保底关卡`);
  return generateFallback(level);
}

/**
 * 异步版关卡生成：与 generateLevel 同构，但 solve 走 async 版本，
 * 由 BFS 周期性让出主线程，关卡预加载器调度它在后台运行。
 *
 * 调用方应当 await 这个函数；返回完整 levelData。
 */
export async function generateLevelAsync(level) {
  const baseConfig = getConfig(level);
  const minStepsFloor = getMinStepsFloor(level, baseConfig.blockCount);
  const maxAttempts = 320;
  const maxDepth = minStepsFloor + 10;
  const maxStates = computeMaxStates(baseConfig);

  let bestCandidate = null;
  let bestMinSteps = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await maybeYield();

    const config = buildAttemptConfig(baseConfig, attempt);
    const candidate = tryGenerate(config, level);
    if (!candidate) continue;

    const result = await resolveCandidateStepsAsync(candidate, maxDepth, maxStates);
    if (!result.solvable) continue;

    let finalCandidate = candidate;
    let finalMinSteps = result.minSteps;

    if (!result.estimated) {
      const finalized = await finalizeCandidate(
        candidate, result.minSteps, maxDepth, maxStates, true
      );
      finalCandidate = finalized.candidate;
      finalMinSteps = finalized.minSteps;
    } else if (candidate.portals.length > 0) {
      const pathResult = await solveWithPathAsync(
        candidate.rows, candidate.cols,
        candidate.grid, candidate.blocks,
        Math.max(maxDepth, 50), Math.max(maxStates, 600000)
      );
      if (pathResult.solvable) {
        const usedKeys = tracePortalsForMoves(
          candidate.rows, candidate.cols,
          candidate.grid, candidate.blocks,
          pathResult.moves
        );
        const toRemove = collectUnusedPortalKeys(candidate, usedKeys);
        if (toRemove.size > 0) {
          finalCandidate = {
            ...candidate,
            grid: gridWithPortalsRemoved(candidate.grid, toRemove),
            portals: candidate.portals.filter((p) => !toRemove.has(`${p.row},${p.col}`)),
          };
        }
      }
      // solveWithPath 也炸状态时保留所有传送门
    }

    // 估算路径的候选跳过 confirmMinSteps（也会炸状态），直接用估算值
    if (!result.estimated) {
      const confirmed = await confirmMinStepsAsync(finalCandidate, maxDepth, maxStates);
      if (!confirmed) continue;
      finalMinSteps = confirmed.minSteps;
    }

    // level >= 10 强制要求传送门存在且为通关必须
    if (level >= 10) {
      if (finalCandidate.portals.length === 0) continue;
      if (!(await isPortalNecessaryAsync(finalCandidate, maxDepth, maxStates))) continue;
    }

    if (finalMinSteps < minStepsFloor - 4 && finalMinSteps <= bestMinSteps) {
      continue;
    }

    if (finalMinSteps > bestMinSteps) {
      bestMinSteps = finalMinSteps;
      bestCandidate = finalCandidate;
    }

    if (finalMinSteps >= minStepsFloor) {
      finalCandidate.steps = computeSteps(level, finalMinSteps);
      return finalCandidate;
    }
  }

  // 兆底路径：level >= 10 也必须有传送门
  if (bestCandidate && bestMinSteps >= Math.max(10, Math.floor(minStepsFloor * 0.75))) {
    if (level >= 10 && (!bestCandidate.portals || bestCandidate.portals.length === 0)) {
      // 不接受无传送门的兆底候选，走 fallback
    } else {
      console.warn(
        `关卡 ${level} 未完美达标（下限 ${minStepsFloor}），使用最佳候选: minSteps=${bestMinSteps}`
      );
      bestCandidate.steps = computeSteps(level, bestMinSteps);
      return bestCandidate;
    }
  }

  console.warn(`关卡 ${level} 生成失败，使用保底关卡`);
  return generateFallbackAsync(level);
}

export { getConfig, tryGenerate, getMinStepsFloor };
