# neton-application-front

通用后台前端 base distribution（React 19 + Next.js 16 App Router），对标服务端
`neton-application` 的 distribution fork 模型。规范见
[Neton Application 规范](https://netonframework.github.io/zh-hans/spec/application/)；
后端安全契约见 [identity-realm](https://netonframework.github.io/zh-hans/spec/application/identity-realm)。

- `apps/shell` — Next.js 壳：登录、后端菜单驱动导航、多页签工作区、语言切换、服务状态
- `packages/front-contract` — 模块契约（manifest / 贡献点 / 语言包声明 / 版本协议）
- `packages/front-runtime` — envelope HTTP client、会话、权限判定、i18n、品牌、格式化
- `packages/front-kit` — UI 组件唯一属地（shadcn/Base UI 只进这里）
- `packages/front-resource` — 通用资源页（列表 / 表单 / 详情）
- `packages/front-workspace` — 页签工作区（按用户隔离持久化，退出即清）

业务模块是独立仓库（`neton-application-front-<模块>`），以 `file:` 依赖装配，清单在
`apps/shell/front.modules.ts`。

## 开发

```bash
pnpm install
pnpm dev          # 先跑 registry（生成页面与语言包注册表）
pnpm typecheck    # registry → check:locales → tsc
pnpm test         # front-runtime 单元测试（权限通配符向量与服务端共用）
pnpm build
pnpm e2e:i18n    # production build 后运行无头浏览器验收；HTTP mock，不冒充真实后端登录
```

`pnpm check:locales` 检查各语言 key 集合与 `{参数}` 一致；声明了 `locales` 的模块页面里不允许再出现硬编码中文
（注释除外）。尚未迁移的模块只告警。

## 部署约定

- **与后端同源部署**（反向代理把 `/admin`、`/app` 等后端路由转给后端）。会话是后端下发的 HttpOnly Cookie，
  写请求自动带 `X-Neton-Csrf` 头；跨源部署时 Cookie 不会随请求发送。
- 升级到身份域版本的后端后，旧令牌全部失效，用户需要重新登录。

## 构建期配置

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_NETON_BACKEND_URL` | 空（同源） | 后端基址，仅在确有需要时设置 |
| `NEXT_PUBLIC_NETON_LOCALES` | `zh-CN,en-US` | 可选语言，逗号分隔 |
| `NEXT_PUBLIC_NETON_DEFAULT_LOCALE` | 列表第一个 | 默认语言 |
| `NEXT_PUBLIC_NETON_TIME_ZONE` | 浏览器时区 | 日期显示时区 |
| `NEXT_PUBLIC_NETON_CURRENCY` | `CNY` | 金额缺省币种（后端金额单位为分） |
| `NEXT_PUBLIC_NETON_BRAND_NAME` / `_TAGLINE` / `_DESCRIPTION` / `_COPYRIGHT` | Neton | 品牌文案；页面标题为「页面 · 品牌」 |

## 国际化

- 服务器与客户端协同遵循 [i18n 规范](https://netonframework.github.io/zh-hans/spec/application/i18n)：管理员偏好存 `system_users.locale`，语言不固化进 token。保存失败提示并回滚，换号重新读取并丢弃旧账号的在途结果。
- 匿名手选 > 浏览器语言 > 站点默认；登录后以本人偏好为准，未设置时回站点默认，不继承上一账号的本地缓存。日期/币种不从语言推断。
- 本轮不新增 SSR，也不做后端错误信息多语言化；客户端按稳定错误码处理。

- 文案用 `useT("<命名空间>")`；模块命名空间 = manifest 的 `id`，语言包放在模块的 `src/locales/<lang>.ts`，
  在 manifest 的 `locales` 声明。
- 菜单与页签标题在非默认语言下取 `menu.<pageKey>` / `title.<pageKey>` 词条。
- 错误统一走 `useDescribeError()`，不直接显示后端原始 message；日期、金额用 `formatDateTime` / `formatMoney`，跟随当前语言。
