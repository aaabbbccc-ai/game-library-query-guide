// Epic 游戏库（含精确时长）只能通过小黑盒的登录态接口获取。
// 该接口要求 pkey 登录 cookie，脚本无法匿名调用，所以采用「浏览器页面注入」方式：
// 在已登录 web.xiaoheihe.cn 的浏览器控制台里运行本脚本，从页面上下文带 cookie 调 API。
//
// 使用步骤：
// 1. 本地算一组签名：node heybox_hkey.js /game/epic/v3/game_info
//    → 得到 {"_time":"...","nonce":"...","hkey":"......"}
// 2. Chrome 登录 https://web.xiaoheihe.cn/ （手机 App 扫码即可）
// 3. 打开 https://web.xiaoheihe.cn/account/epic_personal_page/games?userid=<你的小黑盒ID>
// 4. F12 控制台粘贴下面的脚本，把 TS/NONCE/HKEY/HEYBOX_ID 换成第 1 步的值
// 5. 输出 base64，本地解码：base64 -d > epic_playtime.json
//
// 关键点：
// - x_client_type 必须是 weboutapp（照抄页面自己的请求）
// - hkey 只签路径，所以一组签名可以翻完所有页（_time 有几分钟时效，尽快跑完）
// - fetch 必须 credentials:'include'，否则不带 pkey 会被判未登录
// - 若返回 "Failed to fetch"，通常是 hkey 非法（服务端报错响应不带 CORS 头）

(async () => {
  const TS = '__TS__';
  const NONCE = '__NONCE__';
  const HKEY = '__HKEY__';
  const HEYBOX_ID = '__HEYBOX_ID__';

  const all = [];
  let offset = 0;
  for (let p = 0; p < 12; p++) {
    const u = new URL('https://api.xiaoheihe.cn/game/epic/v3/game_info');
    u.search = new URLSearchParams({
      app: 'heybox', heybox_id: HEYBOX_ID, os_type: 'web', x_app: 'heybox',
      x_client_type: 'weboutapp', x_os_type: 'Windows',
      offset: String(offset), limit: '20', user_id: HEYBOX_ID,
      _time: TS, hkey: HKEY, nonce: NONCE, version: '999.0.4',
    });
    const res = await fetch(u, { credentials: 'include' });
    const data = await res.json();
    if (data.status !== 'ok') { console.log('stop:', JSON.stringify(data).slice(0, 150), 'page', p); break; }
    const games = (data.result && data.result.games) || [];
    all.push(...games);
    console.log('page', p, 'got', games.length, '累计', all.length);
    if (games.length < 20) break;
    offset += 20;
    await new Promise((r) => setTimeout(r, 350));
  }

  const slim = all.map((g) => ({
    name: (g.name || '').replace(/[《》]/g, ''),
    playtime_seconds: g.playtime_forever || 0,   // 秒；除以 3600 得小时
    achievements: g.get_achievement_num + '/' + g.total_achievement_num,
    free_claimed: g.is_free_get === true,        // 喜加一
  }));
  console.log('总款数:', all.length);
  console.log('复制下面这行 base64，本地解码即得 JSON：');
  console.log(btoa(unescape(encodeURIComponent(JSON.stringify(slim)))));
})();
