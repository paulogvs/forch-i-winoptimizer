import React from 'react';

export interface CardProps {
  title?: string;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  hoverable?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  title,
  header,
  footer,
  hoverable = false,
  className = '',
  children,
}) => {
  const hoverClass = hoverable ? 'card-hover' : '';
  const classes = ['card', hoverClass, className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {(title || header) && (
        <div className="card-header">
          {title && <h3 className="card-title">{title}</h3>}
          {header}
        </div>
      )}
      <div className="card-body">{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  );
};
