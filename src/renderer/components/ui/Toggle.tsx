import React from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Native tooltip, used to explain disabled/unimplemented switches. */
  title?: string;
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  className = '',
  title,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!disabled) onChange(!checked);
    }
  };

  const toggleElement = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      disabled={disabled}
      title={title}
      onClick={() => !disabled && onChange(!checked)}
      onKeyDown={handleKeyDown}
    />
  );

  if (label) {
    return (
      <div className={`toggle-wrapper ${className}`.trim()}>
        {toggleElement}
        <label className="toggle-label" onClick={() => !disabled && onChange(!checked)}>
          {label}
        </label>
      </div>
    );
  }

  return <div className={className}>{toggleElement}</div>;
};
