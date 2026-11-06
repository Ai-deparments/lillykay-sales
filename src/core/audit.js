import { run, all } from '../db.js';
import { now } from '../util.js';

/* Har bir avtomatik amal: vaqt, bajaruvchi, amal, ishlatilgan ma'lumot, natija (TZ: umumiy talablar) */
export function audit(kind, actor, action, { object = null, data = null, result = null } = {}) {
  run('INSERT INTO audit(at,kind,actor,action,object,data_used,result) VALUES(?,?,?,?,?,?,?)',
    now(), kind, actor, action, object, typeof data === 'string' ? data : data && JSON.stringify(data), result);
}
export const recentAudit = (kind, limit = 300) =>
  kind && kind !== 'all'
    ? all('SELECT * FROM audit WHERE kind=? ORDER BY id DESC LIMIT ?', kind, limit)
    : all('SELECT * FROM audit ORDER BY id DESC LIMIT ?', limit);
