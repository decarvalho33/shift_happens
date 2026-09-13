import { useState } from 'react';
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  FileText,
  Fingerprint,
  GitCompareArrows,
  MessageSquareQuote,
  ScanLine,
  Search,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { CaseDocument, Evidence, RecommendationResponse, SourceReference } from '../types';
import { Badge, Button, Modal, Notice } from './ui';
import '../styles/evidence.css';

export function DocumentsPanel({
  documents,
  onOpen,
}: {
  documents: CaseDocument[];
  onOpen: (document: CaseDocument, page?: number) => void;
}) {
  const [unavailable, setUnavailable] = useState<CaseDocument | null>(null);
  return (
    <aside className="panel documents-panel" aria-label="Documentos do processo">
      <div className="panel-heading">
        <h2>Documentos do processo</h2>
        <span className="count-label">{documents.length}</span>
      </div>
      <div className="documents-list">
        {documents.map((document) => {
          const StatusIcon =
            document.status === 'PRESENTE'
              ? Check
              : document.status === 'AUSENTE'
                ? X
                : TriangleAlert;
          return (
            <button
              key={document.id}
              className={`document-item document-${document.status.toLowerCase()}`}
              onClick={() => {
                if (document.status === 'AUSENTE') setUnavailable(document);
                else {
                  setUnavailable(null);
                  onOpen(document);
                }
              }}
              aria-label={
                document.status === 'AUSENTE'
                  ? `${document.name}: documento ausente. Ver orientação.`
                  : `Abrir ${document.name}`
              }
              title={document.description}
            >
              <span className="document-icon">
                <FileText size={17} />
              </span>
              <span className="document-copy">
                <strong>{document.name}</strong>
                <span>
                  <StatusIcon size={10} />
                  {document.status === 'PRESENTE'
                    ? `${document.page_count} páginas`
                    : document.status === 'AUSENTE'
                      ? 'Ausente'
                      : 'Inconclusivo'}
                </span>
              </span>
              {document.status === 'PRESENTE' && <Check size={12} className="document-check" />}
            </button>
          );
        })}
      </div>
      {unavailable && (
        <div className="document-unavailable">
          <Notice tone="warning">
            <strong>{unavailable.name} não foi encontrado.</strong> Considere esta ausência antes de
            decidir e, se possível, solicite o documento.
          </Notice>
        </div>
      )}
      <div className="documents-footnote">
        <ScanLine size={17} />
        <p>Clique em qualquer documento disponível para ler o conteúdo.</p>
      </div>
      <div className="document-legend">
        <span>
          <Check size={11} /> Presente
        </span>
        <span>
          <TriangleAlert size={11} /> Inconclusivo
        </span>
        <span>
          <X size={11} /> Ausente
        </span>
      </div>
    </aside>
  );
}

function SourceButton({
  source,
  onView,
}: {
  source: SourceReference;
  onView: (source: SourceReference) => void;
}) {
  return (
    <button
      className="source-button"
      onClick={() => onView(source)}
      aria-label={`Ver evidência: ${source.document_name}, página ${source.page}`}
    >
      <FileText size={12} />
      <span>
        {source.document_name} <span className="source-page">· p. {source.page}</span>
      </span>
      <ArrowUpRight size={12} />
      <span className="source-origin">{source.origin}</span>
    </button>
  );
}

function EvidenceCard({
  item,
  onView,
}: {
  item: Evidence;
  onView: (source: SourceReference) => void;
}) {
  const Icon =
    item.kind === 'FAVORAVEL'
      ? ShieldCheck
      : item.kind === 'RISCO'
        ? TriangleAlert
        : MessageSquareQuote;
  return (
    <article className={`evidence-card evidence-${item.kind.toLowerCase()}`}>
      <div className="evidence-card-top">
        <span className="evidence-icon">
          <Icon size={16} />
        </span>
        <div>
          <span className="evidence-kind">
            {item.kind === 'ALEGACAO' ? 'Alegação da parte' : 'Fato documental'}
          </span>
          <h3>{item.title}</h3>
        </div>
      </div>
      <p>{item.description}</p>
      <SourceButton source={item.source} onView={onView} />
    </article>
  );
}

export function EvidencePanel({
  recommendation,
  onViewSource,
}: {
  recommendation: RecommendationResponse;
  onViewSource: (source: SourceReference) => void;
}) {
  const [tab, setTab] = useState<'evidence' | 'contradictions'>('evidence');
  return (
    <section className="analysis-panel">
      <div className="analysis-tabs" aria-label="Análise documental">
        <button
          className={tab === 'evidence' ? 'active' : ''}
          aria-pressed={tab === 'evidence'}
          onClick={() => setTab('evidence')}
        >
          <Fingerprint size={15} />
          Pontos importantes <span>{recommendation.evidence.length}</span>
        </button>
        <button
          className={tab === 'contradictions' ? 'active' : ''}
          aria-pressed={tab === 'contradictions'}
          onClick={() => setTab('contradictions')}
        >
          <GitCompareArrows size={15} />
          Contradições <span>{recommendation.contradictions.length}</span>
        </button>
      </div>
      {tab === 'evidence' ? (
        <div className="evidence-sections">
          {(['FAVORAVEL', 'RISCO', 'ALEGACAO'] as const).map((kind) => {
            const items = recommendation.evidence.filter((item) => item.kind === kind);
            if (!items.length) return null;
            return (
              <section key={kind}>
                <div className={`evidence-section-heading heading-${kind.toLowerCase()}`}>
                  <span>
                    {kind === 'FAVORAVEL' ? (
                      <CheckCheck size={13} />
                    ) : kind === 'RISCO' ? (
                      <TriangleAlert size={13} />
                    ) : (
                      <MessageSquareQuote size={13} />
                    )}
                    {kind === 'FAVORAVEL'
                      ? 'O que ajuda a defesa'
                      : kind === 'RISCO'
                        ? 'O que precisa de atenção'
                        : 'O que a outra parte diz'}
                  </span>
                  <span>{items.length}</span>
                </div>
                <div className="evidence-grid">
                  {items.map((item) => (
                    <EvidenceCard key={item.id} item={item} onView={onViewSource} />
                  ))}
                </div>
              </section>
            );
          })}
          {!recommendation.evidence.length && (
            <div className="panel empty-state">
              <Search size={26} />
              <h3>Evidências ainda não disponíveis</h3>
              <p>Os documentos deste caso precisam de revisão.</p>
            </div>
          )}
          {recommendation.contradictions.length > 0 && (
            <button className="contradiction-alert" onClick={() => setTab('contradictions')}>
              <GitCompareArrows size={20} />
              <span>
                <strong>Há versões que precisam ser confrontadas</strong>
                <span>
                  Consulte{' '}
                  {recommendation.contradictions.length === 1
                    ? 'a contradição identificada'
                    : 'as contradições identificadas'}{' '}
                  e suas fontes.
                </span>
              </span>
              <ArrowUpRight size={17} />
            </button>
          )}
        </div>
      ) : (
        <div className="contradictions-list">
          {recommendation.contradictions.map((item) => (
            <article className="panel contradiction-card" key={item.id}>
              <header>
                <span className="contradiction-icon">
                  <GitCompareArrows size={18} />
                </span>
                <div>
                  <span className="evidence-kind">Contradição · ponto em aberto</span>
                  <h3>{item.title}</h3>
                </div>
              </header>
              <div className="comparison-side comparison-allegation">
                <span className="comparison-label">
                  <MessageSquareQuote size={13} />
                  Alegação da parte
                </span>
                <p>{item.allegation.text}</p>
                <SourceButton source={item.allegation.source} onView={onViewSource} />
              </div>
              <div className="comparison-connector">
                <GitCompareArrows size={15} />
                <span>Confronto de fontes</span>
              </div>
              <div className="comparison-side comparison-fact">
                <span className="comparison-label">
                  <FileCheck2 size={13} />
                  Fato documental
                </span>
                <p>{item.documentary_fact.text}</p>
                <SourceButton source={item.documentary_fact.source} onView={onViewSource} />
              </div>
              <footer>
                <CircleHelp size={16} />
                <p>{item.description}</p>
              </footer>
            </article>
          ))}
          {!recommendation.contradictions.length && (
            <div className="panel empty-state">
              <CheckCheck size={26} />
              <h3>Nenhuma contradição sinalizada</h3>
              <p>Esta análise não apontou conflito entre as fontes disponíveis.</p>
            </div>
          )}
        </div>
      )}
      {recommendation.next_best_evidence && (
        <article className="next-evidence">
          <div className="eyebrow">
            <span className="accent-square" />O que ainda precisamos confirmar?
          </div>
          <h3>{recommendation.next_best_evidence.title}</h3>
          <p>{recommendation.next_best_evidence.description}</p>
          {recommendation.next_best_evidence.simulation && (
            <div className="hypothesis">
              <Badge value="SIMULACAO" />
              <p>
                <strong>Hipótese:</strong> {recommendation.next_best_evidence.simulation.hypothesis}
              </p>
              <p>{recommendation.next_best_evidence.simulation.outcome}</p>
            </div>
          )}
        </article>
      )}
      <p className="analysis-footnote">
        <ShieldCheck size={13} />
        Cada conclusão deve ser conferida na fonte indicada.
      </p>
    </section>
  );
}

export function DocumentViewer({
  document,
  initialPage = 1,
  onClose,
}: {
  document: CaseDocument;
  initialPage?: number;
  onClose: () => void;
}) {
  const [page, setPage] = useState(initialPage);
  const content = document.demo_pages?.find((item) => item.page === page);
  const pages = Math.max(1, document.page_count);
  const validPage = Number.isInteger(page) && page >= 1 && page <= document.page_count;
  const pdfUrl =
    document.url && validPage ? `${document.url.split('#')[0]}#page=${page}` : undefined;
  return (
    <Modal
      open
      onClose={onClose}
      title={document.name}
      description="Fonte documental · consulte a página referenciada na análise."
      className="document-viewer"
    >
      <div className="viewer-toolbar">
        <span>
          <FileText size={14} />
          {document.category}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="Página anterior"
            disabled={!validPage || page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <label className="page-selector">
            Página{' '}
            <select
              value={page}
              aria-label="Página do documento"
              onChange={(event) => setPage(Number(event.target.value))}
            >
              {!validPage && <option value={page}>{page} · indisponível</option>}
              {Array.from({ length: pages }, (_, index) => (
                <option value={index + 1} key={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>{' '}
            de {pages}
          </label>
          <button
            className="icon-button"
            aria-label="Próxima página"
            disabled={!validPage || page >= pages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      {!validPage ? (
        <div className="modal-body">
          <Notice tone="warning">
            A fonte referencia a página {page}, mas este documento possui {document.page_count}{' '}
            páginas. Selecione uma página disponível para consultar o documento.
          </Notice>
        </div>
      ) : pdfUrl ? (
        <iframe
          key={pdfUrl}
          src={pdfUrl}
          title={`${document.name} — página ${page}`}
          className="pdf-frame"
        />
      ) : (
        <div className="document-canvas">
          <article className="document-paper">
            <header>
              <span>BANCO UNICAMP · ACERVO DEMONSTRATIVO</span>
              <Badge value="DEMO" />
            </header>
            <div className="paper-reference">
              {document.name} / Página {page}
            </div>
            <h2>{content?.title || 'Página sem prévia demonstrativa'}</h2>
            {content ? (
              <>
                {content.fields && (
                  <dl className="document-fields">
                    {content.fields.map((field) => (
                      <div key={field.label}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {content.paragraphs.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </>
            ) : (
              <p>
                O conteúdo desta página não faz parte da prévia. Selecione outra página ou retorne à
                fonte indicada na evidência.
              </p>
            )}
            <footer>
              Documento fictício para demonstração. Não representa um documento jurídico real.
              <span>{page}</span>
            </footer>
          </article>
        </div>
      )}
      <div className="viewer-footer">
        <span>
          {pdfUrl
            ? 'Visualização do documento disponibilizado para o caso.'
            : 'Prévia textual demonstrativa · fonte simulada'}
        </span>
        {pdfUrl && (
          <a className="button secondary" href={pdfUrl} target="_blank" rel="noreferrer">
            Abrir documento <ArrowUpRight size={14} />
          </a>
        )}
        <Button variant="secondary" onClick={onClose}>
          Voltar à análise
        </Button>
      </div>
    </Modal>
  );
}
