import { useState } from 'react';
import type { ReactNode } from 'react';

interface GroupProps {
  title: string;
  /** Short state of the group, so a closed group still shows what is set inside it. */
  recap: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

export default function Group({ title, recap, defaultOpen = false, className = '', children }: GroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={`pl-group ${className}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="pl-group__title">{title}</span>
        <span className="pl-group__recap">{recap}</span>
      </summary>
      <div className="pl-group__body">{children}</div>
    </details>
  );
}
