import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, Check, Circle, LoaderCircle, ShieldCheck, X } from 'lucide-react';

const labels: Record<string, string> = {
  ACORDO: 'Acordo',
  DEFESA: 'Defesa',
  REVISAR: 'Revisar',
  ALTO: 'Alto risco',
  MEDIO: 'Médio risco',
  BAIXO: 'Baixo risco',
  AGUARDANDO_DECISAO: 'Aguardando decisão',
  EM_NEGOCIACAO: 'Em negociação',
  DECISAO_REGISTRADA: 'Decisão registrada',
  CONCLUIDO: 'Concluído',
  PRESENTE: 'Presente',
  AUSENTE: 'Ausente',
  INCONCLUSIVO: 'Inconclusivo',
  PENDENTE: 'Pendente',
  ACEITA: 'Aceita',
  ACEITO: 'Aceito',
  RECUSADA: 'Recusada',
  RECUSADO: 'Recusado',
  CONTRAPROPOSTA: 'Contraproposta',
  ADERENTE: 'Aderente',
  OVERRIDE: 'Divergência',
  DEMO: 'Demo data',
  SIMULACAO: 'Simulação',
  LOCAL: 'Nesta demo',
};
export function Badge({
  value,
  children,
  className = '',
}: {
  value: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span className={`badge badge-${value.toLowerCase()} ${className}`}>
      <span className="badge-dot" />
      {children || labels[value] || value}
    </span>
  );
}
export function Button({
  children,
  variant = 'primary',
  loading,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`button ${variant} ${className}`}
    >
      {loading && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function Brand({
  compact = false,
  inverse = false,
}: {
  compact?: boolean;
  inverse?: boolean;
}) {
  return (
    <div
      className={`brand ${inverse ? 'brand-inverse' : ''}`}
      aria-label="Enter Policy — protótipo Hackathon"
    >
      <svg
        className="brand-logo"
        viewBox="0 0 487 86"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M340.34 40.35H362.96C373.35 40.35 379.47 33.63 379.47 25.07C379.47 15.9 373.36 11.01 362.96 11.01H340.34V40.35ZM328.12 85.59V0H364.8C380.69 0 391.7 9.78 391.7 23.23C391.7 34.23 385.59 42.43 377.64 44.87C387.42 44.87 390.48 48.29 390.48 56.85V85.58H378.25V59.9C378.25 53.18 376.42 51.34 369.69 51.34H340.35V85.58H328.12V85.59Z"
          fill="currentColor"
        />
        <path
          d="M248.36 85.59V0H310.71V11H260.58V36.07H303.38V47.07H260.58V74.58H311.94V85.59H248.36Z"
          fill="currentColor"
        />
        <path d="M192.51 85.59V11H161.94V0H235.3V11H204.73V85.59H192.51Z" fill="currentColor" />
        <path
          d="M79.76 85.59V0H96.88L136.62 70.79V0H148.84V85.59H131.72L91.99 14.79V85.59H79.76Z"
          fill="currentColor"
        />
        <path
          d="M0 85.59V0H62.36V11H12.23V36.07H55.02V47.07H12.23V74.58H63.58V85.59H0Z"
          fill="currentColor"
        />
        <path
          d="M485.24 0H437.51C436.95 0 436.5 0.45 436.5 1.01V46.79C436.5 47.35 436.05 47.8 435.49 47.8H410.57C410.01 47.8 409.56 48.25 409.56 48.81V84.6C409.56 85.16 410.01 85.61 410.57 85.61H485.24C485.8 85.61 486.25 85.16 486.25 84.6V1.01C486.25 0.45 485.8 0 485.24 0Z"
          fill="currentColor"
        />
      </svg>
      {!compact && (
        <>
          <span className="brand-divider" />
          <span className="brand-module">policy</span>
        </>
      )}
    </div>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={`modal ${className}`}>
          <div className="modal-header">
            <div>
              <Dialog.Title className="modal-title">{title}</Dialog.Title>
              <Dialog.Description className={description ? 'modal-description' : 'sr-only'}>
                {description || title}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Fechar janela">
              <X size={19} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function LoadingState() {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={24} />
      <span>Preparando sua mesa de trabalho…</span>
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <AlertCircle size={30} />
      <h2>Não foi possível carregar os dados</h2>
      <p>{message}</p>
      <Button variant="secondary" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  );
}
export function Notice({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  const Icon = tone === 'success' ? Check : tone === 'warning' ? AlertCircle : Circle;
  return (
    <div className={`notice notice-${tone}`} role={tone === 'success' ? 'status' : undefined}>
      <Icon size={16} />
      <span>{children}</span>
    </div>
  );
}
export function Provenance({ policy, model }: { policy: string; model: string }) {
  return (
    <div className="provenance">
      <ShieldCheck size={13} />
      <span>
        Política {policy} · Modelo {model}
      </span>
    </div>
  );
}
