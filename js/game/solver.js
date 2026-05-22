/**
 * BFS 求解器 — 验证关卡是否可解并返回最少步数
 *
 * 重要：本求解器的滑动语义必须与 board.js 的 computeMove 完全一致：
 *   1) 方块朝指定方向连续滑动直到撞墙/石/异色洞/其他方块
 *   2) 同色洞：进入洞，结束
 *   3) 传送门：穿越到配对位置后继续沿原方向滑动
 *   4) 若一次滑动中尝试进入同一传送门两次（含被传送到的出口端），视为死循环，
 *      该移动判定为非法（返回 null），玩家无法用这一步推进。
 */

const DIRS = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};
const DIR_NAMES = ['up', 'down', 'left', 'right'];

function buildPortalPairMap(grid, rows, cols) {
  const byColor = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (cell && cell.type === 'portal') {
        if (!byColor[cell.color]) byColor[cell.color] = [];
        byColor[cell.color].push({ row: r, col: c });
      }
    }
  }
  const map = {};
  for (const arr of Object.values(byColor)) {
    if (arr.length === 2) {
      map[`${arr[0].row},${arr[0].col}`] = arr[1];
      map[`${arr[1].row},${arr[1].col}`] = arr[0];
    }
  }
  return map;
}

/**
 * 数值状态键：把每个方块的位置（或 inHole 标记）压成一个整数，
 * 用一个整数 key 代替字符串 key，让 Set 的 has/add 走数字哈希路径，
 * 配合 BFS 性能显著好于字符串。
 *
 * 编码：每个方块占用 slotSize = rows*cols + 1 个槽位；
 * 位置 (r,c) 编码为 r*cols + c，inHole 编码为 rows*cols。
 * 最大棋盘 9*9=81，每槽 82，最多 5 个方块 → 82^5 ≈ 3.7e9，远在 Number.MAX_SAFE_INTEGER（2^53）以内。
 */
function makeNumericKey(rows, cols) {
  const slot = rows * cols + 1;
  const inHoleVal = rows * cols;
  return function (blocks) {
    let key = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const v = b.inHole ? inHoleVal : b.row * cols + b.col;
      key = key * slot + v;
    }
    return key;
  };
}

/**
 * 模拟一次滑动；若产生传送门死循环则返回 null（移动非法）
 */
function simMove(blockIdx, dir, blocks, grid, rows, cols, portalMap) {
  const block = blocks[blockIdx];
  if (block.inHole) return null;
  const [dr, dc] = DIRS[dir];
  let r = block.row;
  let c = block.col;
  let enteredHole = false;
  const visitedPortals = new Set();
  let guard = 0;
  while (++guard < 500) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) break;
    let hit = false;
    for (let i = 0; i < blocks.length; i++) {
      if (i !== blockIdx && !blocks[i].inHole && blocks[i].row === nr && blocks[i].col === nc) { hit = true; break; }
    }
    if (hit) break;
    const cell = grid[nr][nc];
    if (cell && cell.type === 'stone') break;
    if (cell && cell.type === 'hole') {
      if (cell.color === block.color) { r = nr; c = nc; enteredHole = true; break; }
      break;
    }
    if (cell && cell.type === 'portal') {
      const key = `${nr},${nc}`;
      if (visitedPortals.has(key)) return null;
      visitedPortals.add(key);
      const pair = portalMap[key];
      if (pair) {
        const pairKey = `${pair.row},${pair.col}`;
        if (visitedPortals.has(pairKey)) return null;
        visitedPortals.add(pairKey);
        r = pair.row;
        c = pair.col;
      } else {
        r = nr;
        c = nc;
      }
      continue;
    }
    r = nr;
    c = nc;
  }
  if (guard >= 500) return null;
  if (r === block.row && c === block.col && !enteredHole) return null;
  const nb = new Array(blocks.length);
  for (let i = 0; i < blocks.length; i++) {
    if (i === blockIdx) {
      nb[i] = { id: block.id, color: block.color, row: r, col: c, inHole: enteredHole };
    } else {
      nb[i] = blocks[i];
    }
  }
  return nb;
}

/**
 * 时间预算式让步：累计在主线程上跑了 YIELD_INTERVAL_MS 后，
 * 通过 setTimeout(0) 把控制权交还给宿主一帧，避免长时间阻塞渲染。
 *
 * 注意：lastYieldTs 故意做成模块级单例 —— 即便同一帧内连续调用 solveAsync
 * 多次（例如同一候选连跑 2 次 solve），也共用同一份"已经在主线程占用多久"
 * 的预算，不会因为一次 solve 结束就重置预算。
 */
const YIELD_INTERVAL_MS = 10;
let lastYieldTs = (typeof Date !== 'undefined') ? Date.now() : 0;

function yieldToHost() {
  return new Promise((resolve) => {
    setTimeout(() => {
      lastYieldTs = Date.now();
      resolve();
    }, 0);
  });
}

/**
 * 异步版 BFS 求解：语义与 solve() 完全一致，仅在内部按时间预算周期性让步。
 * 用于关卡预生成器在玩家游戏过程中后台跑，不阻塞游戏渲染。
 */
export async function solveAsync(rows, cols, grid, blocks, maxDepth, maxStates) {
  maxDepth = maxDepth || 25;
  maxStates = maxStates || 300000;
  const portalMap = buildPortalPairMap(grid, rows, cols);
  const init = blocks.map((b) => ({ id: b.id, color: b.color, row: b.row, col: b.col, inHole: !!b.inHole }));
  if (init.every((b) => b.inHole)) return { solvable: true, minSteps: 0 };

  const encode = makeNumericKey(rows, cols);
  const visited = new Set();
  visited.add(encode(init));

  const queue = [{ blocks: init, step: 0 }];
  let head = 0;
  let yieldCheck = 0;

  while (head < queue.length) {
    if (visited.size >= maxStates) return { solvable: false, reason: 'state_limit' };

    // 每 ~2000 次出队检查一下时间预算，避免每次出队都 Date.now() 拖性能
    if (++yieldCheck >= 2000) {
      yieldCheck = 0;
      if (Date.now() - lastYieldTs > YIELD_INTERVAL_MS) {
        await yieldToHost();
      }
    }

    const { blocks: cur, step } = queue[head++];
    if (step >= maxDepth) continue;
    for (let bi = 0; bi < cur.length; bi++) {
      if (cur[bi].inHole) continue;
      for (let di = 0; di < 4; di++) {
        const nb = simMove(bi, DIR_NAMES[di], cur, grid, rows, cols, portalMap);
        if (!nb) continue;
        const key = encode(nb);
        if (visited.has(key)) continue;
        visited.add(key);
        if (nb.every((b) => b.inHole)) return { solvable: true, minSteps: step + 1 };
        if (step + 1 < maxDepth) queue.push({ blocks: nb, step: step + 1 });
      }
    }
  }
  return { solvable: false, reason: 'no_solution' };
}

/**
 * 在生成器的两次 solve 之间也调用一下：BFS 没触发内部让步时（候选很快被解出），
 * 主线程依旧可能连续跑很多帧。这里给生成器一个统一的"打个盹"入口。
 */
export async function maybeYield() {
  if (Date.now() - lastYieldTs > YIELD_INTERVAL_MS) {
    await yieldToHost();
  }
}

export function solve(rows, cols, grid, blocks, maxDepth, maxStates) {
  maxDepth = maxDepth || 25;
  maxStates = maxStates || 300000;
  const portalMap = buildPortalPairMap(grid, rows, cols);
  const init = blocks.map((b) => ({ id: b.id, color: b.color, row: b.row, col: b.col, inHole: !!b.inHole }));
  if (init.every((b) => b.inHole)) return { solvable: true, minSteps: 0 };

  const encode = makeNumericKey(rows, cols);
  const visited = new Set();
  visited.add(encode(init));

  // 用 head 索引模拟出队，避免 Array.shift() 的 O(n) 行为；
  // BFS 在 maxStates 较大时（如 8e4+），shift() 会让总耗时退化为 O(n^2)，
  // 这是第九关及之后生成卡死的主要原因。
  const queue = [{ blocks: init, step: 0 }];
  let head = 0;

  while (head < queue.length) {
    if (visited.size >= maxStates) return { solvable: false, reason: 'state_limit' };
    const { blocks: cur, step } = queue[head++];
    if (step >= maxDepth) continue;
    for (let bi = 0; bi < cur.length; bi++) {
      if (cur[bi].inHole) continue;
      for (let di = 0; di < 4; di++) {
        const nb = simMove(bi, DIR_NAMES[di], cur, grid, rows, cols, portalMap);
        if (!nb) continue;
        const key = encode(nb);
        if (visited.has(key)) continue;
        visited.add(key);
        if (nb.every((b) => b.inHole)) return { solvable: true, minSteps: step + 1 };
        if (step + 1 < maxDepth) queue.push({ blocks: nb, step: step + 1 });
      }
    }
  }
  return { solvable: false, reason: 'no_solution' };
}

/**
 * 暴露模拟函数，供生成器在反向构造时使用相同的滑动语义
 */
export function simulateMove(blockIdx, dir, blocks, grid, rows, cols, portalMap) {
  return simMove(blockIdx, dir, blocks, grid, rows, cols, portalMap);
}

export function getPortalPairMap(grid, rows, cols) {
  return buildPortalPairMap(grid, rows, cols);
}
