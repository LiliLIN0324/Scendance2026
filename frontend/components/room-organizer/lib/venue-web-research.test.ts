import { describe, expect, it, vi } from 'vitest';
import { handleVenueResearch, publicResearchUrl } from '../../../../functions/api/venue-research';
import { answerAssistantChat } from '../../../../supabase/functions/_shared/assistant-chat';

describe('产品网页搜索与多模态转发', () => {
  const request = () => new Request('https://workbench.example/api/venue-research?q=' + encodeURIComponent('杭州西湖草坪婚礼场地'));
  it('未配置不发请求，不把本地资料伪装成联网结果', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await (await handleVenueResearch(request(), {}, fetcher)).json()).toMatchObject({ status: 'not-configured', sources: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('区分正文与摘要，并剔除私有/带凭据的来源', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [
      { title: '湖畔草坪婚礼', url: 'https://venue.cn/wedding', content: '婚礼场地', raw_content: '户外草坪用于婚礼仪式，具体使用范围需要联系场地方确认；公开介绍没有提供档期。' },
      { title: '婚宴案例', url: 'https://venue.cn/case', content: '来自搜索结果的摘要' },
      { title: 'private', url: 'http://127.0.0.1/internal', content: 'secret' },
    ] }));
    const result = await (await handleVenueResearch(request(), { TAVILY_API_KEY: 'fixture' }, fetcher)).json();
    expect(result.status).toBe('ok');
    expect(result.sources.map((source: { contentStatus: string }) => source.contentStatus)).toEqual(['read', 'snippet-only']);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ include_raw_content: 'text', include_answer: false });
    expect(publicResearchUrl('https://venue.cn/private?token=secret')).toBeNull();
  });
  it('图片经过实际服务端函数进入模型请求，不再被二次解析丢掉', async () => {
    const image = 'data:image/jpeg;base64,YWJj';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ action: 'ask', reply: '这张图需要核对尺寸。', references: [], facts: {} }) } }] }));
    const config: Record<string, string> = { AGENT_CHAT_BASE_URL: 'https://model.example/v1', AGENT_CHAT_KEY: 'fixture', AGENT_CHAT_MODEL: 'fixture' };
    const result = await answerAssistantChat({ message: '请看分区截图', history: [], responseMode: 'outdoor_v1', images: [image], enabled: true, env: key => config[key], fetcher });
    expect(result.status).toBe('ok');
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(sent.messages[1].content).toContainEqual({ type: 'image_url', image_url: { url: image } });
  });
});
