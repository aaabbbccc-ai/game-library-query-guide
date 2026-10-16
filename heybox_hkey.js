// 小黑盒 API 的 hkey 签名算法（逆向自网页版前端）
// 关键结论：hkey 只对「URL 路径 + _time + nonce」签名，不包含 query 参数
// → 同一签名的时效窗口内，改 offset/limit 翻页不需要重新计算 hkey
//
// 用法：
//   const { get_hkey, generateNonce } = require('./heybox_hkey.js');
//   const ts = Math.floor(Date.now() / 1000);
//   const nonce = generateNonce();
//   const hkey = get_hkey('/game/steam/get_game_list', ts, nonce);
//
//   node heybox_hkey.js <path>   直接打印一组 可用的 { _time, nonce, hkey }

const crypto = require('crypto');

// 字符集（注意是打乱的，不是 base64 表）
const CHARSET = 'AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89';

// 按字符码取模映射
function sv(str, charset) {
  let out = '';
  for (const ch of String(str)) out += charset[ch.charCodeAt(0) % charset.length];
  return out;
}

// 同 sv 但字符集先用 slice(0, n) 截断（n 为负数表示 slice(0, n) 去掉尾部）
function av(str, charset, n) {
  const cs = n < 0 ? charset.slice(0, n) : charset.slice(0, n);
  return sv(str, cs);
}

// 对字节做混合变换，用于校验和
function Vm(e) { return e & 128 ? (255 & ((e << 1) ^ 27)) : e << 1; }
function qm(e) { return Vm(e) ^ e; }
function dollar_m(e) { return qm(Vm(e)); }
function Ym(e) { return dollar_m(qm(Vm(e))); }
function Gm(e) { return Ym(e) ^ dollar_m(e) ^ qm(e); }

// 注意两个细节：① 输入是 6 字节（MD5 后 6 位的字符码），只替换前 4 位，
// 后 2 位保留原值，6 个字节全部参与求和；② 四个新值必须全部基于「原始字节」计算，
// 不能就地依次覆盖（否则算 e[1] 时用的是已经改写的 e[0]）
function Km_full(bytes) {
  const e = [...bytes];
  const t = [
    Gm(e[0]) ^ Ym(e[1]) ^ dollar_m(e[2]) ^ qm(e[3]),
    qm(e[0]) ^ Gm(e[1]) ^ Ym(e[2]) ^ dollar_m(e[3]),
    dollar_m(e[0]) ^ qm(e[1]) ^ Gm(e[2]) ^ Ym(e[3]),
    Ym(e[0]) ^ dollar_m(e[1]) ^ qm(e[2]) ^ Gm(e[3]),
  ];
  e[0] = t[0];
  e[1] = t[1];
  e[2] = t[2];
  e[3] = t[3];
  return e;
}

function get_hkey(url_path, timestamp, nonce) {
  // 1. 路径标准化：去空段、重拼、首尾加 /
  const parts = url_path.split('/').filter((p) => p);
  const normalized_path = '/' + parts.join('/') + '/';

  // 2. 三个分量
  const comp1 = av(String(timestamp), CHARSET, -2); // 时间戳映射（字符集切掉后2位）
  const comp2 = sv(normalized_path, CHARSET);       // 路径映射（完整字符集）
  const comp3 = sv(nonce, CHARSET);                 // nonce 映射（完整字符集）

  // 3. 交错混合，取前 20 位
  const comps = [comp1, comp2, comp3];
  const max_len = Math.max(...comps.map((c) => c.length));
  let interleaved = '';
  for (let k = 0; k < max_len; k++) {
    for (const c of comps) if (k < c.length) interleaved += c[k];
  }
  const i_str = interleaved.slice(0, 20);

  // 4. MD5 → 前5位映射成前缀，后6位字节做 Km 变换求和 %100 成后缀
  const md5 = crypto.createHash('md5').update(i_str).digest('hex');
  const prefix = av(md5.slice(0, 5), CHARSET, -4);
  const checksum = Km_full(Array.from(md5.slice(-6)).map((c) => c.charCodeAt(0)))
    .reduce((a, b) => a + b, 0) % 100;

  return prefix + String(checksum).padStart(2, '0');
}

function generateNonce() {
  return crypto.createHash('md5')
    .update(String(Date.now()) + String(Math.random()))
    .digest('hex')
    .toUpperCase();
}

module.exports = { get_hkey, generateNonce, CHARSET };

if (require.main === module) {
  const path = process.argv[2] || '/game/steam/get_game_list';
  const ts = Math.floor(Date.now() / 1000);
  const nonce = generateNonce();
  console.log(JSON.stringify({ _time: ts, nonce, hkey: get_hkey(path, ts, nonce) }));
}
