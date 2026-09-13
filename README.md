# Enter Policy

**Hackathon Enter × Unicamp 2026 · Política de acordos com inteligência**

Protótipo de uma mesa de decisão para contencioso bancário. A experiência reúne recomendação, evidências rastreáveis, decisão do advogado, negociação e monitoramento administrativo em um fluxo demonstrativo.

## Links rápidos

- [Desafio oficial](https://www.hackathon.getenter.ai/desafio)
- [Guia de instalação](SETUP.md)
- [Roteiro completo do frontend](frontend/README.md)
- [Agente de testes de usabilidade](usability-agent/README.md)

---

## O problema

O Banco Unicamp recebe aproximadamente **15 mil processos novos por mês**. Cerca de **5 mil** envolvem consumidores que afirmam não reconhecer a contratação de um empréstimo.

Em cada processo, o advogado externo precisa decidir entre defender o banco judicialmente ou propor um acordo. Essa decisão exige consulta rápida aos autos e subsídios, aplicação consistente da política e registro do resultado para que o banco acompanhe aderência e efetividade.

## A solução

O **Enter Policy** organiza essa jornada em três frentes:

- **Mesa do advogado** — apresenta a recomendação **ACORDO**, **DEFESA** ou **REVISAR**, risco estimado, valor da causa, motivos e ponto de atenção. O advogado consulta evidências com documento e página de origem, segue a recomendação ou registra uma divergência justificada.
- **Visão administrativa** — acompanha decisões, aderência, negociações e indicadores de efetividade em dashboards construídos sobre uma camada demonstrativa de dados comportamentais.
- **Agente de usabilidade** — usa Playwright e um modelo multimodal da OpenAI para simular um advogado externo sem treinamento. O agente enxerga apenas a tela, executa seis tarefas e gera relatórios Markdown e JSON.

Uma camada Python complementar gera dados sintéticos e explicáveis de comportamento dos advogados a partir da base disponibilizada para o desafio. O frontend funciona sem backend e usa mocks locais por padrão.

---

## Como executar

### Pré-requisitos

- **Node.js 22.12 ou superior**
- **npm**

### Frontend

```bash
cd frontend
npm ci
npm run dev
```

Abra a URL indicada pelo Vite, normalmente `http://127.0.0.1:5173`.

O modo demonstrativo não exige chave, banco de dados ou serviço externo. Consulte o [guia de instalação](SETUP.md) para executar também o gerador de dados e o agente de usabilidade.

### Rotas principais

```text
/                         seleção de perfil
/minha-fila               processos atribuídos ao advogado
/processos                lista completa de processos
/processos/:caseId        análise, decisão e negociação
/admin/overview           visão administrativa
/admin/adherence          monitoramento de aderência
/admin/effectiveness      monitoramento de efetividade
/admin/decisions          registro de decisões
```

---

## Estrutura do repositório

```text
frontend/                 aplicação React e experiência dos dois perfis
  ├─ src/pages/           login, fila, processo e dashboards
  ├─ src/components/      decisões, evidências e estrutura da aplicação
  ├─ src/mocks/           casos e indicadores demonstrativos
  ├─ src/services/        contrato de API e persistência local
  └─ docs/                contrato para integração futura
backend/                  API do copiloto integrada à OpenAI
  ├─ src/                 servidor, contexto e cliente da Responses API
  └─ test/                testes HTTP e de contrato
usability-agent/          agente screen-only de avaliação de UX
  ├─ prompts/             papel e critérios do advogado simulado
  ├─ tests/               contratos, validações e testes do runner
  ├─ reports/             relatórios gerados, ignorados pelo Git
  └─ screenshots/         evidências visuais, ignoradas pelo Git
src/                      gerador Python da camada comportamental
modelo/                   modelos estatísticos: taxa de risco, condenação e valor de oferta
data/                     snapshot agregado e saídas locais ignoradas
docs/                     documentação do modelo e materiais do projeto
SETUP.md                  instalação, execução e solução de problemas
```

## Stack

**Frontend** · React 19 · TypeScript 6 · Vite 8 · React Router · Radix UI · Lucide

**Backend do chatbot** · Node.js · TypeScript · OpenAI Responses API · Structured Outputs

**Dados demonstrativos** · Python 3.10+ · biblioteca padrão · XLSX · JSON · CSV

**Avaliação de UX** · Python · Playwright · OpenAI Responses API · visão · Structured Outputs

**Qualidade** · Vitest · Testing Library · Oxlint · TypeScript

---

## Testes

### Backend do chatbot

```bash
cd backend
npm run check
npm test
```

### Frontend

```bash
cd frontend
npm run lint
npm run build
npm test
```

### Agente de usabilidade

```bash
cd usability-agent
python -m unittest discover -s tests -v
python run_test.py --dry-run
```

O dry-run valida os seis contratos de tarefa, a normalização das notas, o isolamento dos contextos e o fluxo obrigatório de negociação sem consumir a API da OpenAI.

---

## Documentação adicional

- [`frontend/README.md`](frontend/README.md) — roteiro da demonstração e comportamento dos mocks.
- [`backend/README.md`](backend/README.md) — configuração da OpenAI e execução do chatbot.
- [`frontend/docs/frontend-api.md`](frontend/docs/frontend-api.md) — contrato de integração futura.
- [`usability-agent/README.md`](usability-agent/README.md) — configuração, execução e formato dos relatórios de UX.
- [`docs/behavioral_adherence_model.md`](docs/behavioral_adherence_model.md) — geração da camada sintética de aderência.
- [`SETUP.md`](SETUP.md) — instalação detalhada e solução de problemas.

## Requisitos do desafio no protótipo

| # | Requisito | Implementação demonstrativa |
| --- | --- | --- |
| 1 | Regra de decisão | Recomendações explicáveis nos mocks e no gerador comportamental |
| 2 | Sugestão de valor | Faixa de acordo exibida nos casos recomendados para acordo |
| 3 | Acesso à recomendação | Workspace do advogado com risco, motivos e evidências rastreáveis |
| 4 | Monitoramento de aderência | Dashboard administrativo de aderência e divergências |
| 5 | Monitoramento de efetividade | Dashboard administrativo de negociação, resultado e economia simulada |

## Escopo atual

Este repositório entrega um **protótipo demonstrativo** com um backend local opcional para o chatbot da OpenAI. Não há autenticação de produção, banco de dados, leitura real de documentos ou execução online de uma política de decisão. Casos, nomes, documentos e valores da interface são fictícios; decisões feitas durante a demonstração ficam no navegador.
