// Sidebar collapse preference — display-only local state; everything else
// the app remembers lives on the backend against the profile.
const SIDEBAR_KEY = "shadcut:sidebar";

export const sidebarPref = {
  get() {
    try {
      return window.localStorage.getItem(SIDEBAR_KEY) === "collapsed";
    } catch {
      return false;
    }
  },
  set(collapsed) {
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "open");
  },
};
