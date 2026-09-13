# Agente de teste de usabilidade

Este agente simula um advogado externo usando somente a interface renderizada do frontend. O modelo recebe a screenshot do viewport, a tarefa e o histórico das próprias ações visíveis. Ele não recebe texto extraído do DOM, URL, rota, código-fonte, README ou documentação interna.

O Playwright executa ações por texto, rótulo e papel acessível visíveis. Quando um rótulo se repete, o modelo fornece `near_text` com o autor ou outro texto visível da mesma linha/cartão; assim, o runner abre o caso correto sem seletor derivado do código. Cada teste começa em um contexto novo do navegador, sem cookies ou armazenamento do teste anterior.

## Preparação

Com o frontend rodando em outro terminal:

```powershell
cd src/frontend
npm run dev -- --host 127.0.0.1
```

Em outro terminal, instale as dependências do agente:

```powershell
cd src/usability-agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m playwright install chromium
```

Defina a chave somente no ambiente:

```powershell
$env:OPENAI_API_KEY = "sua-chave"
$env:OPENAI_MODEL = "gpt-4.1-mini"
python run_test.py
```

`OPENAI_MODEL` é opcional. O modelo precisa aceitar imagens e Structured Outputs na Responses API. Para trocar a porta:

```powershell
python run_test.py --base-url http://127.0.0.1:5174
```

Para executar parte da avaliação:

```powershell
python run_test.py --tests test-1-compreensao-imediata test-3-rastreabilidade --max-actions 12
```

## Dry-run

O dry-run não chama a OpenAI e não atribui notas ou sucesso às tarefas. Ele verifica:

- os seis contratos de conclusão;
- a normalização de notas, incluindo `0.9 → 9.0` e `0.95 → 9.5`;
- os 12 marcos obrigatórios da negociação;
- a criação dos schemas estruturados;
- a abertura do frontend em um contexto isolado por teste;
- screenshots e geração dos relatórios Markdown e JSON.

Execute com o frontend local ativo:

```powershell
python run_test.py --dry-run
```

## Como o resultado é validado

O modelo não declara o sucesso. O runner calcula `task_success` com os marcos obrigatórios de cada tarefa:

1. compreensão imediata exige processo aberto e identificação, sem nova interação, de recomendação, risco, motivo e ação principal;
2. entender a recomendação exige motivo explicado e evidência principal localizada;
3. rastreabilidade exige abrir a fonte, identificar documento e página/origem e distinguir alegação de fato documental;
4. seguir recomendação exige acionar, enviar e depois ver a confirmação final;
5. divergir exige alternativa diferente, justificativa preenchida, envio e confirmação;
6. negociação exige encontrar um caso **ACORDO**, abrir o controle daquela linha por contexto visível, seguir e confirmar a recomendação, abrir o formulário, informar proposta, escolher resultado final, enviar ambos e ver a confirmação.

Marcos de ação só são aceitos depois de uma ação Playwright bem-sucedida. Marcos de confirmação só são aceitos quando o modelo os observa em uma screenshot posterior. Clicar no botão principal, isoladamente, não conclui o teste.

A avaliação final é separada das rodadas de navegação. Ela sempre solicita clareza, facilidade e confiança em escala 0–10, inclusive quando a tarefa falha. A resposta passa por validação semântica e tem até três tentativas de correção. Valores proporcionais ou percentuais são normalizados:

- `0.9` ou `90%` vira `9.0/10`;
- `0.95` ou `95` em escala 0–100 vira `9.5/10`;
- booleanos, valores ausentes, `NaN`, infinito e valores fora da escala são rejeitados;
- uma nota inválida nunca entra na média como zero.

Assim, `task_success` mede conclusão objetiva, enquanto `ux_quality` mede a experiência percebida. Uma tarefa pode falhar com boa nota de clareza, ou ser concluída com baixa facilidade.

## Telemetria e recomendações

Cada teste registra:

- ações tentadas e ações necessárias para o objetivo (`necessary_action_count`);
- duração e erro de cada ação;
- scrolls e deslocamento observado;
- waits;
- hesitações e o motivo;
- elementos procurados e não encontrados;
- sequência de telas e screenshots;
- marcos concluídos, ausentes e suas evidências;
- erros de interpretação, campos confusos, informação excessiva e faltante.

Cada avaliação final exige pelo menos uma melhoria acionável. As recomendações são complementadas pelos problemas registrados, deduplicadas e ordenadas por severidade, número de testes afetados e frequência:

- **crítico:** bloqueia a ação principal, permite resultado incorreto ou impede rastreabilidade;
- **alto:** dificulta muito o CTA ou deixa a conclusão incerta;
- **médio:** causa hesitação, scroll ou passos extras recuperáveis;
- **baixo:** gera ruído sem impedir a tarefa.

## Saídas

- `reports/UX_REPORT.md`: resumo executivo, sucesso objetivo, notas de UX, telemetria, marcos e cinco recomendações prioritárias;
- `reports/UX_REPORT.json`: os mesmos dados estruturados, incluindo amostra válida usada em cada média;
- `screenshots/`: uma screenshot de cada rodada.

Relatórios e screenshots são gerados localmente e ignorados pelo Git. Nenhuma chave é escrita em arquivo.

## Testes unitários

```powershell
python -m unittest discover -s tests -v
```

A suíte cobre normalização, respostas inválidas, contratos das seis tarefas, negociação completa, separação entre sucesso e UX, telemetria, severidade, dry-run e garantia de contexto screen-only.
