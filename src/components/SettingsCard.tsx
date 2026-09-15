import { memo, ReactNode } from "react";

type SettingsCardProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
};

export const SettingsCard = memo(function SettingsCard({ actions, children, className = "", title, collapsible, defaultOpen = true }: SettingsCardProps) {
  if (collapsible) {
    return <div className={`settings-card full-span ${className}`.trim()}>
      <details className="settings-collapsible" open={defaultOpen}>
        <summary className="card-title-row">
          {title ? <h3>{title}</h3> : <span />}
          {actions}
        </summary>
        {children}
      </details>
    </div>;
  }

  return <div className={`settings-card full-span ${className}`.trim()}>
    {title || actions ? <div className="card-title-row">
      {title ? <h3>{title}</h3> : <span />}
      {actions}
    </div> : null}
    {children}
  </div>;
});
