> **注意：**
>
> - 需要购买 Pro 版本的 AI 插件，才能添加自定义模型。

# AI 智能助手

## 功能概述

- **深度集成网盘**：AI 可以直接读取网盘中的文件和文件夹内容，进行问答、整理等操作；同时支持在对话中完成文件的上传、删除、查询等网盘操作。

- **自定义智能体**：可配置工具、知识库、对话上下文、模型等，适配不同业务场景；支持分组管理。

- **AI 输出渲染**：支持 Markdown 实时渲染，包括图片、公式、代码块，以及流程图、思维导图等图表；部分代码可在线预览运行。

- **智能体一键分享**：可将配置好的智能体分享给外部用户使用，适合作为专用工具或智能客服等场景。

- **会话与服务管理**：管理用户对话和模型服务；支持收藏精选对话，收藏内容可生成外链分享。

- **模型与服务集成**：可接入 DeepSeek、Qwen、本地大模型等多种模型，统一管理和调用。

- **安全与隔离机制**：防止不同用户数据混用和越权操作；文件访问能力遵循网盘本身的权限逻辑，无需额外担心数据泄露。

...

## RAG 配置说明

RAG（检索增强生成）让 AI 能够基于网盘中的文档内容回答问题。配置前需准备模型 API 和向量数据库。

- **模型服务名称**：自定义填写，便于识别
- **API 地址**：
    - 硅基流动示例：`https://api.siliconflow.cn/v1/chat/completions`
    - 阿里云示例：`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
- **API 密钥**：在对应平台获取，如硅基流动：`https://cloud.siliconflow.cn/me/account/ak`

### 向量数据库部署

向量数据库用于存储文档的语义索引，是 RAG 功能的基础组件。部署参考：

- [Milvus 官方安装文档](https://milvus.io/docs/zh/install_standalone-docker-compose.md)

```console
$ curl -SL https://static.box.kodcloud.com/plugins/teamos/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose
$ chmod +x /usr/local/bin/docker-compose

$ mkdir milvus && cd milvus
$ wget http://static.box.kodcloud.com/update/milvus-standalone-docker-compose.yml -O docker-compose.yml

$ docker-compose up -d

Creating milvus-etcd  ... done
Creating milvus-minio ... done
Creating milvus-standalone ... done
```

### 向量/嵌入模型添加

嵌入模型（Embedding）负责将文档内容转换为向量，供检索使用。

1. 在模型广场搜索 `BAAI/bge-m3`（适用于文本嵌入）
2. 添加模型：
	a. 模型 ID：`BAAI/bge-m3`
    b. 模型名称：自定义填写
    c. 模型类型：嵌入模型

3. 保存后点击检测，确认连接正常

### 图生文本模型添加

图生文本模型用于从图片中提取文字描述，支持对图片类文件的语义检索。

1. 在模型广场搜索 `Qwen/Qwen3-Omni-30B-A3B-Instruct`（适用于多模态）
2. 添加模型：
	a. 模型 ID：`Qwen/Qwen3-Omni-30B-A3B-Instruct`
    b. 模型名称：自定义填写
    c. 模型类型：图片描述提取

3. 保存后点击检测，确认连接正常

### RAG 配置项

按以下顺序完成 RAG 配置：

1. 启用 RAG

2. 配置向量数据库，并检测通过

3. 指定向量模型，并检测通过

4. 指定图片描述提取模型，并选择需要扫描的文件夹

5. 保存设置，等待文件自动入库和向量化，或点击立即手动更新
