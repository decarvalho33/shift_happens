# Integração de dados do frontend

`src/services/api.ts` concentra toda a leitura e gravação de dados. Os componentes devem importar suas funções, sem usar `fetch` diretamente. Os contratos TypeScript ficam em `src/types/index.ts`.

Sem `VITE_API_BASE_URL`, o serviço usa `src/mocks/behavioralFixtures.ts`, com latência simulada de 100 ms. Todos os nomes, números de processo, documentos, probabilidades, valores, versões de política e modelo são fictícios. Não há execução de política, modelo, extração de PDF ou cálculo financeiro. Os casos originais têm prévias textuais `demo_pages`; os dois dossiês adicionais usam PDFs estáticos fornecidos em `public/demo-cases`. Toda referência de evidência identifica um documento e uma página existente.

Os casos `caso-1` a `caso-8` mantêm as sete categorias documentais. `caso-anexo-01` preserva 7 PDFs do processo `0801234-56.2024.8.10.0001`; `caso-anexo-02` preserva 4 PDFs do processo `0654321-09.2024.8.04.0001`. Os casos 1–3 e os anexos começam aguardando decisão; os casos 4–8 incluem registros demonstrativos iniciais. A próxima evidência é uma sugestão acompanhada de SIMULAÇÃO explícita e nunca recalcula a recomendação.

## API pública

| Função | Retorno | Endpoint futuro |
| --- | --- | --- |
| `getCases()` | `Promise<CaseSummary[]>` | `GET /cases` |
| `getCase(id)` | `Promise<CaseDetail>` | `GET /cases/:id` |
| `getRecommendation(id)` | `Promise<RecommendationResponse>` | `GET /cases/:id/recommendation` |
| `getDecision(caseId)` | `Promise<DecisionRecord \| null>` | `GET /cases/:id/decision` |
| `getNegotiation(caseId)` | `Promise<NegotiationRecord \| null>` | `GET /cases/:id/negotiation` |
| `submitLawyerDecision(input)` | `Promise<DecisionRecord>` | `POST /cases/:id/decision` |
| `submitOverride(input)` | `Promise<DecisionRecord>` | `POST /cases/:id/override` |
| `submitNegotiation(input)` | `Promise<NegotiationRecord>` | `POST /cases/:id/negotiation` |
| `getAdminDashboard()` | `Promise<AdminDashboard>` | `GET /admin/dashboard` |
| `resetDemoData()` | `Promise<void>` | Apenas local; não existe chamada de reset remoto |

Também são exportados `isMockMode`, `DATA_CHANGED_EVENT`, `DEMO_STORAGE_KEY` e `ApiError` (com `message` e `status`). Consultas a registro ainda inexistente retornam JSON `null`; consultas a caso inexistente devem falhar com 404. POSTs recebem o objeto tipado completo, incluindo `case_id`, e retornam o registro persistido. As respostas HTTP devem ser JSON, sem envelope. Mensagens de falha podem usar `{ "message": "..." }` ou `{ "detail": "..." }`.

Para integrar um serviço real, configure, por exemplo, `VITE_API_BASE_URL=/api` no ambiente Vite. O prefixo é concatenado aos endpoints acima. A camada central oferece GET/POST tipados e timeout de 15 segundos. Autenticação, autorização, auditoria durável e validação do contrato recebido pertencem à integração futura; os tipos de resposta são contratos de compilação, não validadores de schema em runtime. Não há fallback automático para mocks se a API real falhar.

## Copiloto da Política

O protótipo inclui uma implementação local em `src/backend/`. Ela usa a OpenAI Responses API, carrega as fixtures demonstrativas no servidor e mantém cálculos, fontes e proveniência sob controle da aplicação. Configure `OPENAI_API_KEY` em `src/backend/.env`; a chave não é enviada ao navegador.

`src/services/policyCopilot.ts` expõe a fronteira assíncrona do copiloto. Sem `VITE_COPILOT_API_URL`, `createPolicyCopilotProvider()` usa o provider determinístico local. Para integrar um backend, configure a base do serviço, por exemplo:

```env
VITE_COPILOT_API_URL=/api/copilot
```

Com essa configuração, o provider HTTP usa `POST /api/copilot/lawyer` para o advogado e `POST /api/copilot/admin` para o administrativo. O corpo contém somente `question`, `intent`, `case_id` quando aplicável, `context_ref`, os filtros escalares do recorte administrativo em `scope.filters` e `scenario` quando houver. O frontend não envia o objeto de contexto, dashboard, documentos, perfil ou `audience`; a escolha do endpoint, o identificador de correlação e os filtros recebidos não são uma autorização confiável.

O backend deve autenticar a sessão, obter o perfil autorizado no servidor e carregar o contexto permitido. No endpoint do advogado, deve ainda validar a atribuição do `case_id` antes de consultar o caso, documentos ou evidências. No endpoint administrativo, deve validar cada filtro recebido, reaplicar o recorte no servidor e calcular métricas e simulações em funções controladas pelo sistema. O modelo apenas cruza, resume e explica os resultados dessas funções. Respostas documentais devem preservar documento, página e origem; respostas administrativas devem informar período, tamanho da base, versões disponíveis e limitações. Toda hipótese precisa ser marcada como `SIMULAÇÃO`.

Os endpoints retornam `PolicyCopilotResponse` em JSON, sem envelope, com `provenance.engine` igual a `remote-policy-copilot`. O backend deve ecoar o `context_ref` recebido em `provenance.contextRef`; ele serve apenas para correlacionar a resposta ao processo/recorte e nunca substitui autorização no servidor. O provider valida a estrutura, as fontes permitidas por perfil, a audiência e essa correlação antes de exibir a resposta. Erros HTTP, timeout, falha de rede ou JSON inválido são apresentados como erro; quando a URL remota está configurada, não existe fallback silencioso para o provider local.

O navegador envia as credenciais da sessão com a chamada, mas nunca deve receber uma chave do provedor de modelo. Variáveis `VITE_*` fazem parte do bundle público: não coloque `OPENAI_API_KEY`, tokens ou outros segredos nelas. A chamada ao modelo e suas credenciais pertencem exclusivamente ao backend.

## Gravação e atualização

As decisões e negociações locais são persistidas em `localStorage['policy:demo-data:v1']`, com versão de schema. A última decisão e a última negociação de cada caso são mantidas entre recargas. Os registros iniciais de demonstração são usados quando não existe gravação local. A restauração remove somente essa chave e repõe as fixtures. Objetos retornados no modo mock são cópias, para evitar alteração acidental das fixtures. Erros de armazenamento são apresentados como falhas, sem afirmar que um registro foi salvo.

Após uma gravação bem-sucedida ou restauração, o serviço emite `window` event `policy:data-changed`. Hooks devem refazer as consultas relevantes e remover seus listeners no cleanup. `event.detail` contém `action`, `case_id` opcional e `demo_data`. Alterações da mesma chave em outra aba também emitem esse evento.

A confirmação exige uma decisão igual à recomendação; uma divergência exige decisão diferente, motivo enumerado e justificativa não vazia. Negociações exigem decisão de acordo registrada e valores positivos finitos. Uma contraproposta exige `counterproposal_value`; aceite exige `final_value`. Faixas sugeridas não são usadas para calcular valores ou inferir novas recomendações. Negociações anteriores ficam preservadas se a estratégia for alterada, mas deixam de determinar o estado ativo e a tabela administrativa enquanto a decisão for defesa ou revisão.

O estado do caso passa para `EM_NEGOCIACAO` após decisão de acordo e para `CONCLUIDO` após aceite; decisões de defesa ou revisão ficam em `DECISAO_REGISTRADA`. Negociações pendentes, recusadas e com contraproposta mantêm `EM_NEGOCIACAO`. A recomendação original, sua versão e seus números permanecem iguais às fixtures.

## Dashboard demonstrativo

Os KPIs, séries, distribuição, motivos de divergência e a simulação histórica são valores sintéticos de um cenário demonstrativo maior, não totais da tabela visível. Taxas e `percentage` usam a escala de 0 a 1. A interface deve rotular esses agregados como demonstração; a simulação histórica é separada dos registros efetivamente inseridos no navegador e não representa economia realizada.

`metrics.firm_count` e `metrics.lawyer_count` informam, quando disponíveis, as quantidades únicas na base agregada. Com filtros detalhados, a interface recalcula essas quantidades a partir dos registros rastreáveis do recorte.

`firm_adherence` e `lawyer_adherence` trazem os recortes completos por escritório e advogado, sem limite de ranking. O volume de decisões de cada uma dessas listas deve somar `metrics.decisions`. Sem filtros globais, as comparações de aderência usam esses agregados; com filtros explícitos, usam somente os registros rastreáveis compatíveis e identificam esse escopo na tela.

`getAdminDashboard()` combina as linhas iniciais com a última decisão/negociação local por caso, sem duplicar o caso. `is_local: true` identifica linhas com interação persistida no navegador, ainda dentro da demonstração. A tabela e `updated_at` acompanham essas gravações; KPIs financeiros, séries e premissas históricas não são recalculados.
