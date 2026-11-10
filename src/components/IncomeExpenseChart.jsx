/**
 * График доходов и расходов (recharts).
 *
 * Восстановлено из production-бандла PhoneBooks. Логика и разметка сохранены без изменений;
 * локальные имена переменных в теле функций оставлены как в бандле.
 */
import { formatMoney } from "../utils/format.js";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
export function ChartTooltip({ active: s, payload: t, label: n }) {
  return !s || !(t != null && t.length) ? null : (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-float backdrop-blur">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
        {n}
      </p>
      {t.map((a) => (
        <div
          className="flex items-center justify-between gap-4 text-[12px]"
          key={a.dataKey}
        >
          <span className="flex items-center gap-1.5 text-ink-500">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: a.color,
              }}
            />
            {a.name}
          </span>
          <span className="font-semibold tabular-nums text-ink-900">
            {formatMoney(a.value ?? 0)}
          </span>
        </div>
      ))}
    </div>
  );
}
export function IncomeExpenseChart({ data: s, height: t = 240 }) {
  const n = React.useId(),
    a = React.useId(),
    c = s.some((r) => r.income > 0 || r.expense > 0);
  return (
    <div
      style={{
        height: t,
      }}
      className="w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={s}
          margin={{
            top: 8,
            right: 6,
            left: 0,
            bottom: 0,
          }}
        >
          <defs>
            <linearGradient id={n} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.01} />
            </linearGradient>
            <linearGradient id={a} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.16} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={!1}
            stroke="var(--grid)"
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="label"
            tickLine={!1}
            axisLine={!1}
            tick={{
              fontSize: 11,
              fill: "var(--ink-400)",
            }}
            interval="preserveStartEnd"
            minTickGap={18}
          />
          <YAxis
            tickLine={!1}
            axisLine={!1}
            tick={{
              fontSize: 11,
              fill: "var(--ink-400)",
            }}
            tickFormatter={(r) =>
              Math.abs(r) >= 1e3
                ? `${r < 0 ? "−" : ""}${Math.round(Math.abs(r) / 1e3)}к`
                : String(r)
            }
            width={48}
            allowDecimals={!1}
          />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="income"
            name="Доходы"
            stroke="#10b981"
            strokeWidth={2}
            fill={`url(#${n})`}
            activeDot={{
              r: 4,
              strokeWidth: 2,
              stroke: "var(--surface)",
            }}
          />
          <Area
            type="monotone"
            dataKey="expense"
            name="Расходы"
            stroke="#ef4444"
            strokeWidth={2}
            fill={`url(#${a})`}
            activeDot={{
              r: 4,
              strokeWidth: 2,
              stroke: "var(--surface)",
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
      {!c && (
        <div className="-mt-[calc(50%)] flex h-0 justify-center">
          <span className="rounded-full bg-slate-50 px-3 py-1 text-[12px] text-ink-400">
            Пока нет операций за период
          </span>
        </div>
      )}
    </div>
  );
}
