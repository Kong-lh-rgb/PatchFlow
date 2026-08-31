import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PatchFlow',
  description:
    '面向 GitHub Issue 和代码缺陷的可验证 AI Coding Agent：理解仓库、复现问题、生成补丁、运行测试并交付带证据的修改结果。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
