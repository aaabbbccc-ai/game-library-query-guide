// 通过小黑盒接口拉取某 Xbox 账号的完整游戏列表（含时长/成就）
// 无需登录，但必须传 xuid（不是 gamertag）
//
// xuid 获取：先匿名调 /game/xbox/v3/home_info?userid=<小黑盒ID>
//   返回 result.base_info.xuid（要求目标小黑盒账号绑定过 Xbox）
//
// 用法：node heybox_xbox_games.js <xuid> [heybox_id] [输出文件]
//   node heybox_xbox_games.js 2535428687538351 57233875 out.json
//
// 注意：返回的是「游玩过/启动过」的游戏，买了但从没启动的游戏不会出现。
//       minutes_played 单位是分钟。

const { get_hkey, generateNonce } = require('./heybox_hkey.js');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');

const XUID = process.argv[2];
const HEYBOX_ID = process.argv[3] || '57233875';
const OUT = process.argv[4] || `xbox_games_${XUID}.json`;

if (!XUID) { console.error('用法: node heybox_xbox_games.js <xuid> [heybox_id] [out]'); process.exit(1); }

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
        'Referer': 'https://web.xiaoheihe.cn/account/xbox_personal_page/games',
      },
    }, (resp) => {
      let data = '';
      resp.on('data', (c) => (data += c));
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({ error: data.slice(0, 300) }); } });
    }).on('error', (err) => resolve({ error: err.message }));
  });
}

(async () => {
  // 第一步：拿 xuid（如果调用方没直接给 16~17 位纯数字 xuid，可先调 home_info）
  const home = await requestXhh('/game/xbox/v3/home_info', { userid: HEYBOX_ID });
  if (home.result && home.result.base_info) {
    console.log('Xbox 账号:', home.result.base_info.nickname,
      '| xuid:', home.result.base_info.xuid,
      '| 总分:', home.result.base_info.total_gamerscore || '');
  }

  // 第二步：按 xuid 分页拉游戏列表（xuid 是必传参数，不传会报"获取XUID失败"）
  const all = [];
  const seen = new Set();
  let offset = 0;
  for (let page = 0; page < 10; page++) {
    const res = await requestXhh('/game/xbox/v3/game_list', { xuid: XUID, offset: String(offset), limit: '50' });
    if (!res.result || !res.result.list) { console.log('page', page, 'error:', JSON.stringify(res).slice(0, 200)); break; }
    const list = res.result.list;
    let added = 0;
    for (const g of list) {
      const key = g.appid || g.title_id || g.name;
      if (!seen.has(key)) {
        seen.add(key);
        all.push({
          name: g.name,
          title_id: g.title_id,
          minutes_played: g.minutes_played,           // 分钟
          last_played: g.last_played_desc,
          gamerscore: g.current_gamerscore + '/' + g.total_gamerscore,
          achievements: g.earned_achievements + '/' + g.total_achievements,
        });
        added++;
      }
    }
    console.log('page', page, 'got', list.length, 'new', added, 'server count', res.result.count);
    if (list.length === 0 || added === 0 || all.length >= res.result.count) break;
    offset += list.length;
    await new Promise((r) => setTimeout(r, 600));
  }
  fs.writeFileSync(OUT, JSON.stringify({ xuid: XUID, count: all.length, games: all }, null, 2), 'utf8');
  console.log('saved', all.length, 'games to', OUT);
})();
