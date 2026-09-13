import { useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowUp,
  Database,
  ExternalLink,
  FileText,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  CopilotCitation,
  CopilotFactSource,
  PolicyCopilotResponse,
} from '../lib/policyCopilot.types';
import '../styles/copilot.css';

type ConversationItem =
  | { id: number; role: 'user'; question: string }
  | { id: number; role: 'assistant'; answer: PolicyCopilotResponse };

export type PolicyCopilotProps = {
  title: string;
  contextLabel: string;
  sessionKey?: string;
  contextSelectorLabel?: string;
  contextOptions?: readonly {
    value: string;
    label: string;
    description?: string;
  }[];
  selectedContext?: string;
  onContextChange?: (value: string) => void;
  suggestions: readonly string[];
  onAsk: (question: string) => Promise<PolicyCopilotResponse>;
  onOpenCitation?: (citation: CopilotCitation) => void;
  notice?: string;
};

const sourceLabels: Record<CopilotFactSource, string> = {
  CASE_DETAIL: 'Dados do processo',
  RECOMMENDATION: 'Recomendação',
  DECISION: 'Decisão registrada',
  NEGOTIATION: 'Negociação',
  DASHBOARD_METRICS: 'Métricas administrativas',
  ADMIN_DECISION_ROW: 'Registros de decisões',
  DERIVED: 'Cálculo derivado',
};

function formatGeneratedAt(value: string | undefined) {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function citationText(citation: CopilotCitation) {
  const page = `, página ${citation.page}`;
  const origin = citation.origin ? ` · ${citation.origin}` : '';
  return `${citation.documentName}${page}${origin}`;
}

function visibleLimitations(answer: PolicyCopilotResponse) {
  const answerText = answer.answer.trim();
  return [...new Set(answer.limitations)]
    .map((limitation) => limitation.trim())
    .filter((limitation) => limitation && limitation !== answerText);
}

function AnswerBasis({ answer }: { answer: PolicyCopilotResponse }) {
  const { provenance } = answer;
  return (
    <details className="copilot-basis">
      <summary>
        <Database size={16} aria-hidden="true" />
        Base da resposta
      </summary>
      <dl>
        {answer.basis.map((basis, index) => (
          <div key={`${basis.source}-${basis.description}-${index}`}>
            <dt>{sourceLabels[basis.source]}</dt>
            <dd>
              {basis.description}
              {basis.recordCount == null
                ? ''
                : ` · ${new Intl.NumberFormat('pt-BR').format(basis.recordCount)} registros`}
            </dd>
          </div>
        ))}
        <div>
          <dt>Política</dt>
          <dd>{provenance.policyVersion || 'Não informado'}</dd>
        </div>
        {provenance.period && (
          <div>
            <dt>Período</dt>
            <dd>{provenance.period}</dd>
          </div>
        )}
        <div>
          <dt>Modelo</dt>
          <dd>{provenance.modelVersion || 'Não informado'}</dd>
        </div>
        <div>
          <dt>Dados atualizados</dt>
          <dd>{formatGeneratedAt(provenance.dataUpdatedAt ?? provenance.dashboardUpdatedAt)}</dd>
        </div>
        <div>
          <dt>Mecanismo</dt>
          <dd>
            {provenance.engine} · {provenance.version}
          </dd>
        </div>
      </dl>
      {provenance.dataMode === 'DEMONSTRATION' && (
        <span className="copilot-demo-label">DADOS DEMONSTRATIVOS</span>
      )}
    </details>
  );
}

function CitationList({
  citations,
  onOpen,
  canOpen,
}: {
  citations: CopilotCitation[];
  onOpen: (citation: CopilotCitation) => void;
  canOpen: boolean;
}) {
  if (!citations.length) {
    return <p className="copilot-no-citations">Sem fonte documental vinculada.</p>;
  }
  return (
    <div className="copilot-citations" aria-label="Fontes da resposta">
      <strong>Fontes</strong>
      <ul>
        {citations.map((citation, index) => {
          const content = citationText(citation);
          const key = `${citation.marker}-${citation.documentId}-${citation.page}-${index}`;
          return (
            <li key={key}>
              {canOpen ? (
                <button
                  type="button"
                  className="copilot-citation"
                  onClick={() => onOpen(citation)}
                  aria-label={`Abrir fonte: ${content}`}
                >
                  <FileText size={16} aria-hidden="true" />
                  <span>
                    {citation.marker} {content}
                  </span>
                  <ExternalLink size={14} aria-hidden="true" />
                </button>
              ) : (
                <span className="copilot-citation is-static">
                  <FileText size={16} aria-hidden="true" />
                  <span>
                    {citation.marker} {content}
                  </span>
                </span>
              )}
              {citation.excerpt && <blockquote>{citation.excerpt}</blockquote>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CalculationList({
  calculations,
}: {
  calculations: PolicyCopilotResponse['calculations'];
}) {
  return (
    <ul>
      {calculations.map((calculation) => (
        <li key={calculation.key}>
          <strong>
            {calculation.label}: {calculation.formattedResult}
          </strong>
          <small>{calculation.formula}</small>
          {calculation.inputs.length > 0 && (
            <span>
              Base:{' '}
              {calculation.inputs
                .map(
                  (input) =>
                    `${input.label} ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(input.value)}`,
                )
                .join(' · ')}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function PolicyCopilotSession({
  title,
  contextLabel,
  contextSelectorLabel = 'Contexto analisado',
  contextOptions,
  selectedContext,
  onContextChange,
  suggestions,
  onAsk,
  onOpenCitation,
  notice = 'O copiloto explica os dados disponíveis. Revise as fontes antes de agir.',
}: PolicyCopilotProps) {
  const contentId = useId();
  const descriptionId = useId();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageSequence = useRef(0);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const activeContext = contextOptions?.find((option) => option.value === selectedContext);

  function changeContext(value: string) {
    if (!onContextChange || value === selectedContext) return;
    setConversation([]);
    messageSequence.current = 0;
    setQuestion('');
    setError('');
    onContextChange(value);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function scrollToLatest() {
    window.setTimeout(() => {
      const node = messagesEndRef.current;
      if (node && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'end' });
      }
    }, 0);
  }

  async function ask(value: string) {
    const normalized = value.trim();
    if (!normalized || loading) return;
    setConversation((current) => [
      ...current,
      { id: ++messageSequence.current, role: 'user', question: normalized },
    ]);
    setQuestion('');
    setError('');
    setLoading(true);
    scrollToLatest();
    try {
      const answer = await onAsk(normalized);
      setConversation((current) => [
        ...current,
        { id: ++messageSequence.current, role: 'assistant', answer },
      ]);
      scrollToLatest();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível consultar o copiloto. Tente novamente.',
      );
      scrollToLatest();
    } finally {
      setLoading(false);
    }
  }

  function openCitation(citation: CopilotCitation) {
    if (!onOpenCitation) return;
    setOpen(false);
    window.setTimeout(() => onOpenCitation(citation), 0);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="copilot-trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={contentId}
        >
          <Sparkles size={20} aria-hidden="true" />
          <span>Copiloto da Política</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="copilot-overlay" />
        <Dialog.Content
          id={contentId}
          className="policy-copilot"
          aria-describedby={descriptionId}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            window.setTimeout(() => composerRef.current?.focus(), 0);
          }}
        >
          <header className="copilot-header">
            <div className="copilot-heading-icon" aria-hidden="true">
              <Sparkles size={21} />
            </div>
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description id={descriptionId}>{contextLabel}</Dialog.Description>
            </div>
            <Dialog.Close className="copilot-close" aria-label="Fechar copiloto">
              <X size={21} />
            </Dialog.Close>
          </header>

          <div className="copilot-notice">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>{notice}</span>
          </div>

          <div className="copilot-scroll-area">
            {contextOptions && contextOptions.length > 0 && selectedContext && onContextChange && (
              <section className="copilot-context-picker" aria-label="Contexto do copiloto">
                <label htmlFor={`${contentId}-context`}>
                  <span>{contextSelectorLabel}</span>
                  <select
                    id={`${contentId}-context`}
                    value={selectedContext}
                    disabled={loading}
                    onChange={(event) => changeContext(event.target.value)}
                  >
                    {contextOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {activeContext?.description && <p>{activeContext.description}</p>}
              </section>
            )}
            <section className="copilot-suggestions" aria-labelledby={`${contentId}-suggestions`}>
              <h2 id={`${contentId}-suggestions`}>Perguntas sugeridas</h2>
              <div>
                {suggestions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    disabled={loading}
                    onClick={() => void ask(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </section>

            <div
              className="copilot-messages"
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-busy={loading}
            >
              {!conversation.length && !loading && (
                <div className="copilot-empty">
                  <Sparkles size={24} aria-hidden="true" />
                  <p>Escolha uma sugestão ou escreva sua pergunta sobre este contexto.</p>
                </div>
              )}
              {conversation.map((item) =>
                item.role === 'user' ? (
                  <article className="copilot-message is-user" key={item.id}>
                    <span>Você</span>
                    <p>{item.question}</p>
                  </article>
                ) : (
                  <article
                    className={`copilot-message is-assistant${item.answer.status === 'UNAVAILABLE' ? ' is-unavailable' : ''}`}
                    key={item.id}
                  >
                    <span>Copiloto</span>
                    <h3>{item.answer.title}</h3>
                    {item.answer.status === 'UNAVAILABLE' && (
                      <strong className="copilot-unavailable-label">DADOS INSUFICIENTES</strong>
                    )}
                    <p>{item.answer.answer}</p>
                    {item.answer.facts.length > 0 && (
                      <ul className="copilot-highlights">
                        {item.answer.facts.map((fact) => (
                          <li key={fact.key}>
                            <strong>{fact.label}:</strong> {fact.formattedValue}
                          </li>
                        ))}
                      </ul>
                    )}
                    {item.answer.mode === 'SIMULATION' && (
                      <section className="copilot-simulation" aria-label="Resultado da simulação">
                        <strong>SIMULAÇÃO</strong>
                        {item.answer.assumptions.length > 0 && (
                          <div>
                            <span>Premissas</span>
                            <ul>
                              {item.answer.assumptions.map((assumption) => (
                                <li key={assumption}>{assumption}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {item.answer.calculations.length > 0 && (
                          <div>
                            <span>Resultados calculados</span>
                            <CalculationList calculations={item.answer.calculations} />
                          </div>
                        )}
                      </section>
                    )}
                    {item.answer.mode !== 'SIMULATION' && item.answer.calculations.length > 0 && (
                      <div className="copilot-calculations">
                        <strong>Cálculos utilizados</strong>
                        <CalculationList calculations={item.answer.calculations} />
                      </div>
                    )}
                    {item.answer.mode !== 'SIMULATION' && item.answer.assumptions.length > 0 && (
                      <div className="copilot-assumptions">
                        <strong>Premissas</strong>
                        <ul>
                          {item.answer.assumptions.map((assumption) => (
                            <li key={assumption}>{assumption}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {visibleLimitations(item.answer).length > 0 && (
                      <div className="copilot-limitations">
                        <strong>Limites desta resposta</strong>
                        <ul>
                          {visibleLimitations(item.answer).map((limitation) => (
                            <li key={limitation}>{limitation}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <CitationList
                      citations={item.answer.citations}
                      onOpen={openCitation}
                      canOpen={Boolean(onOpenCitation)}
                    />
                    <AnswerBasis answer={item.answer} />
                  </article>
                ),
              )}
              {loading && (
                <div className="copilot-loading" role="status">
                  <LoaderCircle size={18} aria-hidden="true" />
                  Consultando os dados disponíveis…
                </div>
              )}
              {error && (
                <div className="copilot-error" role="alert">
                  {error}
                </div>
              )}
              <div ref={messagesEndRef} aria-hidden="true" />
            </div>
          </div>

          <form
            className="copilot-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void ask(question);
            }}
          >
            <div>
              <textarea
                ref={composerRef}
                id={`${contentId}-question`}
                aria-label="Pergunte ao Copiloto da Política"
                value={question}
                maxLength={2000}
                rows={4}
                disabled={loading}
                placeholder="Digite sua pergunta…"
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void ask(question);
                  }
                }}
              />
              <button
                type="submit"
                className="copilot-send"
                disabled={loading || !question.trim()}
                aria-label="Enviar pergunta"
              >
                {loading ? (
                  <LoaderCircle size={20} aria-hidden="true" />
                ) : (
                  <ArrowUp size={20} aria-hidden="true" />
                )}
              </button>
            </div>
            <small>Enter envia · Shift + Enter cria uma nova linha</small>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function PolicyCopilot(props: PolicyCopilotProps) {
  return <PolicyCopilotSession key={props.sessionKey ?? props.contextLabel} {...props} />;
}
