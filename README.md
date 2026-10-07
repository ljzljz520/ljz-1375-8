# 湿地鸟类民俗节专题（Wetland Bird Folklore Festival）

一个可运行的 Node.js/Express + SQLite 示例，实现访客专题、管理端、多语言地图/文本/打印卡/CSV 导出、限制区实时几何过滤和全渠道发布失效。

## 运行

```bash
npm install
npm start
# 访客端 http://localhost:3000/
# 管理端 http://localhost:3000/admin.html
# 开发管理令牌：dev-admin-token（生产用 ADMIN_TOKEN 覆盖）
npm test
```

数据库默认在 `data/festival.db`，首次启动自动建表并写入验收样例。可用 `DB_PATH=...` 替换。

## 关键方案选择

选择**“固定公开观测点”为数据资产，但每次发布请求都依据当前限制区实时几何重算**，而不是一次性把公开点复制成静态列表。

- 固定点便于地图、文本、打印卡和导览长期复用。
- 可见性不是点的永久属性：`public_geometry` 与所有当前有效 `restriction_zones.geometry` 做点/多边形关系判定；边界接触按保守原则隐藏。
- 行政区域名称只是备注，不参与是否展示的判定。新增、扩大、提前生效或迟到生效的限制区无需重启，立即改变发布结果。
- 任何内容维护都会递增统一的 `content_versions` 发布版本；地图 API、文本 API、打印卡和 CSV 导出共享同一版本。旧 ETag 在边界变化后不能再命中 304。
- 管理端更新限制区返回新 `releaseId`；前端轮询版本，发现变化重新加载。Service Worker 不缓存 `/api/`、`/print` 或导出；离线时这些请求返回 503 `offline-plan-invalid`，避免旧点位/旧活动计划被继续使用。

## 数据隔离

- `observation_points.public_geometry` 与 `observation_points.sensitive_geometry` 分列。
- `bird_reports.exact_geometry` 保存内部观测记录；`public_geometry` 保存可公开位置，且仍会再次过限制区几何。
- 公共 release、打印卡和 CSV 从不选择/序列化精确几何。
- 图片只保存剥离 GPS 后的元数据白名单；上传接口强制 `gps=removed`。图片可通过 `observation_image_species` 关联多种鸟。
- 公共限制区通知只包含名称、原因、粗区域和有效时间，不输出多边形，避免反向定位敏感栖息点。

## 内容规则

- 鸟讯 `review_status=source-material`：只说明曾有来源记录，不承诺见鸟，也不授权进入。
- 潮汐同样标记为 `source-material-only`；窗口按 UTC 偏移识别本地跨日，但不作为通行或见鸟承诺。
- 活动改期写入 `event_schedule_history`，保留旧时间、原因和新时间。
- 同名俗名通过科学名或唯一 slug 订正，订正关系进入 `taxon_corrections`，公共页面保留旧标签和订正依据。
- 翻译缺失不回退到另一种语言，也不暴露另一语言页面的隐藏点；显示“待补信息 / Pending translation”。

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/release?lang=zh|en&at=ISO` | 当前统一发布快照 |
| GET | `/api/channels/map`、`/api/channels/text` | 同版地图/文本快照 |
| GET | `/print` | 同版打印卡 HTML |
| GET | `/api/export/points.csv`、`/api/export/bird-reports.csv`、`/api/export/images.csv` | 安全导出 |
| GET/POST/PUT/DELETE | `/api/admin/observation-points` | 管理观测点 |
| GET/POST/PUT/DELETE | `/api/admin/restriction-zones` | 管理限制区、有效区间和迟到来源 |
| GET | `/api/admin/observation-records` | 管理端查看精确记录（需令牌） |
| POST | `/api/admin/bird-reports/:id/correct-species` | 同名物种订正 |
| POST | `/api/admin/images` | 安全图片与多物种关联 |
| POST | `/api/admin/events/:id/reschedule` | 活动改期 |

管理接口需要请求头：`X-Admin-Token: dev-admin-token`。

## 验收样例

`tests/festival.test.js` 覆盖：

1. 分类名称、公告和有效区间存储。
2. 真实几何关系与边界点隐藏，行政名称相同也不会误判。
3. 列表、图片元数据和 CSV 不泄露精确坐标。
4. 同名物种订正、一张图片含多种鸟、潮汐本地跨日、活动改期。
5. 迟到限制区扩大边界后的版本递增、旧 ETag 失效及全渠道一致。
6. 缺翻译占位；英文页面不能绕过中文页面隐藏点。
7. Service Worker 离线时拒绝复用旧 API/打印/导出计划。
