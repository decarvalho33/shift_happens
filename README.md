# Enter Policy

**Hackathon Enter × Unicamp 2026 · Política de acordos com inteligência**

Protótipo de uma mesa de decisão para contencioso bancário. A experiência reúne recomendação, score de defesa calculado por modelo, evidências rastreáveis, decisão do advogado, negociação e monitoramento administrativo.

## Entrega

| Item | Onde |
| --- | --- |
| Código-fonte | [`src/`](src/README.md) |
| Instalação e execução | [`SETUP.md`](SETUP.md) |
| Dados | [`data/`](data/README.md) |
| Apresentação e documentação | [`docs/`](docs/README.md) |
| Vídeo de demonstração | _adicionar link_ |

## O problema

O Banco Unicamp recebe aproximadamente **15 mil processos novos por mês**. Cerca de **5 mil** envolvem consumidores que afirmam não reconhecer a contratação de um empréstimo. Em cada processo, o advogado externo precisa decidir entre defender o banco ou propor um acordo, aplicar a política de forma consistente e registrar o resultado. O enunciado completo está em [`docs/desafio.txt`](docs/desafio.txt).

## A solução

- **Mesa do advogado:** recomendação **ACORDO**, **DEFESA** ou **REVISAR**, **score de defesa de 0 a 100** (0 = fechar acordo, 100 = pode defender), valor da causa, motivos e ponto de atenção. O advogado consulta evidências com documento e página de origem, segue a recomendação ou registra uma divergência justificada.
- **Modelos estatísticos:** treinados nas 60 mil sentenças da planilha. A taxa de risco calcula a probabilidade de perda a partir dos subsídios juntados, do sub-assunto e da UF. Também há modelos do valor da condenação e do valor típico de acordo.
- **Visão administrativa:** acompanha decisões, aderência, negociações e efetividade sobre uma camada demonstrativa de dados comportamentais.
- **Agente de usabilidade:** usa Playwright e um modelo multimodal da OpenAI para simular um advogado sem treinamento e gera relatórios.

## Como executar

Com Node.js 22.12 ou superior:

```bash
cd src/frontend
npm ci
npm run dev -- --host 127.0.0.1
```

Abra `http://127.0.0.1:5173`, entre como advogado e abra um processo. O modo demonstrativo não exige chave, banco de dados ou backend. Copiloto com OpenAI, modelos, gerador e agente estão no [`SETUP.md`](SETUP.md).

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

## Estrutura do repositório

```text
src/
  frontend/               aplicação React: páginas, componentes, mocks, score (src/lib/riskModel.ts)
  backend/                API do copiloto integrada à OpenAI
  modelo/                 taxa de risco, valor da condenação e valor de oferta
  usability-agent/        agente screen-only de avaliação de UX
  synthetic_adherence.py  gerador Python da camada comportamental
  tests/                  testes do gerador
data/                     planilha do desafio, snapshot agregado e processos de exemplo locais
docs/                     enunciado, documentação e materiais da apresentação
SETUP.md                  instalação, execução e solução de problemas
```

## Stack

- **Frontend:** React 19 · TypeScript 6 · Vite 8 · React Router · Radix UI · Lucide
- **Backend do copiloto:** Node.js · TypeScript · OpenAI Responses API · Structured Outputs
- **Modelos:** Python 3.10+ · pandas · NumPy · scikit-learn
- **Avaliação de UX:** Python · Playwright · OpenAI Responses API
- **Qualidade:** Vitest · Testing Library · Oxlint · TypeScript

## Testes

```bash
cd src/frontend && npm run lint && npm test && npm run build
cd src/backend && npm run check && npm test
python -m unittest discover -s src/tests
cd src/usability-agent && python -m unittest discover -s tests -v
```

## Requisitos do desafio no protótipo

| # | Requisito | Implementação |
| --- | --- | --- |
| 1 | Regra de decisão | Score de defesa calculado pelo modelo de taxa de risco; recomendações explicáveis nos casos demonstrativos |
| 2 | Sugestão de valor | Faixa de acordo nos casos recomendados para acordo; modelo de valor típico de acordo em `src/modelo/valor_oferta` |
| 3 | Acesso à recomendação | Página do processo com score, risco, motivos e evidências rastreáveis |
| 4 | Monitoramento de aderência | Dashboard administrativo de aderência e divergências |
| 5 | Monitoramento de efetividade | Dashboard administrativo de negociação, resultado e economia simulada |

## Documentação adicional

- [`src/frontend/README.md`](src/frontend/README.md): roteiro da demonstração e comportamento dos mocks
- [`src/backend/README.md`](src/backend/README.md): configuração da OpenAI e execução do copiloto
- [`src/modelo/taxa_de_risco/README.md`](src/modelo/taxa_de_risco/README.md): probabilidade de perda e score de defesa
- [`src/modelo/condenacao/README.md`](src/modelo/condenacao/README.md): valor da condenação
- [`src/modelo/valor_oferta/README.md`](src/modelo/valor_oferta/README.md): valor de oferta
- [`src/usability-agent/README.md`](src/usability-agent/README.md): agente de usabilidade
- [`docs/behavioral_adherence_model.md`](docs/behavioral_adherence_model.md): camada sintética de aderência

## Escopo atual

Protótipo demonstrativo, sem autenticação de produção, banco de dados nem leitura real de documentos. O score de defesa é calculado no navegador pelo modelo de taxa de risco a partir dos documentos de cada caso. Recomendação, faixa de acordo e indicadores administrativos continuam demonstrativos. Casos, nomes e valores da interface são fictícios, e as decisões feitas durante a demonstração ficam no navegador.
