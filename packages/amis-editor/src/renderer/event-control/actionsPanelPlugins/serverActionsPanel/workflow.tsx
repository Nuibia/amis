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
