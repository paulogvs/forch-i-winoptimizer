import { Notification } from 'electron';

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  silent?: boolean;
}

export function showNotification(options: NotificationOptions): void {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: options.title,
      body: options.body,
      ...(options.icon !== undefined && { icon: options.icon }),
      silent: options.silent ?? false,
    });
    notification.show();
  }
}

export function showSuccessNotification(title: string, body: string): void {
  showNotification({ title, body, silent: true });
}

export function showErrorNotification(title: string, body: string): void {
  showNotification({ title, body, silent: false });
}

export function showInfoNotification(title: string, body: string): void {
  showNotification({ title, body, silent: true });
}
