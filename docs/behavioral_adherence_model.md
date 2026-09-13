# Behavioral Adherence Model

This repository now includes an explainable behavioral simulator for agreement-policy adherence.

## Goal

The historical XLSX only contains:

- lawsuit outcome
- claim value
- subsidy availability

It does not contain operational lawyer actions. This script fills that gap for demo and monitoring purposes by generating a synthetic operational layer.

## Inputs

The simulator reads:

- `Resultados dos processos`
- `Subsidios disponibilizados`

## Outputs

- `data/synthetic_adherence.csv`
- `data/synthetic_adherence_summary.json`

## Minimal adherence fields

The generated dataset includes the core fields needed to monitor adherence:

- `processo_id`
- `advogado_id`
- `advogado_nome`
- `escritorio_id`
- `escritorio_nome`
- `data_decisao`
- `acao_recomendada`
- `valor_acordo_recomendado`
- `score_confianca`
- `acao_tomada`
- `valor_acordo_proposto`
- `aderente`
- `override`
- `razao_override`
- `tempo_decisao_min`

## How the behavioral model works

### 1. Recommendation layer

For each case, the simulator creates:

- recommended action: `acordo` or `defesa`
- recommended value when the action is `acordo`
- confidence score

The rule is explainable and based on:

- number of critical subsidies
- presence of dossier
- presence of laudo
- UF risk
- sub-assunto risk

### 2. Lawyer personas

Each synthetic lawyer has a stable persona, for example:

- `guardiao_da_politica`
- `conservador_caso_caro`
- `pragmatica_negociadora`
- `cauteloso_com_baixa_confianca`
- `independente`
- `formalista_documental`
- `sensivel_ao_cliente`
- `orientado_a_meta`
- `litigante_estrategica`
- `seguidor_de_confianca`
- `avesso_a_ruido`
- `fechador_de_acordo`

Each persona has interpretable parameters:

- base adherence
- trust in model confidence
- aversion to high-value cases
- settlement appetite
- respect for documentation strength

### 3. Decision layer

For each case, the lawyer receives weighted behavioral factors such as:

- `alta_confianca_modelo`
- `baixa_confianca_modelo`
- `valor_causa_alto`
- `documentacao_muito_forte`
- `documentacao_fraca`
- `perfil_pro_acordo`
- `perfil_mais_autonomo`

These weights produce a final `probabilidade_seguir`.

The resulting dataset stores:

- the final probability
- whether the lawyer followed the recommendation
- the reason for override
- an explanation string
- the weighted factors used in the decision

## Why this is different from a simple random simulation

This is not pure random adherence.

The random step only resolves the final choice after the model has built a context-specific probability from:

- lawyer persona
- office culture
- confidence score
- lawsuit value
- documentary completeness
- recommendation type

That makes the simulation:

- reproducible
- explainable
- more realistic than a fixed adherence rate

## Command

```bash
python src/synthetic_adherence.py
```

Optional:

```bash
python src/synthetic_adherence.py --limit 500 --seed 7
```

## Frontend integration

The recommended interface is now the React frontend in `src/frontend/`.

Run:

```bash
cd src/frontend
npm install
npm run dev
```

The behavioral mock layer lives in `src/frontend/src/mocks/behavioralFixtures.ts` and preserves the existing lawyer/admin layout while exposing:

- confidence score and confidence band
- subsidy count and documentary completeness
- synthetic lawyer profile
- override context in the admin decision table
