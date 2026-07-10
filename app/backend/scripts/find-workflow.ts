import db from '../src/data/database';

const id = process.argv[2];

console.log('by item_id:', JSON.stringify(db.prepare('SELECT * FROM workflows WHERE item_id = ?').all(id)));
console.log('item row:', JSON.stringify(db.prepare('SELECT * FROM items WHERE id = ?').get(id)));
console.log('like search workflows:', JSON.stringify(db.prepare('SELECT id, item_id, status, current_stage FROM workflows WHERE id LIKE ?').all(id.slice(0, 8) + '%')));
console.log('total workflows count:', JSON.stringify(db.prepare('SELECT COUNT(*) as c FROM workflows').get()));
console.log('recent workflows:', JSON.stringify(db.prepare('SELECT id, item_id, status, current_stage, updated_at FROM workflows ORDER BY updated_at DESC LIMIT 5').all()));
