// Runs before first paint (a blocking script in <head>, not a module): apply the
// author's stored light/dark choice so a dark page never flashes light. With no
// stored choice the page follows the system. Same key as Quartz and the portal.
(function () {
  try {
    var t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {
    /* storage blocked: follow the system */
  }
})();
