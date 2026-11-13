// 探测小黑盒是否提供 LOL / CF 的战绩或时长接口
const { get_hkey, generateNonce } = require('./heybox_hkey.js');
const crypto = require('crypto');
const https = require('https');

const HEYBOX_ID = '57233875';

function requestXhh(path, extraParams = {}) {
  return new Promise((resolve) => {
    const nonce = generateNonce();
    const timestamp = Math.floor(Date.now() / 1000);
    const hkey = get_hkey(path, timestamp, nonce);
    const params = new URLSearchParams({
      ...extraParams,
      os_type: 'web', app: 'heybox', client_type: 'web', version: '999.0.4', web_version: '2.5',
      x_client_type: 'web', x_app: 'heybox_website', heybox_id: HEYBOX_ID, x_os_type: 'Windows',
      device_info: 'Chrome', device_id: '2c2fef8385ccef915e3b3caf94e3aa06',
      hkey, _time: timestamp, nonce,
    });
    const url = 'https://api.xiaoheihe.cn' + path + '?' + params.toString();
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://web.xiaoheihe.cn/',
      },
    }, (resp) => {
      let data = '';
      resp.on('data', (c) => (data += c));
      resp.on('end', () => resolve({ path, code: resp.statusCode, body: data }));
    });
    req.on('error', (err) => resolve({ path, code: 0, body: 'ERR ' + err.message }));
  });
}

const candidates = [
  // LOL
  '/game/lol/get_lol_user_info',
  '/game/lol/get_lol_record',
  '/game/lol/get_game_record',
  '/game/lol/battle/list',
  '/game/lol/get_user_info',
  '/game/lol/record',
  '/game/lol/season_info',
  '/game/lol/player_info',
  '/game/lol/v1/record',
  '/game/lol/get_match_list',
  '/game/lol/get_recent_record',
  // CF
  '/game/cf/get_user_info',
  '/game/cf/get_game_record',
  '/game/cf/record',
  '/game/cf/battle/list',
  '/game/cf/get_cf_user_info',
  // 通用战绩
  '/game/record/list',
  '/game/battle/list',
  '/account/get_game_record',
];

(async () => {
  for (const p of candidates) {
    const r = await requestXhh(p, { userid: HEYBOX_ID });
    const is404 = /Not Found|not found/.test(r.body || '');
    if (!is404) {
      console.log('HIT', p, '|', r.code, '|', (r.body || '').slice(0, 200).replace(/\n/g, ' '));
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  console.log('--- done ---');
})();
