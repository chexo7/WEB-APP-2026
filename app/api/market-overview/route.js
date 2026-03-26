const HALF_HOUR_IN_SECONDS = 60 * 30;
const MINDICADOR_API_ROOT = "https://mindicador.cl/api";
const COINBASE_API_ROOT = "https://api.coinbase.com/v2";
const COINBASE_EXCHANGE_API_ROOT = "https://api.exchange.coinbase.com";
const EIA_HISTORY_PAGES = {
  brent: "https://www.eia.gov/dnav/pet/hist/RBRTED.htm",
  wti: "https://www.eia.gov/dnav/pet/hist/RWTCD.htm",
};

export const runtime = "nodejs";
export const revalidate = 1800;

export async function GET() {
  const warnings = [];

  const [
    mindicadorSummaryResult,
    dollarSeriesResult,
    ufSeriesResult,
    bitcoinSpotResult,
    bitcoinCandlesResult,
    brentHistoryResult,
    wtiHistoryResult,
  ] = await Promise.allSettled([
    fetchJson(MINDICADOR_API_ROOT),
    fetchJson(`${MINDICADOR_API_ROOT}/dolar`),
    fetchJson(`${MINDICADOR_API_ROOT}/uf`),
    fetchJson(`${COINBASE_API_ROOT}/prices/BTC-USD/spot`),
    fetchJson(`${COINBASE_EXCHANGE_API_ROOT}/products/BTC-USD/candles?granularity=86400`),
    fetchText(EIA_HISTORY_PAGES.brent),
    fetchText(EIA_HISTORY_PAGES.wti),
  ]);

  const mindicadorSummary = unwrapSettledValue(mindicadorSummaryResult, "Mindicador resumen", warnings);
  const dollarSeriesPayload = unwrapSettledValue(dollarSeriesResult, "Mindicador dolar", warnings);
  const ufSeriesPayload = unwrapSettledValue(ufSeriesResult, "Mindicador UF", warnings);
  const bitcoinSpotPayload = unwrapSettledValue(bitcoinSpotResult, "Coinbase Bitcoin spot", warnings);
  const bitcoinCandlesPayload = unwrapSettledValue(bitcoinCandlesResult, "Coinbase Bitcoin velas", warnings);
  const brentHistoryHtml = unwrapSettledValue(brentHistoryResult, "EIA Brent", warnings);
  const wtiHistoryHtml = unwrapSettledValue(wtiHistoryResult, "EIA WTI", warnings);

  const usdClpItem = buildMindicadorMetric({
    id: "usd-clp",
    label: "Dolar observado",
    source: "Mindicador",
    summaryNode: mindicadorSummary?.dolar,
    seriesPayload: dollarSeriesPayload,
    unitLabel: "CLP",
    decimals: 0,
  });

  const ufItem = buildMindicadorMetric({
    id: "uf-cl",
    label: "Unidad de fomento",
    source: "Mindicador",
    summaryNode: mindicadorSummary?.uf,
    seriesPayload: ufSeriesPayload,
    unitLabel: "CLP",
    decimals: 2,
  });

  if (ufItem && usdClpItem?.value) {
    const ufUsdValue = ufItem.value / usdClpItem.value;
    ufItem.facts = [
      {
        label: "Relacion UF / USD",
        value: `${formatUsdValue(ufUsdValue, 2)} por UF`,
      },
    ];
  }

  const brentItem = buildEiaOilMetric({
    id: "brent-oil",
    label: "Petroleo Brent",
    source: "EIA",
    historyHtml: brentHistoryHtml,
  });

  const wtiItem = buildEiaOilMetric({
    id: "wti-oil",
    label: "Petroleo WTI",
    source: "EIA",
    historyHtml: wtiHistoryHtml,
  });

  const bitcoinItem = buildCoinbaseBitcoinMetric({
    id: "bitcoin-usd",
    label: "Bitcoin / USD",
    source: "Coinbase",
    spotPayload: bitcoinSpotPayload,
    candlesPayload: bitcoinCandlesPayload,
  });

  const items = [
    ensureMetric(usdClpItem, {
      id: "usd-clp",
      label: "Dolar observado",
      source: "Mindicador",
      message: "No pudimos obtener el valor actual del dolar observado.",
    }),
    ensureMetric(ufItem, {
      id: "uf-cl",
      label: "Unidad de fomento",
      source: "Mindicador",
      message: "No pudimos obtener el valor actual de la UF.",
    }),
    ensureMetric(brentItem, {
      id: "brent-oil",
      label: "Petroleo Brent",
      source: "EIA",
      message: "No pudimos obtener la referencia Brent desde la fuente publica.",
    }),
    ensureMetric(wtiItem, {
      id: "wti-oil",
      label: "Petroleo WTI",
      source: "EIA",
      message: "No pudimos obtener la referencia WTI desde la fuente publica.",
    }),
    ensureMetric(bitcoinItem, {
      id: "bitcoin-usd",
      label: "Bitcoin / USD",
      source: "Coinbase",
      message: "No pudimos obtener el precio actual de Bitcoin.",
    }),
  ];
  const asOf =
    items
      .map((item) => item.updatedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || new Date().toISOString();

  return Response.json(
    {
      asOf,
      items,
      warnings,
    },
    {
      status: items.length ? 200 : 503,
      headers: {
        "Cache-Control": `s-maxage=${HALF_HOUR_IN_SECONDS}, stale-while-revalidate=300`,
      },
    },
  );
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "web-app-2026",
    },
    next: {
      revalidate: HALF_HOUR_IN_SECONDS,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  assertProviderPayload(url, payload);
  return payload;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html, text/plain;q=0.9, */*;q=0.8",
      "User-Agent": "web-app-2026",
    },
    next: {
      revalidate: HALF_HOUR_IN_SECONDS,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

function assertProviderPayload(sourceLabel, payload) {
  const providerMessage =
    payload?.Note ||
    payload?.Information ||
    payload?.["Error Message"] ||
    payload?.message ||
    payload?.error;

  if (providerMessage) {
    throw new Error(`${sourceLabel}: ${String(providerMessage)}`);
  }
}

function unwrapSettledValue(result, label, warnings) {
  if (result.status === "fulfilled") {
    return result.value;
  }

  warnings.push(`${label} no esta disponible ahora.`);
  return null;
}

function buildMindicadorMetric({ id, label, source, summaryNode, seriesPayload, unitLabel, decimals }) {
  const series = normalizeDatedSeries(seriesPayload?.serie).slice(-14);
  const latestPoint = series[series.length - 1];
  const currentValue = toFiniteNumber(summaryNode?.valor) ?? latestPoint?.value ?? null;
  const updatedAt = normalizeDateTime(summaryNode?.fecha) ?? latestPoint?.date ?? null;

  if (currentValue == null) {
    return null;
  }

  return buildMarketMetric({
    id,
    label,
    source,
    unitLabel,
    decimals,
    currentValue,
    updatedAt,
    series,
    formatStyle: "number",
  });
}

function buildCoinbaseBitcoinMetric({ id, label, source, spotPayload, candlesPayload }) {
  const historicalSeries = normalizeCoinbaseCandles(candlesPayload).slice(-14);
  const quote = normalizeCoinbaseSpot(spotPayload);

  let composedSeries = historicalSeries.slice();
  let currentValue = historicalSeries[historicalSeries.length - 1]?.value ?? null;
  let updatedAt = historicalSeries[historicalSeries.length - 1]?.date ?? null;

  if (quote) {
    const quoteDateKey = normalizeDateOnly(quote.updatedAt) || localDateKey();
    const withoutSameDay = historicalSeries.filter((point) => point.date !== quoteDateKey);

    composedSeries = [...withoutSameDay, { date: quoteDateKey, value: quote.value }]
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(-14);
    currentValue = quote.value;
    updatedAt = normalizeDateTime(quote.updatedAt) ?? quoteDateKey;
  }

  if (currentValue == null) {
    return null;
  }

  return buildMarketMetric({
    id,
    label,
    source,
    unitLabel: "USD",
    decimals: 2,
    currentValue,
    updatedAt,
    series: composedSeries,
    formatStyle: "usd",
  });
}

function buildEiaOilMetric({ id, label, source, historyHtml }) {
  const series = parseEiaDailyHistorySeries(historyHtml).slice(-14);
  const latestPoint = series[series.length - 1];

  if (!latestPoint) {
    return null;
  }

  return buildMarketMetric({
    id,
    label,
    source,
    unitLabel: "USD",
    decimals: 2,
    currentValue: latestPoint.value,
    updatedAt: latestPoint.date,
    series,
    formatStyle: "usd",
  });
}

function buildMarketMetric({ id, label, source, unitLabel, decimals, currentValue, updatedAt, series, formatStyle, facts = [] }) {
  const normalizedSeries = Array.isArray(series) ? series.filter(isValidSeriesPoint).slice(-14) : [];
  const comparisonPoint =
    normalizedSeries[normalizedSeries.length - 2] ||
    normalizedSeries[normalizedSeries.length - 1] || { value: currentValue };
  const changeAbs = roundToDecimals(currentValue - (comparisonPoint?.value ?? currentValue), decimals);
  const changePctBase = comparisonPoint?.value ?? 0;
  const changePct = changePctBase
    ? roundToDecimals(((currentValue - changePctBase) / changePctBase) * 100, 2)
    : 0;

  return {
    id,
    label,
    source,
    value: roundToDecimals(currentValue, decimals),
    displayValue: formatMetricValue(currentValue, unitLabel, decimals, formatStyle),
    displayDecimals: decimals,
    unitLabel,
    direction: resolveDirection(changeAbs),
    changeAbs,
    changePct,
    updatedAt: normalizeDateTime(updatedAt) ?? normalizeDateOnly(updatedAt) ?? new Date().toISOString(),
    series: normalizedSeries,
    facts,
    isUnavailable: false,
    errorMessage: "",
  };
}

function ensureMetric(metric, { id, label, source, message }) {
  if (metric) {
    return metric;
  }

  return {
    id,
    label,
    source,
    value: null,
    displayValue: "",
    displayDecimals: 0,
    unitLabel: "",
    direction: "flat",
    changeAbs: null,
    changePct: null,
    updatedAt: "",
    series: [],
    facts: [],
    isUnavailable: true,
    errorMessage: message,
  };
}

function normalizeDatedSeries(series) {
  return (Array.isArray(series) ? series : [])
    .map((entry) => ({
      date: normalizeDateOnly(entry?.date ?? entry?.fecha),
      value: toFiniteNumber(entry?.value ?? entry?.valor),
    }))
    .filter(isValidSeriesPoint)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeCoinbaseSpot(payload) {
  const value = toFiniteNumber(payload?.data?.amount);

  if (value == null) {
    return null;
  }

  return {
    value,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeCoinbaseCandles(payload) {
  return (Array.isArray(payload) ? payload : [])
    .map((entry) => ({
      date: unixTimestampToDateKey(entry?.[0]),
      value: toFiniteNumber(entry?.[4]),
    }))
    .filter(isValidSeriesPoint)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function parseEiaDailyHistorySeries(html) {
  const lines = extractReadableLines(html);
  const linePattern = /^(\d{4})\s+([A-Za-z]{3})-\s*(\d{1,2})\s+to\s+([A-Za-z]{3})-\s*(\d{1,2})\s+(.+)$/;
  const points = [];

  lines.forEach((line) => {
    const match = line.match(linePattern);

    if (!match) {
      return;
    }

    const [, startYearText, startMonthLabel, startDayText, endMonthLabel, endDayText, valueText] = match;
    const startYear = Number(startYearText);
    const startMonth = monthLabelToNumber(startMonthLabel);
    const endMonth = monthLabelToNumber(endMonthLabel);
    const startDay = Number(startDayText);
    const endDay = Number(endDayText);

    if (!startMonth || !endMonth || !Number.isFinite(startDay) || !Number.isFinite(endDay)) {
      return;
    }

    const values = valueText
      .split(/\s+/)
      .map((token) => toFiniteNumber(token.replace(",", "")))
      .filter((value) => value != null);

    if (!values.length) {
      return;
    }

    const startDate = new Date(Date.UTC(startYear, startMonth - 1, startDay));
    const endYear = endMonth < startMonth ? startYear + 1 : startYear;
    const endDate = new Date(Date.UTC(endYear, endMonth - 1, endDay));
    const businessDays = collectBusinessDays(startDate, endDate);
    const usableDates = (businessDays.length >= values.length ? businessDays.slice(-values.length) : businessDays).slice(-values.length);
    const usableValues = values.slice(-usableDates.length);

    usableDates.forEach((date, index) => {
      points.push({
        date: localDateKey(date),
        value: usableValues[index],
      });
    });
  });

  return points
    .filter(isValidSeriesPoint)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function extractReadableLines(html) {
  const text = String(html ?? "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|pre|table|h\d|td|th|section)>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function collectBusinessDays(startDate, endDate) {
  const dates = [];
  const cursor = new Date(startDate.getTime());

  while (cursor <= endDate) {
    const weekday = cursor.getUTCDay();

    if (weekday !== 0 && weekday !== 6) {
      dates.push(new Date(cursor.getTime()));
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function monthLabelToNumber(label) {
  const normalized = String(label ?? "").trim().slice(0, 3).toLowerCase();

  return {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  }[normalized] ?? 0;
}

function formatMetricValue(value, unitLabel, decimals, formatStyle) {
  if (formatStyle === "usd") {
    return formatUsdValue(value, decimals);
  }

  return `${new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)} ${unitLabel}`;
}

function formatUsdValue(value, decimals = 2) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function resolveDirection(delta) {
  if (delta > 0.004) return "up";
  if (delta < -0.004) return "down";
  return "flat";
}

function unixTimestampToDateKey(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "";
  }

  return localDateKey(new Date(numericValue * 1000));
}

function roundToDecimals(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function toFiniteNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function isValidSeriesPoint(point) {
  return Boolean(point?.date) && Number.isFinite(point?.value);
}

function normalizeDateOnly(value) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 10) : "";
}

function normalizeDateTime(value) {
  const text = String(value ?? "").trim();

  if (!text) {
    return "";
  }

  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const candidate = new Date(normalized);

  if (Number.isNaN(candidate.getTime())) {
    return text;
  }

  return candidate.toISOString();
}

function localDateKey(date = new Date()) {
  const normalizedDate = date instanceof Date ? date : new Date(date);
  return normalizedDate.toISOString().slice(0, 10);
}
