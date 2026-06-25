import { RemoteEditOutboundMessageType } from './PanelMessages';
import type { ConfirmDialogOptions } from './PanelTypes';

export interface InputDialogOptions {
  title: string;
  prompt?: string;
  placeHolder?: string;
  label?: string;
  value?: string;
  valueSelection?: readonly [number, number];
  password?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  validationMessage?: string;
  validateInput?: (value: string) => string | undefined | null | PromiseLike<string | undefined | null>;
}

export class RemoteEditDialogManager {
  private readonly pendingConfirmDialogs = new Map<string, (confirmed: boolean) => void>();
  private readonly pendingInputDialogs = new Map<string, (value: string | undefined) => void>();
  private confirmDialogSequence = 0;
  private inputDialogSequence = 0;

  constructor(
    private readonly canShowDialog: () => boolean,
    private readonly postMessage: (type: RemoteEditOutboundMessageType, payload: any) => void
  ) {}

  showInputDialog(options: InputDialogOptions): Promise<string | undefined> {
    if (!this.canShowDialog()) {
      return Promise.resolve(undefined);
    }

    const requestId = `${Date.now()}-${++this.inputDialogSequence}`;

    return new Promise<string | undefined>(resolve => {
      this.pendingInputDialogs.set(requestId, resolve);
      this.postMessage(RemoteEditOutboundMessageType.ShowInputDialog, {
        requestId,
        title: options.title,
        prompt: options.prompt || '',
        placeHolder: options.placeHolder || '',
        label: options.label || '',
        value: options.value || '',
        valueSelection: options.valueSelection || undefined,
        password: Boolean(options.password),
        confirmLabel: options.confirmLabel || 'OK',
        cancelLabel: options.cancelLabel || 'Cancel',
        validationMessage: options.validationMessage || ''
      });
    });
  }

  handleInputDialogResponse(payload: any): void {
    const requestId = String(payload?.requestId || '');
    const resolve = this.pendingInputDialogs.get(requestId);

    if (!resolve) {
      return;
    }

    this.pendingInputDialogs.delete(requestId);
    resolve(Boolean(payload?.confirmed) ? String(payload?.value ?? '') : undefined);
  }

  resolvePendingInputDialogs(): void {
    for (const resolve of this.pendingInputDialogs.values()) {
      resolve(undefined);
    }

    this.pendingInputDialogs.clear();
  }

  showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    if (!this.canShowDialog()) {
      return Promise.resolve(false);
    }

    const requestId = `${Date.now()}-${++this.confirmDialogSequence}`;

    return new Promise<boolean>(resolve => {
      this.pendingConfirmDialogs.set(requestId, resolve);
      this.postMessage(RemoteEditOutboundMessageType.ShowConfirmDialog, {
        requestId,
        title: options.title,
        message: options.message,
        details: options.details || '',
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel || 'Cancel',
        danger: Boolean(options.danger),
        hideCancel: Boolean(options.hideCancel),
        copyable: Boolean(options.copyable)
      });
    });
  }

  handleConfirmDialogResponse(payload: any): void {
    const requestId = String(payload?.requestId || '');
    const resolve = this.pendingConfirmDialogs.get(requestId);

    if (!resolve) {
      return;
    }

    this.pendingConfirmDialogs.delete(requestId);
    resolve(Boolean(payload?.confirmed));
  }

  resolvePendingConfirmDialogs(): void {
    for (const resolve of this.pendingConfirmDialogs.values()) {
      resolve(false);
    }

    this.pendingConfirmDialogs.clear();
  }

  resolvePendingDialogs(): void {
    this.resolvePendingConfirmDialogs();
    this.resolvePendingInputDialogs();
  }
}
