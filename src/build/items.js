// STUB - replaced by the items/packages module. API per docs/ARCHITECTURE.md "Items, packages, building".
export const ITEMS = {};
export function addItem(state, id, qty = 1) { const inv = (state.inventory ||= { items: {}, packages: [] }); inv.items[id] = (inv.items[id] || 0) + qty; }
export function removeItem(state, id, qty = 1) { const inv = state.inventory; if (!inv || (inv.items[id] || 0) < qty) return false; inv.items[id] -= qty; return true; }
export function countItem(state, id) { return state.inventory?.items?.[id] || 0; }
export function rollPackage() { return null; }
export function openPackage() { return []; }
export function drawPackage() {}
