# Enter Policy · Frontend

Aplicação demonstrativa do Hackathon Enter × Unicamp 2026 para consultar processos, confrontar evidências e registrar decisões sobre acordos. Desenvolvida com React, TypeScript, Vite, React Router, Radix UI e Lucide.

O perfil **Advogado** separa os processos em **Para analisar** e **Enviados**, além de reunir análise documental, decisão e negociação. O perfil **Administrativo** reúne visão geral, aderência, efetividade e tabela de decisões. Os perfis são uma navegação de demonstração, sem autenticação ou autorização de servidor.

## Requisitos e execução

Use **Node.js 22.12 ou superior** e npm. O ambiente de desenvolvimento utiliza Node.js 24.

Partindo da raiz do repositório:

```sh
cd src/frontend
npm install
npm run dev
```

Abra a URL indicada pelo Vite no terminal. O modo mock funciona sem arquivo de ambiente ou backend.

| Comando, dentro de `frontend` | Finalidade |
| --- | --- |
| `npm run dev` | Inicia o servidor de desenvolvimento. |
| `npm run build` | Verifica os tipos e gera a aplicação em `dist`. |
| `npm run lint` | Executa o Oxlint. |
| `npm run test` | Executa os testes automatizados. |
| `npm run preview` | Disponibiliza localmente o build já gerado. |

## Roteiro da experiência

1. Na entrada, escolha **Advogado**. **Para analisar** mostra somente casos ainda sem decisão; **Enviados** reúne decisões registradas, negociações e conclusões. A demonstração contém dez casos fictícios. Dois deles reproduzem os dossiês `0801234-56.2024.8.10.0001` e `0654321-09.2024.8.04.0001`, com os PDFs fornecidos e referências por página. Os casos 1–3 e os dois dossiês começam aguardando decisão; os demais incluem registros iniciais para explorar situações posteriores do fluxo.
2. Abra **Maria Aparecida Santos (`caso-1`)**. A causa é de R$ 20.000, com recomendação demonstrativa de **defesa** e risco de perda de **23%**. Consulte os indicadores simulados de assinatura (**91%**) e face (**97,3%**), abra suas fontes e confira a página. Registre a confirmação da recomendação. Uma escolha diferente exige motivo e justificativa.
3. Abra **José Carlos Oliveira (`caso-2`)**. A causa é de R$ 25.000, com recomendação demonstrativa de **acordo** e risco de perda de **72%**. Em contradições, confronte a alegação de não possuir conta na Caixa com a atribuição ao tomador na consulta BACEN MOCK. Essa consulta não resolve as lacunas de comprovação independente do crédito e de liveness.
4. No caso 2, confira a faixa de **R$ 4.500 / R$ 5.200 / R$ 6.500** para abertura, alvo e teto. Os valores de condenação e custo esperado de defesa, **R$ 10.500 / R$ 7.560**, já vêm da fixture. Confirme a decisão de acordo e registre uma negociação. Para demonstrar uma conclusão, informe proposta de R$ 4.500, situação aceita e valor final de R$ 5.200. Pendência, recusa e contraproposta também têm estados próprios.
5. Saia pelo menu lateral e entre como **Administrativo**. Consulte **Visão geral**, **Aderência**, **Efetividade** e **Decisões**. Os registros salvos no navegador aparecem na tabela. Os KPIs e graficos foram alinhados a uma base sintetica maior, enquanto a simulacao historica continua separada dos registros feitos no navegador.

O `caso-3` demonstra a recomendação **Revisar**, com dados numéricos indisponíveis e documentação insuficiente. A seção sobre a próxima evidência mostra uma **SIMULAÇÃO** textual fixa e não recalcula a recomendação. Separadamente, o chatbot pode consultar a OpenAI quando o backend estiver configurado.

## Persistência e restauração

Decisões e negociações são gravadas em `localStorage['policy:demo-data:v1']`. A última decisão e a última negociação de cada caso sobrevivem à recarga e à troca de perfil no mesmo navegador. O perfil escolhido fica em `sessionStorage['enter-policy-role']`; sair encerra essa seleção, sem apagar os registros da demo.

Para recuperar o cenário inicial, abra **Guia da experiência** na navegação lateral e use **Restaurar demonstração**. Essa ação remove os registros locais da demonstração e recupera as fixtures, incluindo as decisões de exemplo dos casos 4–8. Ela está disponível somente no modo mock.

Uma decisão de acordo coloca o caso em negociação; um aceite o conclui. Decisões de defesa ou revisão ficam como decisão registrada. A recomendação original continua preservada, inclusive quando o advogado registra uma divergência. O serviço emite `policy:data-changed` após gravações e restaurações para atualizar as telas.

## Documentos e dados demonstrativos

Todos os casos, nomes, números processuais, documentos e valores iniciais são fictícios. Recomendações e números são fornecidos por mock ou API; o frontend não calcula risco, custos, limites de acordo ou economia e não executa uma política de decisão.

Os casos originais usam sete categorias documentais com estados **Presente**, **Ausente** ou **Inconclusivo** e prévias textuais `demo_pages`. Os dois dossiês adicionais preservam os 7 e 4 PDFs recebidos em `public/demo-cases`. Evidências e contradições apontam para o documento e a página correspondentes, com origem demonstrativa explícita.

Para documentos disponibilizados em `CaseDocument.url`, inclusive os dois dossiês de exemplo, o visualizador usa um `iframe` e acrescenta a página ao fragmento da URL, como `#page=2`. O comportamento de PDFs depende do visualizador do navegador e da permissão de incorporação do servidor de origem. A URL também pode ser aberta separadamente.

Os indicadores agregados e gráficos administrativos representam um cenário sintético maior e não são totais da tabela visível. As comparações de aderência incluem os 6 escritórios e 36 advogados da base completa, sem truncar o ranking; os volumes de ambos os recortes somam 60.000 decisões. Filtros explícitos passam a usar os registros rastreáveis disponíveis e são identificados como recorte detalhado. Registros locais atualizam a tabela e seu estado, sem recalcular KPIs financeiros. A simulação histórica permanece separada e não representa economia realizada.

## Integração de dados e chatbot

Todas as chamadas estão em [`src/services/api.ts`](src/services/api.ts), com contratos em [`src/types/index.ts`](src/types/index.ts). Os componentes não fazem `fetch` diretamente. Por padrão, o serviço retorna cópias dos mocks comportamentais em [`src/mocks/behavioralFixtures.ts`](src/mocks/behavioralFixtures.ts), com pequena latência simulada.

Para direcionar o frontend a uma API, crie `src/frontend/.env.local` a partir da raiz do repositório:

```dotenv
VITE_API_BASE_URL=/api
```

Reinicie o Vite depois de alterar o ambiente. O valor pode ser o prefixo relativo de um serviço disponibilizado na mesma origem ou a URL-base de uma API. Ao definir essa variável, o serviço passa a usar requisições GET/POST centralizadas; falhas da API não são substituídas silenciosamente por mocks. O backend incluído em `backend/` atende somente ao chatbot, não aos endpoints de casos e dashboard de `VITE_API_BASE_URL`.

Para ativar o chatbot com a OpenAI, mantenha `VITE_COPILOT_API_URL=/api/copilot`, configure `OPENAI_API_KEY` em `src/backend/.env` e inicie o backend na porta 8787. O proxy do Vite encaminha `/api` durante o desenvolvimento. Consulte o [backend](../backend/README.md) e o [contrato de integração](docs/frontend-api.md). Autenticação, autorização, auditoria durável e processamento real de documentos continuam fora do protótipo.

## Organização

| Diretório | Responsabilidade |
| --- | --- |
| `src/pages` | Páginas dos dois perfis. |
| `src/components` | Layout, elementos de interface, evidências e visualizador de documentos. |
| `src/hooks` | Sessão demonstrativa e carregamento de dados. |
| `src/services` | API central, persistência e testes da camada de dados. |
| `src/mocks` | Casos, documentos, recomendacoes e indicadores demonstrativos, incluindo a camada comportamental sintetica. |
| `src/types` | Contratos compartilhados do frontend. |
| `src/styles` | Estilos e apresentação responsiva. |
