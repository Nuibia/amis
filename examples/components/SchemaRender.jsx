/**
 * AMIS Schema 渲染器
 *
 * 该文件是 AMIS 框架中将 JSON Schema 配置渲染为实际页面的核心组件
 * 主要功能：将 JSON 配置转换为 React 组件，支持代码查看、移动端适配等
 */

import React from 'react';
// 从 amis 包导入核心渲染函数和组件
import {render, toast, makeTranslator, LazyComponent, Drawer} from 'amis';
import axios from 'axios';
import Portal from 'react-overlays/Portal';
import {normalizeLink} from 'amis-core';
import {withRouter} from 'react-router-dom';
import copy from 'copy-to-clipboard';
import {
  qsparse,
  parseQuery,
  attachmentAdpator,
  supportsMjs,
  setGlobalOptions
} from 'amis-core';
import isPlainObject from 'lodash/isPlainObject';
import {pdfUrlLoad} from '../loadPdfjsWorker';

/**
 * 动态加载代码编辑器组件
 * 用于在右侧面板显示 JSON 配置代码
 */
function loadEditor() {
  return new Promise(resolve =>
    import('amis-ui').then(component => resolve(component.Editor))
  );
}

// 获取视图模式，默认为 PC 端
const viewMode = localStorage.getItem('amis-viewMode') || 'pc';

// 设置全局选项，配置 PDF.js 工作线程
setGlobalOptions({
  pdfjsWorkerSrc: supportsMjs() ? pdfUrlLoad() : ''
});

/**
 * 创建 Schema 渲染器的高阶函数
 *
 * @param {Object} schema - AMIS JSON Schema 配置对象
 * @param {Object} schemaProps - 传递给渲染组件的额外属性
 * @param {boolean} showCode - 是否显示代码查看器按钮
 * @param {Object} envOverrides - 环境变量覆盖配置
 * @returns {React.Component} 包装后的 React 组件
 */
export default function makeSchemaRenderer(
  schema,
  schemaProps,
  showCode,
  envOverrides
) {
  // 如果 schema 没有 $schema 属性，添加默认结构
  if (!schema['$schema']) {
    schema = {
      ...schema
    };
  }

  // 处理嵌套的 schema 结构（兼容不同的配置格式）
  if (!schema.type && schema.schema) {
    schemaProps = schema.props; // 提取 props 配置
    envOverrides = schema.env; // 提取环境配置
    showCode = schema.showCode ?? true; // 提取显示代码配置，默认 true
    schema = {
      // 使用内层的 schema
      ...schema.schema
    };
  }

  return withRouter(
    class SchemaRenderer extends React.Component {
      static displayName = 'SchemaRenderer';

      // iframe 引用，用于移动端渲染
      iframeRef;

      // 组件状态
      state = {
        open: false, // 代码查看器是否打开
        schema: {} // 当前渲染的 schema
      };

      // 保存原始页面标题
      originalTitle = document.title;

      // 切换代码查看器显示状态
      toggleCode = () =>
        this.setState({
          open: !this.state.open
        });

      // 复制代码到剪贴板
      copyCode = () => {
        copy(JSON.stringify(schema, null, 2));
        toast.success('页面配置JSON已复制到粘贴板');
      };

      // 关闭代码查看器
      close = () =>
        this.setState({
          open: false
        });
      /**
       * 构造函数，初始化环境配置
       * env 对象定义了 AMIS 组件运行时的各种环境方法和配置
       */
      constructor(props) {
        super(props);

        const __ = makeTranslator(props.locale); // 创建翻译函数
        const {history} = props; // React Router 的 history 对象

        // AMIS 组件运行环境配置，这是整个渲染器的核心
        this.env = {
          // 更新页面位置（路由跳转）
          updateLocation: (location, replace) => {
            history[replace ? 'replace' : 'push'](normalizeLink(location));
          },

          // 页面跳转方法，支持各种跳转方式
          jumpTo: (to, action) => {
            if (to === 'goBack') {
              return history.location.goBack(); // 返回上一页
            }
            to = normalizeLink(to); // 规范化链接
            if (action && action.actionType === 'url') {
              // URL 类型的跳转
              action.blank === false
                ? (window.location.href = to) // 当前窗口跳转
                : window.open(to); // 新窗口打开
              return;
            }
            if (action && to && action.target) {
              // 指定 target 的跳转
              window.open(to, action.target);
              return;
            }
            if (/^https?:\/\//.test(to)) {
              // 外部链接跳转
              window.location.replace(to);
            } else {
              // 内部路由跳转
              history.push(to);
            }
          },

          // 检查当前 URL 是否匹配
          isCurrentUrl: to => {
            const history = this.props.history;
            const link = normalizeLink(to);
            const location = history.location;
            let pathname = link;
            let search = '';
            const idx = link.indexOf('?');
            if (~idx) {
              pathname = link.substring(0, idx);
              search = link.substring(idx);
            }

            if (search) {
              // 有查询参数的情况，检查路径和参数是否都匹配
              if (pathname !== location.pathname || !location.search) {
                return false;
              }
              const currentQuery = parseQuery(location);
              const query = qsparse(search.substring(1));

              return Object.keys(query).every(
                key => query[key] === currentQuery[key]
              );
            } else if (pathname === location.pathname) {
              return true; // 只有路径匹配
            }

            return false;
          },
          // API 请求方法，AMIS 组件通过此方法发起 HTTP 请求
          fetcher: async api => {
            let {url, method, data, responseType, config, headers} = api;
            config = config || {};
            config.url = url;
            responseType && (config.responseType = responseType);

            // 支持请求取消功能
            if (config.cancelExecutor) {
              config.cancelToken = new axios.CancelToken(config.cancelExecutor);
            }

            config.headers = headers || {};
            config.method = method;
            config.data = data;

            // GET 请求时，将 data 作为查询参数
            if (method === 'get' && data) {
              config.params = data;
            } else if (data && data instanceof FormData) {
              // FormData 不设置 Content-Type，让浏览器自动设置
              // config.headers['Content-Type'] = 'multipart/form-data';
            } else if (
              data &&
              typeof data !== 'string' &&
              !(data instanceof Blob) &&
              !(data instanceof ArrayBuffer)
            ) {
              // 普通对象序列化为 JSON
              data = JSON.stringify(data);
              config.headers['Content-Type'] = 'application/json';
            }

            // 配置 axios 不自动抛出错误，由组件自己处理
            config.validateStatus = function () {
              return true;
            };

            let response = await axios(config);

            // 处理附件下载适配
            response = await attachmentAdpator(response, __, api);

            // 处理错误响应
            if (response.status >= 400) {
              if (response.data) {
                // 处理登录过期重定向
                if (
                  response.status === 401 &&
                  response.data.location &&
                  response.data.location.startsWith('http')
                ) {
                  location.href = response.data.location.replace(
                    '{{redirect}}',
                    encodeURIComponent(location.href)
                  );
                  return new Promise(() => {}); // 返回永不 resolve 的 Promise
                } else if (response.data.msg) {
                  // 优先使用后端返回的错误消息
                  throw new Error(response.data.msg);
                } else {
                  // 其他错误序列化为字符串
                  throw new Error(JSON.stringify(response.data, null, 2));
                }
              } else {
                // 没有响应数据时，使用状态码作为错误信息
                throw new Error(`${response.status}`);
              }
            }

            return response;
          },
          // 检查请求是否被取消
          isCancel: value => axios.isCancel(value),

          // 复制内容到剪贴板
          copy: (content, options) => {
            copy(content, options);
            toast.success('内容已复制到粘贴板');
          },

          // 阻止路由跳转（用于表单未保存提示等场景）
          blockRouting: fn => {
            return history.block(fn);
          },

          // 数据埋点方法
          tracker(eventTrack) {
            console.debug('eventTrack', eventTrack);
          },
          // 加载 TinyMCE 富文本编辑器插件
          loadTinymcePlugin: async tinymce => {
            // 参考：https://www.tiny.cloud/docs/advanced/creating-a-plugin/
            /*
              Note: We have included the plugin in the same JavaScript file as the TinyMCE
              instance for display purposes only. Tiny recommends not maintaining the plugin
              with the TinyMCE instance and using the `external_plugins` option.
            */
            tinymce.PluginManager.add('example', function (editor, url) {
              var openDialog = function () {
                return editor.windowManager.open({
                  title: 'Example plugin',
                  body: {
                    type: 'panel',
                    items: [
                      {
                        type: 'input',
                        name: 'title',
                        label: 'Title'
                      }
                    ]
                  },
                  buttons: [
                    {
                      type: 'cancel',
                      text: 'Close'
                    },
                    {
                      type: 'submit',
                      text: 'Save',
                      primary: true
                    }
                  ],
                  onSubmit: function (api) {
                    var data = api.getData();
                    /* Insert content when the window form is submitted */
                    editor.insertContent('Title: ' + data.title);
                    api.close();
                  }
                });
              };
              /* Add a button that opens a window */
              editor.ui.registry.addButton('example', {
                text: 'My button',
                onAction: function () {
                  /* Open window */
                  openDialog();
                }
              });
              /* Adds a menu item, which can then be included in any menu via the menu/menubar configuration */
              editor.ui.registry.addMenuItem('example', {
                text: 'Example plugin',
                onAction: function () {
                  /* Open window */
                  openDialog();
                }
              });
              /* Return the metadata for the help plugin */
              return {
                getMetadata: function () {
                  return {
                    name: 'Example plugin',
                    url: 'http://exampleplugindocsurl.com'
                  };
                }
              };
            });
          },

          // 是否开启测试 testid（用于自动化测试）
          ...envOverrides // 合并用户自定义的环境配置
        };

        // 绑定方法到组件实例
        this.handleEditorMount = this.handleEditorMount.bind(this);

        // 创建 iframe 引用，用于移动端渲染
        this.iframeRef = React.createRef();

        // 监听移动端 iframe 准备就绪消息
        this.watchIframeReady = this.watchIframeReady.bind(this);
        window.addEventListener('message', this.watchIframeReady, false);
      }

      handleEditorMount(editor, monaco) {
        let host = `${window.location.protocol}//${window.location.host}`;

        // 如果在 gh-pages 里面
        if (/^\/amis/.test(window.location.pathname)) {
          host += '/amis';
        }

        const schemaUrl = `${host}/schema.json`;

        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
          schemas: [
            {
              uri: schemaUrl,
              fileMatch: ['*']
            }
          ],
          validate: true,
          enableSchemaRequest: true,
          allowComments: true
        });
      }

      renderCode() {
        return (
          <LazyComponent
            getComponent={loadEditor}
            editorDidMount={this.handleEditorMount}
            language="json"
            value={schema}
            placeholder="加载中，请稍后。。。"
            disabled
          />
        );
      }

      watchIframeReady(event) {
        // iframe 里面的 amis 初始化了就可以发数据
        if (event.data && event.data === 'amisReady') {
          this.updateIframe();
        }
      }

      updateIframe() {
        if (this.iframeRef && this.iframeRef.current) {
          this.iframeRef.current.contentWindow.postMessage(
            {
              schema: schema,
              props: {
                ...(isPlainObject(schemaProps) ? schemaProps : {}),
                location: this.props.location,
                theme: this.props.theme,
                locale: this.props.locale
              }
            },
            '*'
          );
        }
      }

      componentWillUnmount() {
        this.props.setAsideFolded && this.props.setAsideFolded(false);
        window.removeEventListener('message', this.watchIframeReady, false);
        document.title = this.originalTitle;
      }

      componentDidMount() {
        if (schema.title) {
          document.title = schema.title;
        }
      }

      renderSchema() {
        const {location, theme, locale} = this.props;
        if (viewMode === 'mobile') {
          return (
            <iframe
              width="375"
              height="100%"
              frameBorder={0}
              className="mobile-frame"
              ref={this.iframeRef}
              // @ts-ignore
              src={__uri('../mobile.html')}
            ></iframe>
          );
        }
        // 渲染 schema
        return render(
          schema,
          {
            ...(isPlainObject(schemaProps) ? schemaProps : {}),
            context: {
              // 上下文信息，无论那层可以获取到这个
              amisUser: {
                id: 1,
                name: 'AMIS User'
              }
            },
            location,
            theme,
            locale
          },
          this.env
        );
      }

      render() {
        const ns = this.props.classPrefix;
        const finalShowCode = this.props.showCode ?? showCode;
        return (
          <>
            <div className="schema-wrapper">
              {finalShowCode !== false ? (
                <Drawer
                  classPrefix={ns}
                  size="lg"
                  onHide={this.close}
                  show={this.state.open}
                  // overlay={false}
                  closeOnOutside={true}
                  position="right"
                >
                  {this.state.open ? this.renderCode() : null}
                </Drawer>
              ) : null}
              {this.renderSchema()}
            </div>
            {finalShowCode !== false ? (
              // <div className="schema-toolbar-wrapper">
              //   <div onClick={this.toggleCode}>
              //     查看页面配置 <i className="fa fa-code p-l-xs"></i>
              //   </div>
              //   <div onClick={this.copyCode}>
              //     复制页面配置 <i className="fa fa-copy p-l-xs"></i>
              //   </div>
              // </div>
              <Portal
                container={() => document.getElementById('Header-toolbar')}
              >
                <div className="hidden-xs hidden-sm ml-3">
                  <div>
                    <div className="Doc-headingList">
                      <div className="Doc-headingList-item">
                        <a onClick={this.toggleCode}>
                          查看配置 <i className="fa fa-code p-l-xs"></i>
                        </a>
                      </div>
                      <div className="Doc-headingList-item">
                        <a onClick={this.copyCode}>
                          复制配置 <i className="fa fa-copy p-l-xs"></i>
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </Portal>
            ) : null}
          </>
        );
      }
    }
  );
}
