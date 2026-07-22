import { logApi } from "./bugLog.js";

// Same-origin in production (Express serves the built frontend); in dev,
// Vite's server.proxy forwards /api/* to the backend (see vite.config.js),
// so this can always just call relative /api paths — no CORS needed either way.
async function request(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  let res;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "include",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      ...options,
    });
  } catch (netErr) {
    // Network failure (offline / backend down) — log method+path only, no body.
    logApi(method, path, "network-error");
    throw netErr;
  }
  logApi(method, path, res.status); // status only — never the request/response body
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.error || `request failed: ${res.status}`);
    err.status = res.status;
    err.body = body; // 422 rate-ack responses carry {requiresAck, reasons}
    throw err;
  }
  return body;
}

export const api = {
  login: (email, password) => request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/auth/me"),

  getProfile: () => request("/profile"),
  getProfileMeta: () => request("/profile/meta"),
  putProfile: (patch) => request("/profile", { method: "PUT", body: JSON.stringify(patch) }),

  getWeighins: () => request("/weighins"),
  postWeighin: (date, weightKg) => request("/weighins", { method: "POST", body: JSON.stringify({ date, weightKg }) }),
  deleteWeighin: (date) => request(`/weighins/${date}`, { method: "DELETE" }),
  getSummary: () => request("/weighins/summary"),

  getFoods: () => request("/foods"),
  putFood: (id, patch) => request(`/foods/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  // Barcode-off track: manual UPC entry. lookupUpc previews (never writes);
  // importUpc re-validates server-side and saves, tagged source:"community".
  lookupUpc: (upc) => request(`/foods/lookup-upc/${encodeURIComponent(upc)}`),
  importUpc: (upc) => request("/foods/import-upc", { method: "POST", body: JSON.stringify({ upc }) }),

  getRecipes: () => request("/recipes"),
  generateRecipeDrafts: (params) => request("/recipes/generate-drafts", { method: "POST", body: JSON.stringify(params) }),
  saveRecipeDraft: (draft) => request("/recipes/save-draft", { method: "POST", body: JSON.stringify(draft) }),
  importRecipe: (url) => request("/recipes/import", { method: "POST", body: JSON.stringify({ url }) }),
  placeRecipe: (payload) => request("/plans/place-recipe", { method: "POST", body: JSON.stringify(payload) }),
  fillTodayFromCart: () => request("/plans/fill-today-from-cart", { method: "POST" }),
  updateRecipe: (id, patch) => request(`/recipes/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteRecipe: (id) => request(`/recipes/${id}`, { method: "DELETE" }),

  getCurrentPlan: () => request("/plans/current"),
  generatePlan: (filters) => request("/plans/generate", { method: "POST", body: JSON.stringify({ filters }) }),
  getDayOptions: (dayOfWeek, filters) => request("/plans/day-options", { method: "POST", body: JSON.stringify({ dayOfWeek, filters }) }),
  acceptDay: (dayOfWeek, slots) => request("/plans/accept-day", { method: "POST", body: JSON.stringify({ dayOfWeek, slots }) }),
  setSlotLock: (planId, slotId, locked) => request(`/plans/${planId}/slots/${slotId}`, { method: "PUT", body: JSON.stringify({ locked }) }),
  getSlotAlternates: (planId, slotId, filters) => request(`/plans/${planId}/slots/${slotId}/alternates`, { method: "POST", body: JSON.stringify({ filters }) }),
  applySlotAlternate: (planId, slotId, slot) => request(`/plans/${planId}/slots/${slotId}/apply`, { method: "PUT", body: JSON.stringify(slot) }),
  swapSlot: (planId, slotId) => request(`/plans/${planId}/slots/${slotId}/swap`, { method: "POST" }),
  generateGroceryList: (planId) => request(`/plans/${planId}/grocery-list`, { method: "POST" }),
  checkGroceryItem: (planId, name, checked) => request(`/plans/${planId}/grocery-list/check`, { method: "PUT", body: JSON.stringify({ name, checked }) }),

  getTrainingMeta: () => request("/training/meta"),
  getTrainingPlan: () => request("/training"),
  generateTrainingPlan: (inputs) => request("/training/generate", { method: "POST", body: JSON.stringify(inputs) }),
  deleteTrainingPlan: () => request("/training", { method: "DELETE" }),

  // T (v2) — recipe taste ratings (soft solver re-rank; 1 = like, -1 = dislike).
  getRatings: () => request("/ratings"),
  rateRecipe: (recipeId, rating) => request("/ratings", { method: "PUT", body: JSON.stringify({ recipeId, rating }) }),
  unrateRecipe: (recipeId) => request(`/ratings/${recipeId}`, { method: "DELETE" }),

  getCart: () => request("/cart"),
  addToCart: (recipeId) => request("/cart", { method: "POST", body: JSON.stringify({ recipeId }) }),
  removeFromCart: (recipeId) => request(`/cart/${recipeId}`, { method: "DELETE" }),
  generateCartGroceryList: () => request("/cart/grocery-list", { method: "POST" }),

  // Food diary ("ate as planned"). Backend is being built in parallel — every
  // caller degrades gracefully on a 404 / missing field (see TodayTab).
  getDiary: (date) => request(`/diary/${date}`),
  logPlannedDiary: (date) => request("/diary/log-planned", { method: "POST", body: JSON.stringify({ date }) }),
  addDiaryEntry: (entry) => request("/diary/entry", { method: "POST", body: JSON.stringify(entry) }),
  deleteDiaryEntry: (id) => request(`/diary/entry/${id}`, { method: "DELETE" }),

  // Micronutrients — today's rollup, sourced from the solved plan's real
  // per-food grams (see routes/micronutrients.js for why the diary can't be
  // used for this honestly). Defaults to today when date is omitted.
  getMicronutrientsToday: (date) => request(`/micronutrients/today${date ? `?date=${date}` : ""}`),

  // Stage D2 — brain chat. getBrainStatus gates whether the chat bar renders at
  // all; brainChat sends one message. Both no-op cleanly when the brain is off.
  getBrainStatus: () => request("/brain/status"),
  brainChat: (message, depth, history) => request("/brain/chat", { method: "POST", body: JSON.stringify({ message, depth, history }) }),
};
