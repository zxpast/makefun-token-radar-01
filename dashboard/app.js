/* Token Radar dashboard: renders window.RADAR into the board, the validation
   tables and the protocol detail dialog. No framework, no network: every
   number on the page comes from the data.js this run wrote. */
(function () {
  var R = window.RADAR;
  if (!R) return;

  function $(id) { return document.getElementById(id); }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function compact(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function num(n, digits) { return Number(n).toFixed(digits === undefined ? 4 : digits); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  $('asof').textContent = R.as_of;
  $('source').textContent = R.source;
  $('fitline').innerHTML =
    '<dt>Fit</dt><dd>log10(mcap) = ' + R.fit_intercept + ' + ' + R.fit_slope + ' · log10(TVL)</dd>' +
    '<dt>Live set</dt><dd>' + R.live_size + ' protocols</dd>' +
    '<dt>Flat median</dt><dd>×' + R.flat_median_ratio + '</dd>' +
    '<dt>Board</dt><dd>' + R.board_size + ' rows (' + R.watchlist_size + ' watchlist + ' + R.early_size + ' early)</dd>' +
    '<dt>Total implied</dt><dd>' + money(R.total_implied_usd) + '</dd>';
  $('fittext').textContent =
    'Across the ' + R.live_size + ' protocols that already trade, market cap grows like TVL^' + R.fit_slope +
    ', not in proportion to TVL: the fitted line is log10(mcap) = ' + R.fit_intercept + ' + ' + R.fit_slope +
    ' · log10(TVL). Each board row blends that line (70%) with its 12 nearest live comps (30%), ' +
    'same category first. Every coefficient is refit from this snapshot; the flat ×' + R.flat_median_ratio +
    ' multiple is shown only as the baseline it replaces.';
  $('keypoints').innerHTML =
    '<li>Elasticity ' + R.fit_slope + ': value scales sub-linearly with size — a flat multiple overprices big protocols.</li>' +
    '<li>One-per-ticker comps: the live set is deduped by ticker (' + R.live_dropped_symbol + ' symbol rows and ' +
    R.live_dropped_gecko + ' CoinGecko rows dropped), so versioned rows of one token never count twice.</li>' +
    '<li>Rank ranges come from ' + R.bootstrap_refits + ' bootstrap refits of both legs; the log-log leg alone ' +
    'cannot move a rank, so the ranges are the kNN leg working.</li>' +
    '<li>Coverage: all ' + R.watchlist_size + ' watchlist slugs rank, plus ' + R.early_size +
    ' pre-token protocols below the $' + (R.floor_usd / 1e6).toFixed(0) + 'M floor.</li>';

  // ---- validation tables ----
  var looBody = $('loo').querySelector('tbody');
  looBody.innerHTML = R.validation.map(function (v, i) {
    return '<tr' + (i === 3 ? ' class="best"' : '') + '><td>' + esc(v.model) + '</td>' +
      '<td class="num">' + num(v.loo_rmse) + '</td><td class="num">' + num(v.loo_mae) + '</td>' +
      '<td class="num">' + (v.loo_r2oos >= 0 ? '+' : '') + num(v.loo_r2oos, 3) + '</td>' +
      '<td class="num">' + num(v.loo_spearman, 3) + '</td>' +
      '<td class="num">' + Math.round(v.loo_med_pct) + '%</td>' +
      '<td class="num">' + Math.round(v.loo_within_2x) + '%</td>' +
      '<td class="num">' + num(v.fold_rmse_mean) + '</td></tr>';
  }).join('');
  var walkBody = $('walk').querySelector('tbody');
  walkBody.innerHTML = R.walk_forward.map(function (w) {
    return '<tr><td>' + Math.round(w.cut * 100) + '% / ' + (100 - Math.round(w.cut * 100)) + '%</td>' +
      '<td class="num">' + w.train_n + ' / ' + w.test_n + '</td>' +
      '<td class="num">' + num(w.flat_rmse) + '</td><td class="num">' + num(w.loglog_rmse) + '</td>' +
      '<td class="num">' + num(w.blend_rmse) + '</td></tr>';
  }).join('') +
    '<tr><td colspan="5" class="note">Walk-forward is mixed at the 80% cut (n = 24, noisy): the ' +
    'leave-one-out and 5-fold wins are real but time stability is unproven. The table shows both cuts, including the unfavourable one.</td></tr>';
  $('dropped').innerHTML = R.dropped.map(function (d) {
    return '<li><b>' + esc(d.term) + '</b> — LOO RMSE ' + num(d.loo_rmse) + ' dex. ' + esc(d.note) + '</li>';
  }).join('');

  // ---- board ----
  var rows = R.rows;
  var cats = [];
  rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category); });
  cats.sort();
  $('cat').innerHTML = '<option value="">All categories</option>' +
    cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  function rowHtml(r) {
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><b>' + esc(r.name) + '</b><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + compact(r.tvl_usd) + '</td>' +
      '<td class="num">' + money(r.implied_value_usd) + '</td>' +
      '<td class="num">' + r.model.rank_p10 + '–' + r.model.rank_p90 + '</td>' +
      '<td>' + (r.is_watchlist ? '<span class="star">★</span>' : '') + '</td></tr>';
  }
  function liveHtml(r, i) {
    return '<tr><td class="num">' + (i + 1) + '</td>' +
      '<td><b>' + esc(r.name) + '</b><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + compact(r.tvl_usd) + '</td>' +
      '<td class="num">' + money(r.mcap_usd || 0) + '</td>' +
      '<td class="num">' + (r.mcap_usd ? (r.mcap_usd / r.tvl_usd).toFixed(3) : '—') + '</td></tr>';
  }

  function applyFilters() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('cat').value;
    var watch = $('watchonly').checked;
    var liveMode = $('liveonly').checked;
    $('board').hidden = liveMode;
    $('livetable').hidden = !liveMode;
    var shown = 0;
    if (liveMode) {
      var liveBody = $('livetable').querySelector('tbody');
      var liveRows = R.live.filter(function (r) {
        if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
        if (cat && r.category !== cat) return false;
        return true;
      });
      liveBody.innerHTML = liveRows.length
        ? liveRows.map(liveHtml).join('')
        : '<tr><td colspan="6" class="empty">No live protocol matches.</td></tr>';
      shown = liveRows.length;
    } else {
      var boardBody = $('board').querySelector('tbody');
      var list = rows.filter(function (r) {
        if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
        if (cat && r.category !== cat) return false;
        if (watch && !r.is_watchlist) return false;
        return true;
      });
      boardBody.innerHTML = list.length
        ? list.map(rowHtml).join('')
        : '<tr><td colspan="7" class="empty">No protocol matches.</td></tr>';
      shown = list.length;
    }
    $('count').textContent = shown + (liveMode ? ' live protocols shown (market values, not scored).' : ' of ' + rows.length + ' board rows shown.');
  }

  // ---- detail dialog ----
  var dlg = $('detail');
  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) return;
    var compRows = r.comps.map(function (c) {
      return '<tr><td><b>' + esc(c.slug) + '</b></td><td>' + esc(c.category || '—') + '</td>' +
        '<td class="num">' + compact(c.tvl_usd) + '</td>' +
        '<td class="num">' + num(c.log_ratio) + '</td></tr>';
    }).join('');
    dlg.innerHTML = '<div class="detail-inner"><button class="closebtn" id="closeDetail">Close ✕</button>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'no category') + ' · ' +
      esc(r.chains.join(', ') || 'no chain listed') + ' · TVL ' + compact(r.tvl_usd) +
      (r.age_days === null ? ' · age unknown' : ' · ' + r.age_days + ' days listed') +
      (r.is_watchlist ? ' · ★ watchlist' : '') + '</p>' +
      '<div class="legs">' +
      '<div class="leg"><b>Implied (blend)</b><span>' + money(r.implied_value_usd) + '</span></div>' +
      '<div class="leg"><b>Log-log leg</b><span>' + money(r.model.ols_value_usd) + '</span></div>' +
      '<div class="leg"><b>Comps leg</b><span>' + money(r.model.knn_value_usd) + '</span></div>' +
      '<div class="leg"><b>Median comp ratio</b><span>10^' + num(r.model.knn_median_log_ratio) + '</span></div>' +
      '<div class="leg"><b>Rank range</b><span>' + r.model.rank_p10 + ' – ' + r.model.rank_p90 + '</span></div>' +
      '</div>' +
      '<h3>Twelve nearest live comps (same category first)</h3>' +
      '<div class="tablewrap"><table><thead><tr><th>Comp</th><th>Category</th><th>TVL</th><th>log ratio</th></tr></thead>' +
      '<tbody>' + compRows + '</tbody></table></div>' +
      '<h3>Farm plan</h3><ol class="farm">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></div>';
    $('closeDetail').addEventListener('click', function () { dlg.close(); });
    if (!dlg.open) dlg.showModal();
  }
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  $('board').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  // ---- wiring ----
  ['q', 'cat', 'watchonly', 'liveonly'].forEach(function (id) {
    $(id).addEventListener('input', applyFilters);
    $(id).addEventListener('change', applyFilters);
  });
  function readHash() {
    var h = window.location.hash || '';
    var m = h.match(/p=([A-Za-z0-9._-]+)/);
    var w = /(?:^|[&#])watchlist=1(?:[&#]|$)/.test(h);
    if (w) $('watchonly').checked = true;
    applyFilters();
    if (m) openDetail(m[1]);
  }
  window.addEventListener('hashchange', readHash);
  readHash();
})();
