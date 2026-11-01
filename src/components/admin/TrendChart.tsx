"use client";

import { sumCounts, type DayCount } from "./admin-data";

function MiniBars({ data, label }: { data: DayCount[]; label: string }) {
  const max = Math.max(1, ...data.map((day) => day.count));
  return (
    <div className="admin-bars" role="img" aria-label={label}>
      {data.map((day, index) => (
        <span
          key={day.date}
          className={`admin-bars__bar ${index >= data.length - 7 ? "is-recent" : ""}`}
          style={{ height: `${Math.max(4, Math.round((day.count / max) * 100))}%` }}
          title={`${day.date}: ${day.count}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function TrendBlock({ title, data }: { title: string; data: DayCount[] }) {
  const total = sumCounts(data);
  const recent = sumCounts(data.slice(-7));
  const prior = sumCounts(data.slice(-14, -7));
  const delta = prior === 0 ? (recent > 0 ? 100 : 0) : Math.round(((recent - prior) / prior) * 100);
  const first = data[0]?.date ?? "";
  const last = data[data.length - 1]?.date ?? "";

  return (
    <div className="admin-trend">
      <div className="admin-trend__head">
        <div>
          <p className="admin-trend__title">{title}</p>
          <p className="admin-trend__meta">
            <strong>{recent}</strong> last 7 days
            <span className={delta >= 0 ? "is-up" : "is-down"}>
              {delta >= 0 ? "+" : ""}
              {delta}%
            </span>
          </p>
        </div>
        <span className="admin-trend__total" title={`${total} in the last 14 days`}>
          {total}
        </span>
      </div>
      <MiniBars
        data={data}
        label={`${title}: ${total} across the last ${data.length} days, ${recent} in the last 7`}
      />
      <div className="admin-trend__axis">
        <span>{first.slice(5)}</span>
        <span>{last.slice(5)}</span>
      </div>
    </div>
  );
}
