# CV Builder

**标准格式事实 + 根据求职目标生成简历 + LaTeX 专业格式交付**

地域感知的全球化个人简历站:按求职地的语言与社会文化语境产出专业简历。个人部署形态——一个 Cloudflare Worker 就是你自己的简历站,简历公开可预览/分享,编辑走解锁密码。

- **排版引擎**:模板一律是**原生开源 (La)TeX 简历件**(sb2nov / resumecls / billryan;件与许可住 ccs 的 `tex-templates` 模块,走 jsDelivr),浏览器端 XeLaTeX WASM 编译出 PDF,零服务依赖;预览与导出同一份字节
- **文化规范**:`culture/<圈>.md` 收各求职地官方/权威来源的简历写法原文(带出处与抓取日期),字体、页数、照片政策、分节都据此定 —— 不靠印象
- **数据标准**:[JSON Resume](https://jsonresume.org) —— **纯标准,没有自定义扩展**,74 个字段全覆盖,导出的 `resume.json` 别的 JSON Resume 工具能直接吃;旧版数据自动迁移
- **AI 润色**:接入 [mma](https://mma.11270115.xyz) Agent 框架的"简历专家"租户,按字段生成候选文本
- **可达性**:ccs 组件、上游 (La)TeX 件、网页字体一律走 jsDelivr(**大陆自动切镜像**);自家 worker 只留 404KB 站点资产
- **技术形态**:零构建原生 ES 模块 + [ccs](https://github.com/onegbnet/ccs) 浏览器组件(jsDelivr SHA pin);单 CF Worker 承载页面、D1 简历存储、R2 头像/快照、AI 代理与 i18n 注入

## 部署(个人实例)

```bash
# 前置:Cloudflare 账号 + wrangler 凭据;平级 clone ccs 仓(../ccs)
npx wrangler d1 create cvb          # database_id 填入 wrangler.toml
npx wrangler r2 bucket create cvb
npm install                          # esbuild(构建用)
npm run build && npx wrangler deploy
npx wrangler secret put LOCK         # 解锁密码(3-64 位可见 ASCII)
npx wrangler secret put MMA_API_KEY  # 可选:AI 润色的 mma 租户 key
```

打开部署域名即解锁页;`/apply`(生成简历)目前公开。语言(中/英)按浏览器自动检测,可切换并 cookie 持久化。

## 开发

- 规约与架构细节见 [CLAUDE.md](CLAUDE.md)(单一真相;历史查 git)
- `npm run build`:烤 ccs lock 页 → `dist/index.js`;组装 `dist-assets/`(含 per-lang i18n bundle)
- `npm test`:jest —— AI 路由/provider、转义器、writer、worker 引擎配置,以及**拿官方 schema 用 ajv 校验产出的数据是否合标**(`server/__tests__/schema-standard.test.js`)
- 无本地 dev 环境:改完直接 `wrangler deploy` 到真实环境验证(另有 jsdom 冒烟与**真机浏览器验证**,见 CLAUDE.md §7)

## 名字

产品名是 **CV Builder**;仓库、Cloudflare Worker、D1 与 R2 仍叫 `cvb`——那是基础设施标识,不随产品名走。

## License

MIT
