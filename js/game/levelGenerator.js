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
 */

import { solve, solveAsync, maybeYield } from './solver';

const COLORS = ['red', 'blue', 'green', 'yellow', 'purple'];
const PORTAL_COLORS = ['blue', 'purple', 'yellow'];
const DIRS = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};
const DIR_NAMES = ['up', 'down', 'left', 'right'];

/**
 * 根据关卡号获取难度配置
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
    portalPairs = 3;
  } else if (level <= 20) {
    rows = 8; cols = 8;
    blockCount = 4 + (level >= 17 ? 1 : 0);
    stoneCount = 7 + Math.floor((level - 16) / 2);
    portalPairs = 3;
  } else if (level <= 30) {
    rows = 9; cols = 8;
    blockCount = 5;
    stoneCount = 9 + Math.floor((level - 21) / 3);
    portalPairs = 3;
  } else {
    rows = 9; cols = 9;
    blockCount = 5;
    stoneCount = Math.min(12, 10 + Math.floor((level - 31) / 8));
    portalPairs = 3;
  }

  // 传送门对数与棋盘行数硬挂钩：rows>=8 最多 3 对，rows=7 最多 2 对，rows<7 最多 1 对
  const maxPortalPairs = rows >= 8 ? 3 : rows >= 7 ? 2 : 1;
  portalPairs = Math.min(portalPairs, maxPortalPairs);

  const reverseMoves = blockCount * 3 + Math.min(3 + Math.floor(level / 2), 16);
  return { rows, cols, blockCount, stoneCount, portalPairs, reverseMoves };
}

/**
 * 关卡最少步数下限 — BFS 求解器算出的最优解必须 >= 这个值，否则关卡过于平凡，舍弃。
 * 这是保证"挑战性"的关键约束：反向构造可能产生彼此抵消的轨迹，BFS 会压缩到很短的最优解，
 * 单纯增加 reverseMoves 没用，必须在这里直接卡死。
 */
function getMinStepsFloor(level, blockCount) {
  const base = blockCount * 2;
  let bonus;
  if (level <= 2) bonus = 0;
  else if (level <= 5) bonus = 2;
  else if (level <= 10) bonus = 5;
  else if (level <= 15) bonus = 8;
  else if (level <= 20) bonus = 11;
  else if (level <= 30) bonus = 13;
  else bonus = 15;
  return base + bonus;
}

/**
 * 每个方块在反向构造中至少要移动多少次 — 防止个别方块"原地未动"导致解法只剩 1-2 步。
 */
function getMinMovesPerBlock(level) {
  if (level <= 2) return 1;
  if (level <= 5) return 2;
  if (level <= 12) return 2;
  return 3;
}

/**
 * 把"最少步数"换算成给玩家的实际步数 = minSteps + 缓冲。
 *
 * 缓冲档位按关卡梯度递减，但整体偏宽松：玩家允许走错一两步并通过撤回纠正，
 * 而不是逼着每一步都最优。前期更宽，后期收紧但仍留出试错空间。
 *
 * 这一函数同时被同步版和异步版 generateLevel 使用，避免两份重复实现。
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
  } else if (level <= 15) {
    bufferRatio = 0.30;
    bufferMin = 3;
  } else if (level <= 25) {
    bufferRatio = 0.22;
    bufferMin = 2;
  } else {
    bufferRatio = 0.15;
    bufferMin = 2;
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

  const holeColors = new Set();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (cell && cell.type === 'hole') {
        if (holeColors.has(cell.color)) return false;
        holeColors.add(cell.color);
      }
    }
  }
  const blockColors = blocks.map((b) => b.color);
  if (blockColors.length !== new Set(blockColors).size) return false;
  for (const color of blockColors) {
    if (!holeColors.has(color)) return false;
  }

  return true;
}

/**
 * 尝试生成一个关卡候选
 */
function tryGenerate(config, level) {
  const { rows, cols, blockCount, stoneCount, portalPairs, reverseMoves } = config;

  let colors;
  if (portalPairs > 0) {
    const portalPool = shuffle(PORTAL_COLORS.slice());
    const chosenPortals = portalPool.slice(0, portalPairs);
    const remaining = shuffle(COLORS.filter((c) => !chosenPortals.includes(c)));
    colors = shuffle([...chosenPortals, ...remaining]).slice(0, blockCount);
  } else {
    colors = shuffle(COLORS).slice(0, blockCount);
  }
  if (colors.length < blockCount) return null;

  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));

  const holes = [];
  for (const color of colors) {
    const pos = randomEmptyPos(rows, cols, grid, null);
    if (!pos) return null;
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

  const blocks = holes.map((h, idx) => ({
    id: idx, color: h.color,
    row: h.row, col: h.col, inHole: true,
  }));

  let actualMoves = 0;
  let lastMovedId = -1;
  const moveCounts = new Map(blocks.map((b) => [b.id, 0]));
  const minMovesPerBlock = getMinMovesPerBlock(level);

  // 反向构造主循环：优先选择"移动次数最少 + 非上一次移动"的方块，让每个方块都有充分位移
  let consecutiveStuck = 0;
  for (let i = 0; i < reverseMoves * 10; i++) {
    if (actualMoves >= reverseMoves) break;

    const minCount = Math.min(...moveCounts.values());
    let candidates = blocks.filter((b) => moveCounts.get(b.id) === minCount);
    if (blocks.length > 1) {
      const excluded = candidates.filter((b) => b.id !== lastMovedId);
      if (excluded.length > 0) candidates = excluded;
    }

    const block = candidates[Math.floor(Math.random() * candidates.length)];
    const dirs = shuffle(DIR_NAMES);
    let moved = false;
    for (const dir of dirs) {
      const result = tryReverseMove(block, dir, grid, blocks, rows, cols);
      if (result.moved) {
        block.row = result.row;
        block.col = result.col;
        block.inHole = false;
        lastMovedId = block.id;
        actualMoves++;
        moveCounts.set(block.id, moveCounts.get(block.id) + 1);
        moved = true;
        break;
      }
    }

    // 连续多次随机选到的方块都动不了，再判定整体卡死，避免单次随机选错就放弃。
    if (moved) {
      consecutiveStuck = 0;
    } else if (++consecutiveStuck >= blocks.length * 3) {
      break;
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
        moveCounts.set(b.id, moveCounts.get(b.id) + 1);
        escaped = true;
        break;
      }
    }
    if (!escaped) return null;
  }

  // 校验：每个方块至少移动了 minMovesPerBlock 次，否则解法过于平凡
  for (const b of blocks) {
    if (moveCounts.get(b.id) < minMovesPerBlock) return null;
  }

  if (actualMoves < 1) return null;

  const candidate = {
    rows, cols,
    grid: cloneGrid(grid),
    blocks: blocks.map((b) => ({ ...b })),
    holes,
    portals,
    steps: 0,
    level,
  };

  if (!validatePlacement(candidate)) return null;

  return candidate;
}

/**
 * 简单保底关卡 — 不含传送门，可 100% 保证可解。
 *
 * 使用当前关卡应有的棋盘尺寸（避免后期关卡突然降级为 5x5 的视觉跳变），
 * 但只放 1 个方块 + 1 个同色洞 + 1 个石块，求解必定成功。
 * 由于真正的反向构造 + BFS 已经经过多档 maxStates 调优，正常情况下不会走到这里；
 * 兜底关卡只是终极保险。
 */
function generateFallback(level) {
  const config = getConfig(level);
  const rows = Math.max(5, config.rows);
  const cols = Math.max(5, config.cols);
  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
  grid[rows - 1][cols - 1] = { type: 'hole', color: 'red' };
  // 在方块和洞中间放一个石块，让玩家必须先撞它再转向，避免一步通关
  grid[0][cols - 1] = { type: 'stone' };

  return {
    rows, cols, grid,
    blocks: [{ id: 0, color: 'red', row: 0, col: 0, inHole: false }],
    holes: [{ color: 'red', row: rows - 1, col: cols - 1 }],
    portals: [],
    steps: Math.max(8, rows + cols),
    level,
  };
}

/**
 * 生成关卡（对外接口）
 */
export function generateLevel(level) {
  const config = getConfig(level);

  const minStepsFloor = getMinStepsFloor(level, config.blockCount);
  const maxAttempts = 250;
  // BFS 深度必须能覆盖目标最优解，否则会被误判为不可解。
  // 反向构造最多走 reverseMoves 步，BFS 求得的最优解一定 <= reverseMoves，
  // 因此 maxDepth 不需要超过 reverseMoves + 少量缓冲。
  const maxDepth = Math.max(minStepsFloor + 4, config.reverseMoves + 2);
  // maxStates 控制 BFS 探索上限，需要按 blockCount 分档：
  //   - 每多一个方块，状态空间约扩大 50 倍（位置数 ^ 方块数）
  //   - 上限太小会让 5 方块关卡的合法候选被误判为不可解，触发 5x5 保底关
  //   - 上限太大单次 solve 会跑数秒级，在主线程上表现为卡死
  // 这里的档位是在"识别可解性"与"实时性"之间取的折中。
  let maxStates;
  if (config.blockCount <= 3) maxStates = 60000;
  else if (config.blockCount === 4) maxStates = 120000;
  else maxStates = 220000;

  // 保留尝试过的"最难"候选作为兜底，避免极端情况下生成失败
  // 优先级：传送门必要 > 达到 minSteps 下限 > minSteps 最大
  let bestCandidate = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = tryGenerate(config, level);
    if (!candidate) continue;

    const result = solve(
      candidate.rows, candidate.cols,
      candidate.grid, candidate.blocks,
      maxDepth, maxStates
    );

    if (!result.solvable) continue;

    // 若该候选在最乐观情形（传送门必要）下也无法超过当前最佳，且达不到 minStepsFloor，
    // 那么验证传送门必要性也只会得到一个不会被采纳的候选，直接跳过二次 solve。
    const optimisticScore = 1000 + result.minSteps;
    if (result.minSteps < minStepsFloor && optimisticScore <= bestScore) {
      continue;
    }

    // 若关卡含传送门，验证传送门是否被最优解必需
    // 把传送门替换为空地再求解一次，若仍能在 <= minSteps 步内通关，说明传送门是摆设。
    // 这里把 maxDepth 收紧到 result.minSteps：我们只关心"是否存在不超过 minSteps 步的无传送门解"，
    // 没必要让 BFS 继续往更深处探，大幅减少二次求解开销。
    let portalEssential = true;
    if (config.portalPairs > 0) {
      const gridNoPortal = gridWithoutPortals(candidate.grid);
      const noPortalResult = solve(
        candidate.rows, candidate.cols,
        gridNoPortal, candidate.blocks,
        result.minSteps, maxStates
      );
      if (noPortalResult.solvable && noPortalResult.minSteps <= result.minSteps) {
        portalEssential = false;
      }
    }

    // 评分：传送门必要 +1000 权重，再加上 minSteps；优先选 portalEssential 且 minSteps 大的
    const score = (portalEssential ? 1000 : 0) + result.minSteps;
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
      bestCandidate.steps = computeSteps(level, result.minSteps);
      bestCandidate._minSteps = result.minSteps;
      bestCandidate._portalEssential = portalEssential;
    }

    if (result.minSteps >= minStepsFloor && portalEssential) {
      candidate.steps = computeSteps(level, result.minSteps);
      return candidate;
    }
  }

  if (bestCandidate) {
    console.warn(
      `关卡 ${level} 未完美达标（下限 ${minStepsFloor}），使用最佳候选: ` +
      `minSteps=${bestCandidate._minSteps}, portalEssential=${bestCandidate._portalEssential}`
    );
    delete bestCandidate._minSteps;
    delete bestCandidate._portalEssential;
    return bestCandidate;
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
  const config = getConfig(level);
  const minStepsFloor = getMinStepsFloor(level, config.blockCount);
  const maxAttempts = 250;
  const maxDepth = Math.max(minStepsFloor + 4, config.reverseMoves + 2);

  let maxStates;
  if (config.blockCount <= 3) maxStates = 60000;
  else if (config.blockCount === 4) maxStates = 120000;
  else maxStates = 220000;

  let bestCandidate = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 每个 attempt 开头让一下：tryGenerate 是同步的 cheap 操作，
    // 但 250 次循环连起来也可能占用一帧多的时间。
    await maybeYield();

    const candidate = tryGenerate(config, level);
    if (!candidate) continue;

    const result = await solveAsync(
      candidate.rows, candidate.cols,
      candidate.grid, candidate.blocks,
      maxDepth, maxStates
    );

    if (!result.solvable) continue;

    const optimisticScore = 1000 + result.minSteps;
    if (result.minSteps < minStepsFloor && optimisticScore <= bestScore) {
      continue;
    }

    let portalEssential = true;
    if (config.portalPairs > 0) {
      const gridNoPortal = gridWithoutPortals(candidate.grid);
      const noPortalResult = await solveAsync(
        candidate.rows, candidate.cols,
        gridNoPortal, candidate.blocks,
        result.minSteps, maxStates
      );
      if (noPortalResult.solvable && noPortalResult.minSteps <= result.minSteps) {
        portalEssential = false;
      }
    }

    const score = (portalEssential ? 1000 : 0) + result.minSteps;
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
      bestCandidate.steps = computeSteps(level, result.minSteps);
      bestCandidate._minSteps = result.minSteps;
      bestCandidate._portalEssential = portalEssential;
    }

    if (result.minSteps >= minStepsFloor && portalEssential) {
      candidate.steps = computeSteps(level, result.minSteps);
      return candidate;
    }
  }

  if (bestCandidate) {
    console.warn(
      `关卡 ${level} 未完美达标（下限 ${minStepsFloor}），使用最佳候选: ` +
      `minSteps=${bestCandidate._minSteps}, portalEssential=${bestCandidate._portalEssential}`
    );
    delete bestCandidate._minSteps;
    delete bestCandidate._portalEssential;
    return bestCandidate;
  }

  console.warn(`关卡 ${level} 生成失败，使用保底关卡`);
  return generateFallback(level);
}
