import React from 'react';
import { Card } from '../components/ui/Card';
import { Toggle } from '../components/ui/Toggle';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Theme } from '@shared/types';

interface SettingsProps {
  theme: Theme;
  onThemeToggle: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ theme, onThemeToggle }) => {
  return (
    <div className="page">
      <h2 className="page-title mb-6">Settings</h2>

      <div className="flex flex-col gap-6 max-w-2xl">
        <Card title="Appearance">
          <div className="flex flex-col gap-4">
            <Toggle
              checked={theme === 'dark'}
              onChange={onThemeToggle}
              label="Dark Mode"
            />
            <Input label="Accent Color" type="color" defaultValue="#06B6D4" />
          </div>
        </Card>

        <Card title="General">
          <div className="flex flex-col gap-4">
            <Toggle checked={true} onChange={() => {}} label="Start with Windows" />
            <Toggle checked={false} onChange={() => {}} label="Minimize to tray on close" />
            <Toggle checked={true} onChange={() => {}} label="Enable notifications" />
            <Toggle checked={false} onChange={() => {}} label="Automatic updates" />
          </div>
        </Card>

        <Card title="Cleaner">
          <div className="flex flex-col gap-4">
            <Toggle checked={true} onChange={() => {}} label="Scan browser cache" />
            <Toggle checked={true} onChange={() => {}} label="Scan Windows temp files" />
            <Toggle checked={false} onChange={() => {}} label="Scan recycle bin" />
            <Input label="Exclude paths" placeholder="C:\Important" helperText="Comma-separated list of paths to exclude" />
          </div>
        </Card>

        <Card title="About">
          <div className="flex flex-col gap-2 text-sm text-fg-secondary">
            <p><strong>FORCH.iA WinOptimizer</strong> v0.1.0</p>
            <p>Built with FORCH.i by Paulo Velasco</p>
            <p>Electron 31 + React 18 + TypeScript 5.5 + Vite 5</p>
            <div className="mt-4">
              <Button variant="secondary" size="sm">Check for Updates</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
