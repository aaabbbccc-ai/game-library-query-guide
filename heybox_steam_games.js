// 通过小黑盒接口分页拉取某 Steam 账号的完整游戏库（含时长/成就/家庭共享标记）
// 无需登录：接口匿名可用，但必须同时传 heybox_id（任意小黑盒数字ID）+ steam_id
//
// 用法：node heybox_steam_games.js <steam_id64> [heybox_id] [输出文件]
//   node heybox_steam_games.js 76561199215283604 57233875 out.json
//
// 前置：同目录放 heybox_hkey.js
// 好友代码转 steam_id64：steam_id64 = Number(friendCode) + 76561197960265728

const { get_hkey, generateNonce } = require('./heybox_hkey.js');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');

const STEAM_ID = process.argv[2];
const HEYBOX_ID = process.argv[3] || STEAM_ID; // heybox_id 任意有效值即可
const OUT = process.argv[4] || `steam_games_${STEAM_ID}.json`;

if (!STEAM_ID) { console.error('用法: node heybox_steam_games.js <steam_id64> [heybox_id] [out]'); process.exit(1); }

function requestXhh(path, extraParams = {}) {
  return new Promise((resolve) => {
    const nonce = generateNonce();
    const timestamp = Math.floor(Date.now() / 1000);
    const hkey = get_hkey(path, timestamp, nonce);
    const params = new URLSearchParams({
      ...extraParams,
      os_type: 'web', app: 'heybox', client_type: 'web', version: '999.0.4', web_version: '2.5',
      x_client_type: 'web', x_app: 'heybox_website', heybox_id: HEYBOX_ID, x_os_type: 'Windows',
      // device_id 不能随机生成，服务端会拒绝陌生设备指纹（返回"非法请求"）
      device_info: 'Chrome', device_id: '2c2fef8385ccef915e3b3caf94e3aa06',
      hkey, _time: timestamp, nonce,
    });
    const url = 'https://api.xiaoheihe.cn' + path + '?' + params.toString();
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://web.xiaoheihe.cn/',
      },
    }, (resp) => {
      let data = '';
      resp.on('data', (c) => (data += c));
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({ error: data.slice(0, 300) }); } });
    }).on('error', (err) => resolve({ error: err.message }));
  });
}

(async () => {
  const all = [];
  const seen = new Set();
  let offset = 0;
  let total = null;
  for (let page = 0; page < 30; page++) {
    const res = await requestXhh('/game/steam/get_game_list', {
      userid: HEYBOX_ID, steam_id: STEAM_ID, offset: String(offset), limit: '100', sort_filter: 'all',
    });
    if (!res.result) { console.log('page', page, 'error:', JSON.stringify(res).slice(0, 200)); break; }
    total = res.result.total;
    const list = res.result.game_list || [];
    let added = 0;
    for (const g of list) {
      if (!seen.has(g.steam_appid)) {
        seen.add(g.steam_appid);
        all.push({
          steam_appid: g.steam_appid,
          name: g.name,
          playtime_seconds: g.playtime_forever,   // 注意单位是秒
          playtime_2weeks_seconds: g.playtime_2weeks,
          achieved: g.achieved_count,
          achievements_total: g.achivement_count,
          not_owned: g.not_owned,                  // true = 家庭共享来的，不是本号买的
        });
        added++;
      }
    }
    console.log('page', page, 'offset', offset, 'got', list.length, 'new', added, 'total', total);
    if (list.length === 0 || added === 0 || (total && all.length >= total)) break;
    offset += list.length;
    await new Promise((r) => setTimeout(r, 800));
  }
  fs.writeFileSync(OUT, JSON.stringify({ steam_id: STEAM_ID, total, games: all }, null, 2), 'utf8');
  console.log('saved', all.length, 'games to', OUT);
})();
