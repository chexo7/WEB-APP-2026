const HALF_HOUR_IN_SECONDS = 60 * 30;
const MINDICADOR_API_ROOT = "https://mindicador.cl/api";
const ALPHA_VANTAGE_API_ROOT = "https://www.alphavantage.co/query";

export const runtime = "nodejs";
export const revalidate = 1800;

export async function GET() {
  const warnings = [];

  const [mindicadorSummaryResult, dollarSeriesResult, ufSeriesResult] = await Promise.allSettled([
    fetchJson(MINDICADOR_API_ROOT),
    fetchJson(`${MINDICADOR_API_ROOT}/dolar`),
    fetchJson(`${MINDICADOR_API_ROOT}/uf`),
  ]);

  const mindicadorSummary = unwrapSettledValue(mindicadorSummaryResult, "Mindicador resumen", warnings);
  const dollarSeriesPayload = unwrapSettledValue(dollarSeriesResult, "Mindicador dolar", warnings);
  const ufSeriesPayload = unwrapSettledValue(ufSeriesResult, "Mindicador UF", warnings);

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

  const alphaVantageKey = normalizeEnvValue(process.env.ALPHA_VANTAGE_API_KEY);
  let brentItem = null;
  let wtiItem = null;
  let bitcoinItem = null;

  if (alphaVantageKey) {
    const [brentResult, wtiResult, bitcoinQuoteResult, bitcoinSeriesResult] = await Promise.allSettled([
      fetchAlphaVantage({ functionName: "BRENT", interval: "daily", apiKey: alphaVantageKey }),
      fetchAlphaVantage({ functionName: "WTI", interval: "daily", apiKey: alphaVantageKey }),
      fetchAlphaVantage({
        functionName: "CURRENCY_EXCHANGE_RATE",
        apiKey: alphaVantageKey,
        from_currency: "BTC",
        to_currency: "USD",
      }),
      fetchAlphaVantage({
        functionName: "DIGITAL_CURRENCY_DAILY",
        apiKey: alphaVantageKey,
        symbol: "BTC",
        market: "USD",
      }),
    ]);

    const brentPayload = unwrapSettledValue(brentResult, "Alpha Vantage Brent", warnings);
    const wtiPayload = unwrapSettledValue(wtiResult, "Alpha Vantage WTI", warnings);
    const bitcoinQuotePayload = unwrapSettledValue(bitcoinQuoteResult, "Alpha Vantage Bitcoin quote", warnings);
    const bitcoinSeriesPayload = unwrapSettledValue(bitcoinSeriesResult, "Alpha Vantage Bitcoin serie", warnings);

    brentItem = buildAlphaCommodityMetric({
      id: "brent-oil",
      label: "Petroleo Brent",
      source: "Alpha Vantage",
      payload: brentPayload,
    });

    wtiItem = buildAlphaCommodityMetric({
      id: "wti-oil",
      label: "Petroleo WTI",
      source: "Alpha Vantage",
      payload: wtiPayload,
    });

    bitcoinItem = buildBitcoinMetric({
      id: "bitcoin-usd",
      label: "Bitcoin / USD",
      source: "Alpha Vantage",
      quotePayload: bitcoinQuotePayload,
      seriesPayload: bitcoinSeriesPayload,
    });
  } else {
    warnings.push("Falta ALPHA_VANTAGE_API_KEY para cargar bitcoin y petroleo.");
  }

  const items = [usdClpItem, ufItem, brentItem, wtiItem, bitcoinItem].filter(Boolean);
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

async function fetchAlphaVantage({ functionName, apiKey, ...params }) {
  const searchParams = new URLSearchParams({
    function: functionName,
    apikey: apiKey,
  });

  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") {
      searchParams.set(key, String(value));
    }
  });

  return fetchJson(`${ALPHA_VANTAGE_API_ROOT}?${searchParams.toString()}`);
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

function buildAlphaCommodityMetric({ id, label, source, payload }) {
  const series = normalizeDatedSeries(payload?.data).slice(-14);
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

function buildBitcoinMetric({ id, label, source, quotePayload, seriesPayload }) {
  const historicalSeries = normalizeDigitalCurrencySeries(seriesPayload).slice(-14);
  const quote = normalizeBitcoinQuote(quotePayload);

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

function buildMarketMetric({ id, label, source, unitLabel, decimals, currentValue, updatedAt, series, formatStyle }) {
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

function normalizeDigitalCurrencySeries(payload) {
  const seriesPayload = payload?.["Time Series (Digital Currency Daily)"];

  if (!seriesPayload || typeof seriesPayload !== "object") {
    return [];
  }

  return Object.entries(seriesPayload)
    .map(([dateKey, point]) => ({
      date: normalizeDateOnly(dateKey),
      value: readDigitalCurrencyClose(point),
    }))
    .filter(isValidSeriesPoint)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeBitcoinQuote(payload) {
  const exchangeRate = payload?.["Realtime Currency Exchange Rate"];

  if (!exchangeRate || typeof exchangeRate !== "object") {
    return null;
  }

  const value = toFiniteNumber(exchangeRate["5. Exchange Rate"]);

  if (value == null) {
    return null;
  }

  return {
    value,
    updatedAt: normalizeDateTime(exchangeRate["6. Last Refreshed"]) || localDateKey(),
  };
}

function readDigitalCurrencyClose(point) {
  if (!point || typeof point !== "object") {
    return null;
  }

  const closeEntry = Object.entries(point).find(([key]) => key.toLowerCase().includes("close (usd)"));

  if (closeEntry) {
    return toFiniteNumber(closeEntry[1]);
  }

  const fallbackEntry = Object.entries(point).find(([key]) => key.toLowerCase().includes("close"));
  return toFiniteNumber(fallbackEntry?.[1]);
}

function formatMetricValue(value, unitLabel, decimals, formatStyle) {
  if (formatStyle === "usd") {
    return new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  return `${new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)} ${unitLabel}`;
}

function resolveDirection(delta) {
  if (delta > 0.004) return "up";
  if (delta < -0.004) return "down";
  return "flat";
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

function normalizeEnvValue(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function localDateKey(date = new Date()) {
  const normalizedDate = date instanceof Date ? date : new Date(date);
  return normalizedDate.toISOString().slice(0, 10);
}
