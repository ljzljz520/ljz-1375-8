// 初始化演示数据。虚构湿地“沧澜湾”，基准坐标约 (30.0N,121.0E)。
// 数据刻意覆盖验收场景：
//  - s3 旧瞭望台：曾被策展为固定公开点，但几何上落在核心限制区 -> 必须隐藏
//  - s4 潮沟草滩观察点：当前公开；运行期“晚到”的新限制区覆盖后应消失
//  - sp3/sp4 同名麦鸡（学名不同，合法共存）；sp5 是 sp3 的重复录入（应订正合并）
//  - img1 含两种鸟且 EXIF 含精坐标；t2 潮汐跨日；e3 活动改期；b2 公告已过期
export function seed(d) {
  Object.assign(d, {
    meta: { content_epoch: 1, zone_epoch: 1, version_at: '2026-09-20T08:00:00.000Z' },
    categories: [
      { id: 'cat_bird', code: 'birds', name: { zh: '鸟类', en: 'Birds' }, order: 1 },
      { id: 'cat_ritual', code: 'rituals', name: { zh: '民俗仪式', en: 'Rituals' }, order: 2 },
      { id: 'cat_family', code: 'family', name: { zh: '亲子活动', en: 'Family Activities' }, order: 3 },
    ],
    species: [
      { id: 'sp1', zh: '小白鹭', en: 'Little Egret', scientific: 'Egretta garzetta',
        category_id: 'cat_bird', folk_name: { zh: '白鹭', en: 'White Egret' },
        desc: { zh: '湿地常见涉禽，黑喙黑腿黄趾。', en: 'Common wetland wader with black bill and yellow toes.' } },
      { id: 'sp2', zh: '大白鹭', en: 'Great Egret', scientific: 'Ardea alba',
        category_id: 'cat_bird', folk_name: { zh: '白庄', en: 'Great White Heron' },
        desc: { zh: '体型较大，繁殖期喙黑色。', en: 'Large egret, black bill in breeding season.' } },
      { id: 'sp3', zh: '凤头麦鸡', en: 'Northern Lapwing', scientific: 'Vanellus vanellus',
        category_id: 'cat_bird', folk_name: { zh: '麦鸡', en: 'Lapwing' },
        desc: { zh: '具反翘黑色冠羽，当地俗称“麦鸡”。', en: 'Upturned black crest; locally called 麦鸡.' } },
      { id: 'sp4', zh: '灰头麦鸡', en: 'Grey-headed Lapwing', scientific: 'Vanellus cinereus',
        category_id: 'cat_bird', folk_name: { zh: '麦鸡', en: 'Lapwing' },
        desc: { zh: '灰色头颈，黄肉垂；与凤头麦鸡同俗名但不同种。',
          en: 'Grey head and neck, yellow wattles; shares folk name but is a distinct species.' } },
      // 重复录入：仅俗名“麦鸡”、无学名，后续应订正合并到 sp3
      { id: 'sp5', zh: '麦鸡', en: '', scientific: '', category_id: 'cat_bird',
        folk_name: { zh: '麦鸡', en: '' },
        desc: { zh: '草滩上见到的那种麦鸡（待鉴定）', en: '' }, merged_into: null },
    ],
    zones: [
      {
        id: 'z_core', code: 'core-habitat',
        name: { zh: '核心栖息地区（营鹭滩）', en: 'Core Habitat (Heron Rookery)' },
        level: 'core',
        polygons: [[[
          [121.005, 30.005], [121.015, 30.005], [121.015, 30.015],
          [121.005, 30.015], [121.005, 30.005],
        ]]],
        valid_from: '2026-09-01T00:00:00.000Z',
        valid_to: '2026-12-31T00:00:00.000Z',
        notice: { zh: '全年核心保育，禁止进入。', en: 'Year-round core conservation. No entry.' },
        created_at: '2026-09-01T00:00:00.000Z',
      },
    ],
    sites: [
      {
        id: 's1', code: 'reed-hide', fixed_public: true,
        name: { zh: '芦苇观鸟屋', en: 'Reedbed Bird Hide' },
        region: { zh: '沧澜湾湿地保护小区·外塘', en: 'Canglan Bay Wetland Reserve · Outer Pond' },
        lat: 30.0, lng: 121.0, sensitive: false,
        guidance: { zh: '木栈道尽头，免费开放。', en: 'End of boardwalk, free entry.' },
        facilities: { zh: '望远镜、遮雨棚', en: 'Scopes, shelter' },
      },
      {
        id: 's2', code: 'seawall-point', fixed_public: true,
        name: { zh: '海堤远望点', en: 'Seawall Lookout' },
        region: { zh: '沧澜湾·东海堤', en: 'Canglan Bay · East Seawall' },
        lat: 29.994, lng: 121.02, sensitive: false,
        guidance: { zh: '堤顶公路步行可达。', en: 'Reachable on foot along the seawall road.' },
        facilities: { zh: '停车带', en: 'Parking bay' },
      },
      {
        id: 's3', code: 'old-tower', fixed_public: true, // 旧策展白名单
        name: { zh: '旧瞭望台', en: 'Old Watchtower' },
        region: { zh: '沧澜湾湿地保护小区·营鹭滩', en: 'Canglan Bay Wetland Reserve · Heron Rookery' },
        lat: 30.01, lng: 121.01, sensitive: true,
        guidance: { zh: '（历史点位，现已位于核心区内）', en: '(Legacy point, now inside core zone)' },
        facilities: { zh: '—', en: '—' },
      },
      {
        id: 's4', code: 'creek-flat', fixed_public: true,
        name: { zh: '潮沟草滩观察点', en: 'Creek Flat Watchpoint' },
        region: { zh: '沧澜湾·北潮沟', en: 'Canglan Bay · North Creek' },
        lat: 30.022, lng: 121.022, sensitive: true,
        guidance: { zh: '潮间带草滩边缘，请保持 100 米距离观察。',
          en: 'Edge of intertidal flat; keep 100 m distance.' },
        facilities: { zh: '无遮拦', en: 'No shelter' },
      },
    ],
    records: [
      {
        id: 'r1', species_id: 'sp1', count: 23, date: '2026-10-02',
        site_id: 's3', exact_lat: 30.0103, exact_lng: 121.0098,
        share_coarse: false, sensitive: true,
        note: { zh: '核心区内营巢计数（仅管理端精坐标）。',
          en: 'Rookery count inside core zone (exact coords admin-only).' },
      },
      {
        id: 'r2', species_id: 'sp2', count: 6, date: '2026-10-03',
        site_id: 's1', exact_lat: 30.0001, exact_lng: 120.9999,
        share_coarse: true, sensitive: false,
        note: { zh: '观鸟屋外浅滩。', en: 'Shallows by the reed hide.' },
      },
      {
        id: 'r3', species_id: 'sp5', count: 4, date: '2026-10-04',
        site_id: 's4', exact_lat: 30.0224, exact_lng: 121.0217,
        share_coarse: false, sensitive: true,
        note: { zh: '记录挂在重复录入的“麦鸡”上，订正后应迁移到 sp3。',
          en: 'Linked to duplicate 麦鸡 entry; correction must re-link to sp3.' },
      },
    ],
    bulletins: [
      {
        id: 'b1', title: { zh: '第七届沧澜湾湿地鸟类民俗节开幕', en: '7th Canglan Bay Bird Folklore Festival Opens' },
        body: { zh: '10 月 10 日至 20 日举办，分鸟类、仪式、亲子三类活动。',
          en: 'Oct 10–20, with birds, rituals and family activities.' },
        level: 'info',
        valid_from: '2026-10-01T00:00:00.000Z', valid_to: '2026-10-31T00:00:00.000Z',
      },
      {
        id: 'b2', title: { zh: '2025 年冬季封区通告', en: 'Winter 2025 Closure Notice' },
        body: { zh: '本通告已失效，仅供归档。', en: 'Expired, archive only.' },
        level: 'info',
        valid_from: '2025-11-01T00:00:00.000Z', valid_to: '2026-01-31T00:00:00.000Z',
      },
      {
        id: 'b3', title: { zh: '十一月栖息地轮休预告', en: 'November Habitat Rotation Preview' },
        body: { zh: '11 月 1 日起部分滩涂轮休。', en: 'Some flats rest from Nov 1.' },
        level: 'info',
        valid_from: '2026-11-01T00:00:00.000Z', valid_to: '2026-11-30T00:00:00.000Z',
      },
      {
        id: 'b4', title: { zh: '营鹭滩核心区全年禁入', en: 'Heron Rookery Core Zone Closed Year-round' },
        body: { zh: '任何观测、拍摄、研学活动不得进入核心栖息地区。',
          en: 'No observation, photography or study groups may enter the core habitat.' },
        level: 'warning',
        valid_from: '2026-09-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
      },
    ],
    events: [
      {
        id: 'e1', code: 'bird-rite', category_id: 'cat_ritual',
        title: { zh: '祭鸟大典', en: 'Bird Veneration Ceremony' },
        desc: { zh: '渔家古礼，祭祀候鸟海神。', en: 'Fishermen’s ancient rite honoring migratory birds.' },
        date: '2026-10-10', time: '09:00', site_id: 's2',
        status: 'scheduled', history: [],
      },
      {
        id: 'e2', code: 'lantern-rite', category_id: 'cat_ritual',
        title: { zh: '放荷灯·送候鸟', en: 'Lanterns for Migrating Birds' },
        desc: { zh: '夜潮时放荷灯送别南迁候鸟。', en: 'Release lotus lanterns at night tide.' },
        date: '2026-10-12', time: '19:30', site_id: 's2',
        status: 'scheduled', history: [],
      },
      {
        id: 'e3', code: 'mud-quest', category_id: 'cat_family',
        title: { zh: '泥滩寻宝亲子赛', en: 'Mudflat Treasure Quest (Family)' },
        desc: { zh: '亲子组队沿潮线完成自然任务。', en: 'Family teams follow the tide line on nature tasks.' },
        date: '2026-10-15', time: '14:00', site_id: 's1',
        status: 'rescheduled',
        // 改期留痕：旧日期仅管理端可见，公开包只呈现新日期
        history: [{ from_date: '2026-10-11', from_time: '09:30', changed_at: '2026-10-01T10:00:00.000Z',
          reason: { zh: '配合潮汐窗口调整', en: 'Adjusted to tide window' } }],
      },
      {
        id: 'e4', code: 'bird-painter', category_id: 'cat_family',
        title: { zh: '候鸟小画家', en: '' }, // 缺英文翻译 -> 待补信息
        desc: { zh: '儿童观鸟写生工作坊。', en: '' },
        date: '2026-10-16', time: '10:00', site_id: 's1',
        status: 'scheduled', history: [],
      },
      {
        id: 'e5', code: 'reed-whistle', category_id: 'cat_family',
        title: { zh: '苇编鸟哨工坊', en: 'Reed Bird-whistle Workshop' },
        desc: { zh: '用苇秆学做传统鸟哨。', en: 'Make traditional whistles from reed stems.' },
        date: '2026-10-17', time: '13:30',
        site_id: 's3', // 关联点已隐藏 -> 公开包不得泄露
        status: 'scheduled', history: [],
      },
    ],
    tides: [
      {
        id: 't1', date: '2026-10-11',
        entries: [
          { time: '05:40', type: 'high', height: 4.6 },
          { time: '11:50', type: 'low', height: 0.8 },
        ],
        window_start: { date: '2026-10-11', time: '05:00' },
        window_end: { date: '2026-10-11', time: '06:30' },
      },
      {
        id: 't2', date: '2026-10-11',
        entries: [
          { time: '23:50', type: 'high', height: 4.8 },
          { time: '00:40', type: 'low', height: 0.6 }, // 落在次日
        ],
        window_start: { date: '2026-10-11', time: '23:20' },
        window_end: { date: '2026-10-12', time: '01:10' }, // 跨日窗口
      },
    ],
    birdnews: [
      {
        id: 'n1', date: '2026-10-05', source: { zh: '本地鸟会论坛（网友报料）', en: 'Local bird club forum (user report)' },
        summary: { zh: '有鸟友称北潮沟见到大滨鹬群约 200 只。',
          en: 'A birder reported ~200 great knots near the north creek.' },
        // 仅来源材料，不保证见鸟
      },
      {
        id: 'n2', date: '2026-10-06', source: { zh: '巡护日志摘录', en: 'Ranger log excerpt' },
        summary: { zh: '核心滩涂方向有雁群夜栖，具体方位不公开。',
          en: 'Geese roosted toward the core flats; exact bearing not public.' },
      },
    ],
    images: [
      {
        id: 'img1', caption: { zh: '浅滩上的两种鹭', en: 'Two egret species on the flat' },
        species_ids: ['sp1', 'sp2'], // 一图多鸟
        site_id: 's3', date: '2026-10-02',
        gps_lat: 30.0103, gps_lng: 121.0098, // EXIF 精坐标，公开必须剥离
        camera: 'Canon R5', share_coarse: false,
        license: { zh: 'CC BY 沧澜湾鸟会', en: 'CC BY Canglan Bay Bird Club' },
      },
      {
        id: 'img2', caption: { zh: '观鸟屋远眺', en: 'View from the bird hide' },
        species_ids: ['sp2'], site_id: 's1', date: '2026-10-03',
        gps_lat: 30.0001, gps_lng: 120.9999, camera: 'Nikon Z8', share_coarse: true,
        license: { zh: 'CC BY', en: 'CC BY' },
      },
      {
        id: 'img3', caption: { zh: '荷灯初上', en: 'Lanterns at dusk' },
        species_ids: [], site_id: null, date: '2026-10-05',
        gps_lat: null, gps_lng: null, camera: 'iPhone 15', share_coarse: false,
        license: { zh: '版权所有', en: 'All rights reserved' },
      },
    ],
  });
}
