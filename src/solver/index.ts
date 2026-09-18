// Public barrel for the solver.
//
// Nothing in here is imported by src/sim, src/client or src/server — the solver
// is a consumer of the sim and never the other way round, so the sim's
// isolation rule is untouched and the client bundle never grows a search in it.
export { buildField, buildEdgeIndex, nearestSurface, geodesic, distAt, cellOf, nearestFree } from './field.ts';
export type { Field, EdgeIndex } from './field.ts';
export { Heap } from './heap.ts';
export { StatePool, packState, unpackState, stateFloats, SCALAR_FIELDS, PAIR_FIELDS, BOOL_FIELDS, ARRAY_FIELDS } from './pack.ts';
export { Nodes, search, viable, diverseGoals, DEFAULT_SEARCH, HELD_MASKS, FLIP_MASKS, DURATIONS } from './search.ts';
export type { SearchOpts, SearchResult, SearchStats, Heuristic, GoalTest } from './search.ts';
export { solveLevel, DEFAULT_SOLVE, OPT_STRATEGIES, OPT_SEARCH } from './solve.ts';
export type { SolveOpts, SolveResult, SegmentReport, Strategy } from './solve.ts';
export { optimiseLevel, greedyOrder, DEFAULT_OPTIMISE } from './optimise.ts';
export type { OptimiseOpts, OptimiseResult, OptimiseRound } from './optimise.ts';
export { HUMAN_DURATIONS, HUMAN_GRID, measureHumanSlip } from './human.ts';
export type { HumanSlip } from './human.ts';
export { scoreDifficulty, measureLine, measureTolerance, WEIGHTS, SCALE } from './difficulty.ts';
export type { Difficulty, LineStats, Tolerance } from './difficulty.ts';
