import { memo, ReactNode } from "react";

type FieldGridProps = {
  children: ReactNode;
  columns?: "two" | "three" | "four";
  className?: string;
};

type ToggleSettingProps = {
  checked: boolean;
  children: ReactNode;
  onChange: (checked: boolean) => void;
};

export const FieldGrid = memo(function FieldGrid({ children, columns = "two", className = "climate-fields" }: FieldGridProps) {
  return <div className={`field-grid ${columns}-column ${className}`.trim()}>{children}</div>;
});

export const ToggleSetting = memo(function ToggleSetting({ checked, children, onChange }: ToggleSettingProps) {
  return <label className="check-row module-toggle-row"><input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" /> {children}</label>;
});
