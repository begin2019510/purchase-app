const https = require("https");
function check(file, markers) {
  return new Promise(resolve => {
    https.get("https://121212121.top/" + file, { headers: { "Cache-Control": "no-cache" } }, r => {
      let d = "";
      r.on("data", c => d += c);
      r.on("end", () => resolve({ file, len: d.length, ok: markers.map(m => d.includes(m)) }));
    });
  });
}
Promise.all([
  check("js/items.js", ["Purchase expense no longer"]),
  check("js/app.js", ["getMonthPurchaseTotal"]),
  check("js/stats.js", ["animateNumber", "budget-pool"]),
  check("js/expense.js", ["pureExpenseOut", "purchaseOut"]),
  check("theme.css", ["budget-pool", "fadeInUp"])
]).then(r => r.forEach(x => console.log(x.file + ": len=" + x.len + " " + JSON.stringify(x.ok))));