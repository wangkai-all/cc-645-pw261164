# OPC UA 地址空间浏览器

一个用 **Node.js + node-opcua + React** 构建的 OPC UA 地址空间浏览与数据采集工具。
浏览器只负责界面，所有 OPC UA 通信、节点身份解析、结构比对和持久化都由后端网关完成。

它解决三类实际问题：

1. **按对象浏览地址空间**，同一节点可经多条引用路径到达，引用环可以展开检查，但不会无限复制节点。
2. **节点身份与连接解耦**：用「命名空间 URI + 标识符」保存选择，而不是某次连接得到的命名空间序号。服务器重启后命名空间顺序变化，选择仍指向同一节点；标识符无法匹配时明确报失配，绝不按名字错绑。
3. **可信地采集数值**：每个样本保留数据类型、状态码、源时间、服务时间；数组、矩阵、结构化值有专门展示；Bad / Uncertain 质量不会被当作普通数值。结构定义变化时先提示、确认后才按新定义接收，历史样本保留原解释。

## 目录结构

```
packages/
  server/                后端网关（Express + ws + node-opcua）
    src/
      index.js           HTTP/WebSocket 入口，REST 路由与静态托管
      opcua/
        identity.js      稳定身份：NodeId ⇄ {命名空间 URI, 标识符}
        fingerprint.js   结构指纹（DataType/ValueRank/ArrayDimensions/DataTypeDefinition）
        session.js       OPC UA 会话：浏览、读、写、订阅
        connection-manager.js  连接管理与选择项重核对（reconcile）
        serialize.js     Variant/DataValue/StatusCode 序列化与质量分类
      test-server/       内置演示 OPC UA 服务器（V1/V2 两套结构）
      collection/        采集管理与环形样本缓冲（按结构签名标记）
      store/             JSON 文件持久化（原子写）
      ws/hub.js          WebSocket 广播
    scripts/             端到端测试与可重复演示脚本
  web/                   React 19 + Vite 前端
    src/components/      地址树、节点详情、值渲染、结构变更弹窗、采集面板等
scripts/run-tests.mjs    根测试编排器
```

## 快速开始

```bash
# 安装依赖（如遇缓存权限问题可设置 npm_config_cache）
npm install

# 构建前端
npm run build

# 启动网关（同时托管内置演示服务器与网页）
npm start
# 打开 http://localhost:4080
```

开发模式（网关热重载 + Vite 热更新，Vite 代理 `/api` 与 `/ws` 到 4080）：

```bash
npm run dev
```

单独运行演示 OPC UA 服务器（默认 OPC UA 端口 4840，可用 `--port`、`--variant V1|V2`）：

```bash
npm run test-server
```

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4080` | 网关 HTTP/WS 端口 |
| `OPC_BROWSER_CONFIG` | `packages/data/config.json` | 持久化配置文件路径 |

## 网页操作流程

1. **连接**：顶部选择「内置演示服务器 V1/V2」，或填写外部 OPC UA 端点连接。
2. **浏览**：从根节点按对象逐层展开。
   - 同一节点在不同路径下都会出现，但节点视图用全局身份去重，并显示「共享 / 环」标记；引用环可继续展开，不会无限增殖。
   - 节点详情中显示完整引用路径。
3. **选择变量**：点击「加入选择」。后端先验证节点存在并读取结构指纹，再以稳定身份落盘。
4. **采集**：在采集面板对选择项启动采集，样本通过 WebSocket 实时推送，表格展示类型、值、状态码、质量、源时间、服务时间。
5. **演示控制**：
   - 注入 Good / Uncertain / Bad 质量状态（Bad 样本的值置空并以红色标注，Uncertain 保留值但以琥珀色标注可疑）。
   - 修改数组长度，读取一维数组与 3×3 矩阵。
   - 切换服务器结构 V1 ↔ V2。
6. **结构变更**：重连后若结构指纹变化，对应选择项标记为「结构已变更」，弹窗逐字段展示新增/删除差异；确认后才按新定义继续采集，未确认前采集被拦截。

## 稳定身份与重启演示（核心设计）

稳定身份形如：

```json
{ "namespaceUri": "urn:demo:process", "identifierType": "string", "identifier": "Line1.Reactor.Temperature" }
```

- 连接时读取服务器 `NamespaceArray`，把命名空间序号解析为 URI；标识符支持 numeric / string / guid / opaque（byteString 以 base64 保存）四种类型。
- 演示服务器的两个变体故意以**相反顺序注册命名空间**：V1 中 `urn:demo:process` 是 ns=2，V2 中变成 ns=3。因为保存的是 URI，重连后会按当前命名空间表重新解析，选择仍指向同一节点。
- V1 的 `Pressure`（标识符 `Line1.Reactor.Pressure`）在 V2 中不存在；V2 里同名浏览项 "Pressure" 实际是另一个节点 `Line1.Reactor.Pressure2`。工具返回显式失配 `node-id-unknown-on-server`，**不会**因为浏览名相同而错绑。
- `BatchRecord` 结构在 V1 为 `batchId, sequence, temperature, createdAt`，V2 变为 `id, sequence, temperature, pressure, createdAt`。结构指纹通过 DataType(14)、ValueRank(19)、ArrayDimensions(20) 以及在 DataType 节点上读取 DataTypeDefinition(23) 计算，检测到变化后进入确认流程。
- 每条历史样本都带 `structureSignature`：确认前采集的样本保留 `batchId` 旧解释，确认后的新样本按 `id/pressure` 解释，两者在同一缓冲区内共存、互不改写。

## 可重复的脚本演示

先启动网关（`npm start`），另开终端运行：

```bash
npm run demo
```

该脚本以与网页完全相同的 REST 调用，按顺序 narrate 以下流程：连接 V1 → 浏览（含引用环）→ 保存选择 → 采集并核对时间戳/状态码 → 注入 Bad/Uncertain → 改数组长度、读数组与结构值 → 切到 V2 → 重核对（URI 解析、结构变更、显式失配）→ 确认新结构并验证新旧样本解释共存。

## 测试

```bash
npm test          # 编排器：构建前端 → 启动网关 → 跑全部套件 → 收尾
npm run test:fast # 仅后端套件（需网关已在运行）
```

四个套件：

| 套件 | 覆盖内容 |
| --- | --- |
| `api-e2e.cjs` | 浏览去重、多路径/引用环、选择、读写、质量分类、数组与结构值 |
| `restart-e2e.cjs` | V1→V2 命名空间换序、URI 重解析、显式失配、结构变更确认、新旧样本解释共存 |
| `ws-e2e.mjs` | WebSocket 实时推送与样本字段完整性 |
| `web/test/render.test.jsx` | React 组件 SSR 渲染（esbuild 打包，react-dom/server） |

## 主要 REST 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/connection/connect` | 连接内置演示服务器（`variant`）或外部端点（`endpointUrl`） |
| POST | `/api/connection/disconnect` | 断开连接 |
| POST | `/api/connection/reconcile` | 重核对全部选择项（ok / mismatch / structure-changed） |
| POST | `/api/browse` | 按稳定身份浏览 HierarchicalReferences |
| POST | `/api/node-info` / `/api/read` | 节点属性 / 一次性读取当前值 |
| GET/POST | `/api/selections` | 列出 / 新增选择（新增时验证节点并记录结构指纹） |
| DELETE | `/api/selections/:id` | 删除选择 |
| POST | `/api/selections/:id/confirm-structure` | 确认结构变更，保留 previousFingerprint |
| POST | `/api/collections/start` `/stop` `/clear` | 采集控制（失配/未确认变更会被拦截） |
| GET | `/api/samples/:selectionId` | 读取样本（环形缓冲，带结构签名） |
| POST | `/api/write` | 通用写值（演示用：质量注入、数组长度） |
| GET | `/api/config` `/api/health` | 持久化快照 / 健康检查 |

WebSocket 端点 `ws://localhost:4080/ws`，推送消息类型包括 `hello`、`config`、`connection`、`sample`、`collection-status`、`collection-error`、`structure-confirmed`、`samples-cleared`。

## 持久化

- 配置保存在单个 JSON 文件（默认 `packages/data/config.json`，原子写：临时文件 + rename）。
- 文件中只保存基于 URI 的稳定身份、引用路径、结构指纹与采集配置，**不保存任何命名空间序号**。
- 删除该文件即可重置全部选择与采集状态。
