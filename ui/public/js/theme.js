// Loaded before the stylesheet paints, so a chosen theme does not flash.
// "auto" leaves the attribute off and the stylesheet follows the system.
(function () {
  try {
    var theme = localStorage.getItem("tenric-ui-theme");
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  } catch (error) { /* storage unavailable: follow the system */ }
})();
