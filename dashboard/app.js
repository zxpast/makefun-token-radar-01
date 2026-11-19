// Token Radar round 5 — dashboard rendering. No network: every number comes
// from data.js, the file main.ts wrote beside this page. Sorting, filtering,
// the detail view and the farm what-if controls all run here, in the browser.
(function () {
  const D = window.RADAR;
  const rows = D.rows;
  const watch = new Set(D.watchlist);
  const $ = (id) => document.getElementById(id);

  function money(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
    if (n < 100) return "$" + n.toFixed(2);
    return "$" + Math.round(n);
  }
  function signed(n, dec) {
    return (n >= 0 ? "+" : "−") + "$" + Math.abs(n).toFixed(dec === undefined ? 2 : dec);
  }
  function pct(x, dec) {
    return (x * 100).toFixed(dec === undefined ? 1 : dec) + "%";
  }
  function ageFmt(days) {
    if (days === null || days === undefined) return "—";
    if (days < 365) return days + "d";
    return (days / 365).toFixed(1) + "y";
  }
  function growthFmt(g) {
    if (g === null || g === undefined) return "—";
    return (g >= 0 ? "+" : "") + g.toFixed(1) + "%";
  }

  // ---- KPI strip (from the shipped board, $1,000 / 60 days) ----
  $("kpi-rows").textContent = D.totals.rows;
  $("kpi-total").textContent = money(D.totals.totalImplied);
  const shipped = D.backtest.find((b) => b.label.indexOf("shipped model") >= 0);
  $("kpi-miss").textContent = "×" + shipped.loo.medMissX.toFixed(2);
  $("kpi-within3").textContent = pct(shipped.loo.within3x, 0);
  $("kpi-farm").textContent = D.totals.farm + " FARM";
  $("kpi-besthour").textContent = signed(D.totals.bestPerHour, 2) + "/h";

  // ---- Launch-odds category table ----
  const lc = $("launch-cats");
  lc.innerHTML = D.launchOdds.byCategory
    .map((c) => "<tr><td>" + c.category + "</td><td>" + c.n + "</td><td>" + pct(c.share, 0) + "</td></tr>")
    .join("");

  // ---- Category dropdown ----
  const catSel = $("cat");
  [...new Set(rows.map((r) => r.category))].sort().forEach((c) => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    catSel.appendChild(o);
  });

  // ---- Farm math under the what-if controls ----
  function wiState() {
    return {
      deposit: Number($("wi-deposit").value),
      share: Number($("wi-share").value),
      tbill: Number($("wi-tbill").value),
    };
  }
  function wiFarm(r, wi) {
    const dd = r.dollarDays === undefined ? 60 / (60 + (r.ageDays === null ? 365 : r.ageDays) / 2) : r.dollarDays;
    const slice = wi.share * r.implied_value_usd * (wi.deposit / r.tvl_usd) * dd;
    const net = slice - 5 - (wi.deposit * wi.tbill * 60) / 365;
    const verdict = net > 0 ? "FARM" : net > -10 ? "THIN" : "SKIP";
    return { slice, net, verdict };
  }
  // dollarDays is not in the gate rows; keep it on the full rows for the page.
  rows.forEach((r) => {
    const age = r.ageDays === null ? 365 : r.ageDays;
    r.dollarDays = 60 / (60 + age / 2);
  });

  function currentRows() {
    const wi = wiState();
    const sort = $("sort").value;
    const cat = catSel.value;
    const verdict = $("verdict").value;
    const wlOnly = $("watchlist").checked;
    const q = $("q").value.trim().toLowerCase();
    let list = rows.map((r) => ({ r, f: wiFarm(r, wi) }));
    if (cat) list = list.filter((e) => e.r.category === cat);
    if (verdict) list = list.filter((e) => e.f.verdict === verdict);
    if (wlOnly) list = list.filter((e) => watch.has(e.r.slug));
    if (q) list = list.filter((e) => (e.r.name + " " + e.r.slug).toLowerCase().indexOf(q) >= 0);
    const key = {
      rank: (a, b) => a.r.rank - b.r.rank,
      tvl: (a, b) => b.r.tvl_usd - a.r.tvl_usd,
      growth: (a, b) => (b.r.change_7d === null ? -999 : b.r.change_7d) - (a.r.change_7d === null ? -999 : a.r.change_7d),
      age: (a, b) => (b.r.ageDays === null ? -1 : b.r.ageDays) - (a.r.ageDays === null ? -1 : a.r.ageDays),
      implied: (a, b) => b.r.implied_value_usd - a.r.implied_value_usd,
      net: (a, b) => b.f.net - a.f.net,
    }[sort];
    list.sort(key);
    return { list, wi };
  }

  function render() {
    const { list, wi } = currentRows();
    const tb = $("rows");
    tb.innerHTML = list
      .map((e) => {
        const r = e.r;
        return (
          "<tr data-slug=\"" + r.slug + "\">" +
          "<td class=\"num\">" + r.rank + "</td>" +
          "<td class=\"name\">" + r.name + "<small>" + r.slug + "</small></td>" +
          "<td class=\"num\">" + money(r.tvl_usd) + "</td>" +
          "<td class=\"num\">" + growthFmt(r.change_7d) + "</td>" +
          "<td class=\"num\">" + ageFmt(r.ageDays) + "</td>" +
          "<td>" + r.category + "</td>" +
          "<td class=\"num\">" + money(r.implied_value_usd) + "</td>" +
          "<td class=\"num\">" + r.rankP10 + "–" + r.rankP90 + "</td>" +
          "<td class=\"num\">" + pct(r.launchShare, 0) + "</td>" +
          "<td><span class=\"verdict " + e.f.verdict + "\">" + e.f.verdict + "</span></td>" +
          "<td class=\"num\">" + signed(e.f.net) + "</td>" +
          "</tr>"
        );
      })
      .join("");
    $("count").textContent =
      list.length + " of " + rows.length + " rows · deposit $" + wi.deposit.toLocaleString("en-US") +
      " · drop share " + pct(wi.share, 1) + " · T-bill " + pct(wi.tbill, 0) + " · 60 days";
    const farms = list.filter((e) => e.f.verdict === "FARM").length;
    $("wi-note").textContent = farms + " FARM under these settings";
    tb.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => openDetail(tr.getAttribute("data-slug")));
    });
  }

  // ---- Detail view ----
  const dlg = $("detail");
  function openDetail(slug) {
    const r = rows.find((x) => x.slug === slug);
    if (!r) return;
    const wi = wiState();
    const f = wiFarm(r, wi);
    const w = r.waterfall;
    const farmRows = [
      ["Verdict", "<span class=\"verdict " + f.verdict + "\">" + f.verdict + "</span>"],
      ["Drop slice", money(f.slice)],
      ["Net at $" + wi.deposit.toLocaleString("en-US") + " / 60 days", signed(f.net)],
      ["Break-even deposit", r.breakEvenDeposit === null ? "none — even $1,000 loses" : "$" + Math.round(r.breakEvenDeposit).toLocaleString("en-US")],
      ["Break-even drop share", r.breakEvenShare === null ? "—" : pct(r.breakEvenShare, 1)],
      ["Work", r.hours + " hours (" + r.farm_steps.length + " steps)"],
    ];
    const compRows = r.comps
      .map(
        (c) =>
          "<tr><td>" + c.name + "</td><td class=\"num\">" + money(c.tvl) + "</td><td class=\"num\">" + money(c.mcap) + "</td><td class=\"num\">" + c.ratio.toFixed(2) + "×</td></tr>",
      )
      .join("");
    const stepList = r.farm_steps.map((s) => "<li>" + s + "</li>").join("");
    $("detail-body").innerHTML =
      "<h3>" + r.name + "</h3>" +
      "<p class=\"sub\">#" + r.rank + " · " + r.slug + " · " + r.category + " · " + r.chains.join(", ") + " · TVL " + money(r.tvl_usd) +
      " · 7d " + growthFmt(r.change_7d) + " · age " + ageFmt(r.ageDays) + "</p>" +
      "<p class=\"big\">" + money(r.implied_value_usd) + "</p>" +
      "<p>Rank range p10–p90: " + r.rankP10 + "–" + r.rankP90 + " (200 bootstrap refits). " +
      "Launch share " + pct(r.launchShare, 0) + " — " + r.launchBasis + ", n=" + r.launchN + ". " +
      "Cross-section share, not a forward forecast.</p>" +
      "<h4>How the value is built</h4>" +
      "<table class=\"nums\"><thead><tr><th>Step</th><th>Value</th></tr></thead><tbody>" +
      "<tr><td>Size curve alone</td><td>" + money(w.sizeValue) + "</td></tr>" +
      "<tr><td>After sector (" + r.category + ", offset " + (r.sectorOffset >= 0 ? "+" : "") + r.sectorOffset.toFixed(2) + " dex, n=" + r.sectorN + ")</td><td>" + money(w.sectorValue) + "</td></tr>" +
      "<tr><td>After momentum (growth ×" + r.growthMult.toFixed(2) + ")</td><td>" + money(w.momValue) + "</td></tr>" +
      "<tr><td>After age &amp; chains (×" + (r.maturityMult * r.chainMult).toFixed(2) + ")</td><td>" + money(w.finalValue) + "</td></tr>" +
      "</tbody></table>" +
      "<h4>Farm</h4><div class=\"farmbox\">" +
      farmRows.map((x) => "<p><strong>" + x[0] + ":</strong> " + x[1] + "</p>").join("") +
      "</div>" +
      "<ol class=\"steps\">" + stepList + "</ol>" +
      "<h4>Nearest comps — same category first, then the nearest size</h4>" +
      "<table class=\"nums\"><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Ratio</th></tr></thead><tbody>" +
      compRows +
      "</tbody></table>" +
      "<p>Nearest-comps value: " + money(r.knnValue) + " (median ratio " + r.knnMedianRatio.toFixed(2) +
      "×). This row's value sits within its comps' ratio range.</p>" +
      "<p class=\"caveat\">Values are the entry's own claims. The snapshot is one date; " +
      "a protocol that records no token may still have one its DefiLlama record does not carry.</p>";
    if (!dlg.open) dlg.showModal();
    history.replaceState(null, "", "#p=" + slug);
  }

  // ---- Controls, hash routing, init ----
  ["sort", "cat", "verdict", "watchlist", "q", "wi-deposit", "wi-share", "wi-tbill"].forEach((id) => {
    $(id).addEventListener("change", render);
    $(id).addEventListener("input", render);
  });
  function applyHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get("v")) { $("verdict").value = h.get("v"); }
    if (h.get("c")) { $("cat").value = h.get("c"); }
    render();
    if (h.get("p")) openDetail(h.get("p"));
  }
  dlg.addEventListener("close", () => {
    if (location.hash.indexOf("#p=") === 0) history.replaceState(null, "", location.pathname + location.search);
  });
  applyHash();
})();
