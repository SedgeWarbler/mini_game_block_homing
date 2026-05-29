import { generateLevel } from '../js/game/levelGenerator.js';
import { solve } from '../js/game/solver.js';

const levels = [1, 8, 15, 22, 30, 35, 45, 55, 70, 85];

for (const lvl of levels) {
  const t0 = Date.now();
  const data = generateLevel(lvl);
  const verify = solve(data.rows, data.cols, data.grid, data.blocks, 80, 800000);
  const minDist = Math.min(
    ...data.blocks.map((b) => {
      const same = data.holes.filter((h) => h.color === b.color);
      return Math.min(...same.map((h) => Math.abs(b.row - h.row) + Math.abs(b.col - h.col)));
    })
  );
  console.log(JSON.stringify({
    level: lvl,
    size: `${data.rows}x${data.cols}`,
    blocks: data.blocks.length,
    colors: [...new Set(data.blocks.map((b) => b.color))].length,
    portals: data.portals.length / 2,
    stones: data.grid.flat().filter((c) => c && c.type === 'stone').length,
    playerSteps: data.steps,
    minSteps: verify.minSteps,
    minBlockHoleDist: minDist,
    ms: Date.now() - t0,
  }));
}
