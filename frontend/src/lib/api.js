// Same-origin in production (Express serves the built frontend); in dev,
// Vite's server.proxy forwards /api/* to the backend (see vite.config.js),
// so this can always just call relative /api paths — no CORS needed either way.
async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
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

  getCart: () => request("/cart"),
  addToCart: (recipeId) => request("/cart", { method: "POST", body: JSON.stringify({ recipeId }) }),
  removeFromCart: (recipeId) => request(`/cart/${recipeId}`, { method: "DELETE" }),
  generateCartGroceryList: () => request("/cart/grocery-list", { method: "POST" }),
};
