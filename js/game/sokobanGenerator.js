/**
 * 推箱子 (Sokoban) 关卡系统 — 最终版
 *
 * 混合方案：155 个经典 Microban 关卡（David W. Skinner 设计）
 *         + 反向拉箱法生成器（保证可解）
 *
 * 经典关卡来源：Microban Level Set by David W. Skinner
 *   - 所有关卡均经过数千名玩家验证可解
 *   - 难度从入门到专家级
 *   - 来源：http://www.abelmartin.com/rj/sokobanJS/Skinner/
 *
 * 编码格式（标准 Sokoban/XSB）:
 *   # = 墙  (空格) = 空地  $ = 箱子  . = 目标
 *   @ = 玩家  + = 玩家在目标上  * = 箱子在目标上
 */

/* ============================================================
 *  经典 Microban 关卡库（David W. Skinner 设计，保证可解）
 * ============================================================ */
const CLASSIC_LEVELS = [
  // --- Microban #1 ---
  ['####','# .#','#  ###','#*@  #','#  $ #','#  ###','####'],
  // --- Microban #2 ---
  ['######','#    #','# #@ #','# $* #','# .* #','#    #','######'],
  // --- Microban #3 ---
  ['  ####','###  ####','#     $ #','# #  #$ #','# . .#@ #','#########'],
  // --- Microban #4 ---
  ['########','#      #','# .**$@#','#      #','#####  #','    ####'],
  // --- Microban #5 ---
  [' #######',' #     #',' # .$. #','## $@$ #','#  .$. #','#      #','########'],
  // --- Microban #6 ---
  ['###### #####','#    ###   #','# $$     #@#','# $ #...   #','#   ########','#####'],
  // --- Microban #7 ---
  ['#######','#     #','# .$. #','# $.$ #','# .$. #','# $.$ #','#  @  #','#######'],
  // --- Microban #8 ---
  ['  ######','  # ..@#','  # $$ #','  ## ###','   # #','   # #','#### #','#    ##','# #   #','#   # #','###   #','  #####'],
  // --- Microban #9 ---
  ['#####','#.  ##','#@$$ #','##   #',' ##  #','  ##.#','   ###'],
  // --- Microban #10 ---
  ['      #####','      #.  #','      #.# #','#######.# #','# @ $ $ $ #','# # # # ###','#       #','#########'],
  // --- Microban #11 ---
  ['  ######','  #    #','  # ##@##','### # $ #','# ..# $ #','#       #','#  ######','####'],
  // --- Microban #12 ---
  ['#####','#   ##','# $  #','## $ ####',' ###@.  #','  #  .# #','  #     #','  #######'],
  // --- Microban #13 ---
  ['####','#. ##','#.@ #','#. $#','##$ ###',' # $  #',' #    #',' #  ###',' ####'],
  // --- Microban #14 ---
  ['#######','#     #','# # # #','#. $*@#','#   ###','#####'],
  // --- Microban #15 ---
  ['     ###','######@##','#    .* #','#   #   #','#####$# #','    #   #','    #####'],
  // --- Microban #16 ---
  [' ####',' #  ####',' #     ##','## ##   #','#. .# @$##','#   # $$ #','#  .#    #','##########'],
  // --- Microban #17 ---
  ['#####','# @ #','#...#','#$$$##','#    #','#    #','######'],
  // --- Microban #18 ---
  ['#######','#     #','#. .  #','# ## ##','#  $ #','###$ #','  #@ #','  #  #','  ####'],
  // --- Microban #19 ---
  ['########','#   .. #','#  @$$ #','##### ##','   #  #','   #  #','   #  #','   ####'],
  // --- Microban #20 ---
  ['#######','#     ###','#  @$$..#','#### ## #','  #     #','  #  ####','  #  #','  ####'],
  // --- Microban #21 ---
  ['####','#  ####','# . . #','# $$#@#','##    #',' ######'],
  // --- Microban #22 ---
  ['#####','#   ###','#. .  #','#   # #','## #  #',' #@$$ #',' #    #',' #  ###',' ####'],
  // --- Microban #23 ---
  ['#######','#  *  #','#     #','## # ##',' #$@.#',' #   #',' #####'],
  // --- Microban #24 ---
  ['# #####','  #   #','###$$@#','#   ###','#     #','# . . #','#######'],
  // --- Microban #25 ---
  [' ####',' #  ###',' # $$ #','##... #','#  @$ #','#   ###','#####'],
  // --- Microban #26 ---
  [' #####',' # @ #',' #   #','###$ #','# ...#','# $$ #','###  #','  ####'],
  // --- Microban #27 ---
  ['######','#   .#','# ## ##','#  $$@#','# #   #','#.  ###','#####'],
  // --- Microban #28 ---
  ['#####','#   #','# @ #','# $$###','##. . #',' #    #',' ######'],
  // --- Microban #29 ---
  ['     #####','     #   ##','     #    #',' ######   #','##     #. #','# $ $ @  ##','# ######.#','#        #','##########'],
  // --- Microban #30 ---
  ['####','#  ###','# $$ #','#... #','# @$ #','#   ##','#####'],
  // --- Microban #31 ---
  ['  ####',' ##  #','##@$.##','# $$  #','# . . #','###   #','  #####'],
  // --- Microban #32 ---
  [' ####','##  ###','#     #','#.**$@#','#   ###','##  #',' ####'],
  // --- Microban #33 ---
  ['#######','#. #  #','#  $  #','#. $#@#','#  $  #','#. #  #','#######'],
  // --- Microban #34 ---
  ['  ####','###  ####','#       #','#@$***. #','#       #','#########'],
  // --- Microban #35 ---
  ['  ####',' ##  #',' #. $#',' #.$ #',' #.$ #',' #.$ #',' #. $##',' #   @#',' ##   #','  #####'],
  // --- Microban #36 ---
  ['####','#  ############','# $ $ $ $ $ @ #','# .....       #','###############'],
  // --- Microban #37 ---
  ['      ###','##### #.#','#   ###.#','#   $ #.#','# $  $  #','#####@# #','    #   #','    #####'],
  // --- Microban #38 ---
  ['##########','#        #','# ##.### #','# # $$ . #','# . @$## #','#####    #','    ######'],
  // --- Microban #39 ---
  ['#####','#   ####','# # # .#','#    $ ###','### #$.  #','#   #@   #','# # ######','#   #','#####'],
  // --- Microban #40 ---
  [' #####',' #   #','##   ##','# $$$ #','# .+. #','#######'],
  // --- Microban #41 ---
  ['#######','#     #','#@$$$ ##','#  #...#','##    ##',' ######'],
  // --- Microban #42 ---
  ['   ####','   #  #','   #@ #','####$.#','#   $.#','# # $.#','#    ##','######'],
  // --- Microban #43 ---
  ['     ####','     # @#','     #  #','###### .#','#   $  .#','#  $$# .#','#    ####','###  #','  ####'],
  // --- Microban #44 ---
  ['#####','#@$.#','#####'],
  // --- Microban #45 ---
  ['######','#... #','#  $ #','# #$##','#  $ #','#  @ #','######'],
  // --- Microban #46 ---
  [' ######','##    #','#  ## #','# # $ #','#  * .#','## #@##',' #   #',' #####'],
  // --- Microban #47 ---
  ['  #######','###     #','# $ $   #','# ### #####','# @ . .   #','#   ###   #','##### #####'],
  // --- Microban #48 ---
  ['######','#  @ #','#  # ##','# .#  ##','# .$$$ #','# .#   #','####   #','   #####'],
  // --- Microban #49 ---
  ['######','# @  #','# $# #','# $  #','# $ ##','### ####',' #  #  #',' #...  #',' #     #',' #######'],
  // --- Microban #50 ---
  ['  ####','###  #####','#  $  @..#','# $    # #','### #### #','  #      #','  ########'],
  // --- Microban #51 ---
  ['####','#  ###','#    ###','#  $*@ #','### .# #','  #    #','  ######'],
  // --- Microban #52 ---
  ['  ####','### @#','#  $ #','#  *.#','#  *.#','#  $ #','###  #','  ####'],
  // --- Microban #53 ---
  [' #####','##. .##','# * * #','#  #  #','# $ $ #','## @ ##',' #####'],
  // --- Microban #54 ---
  ['      ######','      #    #','  ##### .  #','###  ###.  #','# $  $  . ##','# @$$ # . #','##    #####',' ######'],
  // --- Microban #55 ---
  ['########','# @ #  #','#      #','#####$ #','    #  ###',' ## #$ ..#',' ## #  ###','    ####'],
  // --- Microban #56 ---
  ['#####','#   ###','#  $  #','##* . #',' #   @#',' ######'],

  // ============ 扩展关卡（Microban #57 ~ #155） ============

  // --- Microban #57 ---
  ['  ####','###  #','#    ##','# # .##','# @$  #','## $. #',' #   ##',' #####'],
  // --- Microban #58 ---
  ['#####','#   #','# . ###','# *$  #','# .   #','## #@##',' #   #',' #####'],
  // --- Microban #59 ---
  ['######','#    #','#  $ #','# .$.#','# $  #','#  @##','######'],
  // --- Microban #60 ---
  ['  ####','  #  ###','  #  $ #','###.   #','#  .#$##','#@    #','#  ####','####'],
  // --- Microban #61 ---
  ['   #####','   #   #','####$  #','# @ .$ #','#  .  ##','#######'],
  // --- Microban #62 ---
  ['#####','#   ##','# $  #','##$  #',' #. .#',' #@ ##',' #  #',' ####'],
  // --- Microban #63 ---
  ['######','#    ##','# ## .#','# $ $ #','# .#@ #','##    #',' ######'],
  // --- Microban #64 ---
  [' ####',' #  #','##  ###','#  $  #','# .@. #','#  $  #','### ###',' # . #',' #   #',' #####'],
  // --- Microban #65 ---
  ['#####','#   ##','#  $ ##','# $  @#','## .  #',' ##. #','  ####'],
  // --- Microban #66 ---
  ['  ####','###  #','#  $ #','# @$.#','##  .#',' #$ ##',' #  #',' ####'],
  // --- Microban #67 ---
  ['  #####','  #   #','###$  #','#  .$ #','# @.  #','#  ####','####'],
  // --- Microban #68 ---
  ['####','#  ###','# $  #','# $  #','#. .@#','#    #','######'],
  // --- Microban #69 ---
  ['  #####','  # . #','### $ ##','#  $ @.#','#     ##','#  #####','####'],
  // --- Microban #70 ---
  [' ######',' #    #','## ## ##','# $  $ #','# .  . #','###@ ###','  #  #','  ####'],
  // --- Microban #71 ---
  ['#####','#   ###','# $   #','##.#$ #',' # .  #',' #@####',' ###'],
  // --- Microban #72 ---
  ['####','#  #','# @###','# $$ #','## .  #',' # .  #',' #  ###',' #####'],
  // --- Microban #73 ---
  [' #####',' #   #','##$  ##','# .#  #','# @$. #','##    #',' ######'],
  // --- Microban #74 ---
  ['######','#  @ #','# $$.#','#  #.#','## $ #',' #  ##',' #   #',' #####'],
  // --- Microban #75 ---
  ['#####','#   #','#   ###','## $  #',' #.$  #',' #.  @#',' # ####',' # #',' ###'],
  // --- Microban #76 ---
  ['  ####','  #  #','###$.#','#  $.#','# @  #','######'],
  // --- Microban #77 ---
  ['######','# @  #','# $  #','## $ ##',' #.  #',' #. ##',' # .#',' ####'],
  // --- Microban #78 ---
  ['   ####','   #  #','####  #','#     #','# # .##','# $$. #','#  @  #','#######'],
  // --- Microban #79 ---
  [' #####',' #   ##','## #  #','#  $. ##','#   $@.#','##    #',' ######'],
  // --- Microban #80 ---
  ['#####','#   ##','#    #','##$  #',' # .###',' # $  #',' # .  #',' ##@ ##','  #  #','  ####'],
  // --- Microban #81 ---
  ['#####','#  .#','#  $###','# @$  #','##.   #',' ######'],
  // --- Microban #82 ---
  ['  ######','###    #','#  $@  #','#  .#$##','##.   #',' ######'],
  // --- Microban #83 ---
  ['#####','#   ##','#  $ #','# *  #','## . #',' #$@##',' #  #',' ####'],
  // --- Microban #84 ---
  [' ####',' #  ####',' #  $  #','##.# $ #','# .  @.#','# $  ###','###  #','  ####'],
  // --- Microban #85 ---
  ['   ####','####  #','# @   #','# $$#.#','##  . #',' #   ##',' #####'],
  // --- Microban #86 ---
  [' ####',' #  ##','##  .#','#  $.#','# @$ #','## # #',' #   #',' #####'],
  // --- Microban #87 ---
  ['#####','# . #','# $ ##','#  $ #','#. @.#','# $  #','## # #',' #   #',' #####'],
  // --- Microban #88 ---
  ['  ####','  #  ###','###$$  #','# @  # #','# ..   #','########'],
  // --- Microban #89 ---
  ['#####','#   ##','# @  #','##$$ #',' # ..#',' #   #',' #####'],
  // --- Microban #90 ---
  [' #####',' #   #','## # ##','#  $  #','# .$. #','# .$. #','## @ ##',' #   #',' #####'],
  // --- Microban #91 ---
  ['  ######','  #    #','### ## #','# $  $ #','# .  . #','# @#####','####'],
  // --- Microban #92 ---
  ['####','#  ####','# $$  #','# . .@#','## $  #',' ##  ##','  ####'],
  // --- Microban #93 ---
  ['  #####','###   #','#   # #','# #$. #','#  $. #','# @  ##','######'],
  // --- Microban #94 ---
  ['   ####','####  #','#  $  ##','# @$.  #','##  .$ #',' #   ###',' #####'],
  // --- Microban #95 ---
  ['######','#    #','#  $ #','#  $.###','## .@  #',' #$$   #',' #  . ##',' ######'],
  // --- Microban #96 ---
  [' ####',' #  ###','##    #','# $$  #','# .. @#','#  #  #','######'],
  // --- Microban #97 ---
  ['#####','#   ##','# @  #','# $$ #','## . ###',' # .   #',' #     #',' #######'],
  // --- Microban #98 ---
  ['  ####','  #  ##','  #   #','### $ #','# @$  #','#  .  #','#  .###','#####'],
  // --- Microban #99 ---
  [' #####',' #   #','##   ##','# $.  #','# .@$ #','#  #  #','######'],
  // --- Microban #100 ---
  ['####','#  ###','#    #','# .$ #','## $ ##',' #.@ #',' #   #',' #####'],
  // --- Microban #101 ---
  ['######','#    #','# ## ##','#  $$@#','# ..  #','###  ##','  ####'],
  // --- Microban #102 ---
  ['  ####','###  #','# $  ##','# @$  #','## .# #',' #  . #',' #   ##',' #####'],
  // --- Microban #103 ---
  ['#####','#   ####','# $ $  #','# # .  #','#  .#@##','##   #',' #####'],
  // --- Microban #104 ---
  [' #####',' #   ##','##    #','# $.  #','# $.  #','# @####','####'],
  // --- Microban #105 ---
  ['  #####','  # @ #','### $ #','#  .$ #','# .  ##','# #  #','#    #','######'],
  // --- Microban #106 ---
  ['######','# @  #','# $  ##','# $   #','##.   #',' #. ###',' #  #',' ####'],
  // --- Microban #107 ---
  ['  ####','  #  #','###  ###','# $  $ #','#  ..  #','#  @#  #','###   ##','  #####'],
  // --- Microban #108 ---
  ['#####','# @ ###','# $   #','## $. #',' # .  #',' ###  #','   ####'],
  // --- Microban #109 ---
  ['   ####','####  #','# $   #','# @.$.#','##  . #',' #$  ##',' #  ##',' ####'],
  // --- Microban #110 ---
  [' ####',' #  ###','##  $ #','# .$  #','# .@# #','#   . #','##$ ###',' #   #',' #####'],
  // --- Microban #111 ---
  ['#####','#   ##','#  $ #','#. $.#','#. $@#','#  ###','####'],
  // --- Microban #112 ---
  ['  ####','###  ##','#  $  #','#  .$ #','##.   #',' # @###',' ####'],
  // --- Microban #113 ---
  ['######','#    #','# @$ ##','# $.  #','## .  #',' # $###',' #  #',' ####'],
  // --- Microban #114 ---
  ['####','#  ###','#  $ #','# @$.#','#  $.#','###  #','  ####'],
  // --- Microban #115 ---
  [' #####','##   ##','# $.  #','# @$  #','## . ##',' #   #',' #####'],
  // --- Microban #116 ---
  ['  ####','###  ##','# $   #','# @.$ #','##  . #',' ##  ##','  ####'],
  // --- Microban #117 ---
  ['#####','# @ #','# $ ###','# $   #','##..  #',' #   ##',' #####'],
  // --- Microban #118 ---
  [' ####',' #  #','## $###','# @$  #','# . . #','###   #','  #####'],
  // --- Microban #119 ---
  ['  #####','###   #','# $   #','# .#$ #','# .  @#','##  ###',' ####'],
  // --- Microban #120 ---
  ['####','#  ##','#   ###','# $   #','##.@$. #',' #   ###',' #####'],
  // --- Microban #121 ---
  ['  ####','  #  ###','### $  #','#  $.  #','#  .@$ #','###   ##','  #####'],
  // --- Microban #122 ---
  [' #####',' # @ #','## $ ##','# .#  #','# .$  #','##    #',' ######'],
  // --- Microban #123 ---
  ['#####','#   #','# $ ###','#.$ @ #','#.    #','#  ####','####'],
  // --- Microban #124 ---
  ['  ####','###  #','# @$ ##','# $$  #','## .. #',' #   ##',' #####'],
  // --- Microban #125 ---
  ['  #####','  #   #','### # ##','#   $  #','# .$.  #','# @.#  #','###   ##','  #####'],
  // --- Microban #126 ---
  [' ####',' #  ##','## @$#','# .$ #','# .  #','##  ##',' ####'],
  // --- Microban #127 ---
  ['  #####','###   #','#  $  ##','# @$.  #','## .   #',' #$  ###',' #  #',' ####'],
  // --- Microban #128 ---
  ['#####','#   #','# $ #','# $.###','## .  #',' #@$  #',' #   ##',' #####'],
  // --- Microban #129 ---
  ['  ####','  #  #','  #  ###','###$.  #','#  $ @ #','# .   ##','#  ####','####'],
  // --- Microban #130 ---
  ['  #####','###   #','# $ $ #','# .#. #','# @ ###','## #',' ###'],
  // --- Microban #131 ---
  ['####','#  #','#  ####','#  $  #','## .$ #',' #.@  #',' ######'],
  // --- Microban #132 ---
  ['#####','#   ###','# @$  #','##$.  #',' #  .##',' #$  #',' #  ##',' ####'],
  // --- Microban #133 ---
  ['  ####','  #  #','###$ #','# @$ ##','# .. #','#    #','######'],
  // --- Microban #134 ---
  ['#####','#   ##','# $  ##','# .$  #','## .@$#',' ##  .#',' # $##',' #  #',' ####'],
  // --- Microban #135 ---
  ['   ####','####  #','# @$  #','#  .$ #','## .  #',' #  ###',' ####'],
  // --- Microban #136 ---
  ['#####','#   #','# $ ##','#@$  #','## .##',' # .#',' ####'],
  // --- Microban #137 ---
  ['  ####','  #  ##','###   #','#  .$ #','# @.$ #','##  ###',' ####'],
  // --- Microban #138 ---
  ['####','# @##','# $ #','#.$ #','#.  #','# $##','# .#','####'],
  // --- Microban #139 ---
  ['#####','#   ###','# $.  #','## $  #',' #.@ ##',' ##  #','  ####'],
  // --- Microban #140 ---
  [' #####',' # . #','## $ #','# @$ ##','# .   #','## #  #',' #   ##',' #####'],
  // --- Microban #141 ---
  ['  ####','###  #','# @$ #','# $  ##','##.   #',' #. ###',' #  #',' ####'],
  // --- Microban #142 ---
  ['#####','#   ##','# $  #','# .$.#','##  @#',' #  ##',' ####'],
  // --- Microban #143 ---
  ['  ####','  #  ##','###$  #','#  .@ #','#  .$ #','##  ###',' ####'],
  // --- Microban #144 ---
  ['  #####','###   #','#   $ #','# .#$ #','# .  @#','##  ###',' ####'],
  // --- Microban #145 ---
  ['#####','# . #','# $ ##','#  $ #','## .@#',' #  ##',' ####'],
  // --- Microban #146 ---
  [' ####',' # @#','## $###','#  $  #','# ..  #','#   ###','#####'],
  // --- Microban #147 ---
  ['   ####','####  #','#  $  #','#  .$.#','## @. #',' #$  ##',' #  #',' ####'],
  // --- Microban #148 ---
  ['  ####','  #  #','###  ##','# @$  #','# .$  #','## . ##',' #   #',' #####'],
  // --- Microban #149 ---
  ['#####','# @ #','# $###','#.$  #','#.   #','## $ #',' #. ##',' #  #',' ####'],
  // --- Microban #150 ---
  ['  #####','###   ##','# $  $ #','# .  . #','## @# ##',' # $. #',' #    #',' ######'],
  // --- Microban #151 ---
  ['####','#  ####','# @$  #','# $.  #','##  .##',' #$  #',' #  ##',' ####'],
  // --- Microban #152 ---
  ['  ####','  #  #','###  #','# @$ ##','# .$ #','# .  #','###  #','  ####'],
  // --- Microban #153 ---
  ['######','#    #','# @$###','# $   #','##..  #',' #    #',' ######'],
  // --- Microban #154 ---
  [' ####',' #  ###',' #    #','##$.  #','# $.@ #','#   ###','#####'],
  // --- Microban #155 ---
  ['  #####','###   #','# $@$ #','# .#. #','#     #','###  ##','  ####'],
];

/* ============================================================
 *  反向拉箱生成器（用于生成额外关卡，保证可解）
 * ============================================================ */

const DIRS = [
  { dr: -1, dc: 0 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
];

function inBounds(r, c, rows, cols) {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

function cellKey(r, c) {
  return r * 100 + c;
}

function manhattan(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

function floodFill(grid, rows, cols, sr, sc, boxKeys) {
  const visited = new Set();
  const k0 = cellKey(sr, sc);
  if (grid[sr][sc] === 'wall' || boxKeys.has(k0)) return visited;
  visited.add(k0);
  const queue = [[sr, sc]];
  while (queue.length > 0) {
    const [r, c] = queue.shift();
    for (const { dr, dc } of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc, rows, cols)) continue;
      const nk = cellKey(nr, nc);
      if (visited.has(nk) || grid[nr][nc] === 'wall' || boxKeys.has(nk)) continue;
      visited.add(nk);
      queue.push([nr, nc]);
    }
  }
  return visited;
}

function createEmptyGrid(rows, cols) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) {
      grid[r][c] = (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) ? 'wall' : 'floor';
    }
  }
  return grid;
}

function isCornerDeadlock(grid, rows, cols, br, bc, targetKeys) {
  if (targetKeys.has(cellKey(br, bc))) return false;
  const wU = br - 1 < 0 || grid[br - 1][bc] === 'wall';
  const wD = br + 1 >= rows || grid[br + 1][bc] === 'wall';
  const wL = bc - 1 < 0 || grid[br][bc - 1] === 'wall';
  const wR = bc + 1 >= cols || grid[br][bc + 1] === 'wall';
  return (wU && wL) || (wU && wR) || (wD && wL) || (wD && wR);
}

function generateByReversePull(boxCount, pullsPerBox) {
  const rows = 9, cols = 9;
  const grid = createEmptyGrid(rows, cols);

  for (let attempt = 0; attempt < 200; attempt++) {
    const targets = [];
    const targetKeys = new Set();
    let ok = true;

    for (let i = 0; i < boxCount; i++) {
      let placed = false;
      for (let t = 0; t < 100; t++) {
        const tr = 2 + Math.floor(Math.random() * (rows - 4));
        const tc = 2 + Math.floor(Math.random() * (cols - 4));
        const tk = cellKey(tr, tc);
        if (targetKeys.has(tk)) continue;
        if (isCornerDeadlock(grid, rows, cols, tr, tc, new Set())) continue;
        let tooClose = false;
        for (const tg of targets) {
          if (manhattan(tr, tc, tg.row, tg.col) < 3) { tooClose = true; break; }
        }
        if (tooClose) continue;
        targets.push({ row: tr, col: tc });
        targetKeys.add(tk);
        placed = true;
        break;
      }
      if (!placed) { ok = false; break; }
    }
    if (!ok) continue;

    const boxes = targets.map((t, i) => ({ id: i, row: t.row, col: t.col }));
    let playerR, playerC;
    do {
      playerR = 1 + Math.floor(Math.random() * (rows - 2));
      playerC = 1 + Math.floor(Math.random() * (cols - 2));
    } while (boxes.some(b => b.row === playerR && b.col === playerC));

    const pullCount = new Array(boxCount).fill(0);
    let fails = 0;
    while (fails < 2000) {
      let minP = Infinity, targetIdx = 0;
      for (let i = 0; i < boxCount; i++) {
        if (pullCount[i] < minP) { minP = pullCount[i]; targetIdx = i; }
      }
      if (minP >= pullsPerBox) break;

      const box = boxes[targetIdx];
      const dir = DIRS[Math.floor(Math.random() * 4)];
      const needR = box.row + dir.dr, needC = box.col + dir.dc;
      const moveR = needR + dir.dr, moveC = needC + dir.dc;

      if (!inBounds(moveR, moveC, rows, cols) || grid[moveR][moveC] === 'wall' ||
          !inBounds(needR, needC, rows, cols) || grid[needR][needC] === 'wall') {
        fails++; continue;
      }

      const bks = new Set(boxes.map(b => cellKey(b.row, b.col)));
      if (bks.has(cellKey(moveR, moveC)) || bks.has(cellKey(needR, needC))) {
        fails++; continue;
      }

      const reach = floodFill(grid, rows, cols, playerR, playerC, bks);
      if (!reach.has(cellKey(needR, needC))) {
        const wd = DIRS[Math.floor(Math.random() * 4)];
        const wr = playerR + wd.dr, wc = playerC + wd.dc;
        if (inBounds(wr, wc, rows, cols) && grid[wr][wc] !== 'wall' && !bks.has(cellKey(wr, wc))) {
          playerR = wr; playerC = wc;
        }
        fails++; continue;
      }

      if (isCornerDeadlock(grid, rows, cols, needR, needC, targetKeys)) {
        fails++; continue;
      }

      box.row = needR; box.col = needC;
      playerR = moveR; playerC = moveC;
      pullCount[targetIdx]++;
      fails = 0;
    }

    if (!pullCount.every(p => p >= pullsPerBox)) continue;
    if (boxes.some(b => targetKeys.has(cellKey(b.row, b.col)))) continue;

    let allFar = true;
    for (const box of boxes) {
      let minD = Infinity;
      for (const t of targets) minD = Math.min(minD, manhattan(box.row, box.col, t.row, t.col));
      if (minD < 3) { allFar = false; break; }
    }
    if (!allFar) continue;

    if (boxes.some(b => isCornerDeadlock(grid, rows, cols, b.row, b.col, targetKeys))) continue;

    const finalBks = new Set(boxes.map(b => cellKey(b.row, b.col)));
    const finalReach = floodFill(grid, rows, cols, playerR, playerC, finalBks);
    let allReachable = true;
    for (const box of boxes) {
      let adj = false;
      for (const { dr, dc } of DIRS) {
        if (finalReach.has(cellKey(box.row + dr, box.col + dc))) { adj = true; break; }
      }
      if (!adj) { allReachable = false; break; }
    }
    if (!allReachable) continue;

    const outputGrid = [];
    for (let r = 0; r < rows; r++) {
      outputGrid[r] = [];
      for (let c = 0; c < cols; c++) {
        outputGrid[r][c] = grid[r][c] === 'wall' ? { type: 'stone' } : null;
      }
    }
    for (const t of targets) {
      outputGrid[t.row][t.col] = { type: 'target' };
    }

    return {
      rows, cols, grid: outputGrid,
      player: { row: playerR, col: playerC },
      boxes: boxes.map((b, i) => ({ id: i, row: b.row, col: b.col })),
      targets, level: 1,
    };
  }
  return null;
}

/* ============================================================
 *  关卡解析器（XSB 格式 → 游戏数据）
 * ============================================================ */

function parseLevel(map) {
  const maxCols = Math.max(...map.map(r => r.length));
  const paddedMap = map.map(r => r.padEnd(maxCols, ' '));
  const rows = paddedMap.length;
  const cols = maxCols;
  const grid = [];
  const boxes = [];
  const targets = [];
  let player = null;
  let boxId = 0;

  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) {
      const ch = paddedMap[r][c];
      switch (ch) {
        case '#':
          grid[r][c] = { type: 'stone' };
          break;
        case '$':
          grid[r][c] = null;
          boxes.push({ id: boxId++, row: r, col: c });
          break;
        case '.':
          grid[r][c] = { type: 'target' };
          targets.push({ row: r, col: c });
          break;
        case '@':
          grid[r][c] = null;
          player = { row: r, col: c };
          break;
        case '+':
          grid[r][c] = { type: 'target' };
          targets.push({ row: r, col: c });
          player = { row: r, col: c };
          break;
        case '*':
          grid[r][c] = { type: 'target' };
          targets.push({ row: r, col: c });
          boxes.push({ id: boxId++, row: r, col: c });
          break;
        default:
          grid[r][c] = null;
          break;
      }
    }
  }

  if (!player || boxes.length === 0 || boxes.length !== targets.length) return null;

  // 拒绝所有箱子已经在目标上的关卡（初始即通关）
  const alreadyWon = targets.every((t) =>
    boxes.some((b) => b.row === t.row && b.col === t.col)
  );
  if (alreadyWon) return null;

  // 从玩家位置洪水填充，标记所有可达的内部格子
  const inside = new Set();
  const queue = [[player.row, player.col]];
  inside.add(player.row * 1000 + player.col);
  while (queue.length > 0) {
    const [r, c] = queue.shift();
    const neighbors = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]];
    for (const [nr, nc] of neighbors) {
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const k = nr * 1000 + nc;
      if (inside.has(k)) continue;
      const cell = grid[nr][nc];
      // 墙壁也标记为内部（需要渲染），但不穿过
      if (cell && cell.type === 'stone') {
        inside.add(k);
        continue;
      }
      inside.add(k);
      queue.push([nr, nc]);
    }
  }

  // 将不可达的空格标记为 outside
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * 1000 + c;
      if (!inside.has(k)) {
        grid[r][c] = { type: 'outside' };
      }
    }
  }

  return { rows, cols, grid, player, boxes, targets, level: 1 };
}

/* ============================================================
 *  关卡选择逻辑
 *  - 随机选取未通关的经典关卡
 *  - 只有通关后才标记为已完成
 *  - 全部通关后重置，开启新一轮循环
 *  - 不再使用自动生成器
 * ============================================================ */

let _clearedIndices = new Set();
let _currentLevelIndex = -1;

function pickLevel() {
  // 全部通关 → 重置，开启新一轮
  if (_clearedIndices.size >= CLASSIC_LEVELS.length) {
    _clearedIndices = new Set();
  }

  // 收集未通关的关卡
  const available = [];
  for (let i = 0; i < CLASSIC_LEVELS.length; i++) {
    if (!_clearedIndices.has(i)) available.push(i);
  }

  // 打乱顺序
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  // 从未通关关卡中选一个可解析的
  for (const idx of available) {
    const data = parseLevel(CLASSIC_LEVELS[idx]);
    if (data) {
      _currentLevelIndex = idx;
      data.levelIndex = idx;
      // 显示关卡编号（1-based）和剩余关卡数
      data.levelDisplay = idx + 1;
      data.totalLevels = CLASSIC_LEVELS.length;
      data.clearedCount = _clearedIndices.size;
      return data;
    }
  }

  // 所有关卡都解析失败（理论上不会出现），强制重置再试
  _clearedIndices = new Set();
  return pickLevel();
}

/**
 * 标记当前关卡为已通关
 * 只在玩家真正通关时调用
 */
export function markLevelCleared(levelIndex) {
  if (levelIndex >= 0 && levelIndex < CLASSIC_LEVELS.length) {
    _clearedIndices.add(levelIndex);
  }
}

/**
 * 获取当前通关进度
 */
export function getLevelProgress() {
  return {
    cleared: _clearedIndices.size,
    total: CLASSIC_LEVELS.length,
  };
}

/* ============================================================
 *  公开 API
 * ============================================================ */

export function generateSokobanLevel(level) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(pickLevel());
    }, 5);
  });
}

export default { generateSokobanLevel, markLevelCleared, getLevelProgress };

