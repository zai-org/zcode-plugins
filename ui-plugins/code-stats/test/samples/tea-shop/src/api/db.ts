// 极简内存数据库，仅演示用
const tables = new Map<string, Map<string, any>>();

export const db = {
  async insert(t: string, row: any) {
    const m = tables.get(t) ?? new Map();
    const id = String(m.size + 1);
    m.set(id, { id, ...row });
    tables.set(t, m);
    return m.get(id);
  },
  async get(t: string, id: string) {
    return tables.get(t)?.get(id);
  },
  async update(t: string, id: string, patch: any) {
    const row = { ...(await this.get(t, id)), ...patch };
    tables.get(t)?.set(id, row);
    return row;
  },
};
