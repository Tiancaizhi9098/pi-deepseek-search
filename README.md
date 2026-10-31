# DeepSeek Search · PI-Desktop 插件

为 PI-Desktop 智能体提供**联网搜索**与**网页抓取**能力，基于 DeepSeek 官方
[Search / Fetch API](https://api-docs.deepseek.com/zh-cn/guides/search)（DeepSeek 自研搜索引擎）。

## 功能

插件注册一个智能体工具 `web`（在 PI-Desktop 中显示为 `plugin_..._web`），包含两个动作：

| action | 接口 | 说明 |
| --- | --- | --- |
| `search` | `POST https://api.deepseek.com/v1/tools/search` | 按关键词搜索网页，返回标题、URL、站点、发布时间、相关性分数、权威性和长摘要 |
| `fetch` | `POST https://api.deepseek.com/v1/tools/fetch` | 抓取单个网页，以 Markdown 返回正文 |

`search` 参数：

- `query`（必填）：1～128 字符，支持搜索语法：`site:` `-site:` `"精确短语"` `-排除词` `lang:zh,en` `after:2025-01-01` `before:2026`
- `count`：返回条数 1～50（默认取插件设置，8）
- `ori_question`：用户原始问题，帮助理解搜索意图
- `need_content`：是否返回网页正文（默认 `false`）

`fetch` 参数：`url`（必填，http/https，不能含用户名密码）。

其它特性：

- 遇到 HTTP 408 / 429 / 5xx 自动退避重试（最多 2 次），其它 4xx 直接报错并给出中文提示
- 返回给模型的文本按 `maxChars` 截断，避免占满上下文
- 网络请求通过 `pi.net.fetch`，并在 manifest 中限定只能访问 `api.deepseek.com`

## 安装

1. 下载本仓库（`Code → Download ZIP` 或 `git clone`）。
2. PI-Desktop → 插件 → 从文件夹安装 / 开发者加载，选择本目录。
3. 点击输入框下方工具栏的 **「打开面板」**，选择 *DeepSeek 联网搜索*，填写 **DeepSeek API Key**（[获取地址](https://platform.deepseek.com/api_keys)）并保存；可点「测试连接」验证。也可在命令面板运行 *DeepSeek 联网搜索: 打开设置面板*。

> 注意：当前 PI-Desktop 版本暂不支持加密的 secret 设置，API Key 以明文保存在本机插件数据目录中（面板里只显示脱敏后的 Key）。
> 插件进程也不会继承系统环境变量，因此无法读取 `DEEPSEEK_API_KEY`，必须在设置中填写。

## 设置项（均在面板中修改）

| key | 默认 | 说明 |
| --- | --- | --- |
| `apiKey` | 空 | DeepSeek API Key |
| `defaultCount` | 8 | 默认搜索结果条数（1～50） |
| `maxChars` | 20000 | 每次返回给智能体的最大字符数（2000～200000） |

## 使用示例

直接对智能体说：

- “搜索一下 DeepSeek 最新发布的模型，并给出来源”
- “用 site:github.com 搜索 pi-desktop 插件示例”
- “读取 https://api-docs.deepseek.com/zh-cn/guides/search 并总结计费规则”

## 计费与限速（来自官方文档）

- Search / Fetch 各 **5 元 / 1000 次成功请求**，失败、无结果、超时不计费
- 账号级 QPS：Search 100，Fetch 25

## 开发

```bash
npm test   # node --test，使用模拟传输层，无需 API Key
```

目录结构：

```
manifest.json        插件清单（权限：ui.panel、agent.tool.register、net.fetch、shell.openExternal）
renderer/index.html  设置面板（API Key / 默认条数 / 最大字符数 / 测试连接）
main.js              插件入口，注册 web 工具
lib/deepseek.js      Search/Fetch API 客户端（参数校验、重试、格式化）
tests/               单元测试
```

## License

MIT
# DeepSeek Search · PI-Desktop 插件

为 PI-Desktop 智能体提供**联网搜索**与**网页抓取**能力，基于 DeepSeek 官方
[Search / Fetch API](https://api-docs.deepseek.com/zh-cn/guides/search)（DeepSeek 自研搜索引擎）。

## 功能

插件注册一个智能体工具 `web`（在 PI-Desktop 中显示为 `plugin_..._web`），包含两个动作：

| action | 接口 | 说明 |
| --- | --- | --- |
| `search` | `POST https://api.deepseek.com/v1/tools/search` | 按关键词搜索网页，返回标题、URL、站点、发布时间、相关性分数、权威性和长摘要 |
| `fetch` | `POST https://api.deepseek.com/v1/tools/fetch` | 抓取单个网页，以 Markdown 返回正文 |

`search` 参数：

- `query`（必填）：1～128 字符，支持搜索语法：`site:` `-site:` `"精确短语"` `-排除词` `lang:zh,en` `after:2025-01-01` `before:2026`
- `count`：返回条数 1～50（默认取插件设置，8）
- `ori_question`：用户原始问题，帮助理解搜索意图
- `need_content`：是否返回网页正文（默认 `false`）

`fetch` 参数：`url`（必填，http/https，不能含用户名密码）。

其它特性：

- 遇到 HTTP 408 / 429 / 5xx 自动退避重试（最多 2 次），其它 4xx 直接报错并给出中文提示
- 返回给模型的文本按 `maxChars` 截断，避免占满上下文
- 网络请求通过 `pi.net.fetch`，并在 manifest 中限定只能访问 `api.deepseek.com`

## 安装

1. 下载本仓库（`Code → Download ZIP` 或 `git clone`）。
2. PI-Desktop → 插件 → 从文件夹安装 / 开发者加载，选择本目录。
3. 在插件设置中填写 **DeepSeek API Key**（[获取地址](https://platform.deepseek.com/api_keys)）。

> 注意：当前 PI-Desktop 版本暂不支持加密的 secret 设置，API Key 以明文保存在本机插件设置中。
> 插件进程也不会继承系统环境变量，因此无法读取 `DEEPSEEK_API_KEY`，必须在设置中填写。

## 设置项

| key | 默认 | 说明 |
| --- | --- | --- |
| `apiKey` | 空 | DeepSeek API Key |
| `defaultCount` | 8 | 默认搜索结果条数（1～50） |
| `maxChars` | 20000 | 每次返回给智能体的最大字符数（2000～200000） |

## 使用示例

直接对智能体说：

- “搜索一下 DeepSeek 最新发布的模型，并给出来源”
- “用 site:github.com 搜索 pi-desktop 插件示例”
- “读取 https://api-docs.deepseek.com/zh-cn/guides/search 并总结计费规则”

## 计费与限速（来自官方文档）

- Search / Fetch 各 **5 元 / 1000 次成功请求**，失败、无结果、超时不计费
- 账号级 QPS：Search 100，Fetch 25

## 开发

```bash
npm test   # node --test，使用模拟传输层，无需 API Key
```

目录结构：

```
manifest.json        插件清单（权限：agent.tool.register、net.fetch）
main.js              插件入口，注册 web 工具
lib/deepseek.js      Search/Fetch API 客户端（参数校验、重试、格式化）
tests/               单元测试
```

## License

MIT
