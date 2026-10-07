const $ = (s, r = document) => r.querySelector(s);
let token = localStorage.getItem('festival-admin-token') || '';
let pack = null;
let view = 'sites';

$('#token').value = token;
$('#save-token').onclick = () => {
  token = $('#token').value.trim();
  localStorage.setItem('festival-admin-token', token);
  toast('令牌已保存');
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function load() {
  try {
    pack = await api('GET', '/admin/api/pack');
    $('#ver').textContent = `版本 ${pack.version}\n基准时间 ${pack.now}`;
    $('#now-label').textContent = `服务端当前时间：${pack.now}`;
    $('#export-admin').href = `/admin/api/export/observations.csv?admin_token=${encodeURIComponent(token)}`;
    render();
  } catch (e) {
    $('#view').innerHTML = `<div class="card-box">加载失败：${e.message}（请检查令牌）</div>`;
  }
}

const txt = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const bip = (v) => (v ? { zh: '测试', en: 'test' } : v);

function render() {
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
  const v = $('#view');
  if (view === 'sites') v.innerHTML = sitesView();
  else if (view === 'zones') v.innerHTML = zonesView();
  else if (view === 'species') v.innerHTML = speciesView();
  else if (view === 'events') v.innerHTML = eventsView();
  else if (view === 'bulletins') v.innerHTML = bulletinsView();
  else if (view === 'records') v.innerHTML = recordsView();
  else if (view === 'images') v.innerHTML = imagesView();
  else v.innerHTML = miscView();
  bind();
}

function sitesView() {
  const rows = pack.sites.map((s) => `
    <tr class="${s.visible ? 'row-ok' : 'row-blocked'}">
      <td>${s.id}</td>
      <td><input value="${txt(s.name && s.name.zh)}" data-upd="sites" data-id="${s.id}" data-k="name.zh"></td>
      <td><input value="${txt(s.name && s.name.en)}" data-upd="sites" data-id="${s.id}" data-k="name.en"></td>
      <td><input value="${s.lat ?? ''}" data-upd="sites" data-id="${s.id}" data-k="lat"></td>
      <td><input value="${s.lng ?? ''}" data-upd="sites" data-id="${s.id}" data-k="lng"></td>
      <td><input type="checkbox" ${s.sensitive ? 'checked' : ''} data-upd="sites" data-id="${s.id}" data-k="sensitive"></td>
      <td><input type="checkbox" ${s.fixed_public ? 'checked' : ''} data-upd="sites" data-id="${s.id}" data-k="fixed_public"></td>
      <td>${s.visible ? '✅ 可展示' : `⛔ 被 ${s.blocked_by_zone} 遮挡（几何判定）`}</td>
      <td><button data-del="sites" data-id="${s.id}">删</button></td>
    </tr>`).join('');
  return `<div class="card-box">
    <p class="disc">可展示性完全由点与生效限制区的实际几何关系实时计算；“固定公开”白名单不能豁免。行政名称不参与判定。</p>
    <table><thead><tr><th>ID</th><th>名称中</th><th>名称英</th><th>lat</th><th>lng</th><th>敏感</th><th>固定公开</th><th>当前状态</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>
    <button id="add-site">新增观测点</button>
  </div>`;
}

function zonesView() {
  const rows = pack.zones.map((z) => `
    <tr class="${z.active ? 'row-blocked' : ''}">
      <td>${z.id}</td>
      <td><input value="${txt(z.name && z.name.zh)}" data-upd="zones" data-id="${z.id}" data-k="name.zh"></td>
      <td><input value="${z.valid_from || ''}" data-upd="zones" data-id="${z.id}" data-k="valid_from" placeholder="2026-10-07T00:00:00Z"></td>
      <td><input value="${z.valid_to || ''}" data-upd="zones" data-id="${z.id}" data-k="valid_to"></td>
      <td>${z.active ? '生效中（触发隐藏）' : '未生效'}</td>
      <td><details><summary>多边形</summary>
        <textarea rows="3" data-upd="zones" data-id="${z.id}" data-k="polygons">${txt(z.polygons)}</textarea></details></td>
      <td><button data-del="zones" data-id="${z.id}">删</button></td>
    </tr>`).join('');
  return `<div class="card-box">
    <p class="disc">空间有效区间 [valid_from, valid_to)；任何新增/修改立即递增边界版本 z-epoch，地图、文本、打印卡和离线缓存全部失效重取。晚到的新规也同样即时生效。</p>
    <table><thead><tr><th>ID</th><th>名称中</th><th>生效起</th><th>生效止</th><th>状态</th><th>几何</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>
    <button id="add-zone">新增限制区</button>
    <form id="check-form" style="margin-top:10px">
      <strong>几何诊断（输入坐标看是否在生效区）：</strong>
      lat <input style="width:120px" name="lat" value="30.01">
      lng <input style="width:120px" name="lng" value="121.01">
      <button>检查</button> <span id="check-out"></span>
    </form>
  </div>`;
}

function speciesView() {
  const rows = pack.species.map((s) => `
    <tr class="${s.merged_into ? 'row-blocked' : ''}">
      <td>${s.id}</td>
      <td>${txt(s.zh)} / ${txt(s.en)}</td>
      <td><i>${txt(s.scientific)}</i></td>
      <td>${s.folk_name ? txt(s.folk_name.zh) : ''}</td>
      <td>${s.merged_into ? `已合并入 ${s.merged_into}` : s.disambiguated ? '已打消歧标记' : '—'}</td>
      <td>${s.merged_into ? '' : `
        <select id="merge-${s.id}">
          ${pack.species.filter((x) => x.id !== s.id && !x.merged_into)
            .map((x) => `<option value="${x.id}">${x.zh} (${x.scientific || x.id})</option>`).join('')}
        </select>
        <button data-merge="${s.id}">订正：重复录入→合并</button>
        <button data-disambiguate="${s.id}">订正：同名不同种→打消歧标记</button>`}
      </td>
    </tr>`).join('');
  return `<div class="card-box">
    <p class="disc">俗名相同但学名不同的物种（凤头麦鸡/灰头麦鸡）应“打消歧标记”保留；重复录入（无学名的“麦鸡” sp5）应“合并”，观测记录与图片标签随之迁移。</p>
    <table><thead><tr><th>ID</th><th>名称</th><th>学名</th><th>俗名</th><th>订正状态</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>`;
}

function eventsView() {
  const rows = pack.events.map((e) => `
    <tr>
      <td>${e.id}</td>
      <td><input value="${txt(e.title && e.title.zh)}" data-upd="events" data-id="${e.id}" data-k="title.zh"></td>
      <td><input value="${txt(e.title && e.title.en)}" data-upd="events" data-id="${e.id}" data-k="title.en"></td>
      <td><input value="${e.date}" data-upd="events" data-id="${e.id}" data-k="date"></td>
      <td><input value="${e.time || ''}" data-upd="events" data-id="${e.id}" data-k="time"></td>
      <td>
        <select data-upd="events" data-id="${e.id}" data-k="site_id">
          <option value="">(无关联点)</option>
          ${pack.sites.map((s) => `<option value="${s.id}" ${s.id === e.site_id ? 'selected' : ''}>${s.name.zh}${s.visible ? '' : '（当前隐藏）'}</option>`).join('')}
        </select>
      </td>
      <td>${e.status}${e.history && e.history.length ? `<details><summary>${e.history.length} 次改期</summary><pre>${JSON.stringify(e.history, null, 1)}</pre></details>` : ''}</td>
      <td>
        <button data-resched="${e.id}">改期…</button>
        <button data-del="events" data-id="${e.id}">删</button>
      </td>
    </tr>`).join('');
  return `<div class="card-box">
    <p class="disc">改期会把旧日期写入审计历史（仅管理端可见），公开包只呈现新日期。关联点被限制区隐藏时，公开包会自动移除点关联而不泄露。</p>
    <table><thead><tr><th>ID</th><th>标题中</th><th>标题英</th><th>日期</th><th>时间</th><th>关联点</th><th>状态/历史</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <button id="add-event">新增活动</button>
  </div>`;
}

function bulletinsView() {
  const rows = pack.bulletins.map((b) => `
    <tr>
      <td>${b.id}</td>
      <td><input value="${txt(b.title && b.title.zh)}" data-upd="bulletins" data-id="${b.id}" data-k="title.zh"></td>
      <td><input value="${txt(b.body && b.body.zh)}" data-upd="bulletins" data-id="${b.id}" data-k="body.zh"></td>
      <td><input value="${b.valid_from || ''}" data-upd="bulletins" data-id="${b.id}" data-k="valid_from"></td>
      <td><input value="${b.valid_to || ''}" data-upd="bulletins" data-id="${b.id}" data-k="valid_to"></td>
      <td><button data-del="bulletins" data-id="${b.id}">删</button></td>
    </tr>`).join('');
  return `<div class="card-box">
    <p class="disc">公告带时间有效区间，过期公告自动退出公开包。</p>
    <table><thead><tr><th>ID</th><th>标题</th><th>正文</th><th>起</th><th>止</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>
    <button id="add-bulletin">新增公告</button>
  </div>`;
}

function recordsView() {
  const rows = pack.records.map((r) => {
    const sp = pack.species.find((s) => s.id === r.species_id);
    return `<tr>
      <td>${r.id}</td>
      <td>${sp ? sp.zh : r.species_id}</td>
      <td>${r.count}</td><td>${r.date}</td>
      <td>${r.site_id}</td>
      <td><b>${r.exact_lat},${r.exact_lng}</b></td>
      <td><input type="checkbox" ${r.sensitive ? 'checked' : ''} data-upd="records" data-id="${r.id}" data-k="sensitive"></td>
      <td><input type="checkbox" ${r.share_coarse ? 'checked' : ''} data-upd="records" data-id="${r.id}" data-k="share_coarse"></td>
      <td>${r.share_coarse ? `公开仅网格 ${(+r.exact_lat).toFixed(2)},${(+r.exact_lng).toFixed(2)}` : '公开无坐标'}</td>
      <td><button data-del="records" data-id="${r.id}">删</button></td>
    </tr>`;
  }).join('');
  return `<div class="card-box">
    <p class="disc">精坐标（exact_lat/exact_lng）只在此处与管理端 CSV 出现；公开列表、公开 CSV、图片导出均不含。可勾选“仅公开网格”。</p>
    <table><thead><tr><th>ID</th><th>物种</th><th>数量</th><th>日期</th><th>点</th><th>精坐标</th><th>敏感</th><th>公开网格</th><th>公开结果</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>
    <button id="add-record">新增记录</button>
  </div>`;
}

function imagesView() {
  const rows = pack.images.map((im) => `
    <tr>
      <td>${im.id}</td>
      <td>${txt(im.caption && im.caption.zh)}</td>
      <td>${(im.species_ids || []).join(', ')}</td>
      <td>${im.site_id || ''}</td>
      <td>${im.gps_lat == null ? '—' : `${im.gps_lat},${im.gps_lng}`}</td>
      <td><input type="checkbox" ${im.share_coarse ? 'checked' : ''} data-upd="images" data-id="${im.id}" data-k="share_coarse"></td>
      <td><button data-del="images" data-id="${im.id}">删</button></td>
    </tr>`).join('');
  return `<div class="card-box">
    <p class="disc">一图多鸟通过 species_ids 多标签保存；EXIF 精坐标在公开 JSON 导出中一律剥离，勾选“仅公开网格”时也只给约 1km 网格。</p>
    <table><thead><tr><th>ID</th><th>说明</th><th>物种标签</th><th>点</th><th>EXIF 坐标</th><th>公开网格</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>`;
}

function miscView() {
  const cats = pack.categories.map((c) => `<tr><td>${c.id}</td><td><input value="${txt(c.name && c.name.zh)}" data-upd="categories" data-id="${c.id}" data-k="name.zh"></td><td><input value="${txt(c.name && c.name.en)}" data-upd="categories" data-id="${c.id}" data-k="name.en"></td></tr>`).join('');
  const tides = pack.tides.map((td) => `<tr><td>${td.id}</td><td>${td.date}</td><td><textarea data-upd="tides" data-id="${td.id}" data-k="entries">${txt(td.entries)}</textarea></td><td>${txt(td.window_start)}<br>${txt(td.window_end)}</td></tr>`).join('');
  const news = pack.birdnews.map((n) => `<tr><td>${n.id}</td><td>${n.date}</td><td>${txt(n.summary && n.summary.zh)}</td></tr>`).join('');
  return `<div class="card-box"><h3>分类名称</h3><table><thead><tr><th>ID</th><th>中</th><th>英</th></tr></thead><tbody>${cats}</tbody></table></div>
  <div class="card-box"><h3>潮汐（来源材料，跨日窗口直接体现在 window_end.date）</h3><table><thead><tr><th>ID</th><th>日期</th><th>潮位条目</th><th>建议窗口</th></tr></thead><tbody>${tides}</tbody></table></div>
  <div class="card-box"><h3>鸟讯（仅来源材料，不保证见鸟）</h3><table><thead><tr><th>ID</th><th>日期</th><th>摘要</th></tr></thead><tbody>${news}</tbody></table></div>`;
}

function setNested(obj, key, value) {
  const parts = key.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o[parts[i]] = o[parts[i]] || {};
  o[parts[parts.length - 1]] = value;
}

function bind() {
  document.querySelectorAll('[data-upd]').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const c = inp.dataset.upd, id = inp.dataset.id, k = inp.dataset.k;
      let value = inp.type === 'checkbox' ? inp.checked : inp.value;
      if ((k === 'lat' || k === 'lng') && value !== '') value = Number(value);
      if (k === 'polygons' || k === 'entries') { try { value = JSON.parse(value); } catch { return toast('JSON 格式错误'); } }
      const patch = {}; setNested(patch, k, value);
      try { await api('PUT', `/admin/api/${c}/${id}`, patch); toast('已保存，版本已推进'); load(); }
      catch (e) { toast(e.message); }
    });
  });
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('确认删除？')) return;
    await api('DELETE', `/admin/api/${b.dataset.del}/${b.dataset.id}`);
    toast('已删除'); load();
  }));
  document.querySelectorAll('[data-merge]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.merge;
    const targetId = $(`#merge-${id}`).value;
    await api('POST', `/admin/api/species/${id}/correct`, { action: 'merge', targetId });
    toast('已合并，记录与图片标签已迁移'); load();
  }));
  document.querySelectorAll('[data-disambiguate]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.disambiguate;
    await api('POST', `/admin/api/species/${id}/correct`, { action: 'disambiguate' });
    toast('已标记为同名不同种，不做合并'); load();
  }));
  document.querySelectorAll('[data-resched]').forEach((b) => b.addEventListener('click', async () => {
    const date = prompt('新日期 YYYY-MM-DD'); if (!date) return;
    const time = prompt('新时间 HH:MM', '10:00');
    const reason = prompt('改期原因', '');
    await api('POST', `/admin/api/events/${b.dataset.resched}/reschedule`, { date, time, reason: { zh: reason, en: '' } });
    toast('已改期，历史已留痕'); load();
  }));
  $('#add-site')?.addEventListener('click', async () => {
    await api('POST', '/admin/api/sites', { name: { zh: '新观测点', en: '' }, lat: 30.0, lng: 121.0 });
    load();
  });
  $('#add-zone')?.addEventListener('click', async () => {
    await api('POST', '/admin/api/zones', {
      name: { zh: '新限制区', en: 'New Zone' }, level: 'restricted',
      polygons: [[[[121.02, 30.02], [121.025, 30.02], [121.025, 30.025], [121.02, 30.025], [121.02, 30.02]]]],
      valid_from: new Date().toISOString(), valid_to: null,
    });
    load();
  });
  $('#add-event')?.addEventListener('click', async () => {
    await api('POST', '/admin/api/events', { category_id: 'cat_family', title: { zh: '新活动', en: '' }, desc: { zh: '', en: '' }, date: '2026-10-20', time: '10:00', site_id: 's1', status: 'scheduled', history: [] });
    load();
  });
  $('#add-bulletin')?.addEventListener('click', async () => {
    await api('POST', '/admin/api/bulletins', { title: { zh: '新公告', en: '' }, body: { zh: '', en: '' }, level: 'info', valid_from: new Date().toISOString(), valid_to: null });
    load();
  });
  $('#add-record')?.addEventListener('click', async () => {
    await api('POST', '/admin/api/records', { species_id: 'sp1', count: 1, date: new Date().toISOString().slice(0, 10), site_id: 's1', exact_lat: 30.0, exact_lng: 121.0, share_coarse: false, sensitive: true, note: { zh: '', en: '' } });
    load();
  });
  $('#check-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try {
      const r = await api('GET', `/admin/api/check-point?lat=${fd.get('lat')}&lng=${fd.get('lng')}`);
      $('#check-out').textContent = r.blocked ? `⛔ 在 ${r.zone.name.zh} 内` : '✅ 不在任何生效区';
    } catch (e) { $('#check-out').textContent = e.message; }
  });
}

$('#refresh').onclick = load;
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; render(); }));

$('#demo-late-zone').addEventListener('click', async () => {
  // 晚到的新规：此刻才生效，覆盖此前公开的 s4 潮沟草滩观察点
  await api('POST', '/admin/api/zones', {
    code: 'late-gull-roost',
    name: { zh: '夜栖鸟类临时保护带（晚到新规）', en: 'Temporary Roost Protection (late-issued rule)' },
    level: 'restricted',
    polygons: [[[
      [121.018, 30.018], [121.026, 30.018], [121.026, 30.026],
      [121.018, 30.026], [121.018, 30.018],
    ]]],
    valid_from: new Date().toISOString(),
    valid_to: '2026-12-31T00:00:00.000Z',
    notice: { zh: '新规即时生效，s4 公开状态全渠道失效。', en: 'Effective now; s4 publication is revoked everywhere.' },
  });
  toast('新规已入库：边界版本已递增，s4 应从所有公开渠道消失');
  load();
});

load();
