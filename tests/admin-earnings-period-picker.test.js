const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');const buttons=fs.readFileSync(path.join(root,'src/services/adminEarningsButtons.js'),'utf8');

test('old named IDs remain classifiable only for fail-closed retirement',()=>{for(const kind of ['abigail','christel'])assert.match(buttons,new RegExp(`admin_${kind}_earnings_last_week: 'admin_retired_named_earnings'`));});
