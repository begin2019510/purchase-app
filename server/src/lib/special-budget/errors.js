'use strict';
// 特殊预算业务错误：路由层据此映射 HTTP 状态码，不吞错、不猜错。
// 规则引擎的 ok:false 结果统一经 ruleFail() 转成这里。
class BizError extends Error {
  constructor(code, message, status, detail) {
    super(message || code);
    this.name = 'BizError';
    this.code = code;
    this.status = Number(status) || 400;
    this.detail = detail === undefined ? null : detail;
  }
}

function isBizError(e) {
  return e instanceof BizError || (e && e.name === 'BizError' && typeof e.code === 'string');
}

module.exports = { BizError, isBizError };
