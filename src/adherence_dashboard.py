"""Deprecated placeholder for the removed standalone dashboard."""

from __future__ import annotations

import argparse
import csv
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from synthetic_adherence import (
    DEFAULT_OUTPUT_CSV,
    DEFAULT_OUTPUT_JSON,
    DEFAULT_XLSX,
    export_csv,
    export_json,
    load_cases,
    simulate_dataset,
    summarize,
)

raise SystemExit(
    "The standalone dashboard was removed. Run the React frontend from `src/frontend/` "
    "with `npm install` and `npm run dev`."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sobe um dashboard local para explorar a base sintetica de aderencia."
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--csv", type=Path, default=DEFAULT_OUTPUT_CSV)
    parser.add_argument("--summary", type=Path, default=DEFAULT_OUTPUT_JSON)
    parser.add_argument("--xlsx", type=Path, default=DEFAULT_XLSX)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument(
        "--regenerate",
        action="store_true",
        help="Regenera a base sintetica antes de subir o dashboard.",
    )
    return parser.parse_args()


def _to_float(value: str | None) -> float:
    if value in (None, ""):
        return 0.0
    return float(value)


def _to_int(value: str | None) -> int:
    if value in (None, ""):
        return 0
    return int(float(value))


def load_records(csv_path: Path) -> list[dict[str, Any]]:
    with csv_path.open("r", encoding="utf-8", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        records: list[dict[str, Any]] = []
        for row in reader:
            row["valor_causa"] = _to_float(row.get("valor_causa"))
            row["valor_condenacao_historica"] = _to_float(row.get("valor_condenacao_historica"))
            row["valor_acordo_recomendado"] = _to_float(row.get("valor_acordo_recomendado"))
            row["valor_acordo_proposto"] = _to_float(row.get("valor_acordo_proposto"))
            row["score_confianca"] = _to_float(row.get("score_confianca"))
            row["aderente"] = _to_int(row.get("aderente"))
            row["override"] = _to_int(row.get("override"))
            row["tempo_decisao_min"] = _to_int(row.get("tempo_decisao_min"))
            row["qtd_subsidios"] = _to_int(row.get("qtd_subsidios"))
            row["qtd_subsidios_criticos"] = _to_int(row.get("qtd_subsidios_criticos"))
            row["probabilidade_seguir"] = _to_float(row.get("probabilidade_seguir"))
            records.append(row)
        return records


def maybe_regenerate_dataset(args: argparse.Namespace) -> None:
    if not args.regenerate and args.csv.exists() and args.summary.exists():
        return

    cases = load_cases(args.xlsx)
    if args.limit > 0:
        cases = cases[: args.limit]
    records = simulate_dataset(cases, seed=args.seed)
    summary = summarize(records)
    export_csv(records, args.csv)
    export_json(summary, args.summary)


def filter_records(records: list[dict[str, Any]], params: dict[str, list[str]]) -> list[dict[str, Any]]:
    profile = params.get("perfil", [""])[0]
    office = params.get("escritorio", [""])[0]
    uf = params.get("uf", [""])[0]
    adherence = params.get("aderencia", [""])[0]
    confidence = params.get("confianca", [""])[0]

    filtered = records
    if profile:
        filtered = [row for row in filtered if row["perfil_advogado"] == profile]
    if office:
        filtered = [row for row in filtered if row["escritorio_id"] == office]
    if uf:
        filtered = [row for row in filtered if row["uf"] == uf]
    if adherence == "aderente":
        filtered = [row for row in filtered if row["aderente"] == 1]
    elif adherence == "override":
        filtered = [row for row in filtered if row["override"] == 1]
    if confidence:
        filtered = [row for row in filtered if row["faixa_confianca"] == confidence]
    return filtered


def aggregate_dashboard(records: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(records)
    aderentes = sum(row["aderente"] for row in records)
    overrides = sum(row["override"] for row in records)
    tempo_medio = round(sum(row["tempo_decisao_min"] for row in records) / total, 2) if total else 0.0
    acordos = [row for row in records if row["acao_tomada"] == "acordo"]
    aceitos = [row for row in acordos if row["resultado_negociacao"] == "aceito"]

    profiles: dict[str, dict[str, Any]] = {}
    offices: dict[str, dict[str, Any]] = {}
    override_reasons: dict[str, int] = {}
    confidence_bands: dict[str, dict[str, int]] = {}
    value_bands: dict[str, dict[str, int]] = {}

    for row in records:
        profile_bucket = profiles.setdefault(
            row["perfil_advogado"],
            {
                "perfil": row["perfil_advogado"],
                "descricao": row["descricao_perfil_advogado"],
                "total": 0,
                "aderentes": 0,
                "overrides": 0,
            },
        )
        profile_bucket["total"] += 1
        profile_bucket["aderentes"] += row["aderente"]
        profile_bucket["overrides"] += row["override"]

        office_bucket = offices.setdefault(
            row["escritorio_id"],
            {
                "escritorio_id": row["escritorio_id"],
                "escritorio_nome": row["escritorio_nome"],
                "total": 0,
                "aderentes": 0,
            },
        )
        office_bucket["total"] += 1
        office_bucket["aderentes"] += row["aderente"]

        confidence_bucket = confidence_bands.setdefault(
            row["faixa_confianca"],
            {"faixa": row["faixa_confianca"], "total": 0, "aderentes": 0},
        )
        confidence_bucket["total"] += 1
        confidence_bucket["aderentes"] += row["aderente"]

        value_bucket = value_bands.setdefault(
            row["faixa_valor"],
            {"faixa": row["faixa_valor"], "total": 0, "aderentes": 0},
        )
        value_bucket["total"] += 1
        value_bucket["aderentes"] += row["aderente"]

        reason = row["razao_override"] or ""
        if reason:
            override_reasons[reason] = override_reasons.get(reason, 0) + 1

    profile_rows = []
    for bucket in profiles.values():
        taxa = round(bucket["aderentes"] / bucket["total"], 4) if bucket["total"] else 0.0
        profile_rows.append({**bucket, "taxa_aderencia": taxa})

    office_rows = []
    for bucket in offices.values():
        taxa = round(bucket["aderentes"] / bucket["total"], 4) if bucket["total"] else 0.0
        office_rows.append({**bucket, "taxa_aderencia": taxa})

    confidence_rows = [
        {
            **bucket,
            "taxa_aderencia": round(bucket["aderentes"] / bucket["total"], 4) if bucket["total"] else 0.0,
        }
        for bucket in confidence_bands.values()
    ]

    value_rows = [
        {
            **bucket,
            "taxa_aderencia": round(bucket["aderentes"] / bucket["total"], 4) if bucket["total"] else 0.0,
        }
        for bucket in value_bands.values()
    ]

    recent_rows = sorted(records, key=lambda row: row["data_decisao"], reverse=True)[:25]

    return {
        "kpis": {
            "total_processos": total,
            "taxa_aderencia": round(aderentes / total, 4) if total else 0.0,
            "taxa_override": round(overrides / total, 4) if total else 0.0,
            "taxa_aceite_acordo": round(len(aceitos) / len(acordos), 4) if acordos else 0.0,
            "tempo_decisao_medio_min": tempo_medio,
        },
        "profiles": sorted(profile_rows, key=lambda row: row["taxa_aderencia"]),
        "offices": sorted(office_rows, key=lambda row: row["taxa_aderencia"]),
        "confidence_bands": sorted(confidence_rows, key=lambda row: row["faixa"]),
        "value_bands": sorted(value_rows, key=lambda row: row["faixa"]),
        "override_reasons": sorted(
            [{"razao": reason, "total": total_reason} for reason, total_reason in override_reasons.items()],
            key=lambda item: item["total"],
            reverse=True,
        ),
        "recent_records": recent_rows,
    }


def options_payload(records: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "perfis": sorted({row["perfil_advogado"] for row in records}),
        "escritorios": sorted(
            {
                (row["escritorio_id"], row["escritorio_nome"])
                for row in records
            }
        ),
        "ufs": sorted({row["uf"] for row in records}),
        "faixas_confianca": sorted({row["faixa_confianca"] for row in records}),
    }


def html_page() -> str:
    return """<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard de Aderência</title>
  <style>
    :root {
      --bg: #f5efe4;
      --panel: rgba(255,255,255,0.75);
      --panel-strong: #fffaf2;
      --text: #2b2118;
      --muted: #6d5a49;
      --accent: #0e6b5c;
      --accent-2: #c06a2f;
      --danger: #a93d32;
      --line: rgba(43,33,24,0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at top left, rgba(192,106,47,0.18), transparent 28%),
        radial-gradient(circle at top right, rgba(14,107,92,0.18), transparent 22%),
        linear-gradient(180deg, #fbf7f0 0%, var(--bg) 100%);
      color: var(--text);
    }
    .page {
      max-width: 1380px;
      margin: 0 auto;
      padding: 28px;
    }
    .hero {
      display: grid;
      grid-template-columns: 1.3fr 0.9fr;
      gap: 18px;
      margin-bottom: 22px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: 0 16px 40px rgba(70, 49, 29, 0.08);
      backdrop-filter: blur(10px);
    }
    .hero-copy {
      padding: 28px;
    }
    .eyebrow {
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 12px;
      color: var(--accent);
      margin-bottom: 12px;
    }
    h1 {
      margin: 0;
      font-size: clamp(34px, 5vw, 58px);
      line-height: 0.95;
      letter-spacing: -0.03em;
    }
    .hero p {
      color: var(--muted);
      font-size: 16px;
      line-height: 1.6;
      max-width: 62ch;
    }
    .hero-note {
      padding: 24px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background: linear-gradient(135deg, rgba(14,107,92,0.12), rgba(192,106,47,0.10));
    }
    .hero-note strong {
      font-size: 18px;
    }
    .filters, .kpis, .grids {
      display: grid;
      gap: 16px;
    }
    .filters {
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      margin-bottom: 18px;
    }
    .filters .panel {
      padding: 16px;
      border-radius: 18px;
    }
    label {
      display: block;
      margin-bottom: 6px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    select {
      width: 100%;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: var(--panel-strong);
      color: var(--text);
      font: inherit;
    }
    .kpis {
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      margin-bottom: 18px;
    }
    .kpi {
      padding: 18px;
      border-radius: 20px;
    }
    .kpi .label {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .kpi .value {
      margin-top: 10px;
      font-size: 38px;
      line-height: 1;
      font-weight: 700;
    }
    .grids {
      grid-template-columns: 1.2fr 0.8fr;
      margin-bottom: 18px;
    }
    .panel-header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      padding: 20px 22px 0;
    }
    .panel-header h2 {
      margin: 0;
      font-size: 24px;
    }
    .panel-header p {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 14px;
    }
    .chart-list, .table-wrap {
      padding: 18px 22px 22px;
    }
    .bar-row {
      display: grid;
      grid-template-columns: minmax(160px, 220px) 1fr 70px;
      gap: 12px;
      align-items: center;
      margin-bottom: 12px;
    }
    .bar-label {
      font-size: 14px;
      line-height: 1.3;
    }
    .bar-track {
      height: 14px;
      border-radius: 999px;
      background: rgba(43,33,24,0.08);
      overflow: hidden;
      position: relative;
    }
    .bar-fill {
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--accent), #4ea18e);
    }
    .bar-fill.warn {
      background: linear-gradient(90deg, var(--accent-2), #e0a24f);
    }
    .bar-fill.danger {
      background: linear-gradient(90deg, var(--danger), #d26a5e);
    }
    .bar-value {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-size: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      text-align: left;
      padding: 12px 10px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      font-size: 14px;
    }
    th {
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 11px;
    }
    .pill {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 11px;
      background: rgba(14,107,92,0.10);
      color: var(--accent);
    }
    .pill.override {
      background: rgba(169,61,50,0.10);
      color: var(--danger);
    }
    .muted {
      color: var(--muted);
    }
    .wide {
      margin-bottom: 18px;
    }
    .footer-note {
      margin-top: 10px;
      color: var(--muted);
      font-size: 13px;
    }
    @media (max-width: 980px) {
      .hero, .grids { grid-template-columns: 1fr; }
      .bar-row { grid-template-columns: 1fr; }
      .bar-value { text-align: left; }
    }
  </style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <div class="panel hero-copy">
        <div class="eyebrow">Monitoring Lab</div>
        <h1>Adesão dos Advogados à Política de Acordos</h1>
        <p>Dashboard local para explorar a base sintética de aderência. Os dados mostram recomendação, comportamento do advogado, overrides, valor proposto e tempo de decisão com perfis explicáveis.</p>
      </div>
      <div class="panel hero-note">
        <div>
          <div class="eyebrow">Como ler</div>
          <strong>Adesão mede se o advogado fez o que a política recomendou.</strong>
        </div>
        <p class="muted">Use os filtros para comparar perfis, escritórios, estados e níveis de confiança. O objetivo aqui é transformar a simulação em uma operação auditável.</p>
      </div>
    </section>

    <section class="filters" id="filters"></section>
    <section class="kpis" id="kpis"></section>

    <section class="grids">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Perfis de Advogado</h2>
            <p>Taxa de aderência por persona comportamental.</p>
          </div>
        </div>
        <div class="chart-list" id="profilesChart"></div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Razões de Override</h2>
            <p>Motivos mais frequentes de divergência.</p>
          </div>
        </div>
        <div class="chart-list" id="overrideChart"></div>
      </div>
    </section>

    <section class="grids">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Escritórios</h2>
            <p>Comparação de aderência por escritório.</p>
          </div>
        </div>
        <div class="chart-list" id="officesChart"></div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Contexto do Caso</h2>
            <p>Aderência por faixa de valor e faixa de confiança.</p>
          </div>
        </div>
        <div class="chart-list" id="contextChart"></div>
      </div>
    </section>

    <section class="panel wide">
      <div class="panel-header">
        <div>
          <h2>Últimas Decisões</h2>
          <p>Recorte operacional do fluxo com recomendação, ação tomada e explicação.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Processo</th>
              <th>Advogado</th>
              <th>Perfil</th>
              <th>Recomendação</th>
              <th>Ação</th>
              <th>Override</th>
              <th>Explicação</th>
            </tr>
          </thead>
          <tbody id="recordsBody"></tbody>
        </table>
        <div class="footer-note" id="tableNote"></div>
      </div>
    </section>
  </div>

  <script>
    const state = {
      perfil: '',
      escritorio: '',
      uf: '',
      aderencia: '',
      confianca: '',
    };

    function pct(value) {
      return `${Math.round(value * 100)}%`;
    }

    function toneClass(value) {
      if (value >= 0.8) return '';
      if (value >= 0.65) return 'warn';
      return 'danger';
    }

    function card(label, value, note) {
      return `
        <article class="panel kpi">
          <div class="label">${label}</div>
          <div class="value">${value}</div>
          <div class="muted">${note}</div>
        </article>
      `;
    }

    function buildFilters(options) {
      const root = document.getElementById('filters');
      const offices = options.escritorios.map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
      root.innerHTML = `
        <div class="panel">
          <label>Perfil</label>
          <select id="perfil">
            <option value="">Todos</option>
            ${options.perfis.map(item => `<option value="${item}">${item}</option>`).join('')}
          </select>
        </div>
        <div class="panel">
          <label>Escritório</label>
          <select id="escritorio">
            <option value="">Todos</option>
            ${offices}
          </select>
        </div>
        <div class="panel">
          <label>UF</label>
          <select id="uf">
            <option value="">Todas</option>
            ${options.ufs.map(item => `<option value="${item}">${item}</option>`).join('')}
          </select>
        </div>
        <div class="panel">
          <label>Adesão</label>
          <select id="aderencia">
            <option value="">Todas</option>
            <option value="aderente">Apenas aderentes</option>
            <option value="override">Apenas overrides</option>
          </select>
        </div>
        <div class="panel">
          <label>Confiança</label>
          <select id="confianca">
            <option value="">Todas</option>
            ${options.faixas_confianca.map(item => `<option value="${item}">${item}</option>`).join('')}
          </select>
        </div>
      `;

      ['perfil', 'escritorio', 'uf', 'aderencia', 'confianca'].forEach((key) => {
        const element = document.getElementById(key);
        element.value = state[key];
        element.addEventListener('change', () => {
          state[key] = element.value;
          loadDashboard();
        });
      });
    }

    function barRows(items, labelKey, valueKey, subtitleKey) {
      if (!items.length) return '<p class="muted">Sem dados para esse recorte.</p>';
      return items.map((item) => `
        <div class="bar-row">
          <div class="bar-label">
            <strong>${item[labelKey]}</strong>
            ${subtitleKey ? `<div class="muted">${item[subtitleKey]}</div>` : ''}
          </div>
          <div class="bar-track">
            <div class="bar-fill ${toneClass(item[valueKey])}" style="width:${Math.round(item[valueKey] * 100)}%"></div>
          </div>
          <div class="bar-value">${pct(item[valueKey])}</div>
        </div>
      `).join('');
    }

    function countRows(items, labelKey, valueKey) {
      if (!items.length) return '<p class="muted">Sem overrides nesse recorte.</p>';
      const max = Math.max(...items.map(item => item[valueKey]), 1);
      return items.map((item) => `
        <div class="bar-row">
          <div class="bar-label"><strong>${item[labelKey]}</strong></div>
          <div class="bar-track">
            <div class="bar-fill danger" style="width:${Math.round((item[valueKey] / max) * 100)}%"></div>
          </div>
          <div class="bar-value">${item[valueKey]}</div>
        </div>
      `).join('');
    }

    function buildRecords(records) {
      const body = document.getElementById('recordsBody');
      body.innerHTML = records.map((row) => `
        <tr>
          <td>
            <strong>${row.processo_id}</strong><br>
            <span class="muted">${row.uf} · ${row.faixa_valor} · ${row.faixa_confianca}</span>
          </td>
          <td>
            <strong>${row.advogado_nome}</strong><br>
            <span class="muted">${row.escritorio_nome}</span>
          </td>
          <td>
            <strong>${row.perfil_advogado}</strong><br>
            <span class="muted">${row.descricao_perfil_advogado}</span>
          </td>
          <td>
            <span class="pill">${row.acao_recomendada}</span><br>
            <span class="muted">${row.valor_acordo_recomendado ? row.valor_acordo_recomendado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Sem valor sugerido'}</span>
          </td>
          <td>
            <span class="pill ${row.override ? 'override' : ''}">${row.acao_tomada}</span><br>
            <span class="muted">${row.valor_acordo_proposto ? row.valor_acordo_proposto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Sem proposta'}</span>
          </td>
          <td>${row.override ? `<span class="pill override">${row.razao_override}</span>` : '<span class="muted">Sem override</span>'}</td>
          <td class="muted">${row.explicacao_decisao_advogado}</td>
        </tr>
      `).join('');
      document.getElementById('tableNote').textContent = `Mostrando ${records.length} decisões recentes após os filtros.`;
    }

    async function loadOptions() {
      const response = await fetch('/api/options');
      const options = await response.json();
      buildFilters(options);
    }

    async function loadDashboard() {
      const params = new URLSearchParams(state);
      const response = await fetch(`/api/dashboard?${params.toString()}`);
      const payload = await response.json();

      document.getElementById('kpis').innerHTML = [
        card('Total de Processos', payload.kpis.total_processos, 'Casos dentro do recorte atual'),
        card('Taxa de Aderência', pct(payload.kpis.taxa_aderencia), 'Percentual que seguiu a recomendação'),
        card('Taxa de Override', pct(payload.kpis.taxa_override), 'Percentual que divergiu da política'),
        card('Aceite de Acordo', pct(payload.kpis.taxa_aceite_acordo), 'Negociações encerradas com aceite'),
        card('Tempo Médio', `${payload.kpis.tempo_decisao_medio_min} min`, 'Velocidade média até a decisão'),
      ].join('');

      document.getElementById('profilesChart').innerHTML = barRows(payload.profiles, 'perfil', 'taxa_aderencia', 'descricao');
      document.getElementById('officesChart').innerHTML = barRows(payload.offices, 'escritorio_nome', 'taxa_aderencia', null);
      document.getElementById('overrideChart').innerHTML = countRows(payload.override_reasons, 'razao', 'total');
      document.getElementById('contextChart').innerHTML =
        '<div class="muted" style="margin-bottom:10px">Por confiança</div>' +
        barRows(payload.confidence_bands, 'faixa', 'taxa_aderencia', null) +
        '<div class="muted" style="margin:16px 0 10px">Por valor da causa</div>' +
        barRows(payload.value_bands, 'faixa', 'taxa_aderencia', null);
      buildRecords(payload.recent_records);
    }

    async function init() {
      await loadOptions();
      await loadDashboard();
    }

    init();
  </script>
</body>
</html>
"""


def make_handler(records: list[dict[str, Any]]):
    options = options_payload(records)

    class Handler(BaseHTTPRequestHandler):
        def _write_json(self, payload: dict[str, Any] | list[dict[str, Any]]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _write_html(self, body: str) -> None:
            payload = body.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args: Any) -> None:
            return

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if parsed.path == "/":
                self._write_html(html_page())
                return

            if parsed.path == "/api/options":
                self._write_json(options)
                return

            if parsed.path == "/api/dashboard":
                params = parse_qs(parsed.query)
                filtered = filter_records(records, params)
                self._write_json(aggregate_dashboard(filtered))
                return

            self.send_error(HTTPStatus.NOT_FOUND, "Rota não encontrada.")

    return Handler


def main() -> None:
    args = parse_args()
    maybe_regenerate_dataset(args)
    records = load_records(args.csv)
    handler = make_handler(records)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Dashboard disponível em http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
