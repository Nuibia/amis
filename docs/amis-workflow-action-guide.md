# Amis 自定义事件动作开发指南：调用工作流（Workflow）

## 📋 概述

本文档记录了如何在 Amis 可视化编辑器中新增自定义事件动作"调用工作流"（workflow）的完整实现过程。该功能参考了"发送请求"（ajax）动作的实现方式，提供了调用工作流服务的完整能力。

## 🎯 功能特性

- ✅ 支持配置 API 请求
- ✅ 支持可选的工作流 ID 配置
- ✅ 支持静默请求模式
- ✅ 支持自定义输出变量名
- ✅ 支持成功/失败消息提示
- ✅ 完全集成到可视化编辑器的动作配置面板

## 📁 文件结构

实现需要修改和创建以下文件：

```
packages/
├── amis-core/
│   └── src/
│       └── actions/
│           ├── WorkflowAction.ts          # 新增：工作流动作实现
│           └── index.ts                   # 修改：注册动作类型
│       └── Action.ts                      # 修改：添加动作处理逻辑
└── amis-editor/
    └── src/
        └── renderer/
            └── event-control/
                ├── actionsPanelPlugins/
                │   └── serverActionsPanel/
                │       ├── workflow.tsx    # 新增：编辑器面板配置
                │       └── index.ts       # 修改：导入面板配置
                └── eventControlConfigHelper.ts  # 修改：配置处理逻辑
```

## 🔧 实现步骤

### 步骤 1：创建动作实现类

**文件路径：** `packages/amis-core/src/actions/WorkflowAction.ts`

```typescript
import {Api, ApiObject} from '../types';
import {normalizeApi, normalizeApiResponseData} from '../utils/api';
import {ServerError} from '../utils/errors';
import {createObject, isEmpty} from '../utils/helper';
import {RendererEvent} from '../utils/renderer-event';
import {evalExpressionWithConditionBuilderAsync} from '../utils/tpl';
import {
  RendererAction,
  ListenerAction,
  ListenerContext,
  registerAction
} from './Action';

export interface IWorkflowAction extends ListenerAction {
  actionType: 'workflow';
  api: Api;
  workflowId?: string; // 工作流ID
  messages?: {
    success: string;
    failed: string;
  };
  options?: Record<string, any>;
  [propName: string]: any;
}

/**
 * 调用工作流动作
 */
export class WorkflowAction implements RendererAction {
  async run(
    action: IWorkflowAction,
    renderer: ListenerContext,
    event: RendererEvent<any>
  ) {
    if (!event.context.env?.fetcher) {
      throw new Error('env.fetcher is required!');
    }

    if (!action.api) {
      throw new Error('api is required!');
    }

    const env = event.context.env;
    const silent = action?.options?.silent || (action?.api as ApiObject).silent;
    const messages = (action?.api as ApiObject)?.messages;
    let api = normalizeApi(action.api);

    // 获取工作流ID（可能来自 action.workflowId 或 action.args.workflowId）
    const workflowId = action.workflowId || (action.args as any)?.workflowId;

    if (api.sendOn) {
      // 发送请求前，判断是否需要发送
      const sendOn = await evalExpressionWithConditionBuilderAsync(
        api.sendOn,
        action.data ?? {},
        false
      );

      if (!sendOn) {
        return;
      }
    }

    // 如果没配置data数据映射，则给一个空对象，避免将当前数据域作为接口请求参数
    // 如果有工作流ID，将其添加到请求参数中
    if ((api as any)?.data == undefined) {
      api = {
        ...api,
        data: workflowId ? {workflowId} : {}
      };
    } else if (workflowId) {
      // 如果已有 data，则合并 workflowId
      api = {
        ...api,
        data: {
          ...(api as any)?.data,
          workflowId
        }
      };
    }

    try {
      const result = await env.fetcher(
        api,
        action.data ?? {},
        action?.options ?? {}
      );
      const responseData =
        !isEmpty(result.data) || result.ok
          ? normalizeApiResponseData(result.data)
          : null;

      // 记录请求返回的数据
      event.setData(
        createObject(event.data, {
          ...event.data,
          ...responseData, // 兼容历史配置
          responseData: responseData,
          [action.outputVar || 'workflowResult']: {
            ...responseData,
            responseData,
            responseStatus: result.status,
            responseMsg: result.msg
          }
        })
      );
      if (!silent) {
        if (!result.ok) {
          throw new ServerError(
            messages?.failed ?? action.messages?.failed ?? result.msg,
            result
          );
        } else {
          const msg =
            messages?.success ??
            action.messages?.success ??
            result.msg ??
            result.defaultMsg;
          msg &&
            env.notify(
              'success',
              msg,
              result.msgTimeout !== undefined
                ? {
                    closeButton: true,
                    timeout: result.msgTimeout
                  }
                : undefined
            );
        }
      }

      return result.data;
    } catch (e) {
      if (!silent) {
        if (e.type === 'ServerError') {
          const result = (e as ServerError).response;
          env.notify(
            'error',
            e.message,
            result.msgTimeout !== undefined
              ? {
                  closeButton: true,
                  timeout: result.msgTimeout
                }
              : undefined
          );
        } else {
          env.notify('error', e.message);
        }
      }
      throw e;
    }
  }
}

registerAction('workflow', new WorkflowAction());
```

**关键点说明：**

1. **接口定义**：`IWorkflowAction` 继承自 `ListenerAction`，定义工作流动作的所有属性
2. **run 方法**：实现 `RendererAction` 接口的 `run` 方法，包含完整的请求逻辑
3. **工作流 ID 处理**：支持从 `action.workflowId` 或 `action.args.workflowId` 获取工作流 ID
4. **请求参数合并**：如果配置了工作流 ID，会自动添加到请求的 `data` 参数中
5. **注册动作**：使用 `registerAction('workflow', new WorkflowAction())` 注册动作

### 步骤 2：注册动作类型

**文件路径：** `packages/amis-core/src/actions/index.ts`

需要做以下修改：

1. **导入 WorkflowAction**：

```typescript
import './WorkflowAction';
```

2. **导入类型定义**：

```typescript
import {IWorkflowAction} from './WorkflowAction';
```

3. **在 AMISActionRegistry 中注册类型**：

```typescript
declare module '../schema' {
  interface AMISActionRegistry {
    // ... 其他动作类型
    workflow: IWorkflowAction;
    // ... 其他动作类型
  }
}
```

### 步骤 3：创建编辑器面板配置

**文件路径：** `packages/amis-editor/src/renderer/event-control/actionsPanelPlugins/serverActionsPanel/workflow.tsx`

```typescript
import React from 'react';
import {registerActionPanel} from '../../actionsPanelManager';
import {defaultValue, getSchemaTpl, tipedLabel} from 'amis-editor-core';
import {normalizeApi} from 'amis-core';

registerActionPanel('workflow', {
  label: '调用工作流',
  tag: '服务',
  description: '配置并调用工作流服务',
  descDetail: (info: any, context: any, props: any) => {
    let apiInfo = info?.api ?? info?.args?.api;
    if (typeof apiInfo === 'string') {
      apiInfo = normalizeApi(apiInfo);
    }
    const workflowId = info?.workflowId ?? info?.args?.workflowId;
    return (
      <div className="action-desc">
        调用工作流：
        {workflowId ? (
          <span className="variable-left">{workflowId}</span>
        ) : (
          <span className="variable-left">{apiInfo?.url || '-'}</span>
        )}
      </div>
    );
  },
  schema: () => [
    {
      type: 'wrapper',
      className: 'p-none',
      body: [
        getSchemaTpl('apiControl', {
          name: 'api',
          label: '配置请求',
          mode: 'horizontal',
          size: 'lg',
          inputClassName: 'm-b-none',
          renderLabel: true,
          required: true
        }),
        {
          name: 'workflowId',
          type: 'input-text',
          label: '工作流ID',
          placeholder: '请输入工作流ID（可选）',
          description: '工作流ID，如果配置了此字段，会将其添加到请求参数中',
          mode: 'horizontal',
          size: 'lg'
        },
        {
          name: 'options',
          type: 'combo',
          label: tipedLabel(
            '静默请求',
            '开启后，工作流请求将以静默模式发送，即不会弹出成功或报错提示。'
          ),
          mode: 'horizontal',
          items: [
            {
              type: 'switch',
              name: 'silent',
              label: false,
              onText: '开启',
              offText: '关闭',
              mode: 'horizontal',
              pipeIn: defaultValue(false)
            }
          ]
        },
        {
          name: 'outputVar',
          type: 'input-text',
          label: '请求结果',
          placeholder: '请输入存储请求结果的变量名称',
          description:
            '如需执行多次调用工作流，可以修改此变量名用于区分不同请求返回的结果',
          mode: 'horizontal',
          size: 'lg',
          value: 'workflowResult',
          required: true
        }
      ]
    }
  ],
  outputVarDataSchema: [
    {
      type: 'object',
      title: 'workflowResult',
      properties: {
        responseData: {
          type: 'object',
          title: '响应数据'
        },
        responseStatus: {
          type: 'number',
          title: '状态标识'
        },
        responseMsg: {
          type: 'string',
          title: '提示信息'
        }
      }
    }
  ]
});
```

**配置说明：**

- `label`: 动作显示名称
- `tag`: 动作分类标签，设置为"服务"会显示在"服务"分类下
- `description`: 动作描述
- `descDetail`: 动作详情的渲染函数
- `schema`: 动作配置表单的 schema 定义
- `outputVarDataSchema`: 输出变量的数据结构定义

### 步骤 4：导入面板配置

**文件路径：** `packages/amis-editor/src/renderer/event-control/actionsPanelPlugins/serverActionsPanel/index.ts`

添加导入：

```typescript
import './workflow';
```

### 步骤 5：更新动作处理逻辑

#### 5.1 更新 Action.ts

**文件路径：** `packages/amis-core/src/actions/Action.ts`

**修改点 1：添加属性排除列表**

在 `getOmitActionProp` 函数中添加：

```typescript
case 'ajax':
case 'download':
case 'workflow':
  omitList = ['api', 'messages', 'options'];
  break;
```

**修改点 2：添加动作参数处理**

在 `runAction` 函数中添加：

```typescript
} else if (['ajax', 'download', 'workflow'].includes(action.actionType)) {
  const api = action.api ?? action.args?.api;
  action.api = typeof api === 'string' ? api : {...api};
  action.options = {...(action.options ?? action.args?.options)};
  action.messages = {...(action.messages ?? action.args?.messages)};
  if (action.actionType === 'workflow') {
    action.workflowId = action.workflowId ?? action.args?.workflowId;
  }
  delete action.args?.api;
  delete action.args?.options;
  delete action.args?.messages;
  if (action.actionType === 'workflow') {
    delete action.args?.workflowId;
  }
}
```

**修改点 3：添加数据判断逻辑**

在数据域判断中添加：

```typescript
const data =
  actionData !== undefined &&
  !['ajax', 'download', 'workflow', 'dialog', 'drawer'].includes(
    action.actionType
  )
    ? actionData
    : mergeData;
```

#### 5.2 更新 eventControlConfigHelper.ts

**文件路径：** `packages/amis-editor/src/renderer/event-control/eventControlConfigHelper.ts`

在 `actionConfigInitFormatterHoc` 函数中添加：

```typescript
if (['ajax', 'download', 'workflow'].includes(action.actionType)) {
  config.api = action.api ?? action?.args?.api;
  config.options = action.options ?? action?.args?.options;
  config.workflowId = action.workflowId ?? action?.args?.workflowId;
  if (typeof action?.api === 'string') {
    config.api = normalizeApi(action?.api);
  }
  delete config.args;
}
```

## 🎨 使用示例

### 在可视化编辑器中配置

1. 打开需要配置的组件的事件面板
2. 添加事件（如"点击"事件）
3. 在动作配置弹窗中，选择"服务"分类
4. 选择"调用工作流"动作
5. 配置以下参数：
   - **配置请求**：设置 API 地址和请求方式
   - **工作流 ID**（可选）：输入工作流 ID
   - **静默请求**：选择是否静默发送
   - **请求结果**：设置输出变量名（默认为 `workflowResult`）

### Schema 配置示例

```json
{
  "type": "button",
  "label": "调用工作流",
  "onEvent": {
    "click": {
      "actions": [
        {
          "actionType": "workflow",
          "api": "/api/workflow/execute",
          "workflowId": "workflow-123",
          "outputVar": "workflowResult",
          "options": {
            "silent": false
          }
        }
      ]
    }
  }
}
```

## 📊 输出变量结构

调用工作流动作会将结果存储在指定的输出变量中（默认为 `workflowResult`），结构如下：

```typescript
{
  workflowResult: {
    responseData: {},      // 响应数据
    responseStatus: 200,   // HTTP 状态码
    responseMsg: "成功"     // 响应消息
  }
}
```

## 🔍 实现原理

### 动作注册流程

1. **动作实现**：创建实现 `RendererAction` 接口的类
2. **类型注册**：在 `AMISActionRegistry` 中注册类型定义
3. **动作注册**：使用 `registerAction` 注册动作实例
4. **面板注册**：使用 `registerActionPanel` 注册编辑器面板配置

### 动作执行流程

1. 用户在可视化编辑器中配置动作
2. 配置数据通过 `actionConfigInitFormatterHoc` 格式化
3. 运行时通过 `runAction` 执行动作
4. `WorkflowAction.run` 方法被调用
5. 执行 API 请求并处理响应

### 工作流 ID 处理逻辑

- 如果配置了 `workflowId`，会自动添加到请求的 `data` 参数中
- 如果 API 配置中已有 `data`，会合并 `workflowId`
- 如果 API 配置中没有 `data`，会创建包含 `workflowId` 的 `data` 对象

## 🚀 扩展建议

1. **添加更多工作流参数**：可以在面板配置中添加更多工作流相关的配置项
2. **支持工作流模板**：可以添加工作流模板选择功能
3. **增强错误处理**：可以根据工作流返回的错误类型进行更细粒度的处理
4. **添加工作流状态查询**：可以添加查询工作流执行状态的功能

## 📝 注意事项

1. **API 配置**：必须配置有效的 API 地址
2. **工作流 ID**：可选参数，但如果后端需要，建议配置
3. **输出变量**：建议为不同的工作流调用设置不同的输出变量名
4. **错误处理**：建议配置错误提示消息，方便调试

## 🔗 参考文档

- [Amis 官方文档 - 注册自定义动作](https://baidu.github.io/amis/zh-CN/docs/concepts/event-action#%E6%B3%A8%E5%86%8C%E8%87%AA%E5%AE%9A%E4%B9%89%E5%8A%A8%E4%BD%9C)
- [AjaxAction 实现参考](../../packages/amis-core/src/actions/AjaxAction.ts)
- [编辑器面板配置参考](../../packages/amis-editor/src/renderer/event-control/actionsPanelPlugins/serverActionsPanel/ajax.tsx)

## ✅ 检查清单

- [x] 创建 WorkflowAction.ts 动作实现类
- [x] 在 actions/index.ts 中注册动作类型
- [x] 创建 workflow.tsx 编辑器面板配置
- [x] 在 serverActionsPanel/index.ts 中导入面板配置
- [x] 更新 Action.ts 的动作处理逻辑
- [x] 更新 eventControlConfigHelper.ts 的配置处理逻辑
- [x] 测试动作在可视化编辑器中的显示
- [x] 测试动作的执行功能

---

**创建时间：** 2024 年
**最后更新：** 2024 年
**作者：** Amis 开发团队
