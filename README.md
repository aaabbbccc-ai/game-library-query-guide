# Steam / Xbox / Epic 游戏库数据查询指南（基于小黑盒接口逆向）

> 整合多平台已购游戏 + 游玩时长的一套可行方案。核心思路：**小黑盒替你聚合了 Steam / Xbox / Epic 三家数据，其中 Steam 和 Xbox 的接口可以匿名调用，Epic 需要小黑盒登录态。**
>
> 实测于 2026-10，API 随时可能变更。

## 总览

| 平台 | 查询入口 | 需要什么 | 能拿到什么 |
|---|---|---|---|
| Steam | 小黑盒接口 | steam_id64 + 任意 heybox_id（均匿名） | 全量游戏、精确时长（秒）、成就、**家庭共享标记** |
| Steam | 官方 API | 已登录网页版里的 OAuth access_token | 本人账号 owned 全量（不含家庭共享） |
| Xbox | 小黑盒接口 | xuid（匿名可取）+ 任意 heybox_id | 游玩过的游戏、时长（分钟）、成就、Gamertag |
| Xbox | 微软订单历史 | 浏览器登录微软账号 | 区分「付款购买 / 兑换码 / XGP 订阅」 |
| Epic | 小黑盒接口（登录态） | web.xiaoheihe.cn 登录 + pkey cookie | 全量游戏、精确时长（秒）、成就、是否喜加一 |
| Epic | 官方订单历史 | 浏览器登录 Epic | 购买清单（**没有时长，Epic 根本没有云端时长数据**） |

## 一、小黑盒 API 通用知识

所有接口都在 `https://api.xiaoheihe.cn`，GET 请求，需要一组通用参数 + 一个 `hkey` 签名：

```
os_type=web & app=heybox & client_type=web & version=999.0.4 & web_version=2.5
x_client_type=web & x_app=heybox_website & heybox_id=<小黑盒数字ID>
x_os_type=Windows & device_info=Chrome & device_id=<32位hex>
hkey=<签名> & _time=<秒级时间戳> & nonce=<大写MD5随机串>
```

### hkey 签名算法（最关键的逆向成果）

**hkey 只签「URL 路径 + _time + nonce」，不包含 query 参数。**
所以同一组签名的时效窗口内（几分钟），改 `offset`/`limit` 翻页**不需要重算签名**。

算法：路径标准化（去空段重拼、首尾加 `/`）→ 时间戳 / 路径 / nonce 三者分别按打乱字符集
`AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89` 做字符码取模映射 → 交错混合取前 20 位 → MD5 →
前 5 位映射成 5 字符前缀，后 6 位字节做 AES S盒风格的混合变换求和 %100 得 2 位后缀。

完整实现见 [heybox_hkey.js](heybox_hkey.js)。

### 接口可用性（实测）

| 接口 | 匿名 | 说明 |
|---|---|---|
| `/bbs/app/profile/user/profile` | ✅ | 用户资料（昵称、等级） |
| `/game/steam/get_player_overview_v2` | ✅ | **返回绑定的所有 Steam 账号**（`steamids.accounts[]`，一人多号必看） |
| `/game/steam/get_game_list` | ✅ | Steam 游戏库，分页 |
| `/game/xbox/v3/home_info` | ✅ | Xbox 总览，**从 `base_info.xuid` 拿 xuid** |
| `/game/xbox/v3/game_list` | ✅ | Xbox 游戏列表，**必须传 `xuid`**，不传报「获取XUID失败」 |
| `/game/epic/v3/detail_info` | ❌ 需登录 | Epic 总览 |
| `/game/epic/v3/game_info` | ❌ 需登录 | Epic 游戏库（含时长），分页 `limit=20` |
| `/game/assets/game_first_play` 等 | ❌ 需登录 | 桌面端的时间轴数据 |
| `/game/owned_game/game_list` | ❌ 需登录 | 跨平台已购列表（PC客户端用） |

判断依据：返回 `<h1>Not Found` = 路径不存在；`{"status":"login","msg":"请登录后使用该功能"}` = 缺登录态（pkey cookie）。

## 二、Steam 查询

### 1. ID 换算
```
steam_id64 = 好友代码 + 76561197960265728
```

### 2. 小黑盒拉全量游戏库（推荐，匿名）

```bash
node heybox_steam_games.js 76561199215283604 57233875 out.json
```

- `userid` 和 `heybox_id` 传任意有效小黑盒数字 ID；`steam_id` 是目标
- `sort_filter=all` 很重要（默认按两周排序，会漏游戏）
- 返回字段：`playtime_forever`（**单位是秒**）、`achieved_count`/`achivement_count`、
  **`not_owned`（true = 家庭共享来的，不是这个号买的）**
- 一人多号：先调 `get_player_overview_v2`，从 `steamids.accounts[]` 拿到全部绑定账号逐个拉

### 3. 官方 API（需要已登录网页版的 OAuth token）

打开 steamcommunity.com 任意页面，F12 网络面板里找
`api.steampowered.com/...?access_token=eyJ...`，把 token 抠出来：

```
https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/
  ?access_token=<token>&steamid=<id>&include_appinfo=1&include_played_free_games=1
```

- JWT 的 aud 是 `web:community`，但实测能调 IPlayerService
- 只返回**本人拥有**的游戏（不含家庭共享）；查别人需要对方隐私公开
- `playtime_forever` 单位是**分钟**

### 4. 家庭共享核实

- 各账号分别用小黑盒接口拉取，`not_owned=true` 的就是共享来的
- 再互相交叉对比，就能定位每个游戏的真实购买者
- 想看"买过但从未启动"的：`store.steampowered.com/account/licenses/`（账号许可页）

## 三、Xbox 查询

### 1. 两步走（全部匿名）

```bash
# 第一步：拿 xuid（目标小黑盒号需绑定过 Xbox）
GET /game/xbox/v3/home_info?userid=<小黑盒ID>
# → result.base_info.xuid / nickname / total_gamerscore

# 第二步：按 xuid 分页拉游戏
node heybox_xbox_games.js <xuid> <小黑盒ID> out.json
```

- `minutes_played` 单位是**分钟**
- **重要局限**：这个列表是「启动过/游玩过」的游戏，**买了但从未启动的不会出现**

### 2. 区分「真买」和「XGP 订阅白嫖」

Xbox 没有匿名接口查拥有库，权威方法是登录
[account.microsoft.com/billing/orders](https://account.microsoft.com/billing/orders)
（时间范围选最大），看订单类型：

- `已完成` + 有价格 = 付款购买
- `已兑现` + $0.00 + 支付方式"代码已兑换" = 兑换码（XGP 会员福利等）
- `Xbox Game Pass Ultimate` / `PC Game Pass` = 订阅本身

订单里查不到、但小黑盒列表里有的游戏 = XGP 订阅期间玩的（订阅过期就不能玩了）。

## 四、Epic 查询

### 先说结论

- **Epic 没有公开 API，也没有云端时长**。GitHub 上所有聚合启动器（Playnite、legendary 系）对
  Epic 时长全是本地进程计时——因为 Epic 服务器不提供
- 官方订单历史接口在 `accounts.epicgames.com`，**注意 CORS**：
  在 accounts 域下的页面控制台里 fetch www.epicgames.com 的接口会被 403 + 无 CORS 头拦截。
  用**相对路径同源请求**才可行：
  ```
  /account/v2/payment/ajaxGetOrderHistory?count=50&sortDir=DESC&sortBy=DATE&nextPageToken=<token>
  ```
  遍历 `nextPageToken` 翻完，`orderType=PURCHASE` 的 `items[].description` 就是已购/已领清单

### 拿精确时长：小黑盒登录态 + 页面注入（独家方法）

小黑盒在你绑定 Epic 时拿过 OAuth 授权，所以它能查到 Epic 云端时长。它自己也有对应接口，
但要小黑盒登录态（pkey cookie）。完整操作见 [epic_console_snippet.js](epic_console_snippet.js)：

1. `node heybox_hkey.js /game/epic/v3/game_info` 本地算签名
2. Chrome 登录 web.xiaoheihe.cn（手机 App 扫码）
3. 打开 `web.xiaoheihe.cn/account/epic_personal_page/games?userid=<小黑盒ID>`
4. 控制台注入脚本，**关键参数**：
   - `x_client_type=weboutapp`（照抄页面自己的请求，用普通 web 也可以试）
   - `credentials: 'include'`（不带 pkey 就是"请登录"）
   - hkey 只签路径 → 一组签名翻完所有页，`limit=20`
5. 字段：`playtime_forever`（**秒**）、`get_achievement_num`/`total_achievement_num`、`is_free_get`（喜加一）

## 五、踩坑记录

| 坑 | 说明 |
|---|---|
| `Failed to fetch` | hkey 非法。服务端报错时**不返回 CORS 头**，浏览器统一报 fetch 失败，别误判成网络问题 |
| 404 vs login | API 404 返回的是 nginx 风格 HTML；`status:"login"/"relogin"` 才是缺登录态 |
| Electron cookie 抠不出来 | 小黑盒 PC 客户端运行时锁死 Cookies SQLite，且 Chrome 127+ 有 App-Bound Encryption，直接复制文件解不开。走浏览器登录态更省事 |
| Shadow DOM | 网页版小黑盒的导航栏在 shadow root 里，`document.querySelector` 查不到，用可访问性快照（accessibility snapshot）定位 |
| 控制台传大对象 | evaluate 返回大 JSON 会被格式化损坏，用 `btoa(unescape(encodeURIComponent(JSON.stringify(x))))` 转 base64 回传 |
| 数据新鲜度 | 小黑盒的 Steam 数据有缓存（实测落后真实时长几小时到几天），Steam 网页版/官方 API 更新 |
| 频率 | 每页间隔 300~800ms，实测无风控；匿名接口刷了一下午没事 |
| Microsoft/Epic/Steam 登录 | 全程自己输密码，不要把 cookie/token 发给任何人（包括 AI） |

## 六、实战数据（data/ 目录）

本仓库 data/ 目录里有一份真实的抓取结果（我自己的账号，397 款），字段即脚本输出：

| 文件 | 内容 |
|---|---|
| data/steam_*.json | 4 个 Steam 号（含家庭共享标记 family_shared） |
| data/xbox_*.json | Xbox 游玩列表，source 字段区分 purchased / redeemed_code / xgp_or_unknown |
| data/epic_*.json | Epic 全量 + 精确时长 + 喜加一标记 |
| data/library_summary.md | 三平台合并总表（按平台分组、按时长排序） |

## 七、脚本清单

| 文件 | 用途 |
|---|---|
| [heybox_hkey.js](heybox_hkey.js) | hkey 签名算法。`node heybox_hkey.js <path>` 直接打印一组可用签名 |
| [heybox_steam_games.js](heybox_steam_games.js) | Steam 全量游戏库（匿名） |
| [heybox_xbox_games.js](heybox_xbox_games.js) | Xbox 游戏列表（匿名） |
| [epic_console_snippet.js](epic_console_snippet.js) | Epic 时长（需登录态，浏览器控制台运行） |

## 八、实战成果

用这套方法整合了一个 4 Steam 号（家庭组）+ Xbox + Epic 的账号：

- **397 款游戏**全量盘点，每款标注平台 / 精确时长 / 成就 / 家庭共享 / 喜加一标记
- 发现：Steam 家庭共享占主号可见库的 16%；Xbox 43 款里只有 14 款是真买（其余 XGP）；
  Epic 141 款里 120 款是喜加一且 125 款 0 小时

## 免责声明

- 所有接口均为非官方、未公开接口，随时可能失效
- 仅查询自己的账号数据，请勿用于爬取他人隐私或任何违规用途
- 登录凭据（cookie/token/密码）不要发给任何人
