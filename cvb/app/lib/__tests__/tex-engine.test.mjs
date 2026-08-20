// 引擎客户端读配置的常驻回归网。
//
// 为什么非有不可:2026-08-19 在**生产**上抓到 —— worker 把 templateBase 注入得好好的,
// 而 readConfig() 组装返回对象时漏了这个字段,于是 templateBase() 永远回落到同源 `/tex`,
// 而 `tex/` 自 2026-08-17 起就不随站点发布了 → 每个 .cls/.sty 都 404、**PDF 编译全灭**。
// 它坏了两天没人发现,因为 Node 编译冒烟是**显式把文件传进去**的,结构上抓不到这一类;
// 而 jsdom 冒烟不跑引擎。这条测试盯的就是"注入了什么,客户端就得读到什么"。
import { templateBase, isEngineConfigured } from '../tex-engine.mjs';

const CFG = {
  wrapperUrl: 'https://cdn.example.com/npm/texlyre-busytex@1.3.1/dist/index.js',
  assetBase: 'https://cdn.example.com/gh/onegbnet/ccs@deadbeef/tex-engine',
  assetVersion: '1.3.1-r8',
  templateBase: 'https://cdn.example.com/gh/onegbnet/ccs@deadbeef/tex-templates',
  useWorker: true,
  workerUrl: '/tex-worker.js?v=1',
};

afterEach(() => {
  delete window.__TEX_ENGINE__;
});

describe('templateBase', () => {
  it('注入了就必须原样读到 —— 不许回落到同源 /tex', () => {
    window.__TEX_ENGINE__ = { ...CFG };
    expect(templateBase()).toBe(CFG.templateBase);
    expect(templateBase()).not.toBe('/tex');
  });

  it('末尾斜杠归一,免得拼出双斜杠', () => {
    window.__TEX_ENGINE__ = { ...CFG, templateBase: `${CFG.templateBase}///` };
    expect(templateBase()).toBe(CFG.templateBase);
  });

  it('**没注入**时才回落 /tex(那是本地开发的老形态,不是线上的)', () => {
    window.__TEX_ENGINE__ = { ...CFG, templateBase: undefined };
    expect(templateBase()).toBe('/tex');
    delete window.__TEX_ENGINE__;
    expect(templateBase()).toBe('/tex');
  });

  it('配置缺三个必填项之一时,isEngineConfigured 为假', () => {
    window.__TEX_ENGINE__ = { ...CFG, assetVersion: '' };
    expect(isEngineConfigured()).toBe(false);
    window.__TEX_ENGINE__ = { ...CFG };
    expect(isEngineConfigured()).toBe(true);
  });
});
