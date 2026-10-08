// The platform's one Plausible site (registry platform.analytics.plausible,
// confused4now.org). Only the production hostname loads it: previews on
// *.pages.dev and local tests load no script at all.
(function () {
  if (location.hostname !== "author.confused4now.org") return;
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://plausible.io/js/pa-eii3VlmU1ClI0VxGOsCTe.js";
  document.head.appendChild(s);
})();
