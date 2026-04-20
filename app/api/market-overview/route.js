const MARKET_REFRESH_SECONDS = 60 * 5;
const PROVIDER_TIMEOUT_MS = 8000;
const MINDICADOR_API_ROOT = "https://mindicador.cl/api";
const COINBASE_API_ROOT = "https://api.coinbase.com/v2";
const COINBASE_EXCHANGE_API_ROOT = "https://api.exchange.coinbase.com";
const YAHOO_FINANCE_CHART_API_ROOT = "https://query1.finance.yahoo.com/v8/finance/chart";
const FRED_GRAPH_API_ROOT = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const OIL_SERIES = {
  brent: {
    key: "brent",
    label: "Brent",
    yahooSymbol: "BZ=F",
    fredSeriesId: "DCOILBRENTEU",
    color: "#9a5b1f",
  },
  wti: {
    key: "wti",
    label: "WTI",
    yahooSymbol: "CL=F",
    fredSeriesId: "DCOILWTICO",
    color: "#24588f",
  },
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 300;

export async function GET() {
  const warnings = [];

  const [
    mindicadorSummaryResult,
    dollarSeriesResult,
    ufSeriesResult,
    bitcoinSpotResult,
    bitcoinCandlesResult,
    brentIntradayResult,
    wtiIntradayResult,
  ] = await Promise.allSettled([
    fetchJson(MINDICADOR_API_ROOT),
    fetchJson(`${MINDICADOR_API_ROOT}/dolar`),
    fetchJson(`${MINDICADOR_API_ROOT}/uf`),
    fetchJson(`${COINBASE_API_ROOT}/prices/BTC-USD/spot`),
    fetchJson(`${COINBASE_EXCHANGE_API_ROOT}/products/BTC-USD/candles?granularity=86400`),
    fetchJson(buildYahooChartUrl(OIL_SERIES.brent.yahooSymbol)),
    fetchJson(buildYahooChartUrl(OIL_SERIES.wti.yahooSymbol)),
  ]);

  const mindicadorSummary = unwrapSettledValue(mindicadorSummaryResult, "Mindicador resumen", warnings);
  const dollarSeriesPayload = unwrapSettledValue(dollarSeriesResult, "Mindicador dolar", warnings);
  const ufSeriesPayload = unwrapSettledValue(ufSeriesResult, "Mindicador UF", warnings);
  const bitcoinSpotPayload = unwrapSettledValue(bitcoinSpotResult, "Coinbase Bitcoin spot", warnings);
  const bitcoinCandlesPayload = unwrapSettledValue(bitcoinCandlesResult, "Coinbase Bitcoin velas", warnings);
  const brentIntradayPayload = unwrapSettledValue(brentIntradayResult, "Yahoo Finance Brent intradia", warnings);
  const wtiIntradayPayload = unwrapSettledValue(wtiIntradayResult, "Yahoo Finance WTI intradia", warnings);

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
        label: "UF en USD",
        value: formatUsdValue(ufUsdValue, 2),
      },
    ];
  }

  let brentSeriesCsv = null;
  let wtiSeriesCsv = null;
  let oilItem = buildOilMetric({
    id: "oil",
    label: "Petroleo",
    intradaySource: "Yahoo Finance",
    fallbackSource: "FRED / EIA",
    brentIntradayPayload,
    wtiIntradayPayload,
    brentCsv: brentSeriesCsv,
    wtiCsv: wtiSeriesCsv,
  });

  if (!hasCompleteIntradayOilMetric(oilItem)) {
    const [brentSeriesResult, wtiSeriesResult] = await Promise.allSettled([
      fetchText(buildFredSeriesUrl(OIL_SERIES.brent.fredSeriesId)),
      fetchText(buildFredSeriesUrl(OIL_SERIES.wti.fredSeriesId)),
    ]);

    brentSeriesCsv = unwrapSettledValue(brentSeriesResult, "FRED Brent", warnings);
    wtiSeriesCsv = unwrapSettledValue(wtiSeriesResult, "FRED WTI", warnings);
    oilItem = buildOilMetric({
      id: "oil",
      label: "Petroleo",
      intradaySource: "Yahoo Finance",
      fallbackSource: "FRED / EIA",
      brentIntradayPayload,
      wtiIntradayPayload,
      brentCsv: brentSeriesCsv,
      wtiCsv: wtiSeriesCsv,
    });
  }

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
    ensureMetric(oilItem, {
      id: "oil",
      label: "Petroleo",
      source: "Yahoo Finance / FRED",
      message: "No pudimos obtener referencias recientes de Brent y WTI desde las fuentes publicas.",
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
        "Cache-Control": `s-maxage=${MARKET_REFRESH_SECONDS}, stale-while-revalidate=60`,
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
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    next: {
      revalidate: MARKET_REFRESH_SECONDS,
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
      Accept: "text/csv, text/plain;q=0.9, */*;q=0.8",
      "User-Agent": "web-app-2026",
    },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    next: {
      revalidate: MARKET_REFRESH_SECONDS,
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
    payload?.chart?.error?.description ||
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

function buildOilMetric({ id, label, intradaySource, fallbackSource, brentIntradayPayload, wtiIntradayPayload, brentCsv, wtiCsv }) {
  const quoteInputs = [
    { config: OIL_SERIES.brent, intradayPayload: brentIntradayPayload, fallbackCsv: brentCsv },
    { config: OIL_SERIES.wti, intradayPayload: wtiIntradayPayload, fallbackCsv: wtiCsv },
  ];
  const quotes = quoteInputs
    .map(({ config, intradayPayload, fallbackCsv }) => {
      return buildYahooOilQuoteCard(config, intradayPayload, intradaySource) ?? buildFredOilQuoteCard(config, fallbackCsv, fallbackSource);
    })
    .filter(Boolean);

  if (!quotes.length) {
    return null;
  }

  const hasIntradayQuotes = quotes.some((quote) => quote.isIntraday);
  const hasFallbackQuotes = quotes.some((quote) => !quote.isIntraday);
  const averageCurrentValue = roundToDecimals(quotes.reduce((total, quote) => total + quote.value, 0) / quotes.length, 2);
  const averagePreviousValue = roundToDecimals(quotes.reduce((total, quote) => total + quote.previousValue, 0) / quotes.length, 2);
  const aggregateChangeAbs = roundToDecimals(averageCurrentValue - averagePreviousValue, 2);
  const aggregateChangePct = averagePreviousValue
    ? roundToDecimals(((averageCurrentValue - averagePreviousValue) / averagePreviousValue) * 100, 2)
    : 0;
  const updatedAt =
    quotes
      .map((quote) => quote.updatedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || new Date().toISOString();
  const chartSeries = mergeMultiSeries(quotes);
  const spreadValue =
    quotes.length === 2 ? roundToDecimals(quotes[0].value - quotes[1].value, 2) : null;
  const rangeFacts = quotes
    .filter((quote) => quote.isIntraday && quote.sessionLow != null && quote.sessionHigh != null)
    .map((quote) => ({
      label: `Rango ${quote.label}`,
      value: `${formatUsdValue(quote.sessionLow, 2)} a ${formatUsdValue(quote.sessionHigh, 2)}`,
    }));

  return {
    id,
    label,
    source: hasIntradayQuotes && hasFallbackQuotes ? `${intradaySource} / ${fallbackSource}` : hasIntradayQuotes ? intradaySource : fallbackSource,
    value: averageCurrentValue,
    displayValue: formatUsdValue(averageCurrentValue, 2),
    displayDecimals: 2,
    unitLabel: "USD",
    direction: resolveDirection(aggregateChangeAbs),
    changeAbs: aggregateChangeAbs,
    changePct: aggregateChangePct,
    updatedAt: normalizeDateTime(updatedAt) ?? new Date().toISOString(),
    series: chartSeries,
    facts: [
      ...(spreadValue == null ? [] : [{ label: "Spread Brent-WTI", value: formatUsdValue(spreadValue, 2) }]),
      ...rangeFacts,
    ],
    description:
      hasIntradayQuotes && quotes.length === 2 && !hasFallbackQuotes
        ? "Serie intradia de 5 minutos para seguir la variacion de la sesion en Brent y WTI."
        : hasIntradayQuotes
          ? "Parte del panel usa datos intradia y parte quedo con respaldo diario."
          : "Respaldo diario de FRED/EIA mientras la fuente intradia no responde.",
    quoteCards: quotes,
    chartKeys: quotes.map(({ key, label, color }) => ({ key, label, color })),
    showAggregateChange: false,
    isUnavailable: false,
    errorMessage: "",
  };
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

function buildYahooOilQuoteCard(seriesConfig, payload, source) {
  const normalized = normalizeYahooChartSeries(payload);
  const chartSeries = normalized.series.slice(-288);
  const latestPoint = chartSeries[chartSeries.length - 1];
  const currentValue = normalized.currentValue ?? latestPoint?.value ?? null;
  const previousValue = normalized.previousClose ?? normalized.sessionOpen ?? chartSeries[0]?.value ?? currentValue;

  if (currentValue == null || previousValue == null) {
    return null;
  }

  const changeAbs = roundToDecimals(currentValue - previousValue, 2);
  const changePct = previousValue ? roundToDecimals(((currentValue - previousValue) / previousValue) * 100, 2) : 0;
  const updatedAt = normalized.updatedAt ?? latestPoint?.date ?? new Date().toISOString();
  const series = mergeCurrentQuoteIntoSeries(chartSeries, currentValue, updatedAt);

  return {
    key: seriesConfig.key,
    label: seriesConfig.label,
    color: seriesConfig.color,
    value: roundToDecimals(currentValue, 2),
    previousValue: roundToDecimals(previousValue, 2),
    displayValue: formatUsdValue(currentValue, 2),
    displayDecimals: 2,
    unitLabel: "USD",
    direction: resolveDirection(changeAbs),
    changeAbs,
    changePct,
    updatedAt,
    source,
    series,
    sessionLow: normalized.sessionLow,
    sessionHigh: normalized.sessionHigh,
    isIntraday: true,
  };
}

function hasCompleteIntradayOilMetric(metric) {
  return (
    Array.isArray(metric?.quoteCards) &&
    metric.quoteCards.length === Object.keys(OIL_SERIES).length &&
    metric.quoteCards.every((quote) => quote.isIntraday)
  );
}

function buildFredOilQuoteCard(seriesConfig, csvPayload, source) {
  const series = normalizeFredCsvSeries(csvPayload).slice(-14);
  const latestPoint = series[series.length - 1];
  const comparisonPoint = series[series.length - 2] ?? latestPoint;

  if (!latestPoint || !comparisonPoint) {
    return null;
  }

  const changeAbs = roundToDecimals(latestPoint.value - comparisonPoint.value, 2);
  const changePct = comparisonPoint.value
    ? roundToDecimals(((latestPoint.value - comparisonPoint.value) / comparisonPoint.value) * 100, 2)
    : 0;

  return {
    key: seriesConfig.key,
    label: seriesConfig.label,
    color: seriesConfig.color,
    value: roundToDecimals(latestPoint.value, 2),
    previousValue: roundToDecimals(comparisonPoint.value, 2),
    displayValue: formatUsdValue(latestPoint.value, 2),
    displayDecimals: 2,
    unitLabel: "USD",
    direction: resolveDirection(changeAbs),
    changeAbs,
    changePct,
    updatedAt: latestPoint.date,
    source,
    series,
    sessionLow: null,
    sessionHigh: null,
    isIntraday: false,
  };
}

function normalizeYahooChartSeries(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const series = timestamps
    .map((timestamp, index) => ({
      date: unixTimestampToIso(timestamp),
      value: toMarketQuoteNumber(quote.close?.[index]),
    }))
    .filter(isValidSeriesPoint)
    .sort((left, right) => left.date.localeCompare(right.date));
  const highValues = normalizeNumericArray(quote.high);
  const lowValues = normalizeNumericArray(quote.low);
  const fallbackValues = series.map((point) => point.value);
  const meta = result?.meta ?? {};
  const updatedAt = unixTimestampToIso(meta.regularMarketTime) || series[series.length - 1]?.date || "";

  return {
    currentValue: toMarketQuoteNumber(meta.regularMarketPrice) ?? series[series.length - 1]?.value ?? null,
    previousClose: toMarketQuoteNumber(meta.chartPreviousClose) ?? toMarketQuoteNumber(meta.previousClose),
    sessionOpen: series[0]?.value ?? null,
    sessionHigh: highValues.length ? Math.max(...highValues) : fallbackValues.length ? Math.max(...fallbackValues) : null,
    sessionLow: lowValues.length ? Math.min(...lowValues) : fallbackValues.length ? Math.min(...fallbackValues) : null,
    updatedAt,
    series,
  };
}

function normalizeNumericArray(values) {
  return (Array.isArray(values) ? values : []).map(toMarketQuoteNumber).filter((value) => value != null);
}

function mergeCurrentQuoteIntoSeries(series, currentValue, updatedAt) {
  const normalizedUpdatedAt = normalizeDateTime(updatedAt);

  if (!normalizedUpdatedAt || currentValue == null) {
    return series;
  }

  return [
    ...series.filter((point) => normalizeDateTime(point.date) !== normalizedUpdatedAt),
    {
      date: normalizedUpdatedAt,
      value: roundToDecimals(currentValue, 2),
    },
  ].sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeFredCsvSeries(csvText) {
  return String(csvText ?? "")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [date, rawValue] = line.split(",", 2);
      return {
        date: normalizeDateOnly(date),
        value: toFiniteNumber(rawValue),
      };
    })
    .filter(isValidSeriesPoint)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function mergeMultiSeries(quotes) {
  const dates = new Set();

  quotes.forEach((quote) => {
    quote.series.forEach((point) => {
      dates.add(point.date);
    });
  });

  return Array.from(dates)
    .sort()
    .map((date) => {
      const point = { date };

      quotes.forEach((quote) => {
        point[quote.key] = quote.series.find((entry) => entry.date === date)?.value ?? null;
      });

      return point;
    });
}

function buildFredSeriesUrl(seriesId) {
  return `${FRED_GRAPH_API_ROOT}?id=${encodeURIComponent(seriesId)}`;
}

function buildYahooChartUrl(symbol) {
  return `${YAHOO_FINANCE_CHART_API_ROOT}/${encodeURIComponent(symbol)}?range=1d&interval=5m`;
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

function unixTimestampToIso(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "";
  }

  return new Date(numericValue * 1000).toISOString();
}

function roundToDecimals(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function toFiniteNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function toMarketQuoteNumber(value) {
  const numericValue = toFiniteNumber(value);
  return numericValue === 0 ? null : numericValue;
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

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
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
