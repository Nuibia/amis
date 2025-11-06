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
 *
 * @export
 * @class WorkflowAction
 * @implements {RendererAction}
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
