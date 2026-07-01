const fs = require('fs');
const path = 'C:\\Users\\ChristopherHorn\\Documents\\Coding\\product-hub\\data\\sessions\\2026-06\\recTYndLUaBzes4dy\\backlog\\artifacts\\1782302939764-8602bcd1-backlog.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const features = data.features ?? [];
console.log(`Total features in artifact: ${features.length}`);
features.forEach((f, i) => {
  console.log(`F${i+1}: phase="${f.phase}" title="${f.title?.slice(0,50)}"`);
});
