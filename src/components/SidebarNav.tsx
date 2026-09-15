import { memo } from "react";

type AppPage = "chat" | "editor" | "settings" | "agents" | "users" | "modules";

type SidebarNavProps = {
  activePage: AppPage;
  pages: Array<{ id: AppPage; label: string }>;
  onPageChange: (page: AppPage) => void;
};

export const SidebarNav = memo(function SidebarNav({ activePage, pages, onPageChange }: SidebarNavProps) {
  return <aside className="sidebar">
    <nav>
      {pages.map((page) => <button
        className={activePage === page.id ? "active" : ""}
        key={page.id}
        onClick={() => onPageChange(page.id)}
        type="button"
      >{page.label}</button>)}
    </nav>
  </aside>;
});
