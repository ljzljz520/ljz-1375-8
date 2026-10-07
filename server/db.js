// 服务数据库层（JSON 文件持久化，原子写）。
// 存储：分类名称、公告、空间有效区间、限制区、观测点、观测记录（精坐标）、
// 物种、图片元数据、仪式、亲子活动、潮汐、鸟讯等来源材料。
// 版本：content_epoch（内容版本）/ zone_epoch（边界版本）。
// 限制区几何或有效区间变化 -> zone_epoch += 1，驱动地图/文本/打印卡/离线全渠道失效。
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export const COLLECTIONS = [
  'categories', 'species', 'sites', 'records', 'zones',
  'bulletins', 'events', 'tides', 'birdnews', 'images',
];

export function defaultData() {
  return {
    meta: {
      content_epoch: 1,
      zone_epoch: 1,
      // 同一版本戳：地图、文本、打印卡必须同版发布
      version_at: new Date(0).toISOString(),
    },
    categories: [],
    species: [],
    sites: [],
    records: [],
    zones: [],
    bulletins: [],
    events: [],
    tides: [],
    birdnews: [],
    images: [],
  };
}

export class JsonDB {
  constructor(file, seedFn = null) {
    this.file = file;
    if (!existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true });
      const d = defaultData();
      if (seedFn) seedFn(d);
      writeFileSync(file, JSON.stringify(d, null, 2));
    }
    this.data = JSON.parse(readFileSync(file, 'utf8'));
    for (const c of COLLECTIONS) {
      if (!Array.isArray(this.data[c])) this.data[c] = [];
    }
  }

  all(collection) {
    return this.data[collection];
  }

  find(collection, id) {
    return this.data[collection].find((r) => r.id === id) || null;
  }

  insert(collection, record) {
    if (!record.id) record.id = `${collection[0]}_${Math.random().toString(36).slice(2, 9)}`;
    if (!record.created_at) record.created_at = new Date().toISOString();
    this.data[collection].push(record);
    this.flush();
    return record;
  }

  update(collection, id, patch) {
    const rec = this.find(collection, id);
    if (!rec) return null;
    Object.assign(rec, patch, { updated_at: new Date().toISOString() });
    this.flush();
    return rec;
  }

  remove(collection, id) {
    const i = this.data[collection].findIndex((r) => r.id === id);
    if (i < 0) return false;
    this.data[collection].splice(i, 1);
    this.flush();
    return true;
  }

  bump(kind) {
    if (kind === 'zone') this.data.meta.zone_epoch += 1;
    else this.data.meta.content_epoch += 1;
    this.data.meta.version_at = new Date().toISOString();
    this.flush();
    return {
      content_epoch: this.data.meta.content_epoch,
      zone_epoch: this.data.meta.zone_epoch,
    };
  }

  version() {
    return {
      content_epoch: this.data.meta.content_epoch,
      zone_epoch: this.data.meta.zone_epoch,
      version: `z${this.data.meta.zone_epoch}-c${this.data.meta.content_epoch}`,
      generated_at: new Date().toISOString(),
    };
  }

  flush() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  reset(data = defaultData()) {
    this.data = data;
    this.flush();
  }
}
