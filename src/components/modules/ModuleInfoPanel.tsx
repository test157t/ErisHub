import { memo, ReactNode } from "react";

type ModuleInfoPanelProps = {
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  title?: ReactNode;
};

export const ModuleInfoPanel = memo(function ModuleInfoPanel({ children, className = "", description }: ModuleInfoPanelProps) {
  return <div className={`module-info-panel ${className}`.trim()}>
    {description ? Array.isArray(description) ? description.map((item, index) => <span key={index}>{item}</span>) : <span>{description}</span> : null}
    {children}
  </div>;
});
