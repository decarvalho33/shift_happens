# Documentação

Esta pasta reúne a documentação técnica e funcional que complementa a visão geral do projeto.

## Conteúdo

| Documento | Finalidade |
| --- | --- |
| [behavioral_adherence_model.md](behavioral_adherence_model.md) | Hipóteses, campos e funcionamento do simulador comportamental |
| [Guia de configuração](../SETUP.md) | Instalação, execução e verificações dos componentes |
| [Contrato do frontend](../src/frontend/docs/frontend-api.md) | Modo mock, endpoints previstos e limites da integração |
| [Agente de usabilidade](../src/usability-agent/README.md) | Execução, validação das tarefas e formato dos relatórios |
| [Dados demonstrativos](../data/README.md) | Origem e política de versionamento dos artefatos sintéticos |

## Escopo atual

O produto navegável é um frontend React/Vite com dados fictícios. O gerador Python produz uma camada sintética de comportamento para análises de aderência, enquanto o agente de usabilidade avalia a interface somente pelo que aparece na tela.

Os materiais desta pasta devem registrar decisões e hipóteses verificáveis. Não inclua credenciais, documentos jurídicos reais, informações pessoais ou bases sem autorização de publicação.

## Modelos

| Documento | Conteúdo |
| --- | --- |
| [Enunciado do desafio](desafio.txt) | Texto oficial recebido pela equipe |
| [Taxa de risco](../src/modelo/taxa_de_risco/README.md) | Probabilidade de perda, score de defesa e validação |
| [Valor da condenação](../src/modelo/condenacao/README.md) | Comparação de 64 modelos |
| [Valor de oferta](../src/modelo/valor_oferta/README.md) | Valor típico de acordo com bootstrap |

## Entregáveis

| Arquivo | Descrição | Situação |
| --- | --- | --- |
| `presentation.*` | Slides ou documento da apresentação final | A adicionar |
| `demo_video.*` | Vídeo de até 2 minutos, ou link no README principal | A adicionar |
| `architecture.*` | Diagrama de arquitetura (opcional) | A adicionar |

## Checklist de entrega

- [x] Código-fonte na pasta `src/`
- [x] `SETUP.md` preenchido com instruções de execução
- [ ] Apresentação nesta pasta (`docs/`)
- [ ] Link do vídeo demo adicionado ao README principal
- [x] `.env.example` atualizado com todas as variáveis necessárias

