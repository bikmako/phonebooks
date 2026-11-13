// Vite aliases the demo generator to this module in paid builds. Synthetic
// records cannot enter the paid distribution, even through a future caller.
export { createInitialState as createDemoState } from '../storage/initialState.js';
