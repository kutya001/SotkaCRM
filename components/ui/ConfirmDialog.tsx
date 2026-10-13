'use client';

import * as React from 'react';
import { AlertTriangle, Trash2, RotateCcw, Info, type LucideIcon } from 'lucide-react';
import { Modal, ModalCallout, type ModalTone } from './Modal';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: React.ReactNode;
  /** Подзаголовок (например, имя записи) */
  subtitle?: React.ReactNode;
  /** Текст-предупреждение в плашке */
  description?: React.ReactNode;
  tone?: Extract<ModalTone, 'danger' | 'warning' | 'info' | 'success'>;
  icon?: LucideIcon;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  /** Дополнительные поля между плашкой и кнопками (причина, комментарий) */
  children?: React.ReactNode;
  level?: 1 | 2;
}

const DEFAULT_ICON: Record<NonNullable<ConfirmDialogProps['tone']>, LucideIcon> = {
  danger: Trash2,
  warning: RotateCcw,
  info: Info,
  success: AlertTriangle,
};

const CONFIRM_VARIANT: Record<NonNullable<ConfirmDialogProps['tone']>, 'danger' | 'warning' | 'info' | 'success'> = {
  danger: 'danger',
  warning: 'warning',
  info: 'info',
  success: 'success',
};

/** Диалог подтверждения действия в едином стиле */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  subtitle,
  description,
  tone = 'danger',
  icon,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  confirmDisabled = false,
  children,
  level = 1,
}: ConfirmDialogProps) {
  const [isWorking, setIsWorking] = React.useState(false);

  const handleConfirm = async () => {
    setIsWorking(true);
    try {
      await onConfirm();
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      icon={icon || DEFAULT_ICON[tone]}
      tone={tone}
      size="md"
      level={level}
      busy={isWorking}
      hideClose
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isWorking}>
            {cancelLabel}
          </Button>
          <Button variant={CONFIRM_VARIANT[tone]} onClick={handleConfirm} loading={isWorking} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {description && <ModalCallout tone={tone}>{description}</ModalCallout>}
        {children}
      </div>
    </Modal>
  );
}

// --- useConfirm: замена window.confirm -------------------------------------------------

interface ConfirmOptions {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  description?: React.ReactNode;
  tone?: ConfirmDialogProps['tone'];
  icon?: LucideIcon;
  confirmLabel?: string;
  cancelLabel?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const confirm = React.useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={Boolean(state)}
        onClose={() => close(false)}
        onConfirm={() => close(true)}
        title={state?.title ?? ''}
        subtitle={state?.subtitle}
        description={state?.description}
        tone={state?.tone ?? 'danger'}
        icon={state?.icon}
        confirmLabel={state?.confirmLabel}
        cancelLabel={state?.cancelLabel}
        level={2}
      />
    </ConfirmContext.Provider>
  );
}

/** `const confirm = useConfirm(); if (await confirm({ title: 'Удалить?' })) …` */
export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm должен использоваться внутри ConfirmProvider');
  }
  return ctx;
}
