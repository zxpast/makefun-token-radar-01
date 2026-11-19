// Token Radar's page: it renders the board from the data file beside it (data.js sets
// window.RADAR) and nothing else. Every number on the page comes from that data, and the
// detail drawer replays the model's own arithmetic on the row it shows, so the page and
// board.json can never disagree: the drawer recomputes the row and says so.

(function () {
  "use strict";

  var DATA = window.RADAR;
  var root = document.getElementById("board");
  if (!DATA || !root) {
    if (root) {
      root.textContent = "Token Radar needs its data file (data.js) beside this page.";
    }
    return;
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function numOr(value, fallback) {
    if (typeof value === "number" && isFinite(value)) {
      return value;
    }
    return fallback;
  }

  function clampNum(value, low, high) {
    if (value < low) {
      return low;
    }
    if (value > high) {
      return high;
    }
    return value;
  }

  function fmtMoney(value) {
    if (value >= 1000000000) {
      return "$" + (value / 1000000000).toFixed(2) + "B";
    }
    if (value >= 1000000) {
      return "$" + (value / 1000000).toFixed(1) + "M";
    }
    if (value >= 1000) {
      return "$" + (value / 1000).toFixed(1) + "K";
    }
    return "$" + String(value);
  }

  function fmtPct(change) {
    if (change === null || change === undefined) {
      return "—";
    }
    return (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
  }

  function fmtAge(days) {
    if (days === null || days === undefined) {
      return "—";
    }
    if (days < 365) {
      return days + "d";
    }
    return (days / 365).toFixed(1) + "y";
  }

  // The model's own arithmetic, replayed on a row: the same growth, maturity and chain
  // factors the entry scored it with, at full precision, so the drawer lands on the exact
  // whole-dollar value board.json carries.
  function impliedOf(row, model) {
    var growthPct = clampNum(numOr(row.change_7d, 0), model.growth_floor, model.growth_cap);
    var growthMul = 1 + (growthPct / 100) * model.growth_weight;
    var ageForModel = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var cappedAge = Math.min(Math.max(ageForModel, 0), model.maturity_days);
    var ageMul = model.maturity_floor + (cappedAge / model.maturity_days) * model.maturity_range;
    var extraChains = Math.min(Math.max(row.chains.length - 1, 0), model.chain_max_extra);
    var chainMul = 1 + extraChains * model.chain_step;
    var base = row.tvl_usd * model.base_multiple;
    return Math.max(1, Math.round(base * growthMul * ageMul * chainMul));
  }

  function gasLabel(chain) {
    if (chain === "Ethereum") {
      return "about $8 of gas per transaction";
    }
    if (["Solana", "Sui", "Aptos", "NEAR", "Sei"].indexOf(chain) >= 0) {
      return "about $0.05 of gas per transaction";
    }
    if (["Base", "Arbitrum", "Optimism", "Linea", "Scroll", "Unichain", "Blast",
      "zkSync Era", "Polygon", "Mantle", "Celo", "Mode", "BOB", "Abstract", "Soneium"].indexOf(chain) >= 0) {
      return "about $0.50 of gas per transaction";
    }
    return "about $2 of gas per transaction";
  }

  function stakeFor(tvl) {
    if (tvl >= 5000000000) {
      return 250;
    }
    if (tvl >= 1000000000) {
      return 150;
    }
    if (tvl >= 100000000) {
      return 100;
    }
    return 50;
  }

  function holdFor(ageDays) {
    if (ageDays === null || ageDays === undefined) {
      return 30;
    }
    if (ageDays < 180) {
      return 60;
    }
    if (ageDays < 365) {
      return 45;
    }
    return 30;
  }

  function hasAny(lower, words) {
    for (var i = 0; i < words.length; i++) {
      if (lower.indexOf(words[i]) >= 0) {
        return true;
      }
    }
    return false;
  }

  function mainAction(row, capital, chain) {
    var lower = (row.category || "").toLowerCase();
    var name = row.name;
    var half = Math.floor(capital / 2);
    if (hasAny(lower, ["lend", "cdp", "collateral"])) {
      return ["Supply $", capital, " of USDC to ", name, " on ", chain,
        " as collateral, then borrow $", half,
        " of stablecoin against it and repay the borrow within the week."].join("");
    }
    if (hasAny(lower, ["dex", "yield", "leveraged farm"])) {
      return ["Provide $", capital, " of liquidity to ", name, "'s deepest pool on ", chain,
        " and stake the LP receipt in its rewards gauge."].join("");
    }
    if (hasAny(lower, ["bridge"])) {
      return ["Bridge $", capital, " of USDC into ", chain, " through ", name,
        ", then use the bridged funds in one app on the destination chain."].join("");
    }
    if (hasAny(lower, ["liquid staking", "staking", "restak"])) {
      return ["Stake $", capital, " of the chain's native asset through ", name,
        " and hold the staking receipt instead of selling it."].join("");
    }
    if (hasAny(lower, ["perpetual", "derivative", "options", "basis trading"])) {
      return ["Deposit $", capital, " of USDC as margin on ", name,
        " and open one small hedged position, then close it after a day."].join("");
    }
    if (hasAny(lower, ["prediction"])) {
      return ["Fund the account with $", capital,
        " and take one small position in a market on ", name, " that settles within a week."].join("");
    }
    if (hasAny(lower, ["curator", "allocator"])) {
      return ["Deposit $", capital, " into a ", name, " vault on ", chain,
        " and keep the vault shares through one full epoch."].join("");
    }
    if (hasAny(lower, ["stable"])) {
      return ["Mint or hold $", capital, " of the stable asset through ", name, " on ", chain,
        " and keep it through one peg check."].join("");
    }
    if (hasAny(lower, ["rwa"])) {
      return ["Mint $", capital, " of the protocol's yield-bearing asset on ", chain,
        " and hold it for the full accrual period."].join("");
    }
    if (hasAny(lower, ["insurance"])) {
      return ["Buy $", capital, " of cover from ", name, " on ", chain,
        " and keep the policy active for the full term."].join("");
    }
    if (lower === "chain") {
      return ["Bridge $", capital, " onto ", name,
        " and use it in two of the chain's own apps, keeping the funds on the chain."].join("");
    }
    return ["Deposit $", capital, " of USDC into ", name, " on ", chain,
      " and keep the position open."].join("");
  }

  function joinStep(text, cost, time) {
    var out = text + " Cost: " + cost + ". Time: " + time + ".";
    if (out.length > 600) {
      out = out.slice(0, 596) + "...";
    }
    if (out.length < 20) {
      out = out + " Hold the position and check the protocol's own page.";
    }
    return out;
  }

  function farmStepsFor(row) {
    var chain = row.chains.length > 0 ? row.chains[0] : "its main chain";
    var chain2 = row.chains.length > 1 ? row.chains[1] : null;
    var capital = stakeFor(row.tvl_usd);
    var half = Math.floor(capital / 2);
    var hold = holdFor(row.age_days);
    var gas = gasLabel(chain);
    var action = mainAction(row, capital, chain);
    var second;
    if (chain2 !== null) {
      second = ["Repeat the main action once on ", chain2, " with $", half,
        " so the wallet is active on two chains."].join("");
    } else {
      second = ["Open a second small position in the same protocol, in a different pool or vault, with $",
        half, "."].join("");
    }
    var fresh = ["Use a fresh wallet that holds only the funds you plan to farm, ",
      "and keep its seed phrase offline."].join("");
    var secondAct = ["Do a second, different action in the same protocol: a swap, a vote, ",
      "a deposit into another pool, or a borrow."].join("");
    var weekly = "Repeat one qualifying action each week, such as a deposit, a borrow, a swap or a vote.";
    var holdText = ["Hold the position for at least ", hold,
      " days so the activity is counted in more than one snapshot."].join("");
    var beforeOut = ["Before you withdraw, open the protocol's own points or rewards page ",
      "and claim only from the link it publishes."].join("");
    var logText = ["Write the wallet, the dates and every transaction in a farm log, and plan the exit: ",
      "unwind in two steps and never pay a fee to claim."].join("");
    return [
      joinStep(fresh, "nothing to set up", "5 minutes"),
      joinStep(action, "$" + capital + " of capital and " + gas, "15 minutes to set up"),
      joinStep(second, "$" + half + " of capital and " + gasLabel(chain2 === null ? chain : chain2), "15 minutes to set up"),
      joinStep(secondAct, gas, "10 minutes"),
      joinStep(weekly, gas + " a week", "10 minutes a week"),
      joinStep(holdText, "the $" + capital + " stays in the position", hold + " days"),
      joinStep(beforeOut, "no fee to check, and never pay to claim", "10 minutes"),
      joinStep(logText, "nothing but the log", "5 minutes"),
    ];
  }

  window.RADAR_DEBUG = { impliedOf: impliedOf, farmSteps: farmStepsFor };

  var state = {
    tab: "pre",
    query: "",
    category: "",
    chain: "",
    watchlistOnly: false,
    sortKey: "rank",
    sortDir: 1,
    picked: null,
  };

  function allCategories(rows) {
    var seen = {};
    var out = [];
    rows.forEach(function (r) {
      if (r.category && !seen[r.category]) {
        seen[r.category] = true;
        out.push(r.category);
      }
    });
    out.sort();
    return out;
  }

  function allChains(rows) {
    var seen = {};
    var out = [];
    rows.forEach(function (r) {
      r.chains.forEach(function (c) {
        if (!seen[c]) {
          seen[c] = true;
          out.push(c);
        }
      });
    });
    out.sort();
    return out;
  }

  function visibleRows() {
    var rows = state.tab === "live" ? DATA.live : DATA.rows;
    var q = state.query.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.tab === "pre" && state.watchlistOnly && !r.is_watchlist) {
        return false;
      }
      if (state.category && r.category !== state.category) {
        return false;
      }
      if (state.chain && r.chains.indexOf(state.chain) < 0) {
        return false;
      }
      if (q) {
        var hay = (r.name + " " + (r.category || "") + " " + r.chains.join(" ")).toLowerCase();
        if (hay.indexOf(q) < 0) {
          return false;
        }
      }
      return true;
    });
    var key = state.sortKey;
    var dir = state.sortDir;
    out.sort(function (a, b) {
      var av;
      var bv;
      if (state.tab === "live") {
        av = key === "mcap" ? (a.mcap_usd || 0) : 0;
        bv = key === "mcap" ? (b.mcap_usd || 0) : 0;
        if (key === "mcap" && av !== bv) {
          return (av - bv) * dir;
        }
        return 0;
      }
      av = key === "value" ? a.implied_value_usd : a.rank;
      bv = key === "value" ? b.implied_value_usd : b.rank;
      if (av !== bv) {
        return (av - bv) * dir;
      }
      return a.rank - b.rank;
    });
    return out;
  }

  function subline(row, maxChains) {
    var shown = row.chains.slice(0, maxChains).join(", ");
    if (row.category) {
      return row.category + " on " + shown;
    }
    return shown;
  }

  function optionList(values, current, allLabel) {
    var html = '<option value="">' + esc(allLabel) + "</option>";
    values.forEach(function (v) {
      html += '<option value="' + esc(v) + '"' + (v === current ? " selected" : "") + ">" + esc(v) + "</option>";
    });
    return html;
  }

  function statRow(label, value) {
    return '<div class="stat"><span>' + esc(label) + "</span><output>" + esc(value) + "</output></div>";
  }

  function renderTop() {
    var top5 = DATA.rows.slice(0, 5);
    var cards = top5.map(function (r) {
      var gold = r.rank <= 3 ? " gold" : "";
      return '<article class="card" tabindex="0" data-slug="' + esc(r.slug) + '">' +
        '<span class="rank-tag' + gold + '">RANK ' + r.rank + "</span>" +
        "<h3>" + esc(r.name) + "</h3>" +
        '<div class="value">' + esc(fmtMoney(r.implied_value_usd)) + "</div>" +
        '<div class="sub">TVL ' + esc(fmtMoney(r.tvl_usd)) + " · " + esc(fmtPct(r.change_7d)) + " 7d</div>" +
        "</article>";
    }).join("");
    return '<div class="wrap">' +
      '<header class="topbar">' +
      '<div class="brand"><span class="dot"></span>TOKEN RADAR</div>' +
      '<div class="meta">Snapshot <b>' + esc(DATA.as_of) + "</b> · DefiLlama protocol index · <b>" + esc(DATA.model_version) + "</b> model</div>" +
      "</header>" +
      '<section class="hero"><div>' +
      "<h1>" + DATA.watchlist_size + " watchlist protocols, ranked by implied value</h1>" +
      '<p class="lede">The watchlist is the floor: every protocol with at least <b>' + esc(fmtMoney(DATA.floor_usd)) + "</b> of TVL and no token on record. " +
      "The early radar adds <b>" + DATA.early_size + "</b> more below that floor, every one of them passing the watchlist's own rule. " +
      "Implied value is a model, not a promise.</p>" +
      "</div>" +
      '<div class="stats">' +
      statRow("Watchlist covered", DATA.watchlist_size + " / " + DATA.watchlist_size) +
      statRow("Pre-token rows scored", String(DATA.board_size)) +
      statRow("Early rows below the floor", String(DATA.early_size)) +
      statRow("Live-token protocols set aside", String(DATA.live_size)) +
      statRow("Total implied value", fmtMoney(DATA.total_implied_usd)) +
      statRow("Base multiple, market-calibrated", "x" + DATA.calibration.base_multiple.toFixed(4)) +
      "</div></section>" +
      '<section class="spot">' + cards + "</section>";
  }

  function renderFilters() {
    var rows = state.tab === "live" ? DATA.live : DATA.rows;
    var cats = allCategories(rows);
    var chains = allChains(rows);
    var shown = visibleRows().length;
    return '<div class="filters">' +
      '<label class="field"><span>Search</span><input id="q" type="search" placeholder="Search name, category or chain" value="' + esc(state.query) + '"></label>' +
      '<label class="field"><span>Category</span><select id="cat">' + optionList(cats, state.category, "All categories") + "</select></label>" +
      '<label class="field"><span>Chain</span><select id="chain">' + optionList(chains, state.chain, "All chains") + "</select></label>" +
      '<div class="field"><span>Token status</span><div class="tabs">' +
      '<button type="button" data-tab="pre" aria-pressed="' + (state.tab === "pre") + '">Pre-token</button>' +
      '<button type="button" data-tab="live" aria-pressed="' + (state.tab === "live") + '">Live token</button>' +
      "</div></div>" +
      '<div class="field"><span>Scope</span><button type="button" class="toggle" id="watch" aria-pressed="' + state.watchlistOnly + '">Watchlist only</button></div>' +
      '<div class="count">' + shown + " rows shown</div>" +
      "</div>";
  }

  function sortButton(key, label) {
    return '<button type="button" data-sort="' + key + '">' + esc(label) + " ∨</button>";
  }

  function renderTable() {
    var rows = visibleRows();
    var head;
    var body;
    if (state.tab === "live") {
      head = "<tr><th>#</th><th>Protocol</th><th class=\"num\">TVL</th><th class=\"num\">" + sortButton("mcap", "Market cap") + "</th><th class=\"num\">7d</th><th>Token</th></tr>";
      body = rows.map(function (r, i) {
        var change = r.change_7d === null || r.change_7d === undefined ? '<span class="num">—</span>' : '<span class="num ' + (r.change_7d >= 0 ? "up" : "down") + '">' + esc(fmtPct(r.change_7d)) + "</span>";
        return '<tr data-slug="' + esc(r.slug) + '" data-live="1">' +
          "<td><span class=\"pill\">" + (i + 1) + "</span></td>" +
          '<td><div class="name">' + esc(r.name) + '</div><div class="under">' + esc(subline(r, 2)) + "</div></td>" +
          '<td class="num">' + esc(fmtMoney(r.tvl_usd)) + "</td>" +
          '<td class="num">' + esc(fmtMoney(r.mcap_usd || 0)) + "</td>" +
          "<td>" + change + "</td>" +
          '<td><span class="token-flag">' + esc(r.symbol || "trades") + "</span></td>" +
          "</tr>";
      }).join("");
      var liveCaption = "Live-token protocols, largest market cap first. Their tokens already trade, so the radar shows the market's own value, not a model.";
      return '<section class="panel"><div class="caption">' + esc(liveCaption) + "</div>" +
        '<table class="board"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></section>";
    }
    head = "<tr><th>" + sortButton("rank", "Rank") + "</th><th>Protocol</th><th class=\"num\">TVL</th><th class=\"num\">7d</th><th class=\"num\">Age</th><th class=\"num\">" + sortButton("value", "Implied value") + "</th><th>Scope</th><th>Token</th></tr>";
    var top = DATA.rows.length > 0 ? DATA.rows[0].implied_value_usd : 1;
    body = rows.map(function (r) {
      var gold = r.rank <= 3 ? " gold" : "";
      var picked = state.picked === r.slug ? " picked" : "";
      var change = r.change_7d === null || r.change_7d === undefined
        ? '<span class="num">—</span>'
        : '<span class="num ' + (r.change_7d >= 0 ? "up" : "down") + '">' + esc(fmtPct(r.change_7d)) + "</span>";
      var width = Math.max(2, Math.round((r.implied_value_usd / top) * 100));
      var scope = r.is_watchlist ? '<span class="badge">Watchlist</span>' : "";
      return '<tr data-slug="' + esc(r.slug) + '" class="' + picked.trim() + '">' +
        '<td><span class="pill' + gold + '">' + r.rank + "</span></td>" +
        '<td><div class="name">' + esc(r.name) + '</div><div class="under">' + esc(subline(r, 2)) + "</div></td>" +
        '<td class="num">' + esc(fmtMoney(r.tvl_usd)) + "</td>" +
        "<td>" + change + "</td>" +
        '<td class="num">' + esc(fmtAge(r.age_days)) + "</td>" +
        '<td><div class="value-cell"><span class="track"><span class="fill" style="width:' + width + '%"></span></span><span class="num">' + esc(fmtMoney(r.implied_value_usd)) + "</span></div></td>" +
        "<td>" + scope + "</td>" +
        '<td><span class="token-flag"><span class="dot"></span>no token</span></td>' +
        "</tr>";
    }).join("");
    if (rows.length === 0) {
      body = '<tr><td colspan="8"><div class="empty">Nothing matches these filters.</div></td></tr>';
    }
    return '<section class="panel"><div class="caption">Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.</div>' +
      '<table class="board"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></section>";
  }

  function renderModelNote() {
    var m = DATA.model;
    var c = DATA.calibration;
    return '<section class="model-note"><h2>How the value is made</h2>' +
      "<p>Implied value is TVL times <b>x" + c.base_multiple.toFixed(4) + "</b>, the median market-cap-to-TVL ratio of the snapshot's own " +
      c.live_protocols + " live-token protocols — the market, not the author, says what a dollar of TVL is worth as a token.</p>" +
      "<p>That base is then moved by the seven-day change (kept between " + m.growth_floor + "% and +" + m.growth_cap + "%, at " +
      Math.round(m.growth_weight * 100) + "% weight), by age without a token (from x" + m.maturity_floor + " for a new protocol to x" +
      (m.maturity_floor + m.maturity_range).toFixed(2) + " after " + Math.round(m.maturity_days / 365) + " years), and by chain spread (+" +
      Math.round(m.chain_step * 100) + "% per extra chain, up to +" + Math.round(m.chain_step * m.chain_max_extra * 100) + "%).</p>" +
      "<p>The watchlist is the floor, never the ceiling: the board also ranks protocols below it that pass the watchlist's own rule. " +
      "Implied value is a model, not a promise, and never a prediction that a token will be issued.</p></section>";
  }

  function splitStep(joined) {
    var costAt = joined.indexOf(" Cost: ");
    var timeAt = joined.indexOf(". Time: ", costAt);
    return {
      action: joined.slice(0, costAt),
      cost: joined.slice(costAt + 7, timeAt),
      time: joined.slice(timeAt + 8, -1),
    };
  }

  function drawerHtml() {
    if (!state.picked) {
      return "";
    }
    var row = null;
    var live = false;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === state.picked) {
        row = DATA.rows[i];
        break;
      }
    }
    if (!row) {
      for (var j = 0; j < DATA.live.length; j++) {
        if (DATA.live[j].slug === state.picked) {
          row = DATA.live[j];
          live = true;
          break;
        }
      }
    }
    if (!row) {
      return "";
    }
    var kicker = live ? "LIVE TOKEN" : "RANK " + row.rank + " OF " + DATA.board_size + (row.is_watchlist ? " · WATCHLIST" : "");
    var html = '<button type="button" class="close">Close</button>' +
      '<p class="kicker">' + esc(kicker) + "</p>" +
      "<h2>" + esc(row.name) + "</h2>" +
      '<p class="chains-line">' + esc(subline(row, row.chains.length)) + "</p>";
    if (live) {
      html += "<h3>Market value</h3>" +
        '<div class="kv"><span>TVL</span><span>' + esc(fmtMoney(row.tvl_usd)) + "</span></div>" +
        '<div class="kv"><span>Market cap</span><span>' + esc(fmtMoney(row.mcap_usd || 0)) + "</span></div>" +
        '<div class="kv"><span>Seven-day growth</span><span>' + esc(fmtPct(row.change_7d)) + "</span></div>" +
        '<div class="kv"><span>Chains</span><span>' + row.chains.length + "</span></div>" +
        '<p class="recheck">This protocol\u2019s token already trades, so the radar shows the market\u2019s own value, not a model.</p>';
      return html;
    }
    var again = impliedOf(row, DATA.model);
    html += "<h3>Implied value</h3>" +
      '<div class="kv"><span>TVL</span><span>' + esc(fmtMoney(row.tvl_usd)) + "</span></div>" +
      '<div class="kv"><span>Seven-day growth</span><span>' + esc(fmtPct(row.change_7d)) + "</span></div>" +
      '<div class="kv"><span>Age with no token</span><span>' + esc(fmtAge(row.age_days)) + "</span></div>" +
      '<div class="kv"><span>Chains</span><span>' + row.chains.length + "</span></div>" +
      '<div class="kv"><span>Growth multiplier</span><span>' + esc(String(row.growth_multiplier)) + "</span></div>" +
      '<div class="kv"><span>Maturity multiplier</span><span>' + esc(String(row.maturity_multiplier)) + "</span></div>" +
      '<div class="kv"><span>Chain multiplier</span><span>' + esc(String(row.chain_multiplier)) + "</span></div>" +
      '<div class="kv"><span>Implied value</span><span>' + esc(fmtMoney(row.implied_value_usd)) + "</span></div>" +
      '<p class="recheck">Model ' + esc(DATA.model_version) + ": the same function scores every protocol. The page recomputes this row as " +
      esc(fmtMoney(again)) + ", the same number board.json carries. This is an estimate, not a price.</p>" +
      "<h3>Farm plan</h3>" +
      '<ol class="plan">' + farmStepsFor(row).map(function (s) {
        var parts = splitStep(s);
        return "<li><div><div class=\"act\">" + esc(parts.action) + '</div><div class="bill">Cost: ' + esc(parts.cost) + ". Time: " + esc(parts.time) + ".</div></div></li>";
      }).join("") + "</ol>";
    return html;
  }

  function render() {
    var html = renderTop() + renderFilters() + renderTable() + renderModelNote() + "</div>";
    root.innerHTML = html;
    var scrim = document.querySelector(".scrim");
    var drawer = document.querySelector(".drawer");
    if (!scrim) {
      scrim = document.createElement("button");
      scrim.className = "scrim";
      scrim.type = "button";
      scrim.setAttribute("aria-label", "Close the detail view");
      document.body.appendChild(scrim);
    }
    if (!drawer) {
      drawer = document.createElement("aside");
      drawer.className = "drawer";
      document.body.appendChild(drawer);
    }
    if (state.picked) {
      drawer.innerHTML = drawerHtml();
      drawer.hidden = false;
      scrim.hidden = false;
    } else {
      drawer.hidden = true;
      scrim.hidden = true;
    }
    wire();
  }

  function wire() {
    var q = document.getElementById("q");
    if (q) {
      q.addEventListener("input", function () {
        state.query = q.value;
        render();
        var again = document.getElementById("q");
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      });
    }
    var cat = document.getElementById("cat");
    if (cat) {
      cat.addEventListener("change", function () {
        state.category = cat.value;
        render();
      });
    }
    var chain = document.getElementById("chain");
    if (chain) {
      chain.addEventListener("change", function () {
        state.chain = chain.value;
        render();
      });
    }
    var watch = document.getElementById("watch");
    if (watch) {
      watch.addEventListener("click", function () {
        state.watchlistOnly = !state.watchlistOnly;
        render();
      });
    }
    var tabs = document.querySelectorAll(".tabs button");
    tabs.forEach(function (b) {
      b.addEventListener("click", function () {
        state.tab = b.getAttribute("data-tab");
        state.category = "";
        state.chain = "";
        state.watchlistOnly = false;
        state.sortKey = "rank";
        state.sortDir = 1;
        render();
      });
    });
    var sorts = document.querySelectorAll("[data-sort]");
    sorts.forEach(function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-sort");
        if (state.sortKey === key) {
          state.sortDir = -state.sortDir;
        } else {
          state.sortKey = key;
          state.sortDir = key === "rank" ? 1 : -1;
        }
        render();
      });
    });
    var cards = document.querySelectorAll(".card");
    cards.forEach(function (c) {
      c.addEventListener("click", function () {
        state.picked = c.getAttribute("data-slug");
        render();
      });
      c.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          state.picked = c.getAttribute("data-slug");
          render();
        }
      });
    });
    var rows = document.querySelectorAll("table tbody tr[data-slug]");
    rows.forEach(function (tr) {
      tr.addEventListener("click", function () {
        state.picked = tr.getAttribute("data-slug");
        render();
      });
    });
    var close = document.querySelector(".drawer .close");
    if (close) {
      close.addEventListener("click", function () {
        state.picked = null;
        render();
      });
    }
    var scrim = document.querySelector(".scrim");
    if (scrim) {
      scrim.addEventListener("click", function () {
        state.picked = null;
        render();
      });
    }
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.picked) {
      state.picked = null;
      render();
    }
  });

  render();
})();
