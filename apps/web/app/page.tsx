import { fetchApiHealth, resolveApiBaseUrl } from '@/src/lib/api';

export const dynamic = 'force-dynamic';

interface ComponentCard {
  name: string;
  state: 'up' | 'down' | 'placeholder';
  detail: string;
}

export default async function HomePage() {
  // 后端不可用时 fetchApiHealth 返回 down 而不是抛出异常，页面不会白屏。
  const apiHealth = await fetchApiHealth();

  const cards: ComponentCard[] = [
    {
      name: 'API',
      state: apiHealth.status,
      detail:
        apiHealth.status === 'up'
          ? `存活（GET ${apiHealth.baseUrl}/health → 200）`
          : `${apiHealth.message}（${apiHealth.baseUrl}）`,
    },
    {
      name: 'PostgreSQL',
      state: 'placeholder',
      detail: '占位：数据库状态入口在下一阶段接入（API /ready 已实现探测）',
    },
    {
      name: 'Redis',
      state: 'placeholder',
      detail: '占位：队列状态入口在下一阶段接入（API /ready 已实现探测）',
    },
    {
      name: 'Worker',
      state: 'placeholder',
      detail: '占位：Worker 消费状态在下一阶段接入',
    },
  ];

  return (
    <main className="page">
      <div className="header">
        <h1 className="title">PatchFlow</h1>
        <span className="badge">当前阶段：Foundation</span>
      </div>
      <p className="tagline">
        面向 GitHub Issue 和代码缺陷的可验证 AI Coding Agent ——
        在隔离环境中理解仓库、复现问题、生成补丁、运行测试，并交付带证据的修改结果。
      </p>

      {apiHealth.status === 'down' ? (
        <div className="error-banner" role="alert">
          无法连接 API：{apiHealth.message}（目标地址 {apiHealth.baseUrl}，可通过
          NEXT_PUBLIC_API_BASE_URL 配置）
        </div>
      ) : null}

      <section className="grid" aria-label="环境状态">
        {cards.map((card) => (
          <div className="card" key={card.name}>
            <h3>{card.name}</h3>
            <div className={`state ${card.state}`}>
              {card.state === 'up' ? '正常' : card.state === 'down' ? '不可用' : '占位'}
            </div>
            <p>{card.detail}</p>
          </div>
        ))}
      </section>

      <footer className="footer">
        <p>
          Foundation 阶段范围：pnpm Monorepo、共享契约、数据库 Schema 与 migration、API
          健康检查、Worker 队列骨架与本项目页面。API 基础地址：
          {resolveApiBaseUrl()}。
        </p>
      </footer>
    </main>
  );
}
