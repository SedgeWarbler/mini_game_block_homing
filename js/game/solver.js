/**
 * BFS 求解器 — 验证关卡是否可解并返回最少步数
 *
 * 重要：本求解器的滑动语义必须与 board.js 的 computeMove 完全一致：
 *   1) 方块朝指定方向连续滑动直到撞墙/石/异色洞/其他方块
 *   2) 同色洞：进入洞，结束
 *   3) 传送门：穿越到配对位置后继续沿原方向滑动
 *   4) 若一次滑动中尝试进入同一传送门两次（含被传送到的出口端），视为死循环，
 *      该移动判定为非法（返回 null），玩家无法用这一步推进。
 *
 * 支持「同色多块」：当关卡有多个同色方块（必然伴随同色多洞）时，BFS 的状态
 * 哈希按颜色分组、组内位置排序后再编码，使「红块A 在 P1、红块B 在 P2」与
 * 「红块A 在 P2、红块B 在 P1」被视作同一状态，状态空间收缩 n! 倍，性能显著提升。
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
 * 按颜色分组：返回 [[idx0, idx1, ...], [...], ...]
 * 颜色名按字典序排序，组内索引按方块原始顺序。
 */
function buildColorGroups(blocks) {
  const map = new Map();
  for (let i = 0; i < blocks.length; i++) {
    const c = blocks[i].color;
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(i);
  }
  const sortedColors = [...map.keys()].sort();
  return sortedColors.map((c) => map.get(c));
}

/**
 * 数值状态键：把每个方块的位置（或 inHole 标记）压成一个整数，
 * 用一个整数 key 代替字符串 key，让 Set 的 has/add 走数字哈希路径，
 * 配合 BFS 性能显著好于字符串。
 *
 * 编码：每个方块占用 slotSize = rows*cols + 1 个槽位；
 * 位置 (r,c) 编码为 r*cols + c，inHole 编码为 rows*cols。
 *
 * 同色多块：组内位置先排序再编码，使「红块A在P1、红块B在P2」与
 * 「红块A在P2、红块B在P1」哈希到同一 key（同色方块本质等价）。
 *
 * 编码空间上限：10*10=100，每槽 101，最多 6 个方块 → 101^6 ≈ 1.06e12，
 * 仍在 Number.MAX_SAFE_INTEGER（2^53 ≈ 9e15）以内，安全。
 */
function makeNumericKey(rows, cols, colorGroups) {
  const slot = rows * cols + 1;
  const inHoleVal = rows * cols;
  return function (blocks) {
    let key = 0;
    for (const group of colorGroups) {
      if (group.length === 1) {
        const b = blocks[group[0]];
        const v = b.inHole ? inHoleVal : b.row * cols + b.col;
        key = key * slot + v;
      } else {
        const vals = new Array(group.length);
        for (let i = 0; i < group.length; i++) {
          const b = blocks[group[i]];
          vals[i] = b.inHole ? inHoleVal : b.row * cols + b.col;
        }
        vals.sort((a, b) => a - b);
        for (let i = 0; i < vals.length; i++) key = key * slot + vals[i];
      }
    }
    return key;
  };
}

/**
 * 模拟一次滑动；若产生传送门死循环则返回 null（移动非法）
 *
 * 可选参数 outPortalKeys：传入一个数组时，把本次滑动中"实际进入过"的传送门坐标 key
 * 追加进去（用于关卡生成后判断哪些传送门被解法真正使用）。
 */
function simMove(blockIdx, dir, blocks, grid, rows, cols, portalMap, outPortalKeys) {
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
      if (outPortalKeys) outPortalKeys.push(key);
      const pair = portalMap[key];
      if (pair) {
        const pairKey = `${pair.row},${pair.col}`;
        if (visitedPortals.has(pairKey)) return null;
        visitedPortals.add(pairKey);
        if (outPortalKeys) outPortalKeys.push(pairKey);
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
const YIELD_INTERVAL_MS = 4;
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

  const colorGroups = buildColorGroups(init);
  const encode = makeNumericKey(rows, cols, colorGroups);
  const visited = new Set();
  visited.add(encode(init));

  const queue = [{ blocks: init, step: 0 }];
  let head = 0;
  let yieldCheck = 0;

  while (head < queue.length) {
    if (visited.size >= maxStates) return { solvable: false, reason: 'state_limit' };

    if (++yieldCheck >= 500) {
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

  const colorGroups = buildColorGroups(init);
  const encode = makeNumericKey(rows, cols, colorGroups);
  const visited = new Set();
  visited.add(encode(init));

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
 * 带路径还原的 BFS 求解：除了返回 minSteps，还返回到达目标的一条最优移动序列。
 * 用于关卡生成阶段重放最优解、识别"哪几个传送门被实际用到"。
 *
 * 返回值：{ solvable, minSteps, moves: [{ blockId, dir }, ...] }
 */
export function solveWithPath(rows, cols, grid, blocks, maxDepth, maxStates) {
  maxDepth = maxDepth || 25;
  maxStates = maxStates || 300000;
  const portalMap = buildPortalPairMap(grid, rows, cols);
  const init = blocks.map((b) => ({ id: b.id, color: b.color, row: b.row, col: b.col, inHole: !!b.inHole }));
  if (init.every((b) => b.inHole)) return { solvable: true, minSteps: 0, moves: [] };

  const colorGroups = buildColorGroups(init);
  const encode = makeNumericKey(rows, cols, colorGroups);
  const visited = new Set();
  visited.add(encode(init));

  // 每个节点：blocks + step + 父节点索引 + 父→本节点的 move
  const queue = [{ blocks: init, step: 0, parent: -1, move: null }];
  let head = 0;

  while (head < queue.length) {
    if (visited.size >= maxStates) return { solvable: false, reason: 'state_limit' };
    const curIdx = head;
    const { blocks: cur, step } = queue[head++];
    if (step >= maxDepth) continue;
    for (let bi = 0; bi < cur.length; bi++) {
      if (cur[bi].inHole) continue;
      const blockId = cur[bi].id;
      for (let di = 0; di < 4; di++) {
        const dir = DIR_NAMES[di];
        const nb = simMove(bi, dir, cur, grid, rows, cols, portalMap);
        if (!nb) continue;
        const key = encode(nb);
        if (visited.has(key)) continue;
        visited.add(key);
        const nodeIdx = queue.length;
        queue.push({ blocks: nb, step: step + 1, parent: curIdx, move: { blockId, dir } });
        if (nb.every((b) => b.inHole)) {
          const moves = [];
          let cursor = nodeIdx;
          while (cursor !== -1 && queue[cursor].move) {
            moves.unshift(queue[cursor].move);
            cursor = queue[cursor].parent;
          }
          return { solvable: true, minSteps: step + 1, moves };
        }
      }
    }
  }
  return { solvable: false, reason: 'no_solution' };
}

/**
 * 异步版 solveWithPath：语义与 solveWithPath 完全一致，内部按时间预算周期性让步。
 * 用于关卡后台生成时不阻塞主线程。
 */
export async function solveWithPathAsync(rows, cols, grid, blocks, maxDepth, maxStates) {
  maxDepth = maxDepth || 25;
  maxStates = maxStates || 300000;
  const portalMap = buildPortalPairMap(grid, rows, cols);
  const init = blocks.map((b) => ({ id: b.id, color: b.color, row: b.row, col: b.col, inHole: !!b.inHole }));
  if (init.every((b) => b.inHole)) return { solvable: true, minSteps: 0, moves: [] };

  const colorGroups = buildColorGroups(init);
  const encode = makeNumericKey(rows, cols, colorGroups);
  const visited = new Set();
  visited.add(encode(init));

  const queue = [{ blocks: init, step: 0, parent: -1, move: null }];
  let head = 0;
  let yieldCheck = 0;

  while (head < queue.length) {
    if (visited.size >= maxStates) return { solvable: false, reason: 'state_limit' };

    if (++yieldCheck >= 500) {
      yieldCheck = 0;
      if (Date.now() - lastYieldTs > YIELD_INTERVAL_MS) {
        await yieldToHost();
      }
    }

    const curIdx = head;
    const { blocks: cur, step } = queue[head++];
    if (step >= maxDepth) continue;
    for (let bi = 0; bi < cur.length; bi++) {
      if (cur[bi].inHole) continue;
      const blockId = cur[bi].id;
      for (let di = 0; di < 4; di++) {
        const dir = DIR_NAMES[di];
        const nb = simMove(bi, dir, cur, grid, rows, cols, portalMap);
        if (!nb) continue;
        const key = encode(nb);
        if (visited.has(key)) continue;
        visited.add(key);
        const nodeIdx = queue.length;
        queue.push({ blocks: nb, step: step + 1, parent: curIdx, move: { blockId, dir } });
        if (nb.every((b) => b.inHole)) {
          const moves = [];
          let cursor = nodeIdx;
          while (cursor !== -1 && queue[cursor].move) {
            moves.unshift(queue[cursor].move);
            cursor = queue[cursor].parent;
          }
          return { solvable: true, minSteps: step + 1, moves };
        }
      }
    }
  }
  return { solvable: false, reason: 'no_solution' };
}

/**
 * 重放一条 move 序列，收集所有「实际进入」的传送门坐标 key（'r,c'）。
 *
 * 用于关卡生成器在确认最优解后，剔除"摆设型"传送门：只有被解法路径真正穿越的
 * 那对传送门会被保留，其余传送门在最终关卡数据中被清除。
 *
 * 返回：用过的 portal 坐标 key 集合（Set<string>）。如果重放中途出现非法 move
 * （理论上不会发生，但容错），返回到那一步为止已经收集的集合。
 */
export function tracePortalsForMoves(rows, cols, grid, blocks, moves) {
  const portalMap = buildPortalPairMap(grid, rows, cols);
  let cur = blocks.map((b) => ({ id: b.id, color: b.color, row: b.row, col: b.col, inHole: !!b.inHole }));
  const usedKeys = new Set();
  for (const mv of moves) {
    const bi = cur.findIndex((b) => b.id === mv.blockId);
    if (bi < 0) break;
    const trace = [];
    const next = simMove(bi, mv.dir, cur, grid, rows, cols, portalMap, trace);
    if (!next) break;
    for (const k of trace) usedKeys.add(k);
    cur = next;
  }
  return usedKeys;
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
