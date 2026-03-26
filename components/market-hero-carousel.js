"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, Line, LineChart, ResponsiveContainer } from "recharts";

const AUTOPLAY_INTERVAL_MS = 6000;
const SWIPE_THRESHOLD_PX = 44;

export default function MarketHeroCarousel() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [trackIndex, setTrackIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const touchStartRef = useRef(null);

  const carouselItems = useMemo(() => {
    if (items.length <= 1) return items;
    return [items[items.length - 1], ...items, items[0]];
  }, [items]);

  const safeTrackIndex = useMemo(() => {
    if (items.length <= 1) return 0;
    return clamp(trackIndex, 0, items.length + 1);
  }, [items.length, trackIndex]);

  const activeIndex = useMemo(() => {
    if (!items.length) return 0;
    if (items.length === 1) return 0;
    return modulo(safeTrackIndex - 1, items.length);
  }, [items.length, safeTrackIndex]);

  useEffect(() => {
    let ignore = false;
    const controller = new AbortController();

    async function loadMarketOverview() {
      setStatus("loading");
      setMessage("");

      try {
        const response = await fetch("/api/market-overview", {
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        const nextItems = Array.isArray(payload?.items) ? payload.items : [];
        const warningText = Array.isArray(payload?.warnings) && payload.warnings.length ? payload.warnings[0] : "";

        if (ignore) return;

        setItems(nextItems);
        setTrackIndex(nextItems.length > 1 ? 1 : 0);
        setIsAnimating(false);
        setIsTransitioning(false);
        setMessage(warningText);
        setStatus(nextItems.length ? "ready" : response.ok ? "empty" : "error");
      } catch (error) {
        if (ignore || controller.signal.aborted) return;
        setItems([]);
        setTrackIndex(0);
        setIsAnimating(false);
        setIsTransitioning(false);
        setStatus("error");
        setMessage("No pudimos cargar los indicadores ahora mismo.");
      }
    }

    loadMarketOverview();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);

    handleChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || isAnimating || items.length <= 1) {
      return undefined;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      setIsAnimating(true);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isAnimating, items.length]);

  useEffect(() => {
    if (typeof window === "undefined" || items.length <= 1 || isPaused || prefersReducedMotion || isTransitioning) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      advanceSlide(1);
    }, AUTOPLAY_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [isPaused, isTransitioning, items.length, prefersReducedMotion]);

  useEffect(() => {
    if (items.length <= 1) {
      if (trackIndex !== 0) {
        setTrackIndex(0);
      }
      return;
    }

    if (trackIndex === safeTrackIndex) {
      return;
    }

    setIsAnimating(false);
    setIsTransitioning(false);
    setTrackIndex(trackIndex < 0 ? items.length : trackIndex > items.length + 1 ? 1 : safeTrackIndex);
  }, [items.length, safeTrackIndex, trackIndex]);

  useEffect(() => {
    if (typeof window === "undefined" || !isTransitioning) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setIsTransitioning(false);

      if (safeTrackIndex === 0) {
        setIsAnimating(false);
        setTrackIndex(items.length);
        return;
      }

      if (safeTrackIndex === items.length + 1) {
        setIsAnimating(false);
        setTrackIndex(1);
      }
    }, 520);

    return () => window.clearTimeout(timeoutId);
  }, [isTransitioning, items.length, safeTrackIndex]);

  function handleTransitionEnd() {
    if (!isTransitioning) return;
    finalizeTransition();
  }

  function finalizeTransition() {
    if (items.length <= 1) return;

    setIsTransitioning(false);

    if (safeTrackIndex === 0) {
      setIsAnimating(false);
      setTrackIndex(items.length);
      return;
    }

    if (safeTrackIndex === items.length + 1) {
      setIsAnimating(false);
      setTrackIndex(1);
    }
  }

  function advanceSlide(direction = 1) {
    if (items.length <= 1 || isTransitioning) return;
    setIsAnimating(true);
    setIsTransitioning(true);
    setTrackIndex((currentIndex) => clamp(currentIndex + direction, 0, items.length + 1));
  }

  function handleMouseEnter() {
    setIsPaused(true);
  }

  function handleMouseLeave() {
    setIsPaused(false);
  }

  function handleFocusCapture() {
    setIsPaused(true);
  }

  function handleBlurCapture(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsPaused(false);
    }
  }

  function handleTouchStart(event) {
    touchStartRef.current = event.changedTouches[0]?.clientX ?? null;
    setIsPaused(true);
  }

  function handleTouchEnd(event) {
    const startX = touchStartRef.current;
    const endX = event.changedTouches[0]?.clientX ?? null;

    touchStartRef.current = null;
    setIsPaused(false);

    if (startX == null || endX == null) return;

    const distance = endX - startX;

    if (Math.abs(distance) < SWIPE_THRESHOLD_PX) {
      return;
    }

    advanceSlide(distance < 0 ? 1 : -1);
  }

  function handleTouchCancel() {
    touchStartRef.current = null;
    setIsPaused(false);
  }

  const visibleTrackIndex = items.length <= 1 ? activeIndex : safeTrackIndex;

  if (status === "loading") {
    return (
      <section aria-live="polite" className="market-hero-shell">
        <div className="market-carousel-state is-loading">
          <p>Mercado</p>
          <h2>Cargando referencias</h2>
          <span>Estamos trayendo UF, dolar, bitcoin y petroleo para llenar esta cabecera con datos utiles.</span>
        </div>
      </section>
    );
  }

  if (status === "error" || !items.length) {
    return (
      <section aria-live="polite" className="market-hero-shell">
        <div className="market-carousel-state">
          <p>Mercado</p>
          <h2>Indicadores no disponibles</h2>
          <strong>Hero financiero en espera</strong>
          <span>{message || "Por ahora no pudimos conectar con las fuentes externas."}</span>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Indicadores financieros destacados"
      className="market-hero-shell"
      onBlurCapture={handleBlurCapture}
      onFocusCapture={handleFocusCapture}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchCancel={handleTouchCancel}
      onTouchEnd={handleTouchEnd}
      onTouchStart={handleTouchStart}
    >
      <button
        aria-label="Indicador anterior"
        className="market-carousel-advance is-prev"
        disabled={items.length <= 1 || isTransitioning}
        onClick={() => advanceSlide(-1)}
        type="button"
      >
        <ArrowIcon direction="left" />
      </button>

      <button
        aria-label="Siguiente indicador"
        className="market-carousel-advance is-next"
        disabled={items.length <= 1 || isTransitioning}
        onClick={() => advanceSlide(1)}
        type="button"
      >
        <ArrowIcon direction="right" />
      </button>

      <div className="market-carousel-frame">
        <div
          className={isAnimating ? "market-carousel-track is-animated" : "market-carousel-track"}
          onTransitionEnd={handleTransitionEnd}
          style={{ transform: `translateX(-${visibleTrackIndex * 100}%)` }}
        >
          {carouselItems.map((item, index) => (
            <article
              aria-hidden={index !== visibleTrackIndex}
              className={item.isUnavailable ? "market-slide is-unavailable" : `market-slide is-${item.direction}`}
              key={`${item.id}-${index}`}
            >
              <div className="market-slide-copy">
                <div className="market-slide-header">
                  <div>
                    <span className="market-slide-kicker">Indicador al dia</span>
                    <h2>{item.label}</h2>
                  </div>
                  <span className="market-slide-source">{item.source}</span>
                </div>

                <div>
                  {item.isUnavailable ? (
                    <div aria-hidden="true" className="market-slide-value-placeholder" />
                  ) : Array.isArray(item.quoteCards) && item.quoteCards.length ? (
                    <div className="market-quote-grid">
                      {item.quoteCards.map((quote) => (
                        <div className={`market-quote-card is-${quote.direction}`} key={`${item.id}-${quote.key}`}>
                          <span className="market-quote-label">{quote.label}</span>
                          <strong className="market-quote-value">{quote.displayValue}</strong>
                          <span className={`market-quote-change ${quote.direction === "flat" ? "is-flat" : ""}`}>
                            <TrendIcon direction={quote.direction} />
                            {formatChangeLabel(quote)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="market-slide-value">{item.displayValue}</p>
                  )}
                  <p className="market-slide-blurb">
                    {item.isUnavailable
                      ? item.errorMessage || "No pudimos cargar este indicador con la fuente actual."
                      : item.description || `Tendencia ${describeDirection(item.direction)} con base en los ultimos puntos disponibles.`}
                  </p>
                </div>

                {Array.isArray(item.facts) && item.facts.length ? (
                  <div className="market-slide-facts">
                    {item.facts.map((fact) => (
                      <span className="market-fact-chip" key={`${item.id}-${fact.label}`}>
                        <strong>{fact.label}</strong>
                        <span>{fact.value}</span>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="market-slide-meta">
                  {item.isUnavailable ? (
                    <span className="market-update-chip">Sin datos disponibles</span>
                  ) : (
                    <>
                      {item.showAggregateChange === false ? null : (
                        <span className={`market-change-chip ${item.direction === "flat" ? "is-flat" : ""}`}>
                          <TrendIcon direction={item.direction} />
                          {formatChangeLabel(item)}
                        </span>
                      )}
                      <span className="market-update-chip">Actualizado {formatUpdatedAt(item.updatedAt)}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="market-slide-chart-shell">
                <span className="market-slide-window">{item.isUnavailable ? "Sin serie disponible" : `Ultimos ${item.series?.length || 0} puntos`}</span>
                <div className="market-slide-chart">
                  {item.isUnavailable || !item.series?.length ? (
                    <div className="market-chart-empty">
                      <strong>{item.source}</strong>
                      <span>Este indicador existe, pero su fuente no devolvio un valor utilizable.</span>
                    </div>
                  ) : Array.isArray(item.chartKeys) && item.chartKeys.length ? (
                    <>
                      <div className="market-chart-legend">
                        {item.chartKeys.map((line) => (
                          <span className="market-chart-legend-chip" key={`${item.id}-${line.key}`}>
                            <span aria-hidden="true" className="market-chart-legend-swatch" style={{ backgroundColor: line.color }} />
                            {line.label}
                          </span>
                        ))}
                      </div>
                      <div className="market-chart-figure">
                        <ResponsiveContainer height="100%" width="100%">
                          <LineChart data={item.series}>
                            {item.chartKeys.map((line) => (
                              <Line
                                connectNulls
                                dataKey={line.key}
                                dot={false}
                                isAnimationActive={false}
                                key={line.key}
                                stroke={line.color}
                                strokeWidth={3}
                                type="monotone"
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="market-slide-range">
                        <span>{formatShortDate(item.series?.[0]?.date)}</span>
                        <span>{formatShortDate(item.series?.[item.series.length - 1]?.date)}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="market-chart-figure">
                        <ResponsiveContainer height="100%" width="100%">
                          <AreaChart data={item.series}>
                            <defs>
                              <linearGradient id={`market-fill-${item.id}`} x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stopColor={resolveChartColor(item.direction)} stopOpacity={0.28} />
                                <stop offset="100%" stopColor={resolveChartColor(item.direction)} stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <Area
                              dataKey="value"
                              dot={false}
                              fill={`url(#market-fill-${item.id})`}
                              isAnimationActive={false}
                              stroke={resolveChartColor(item.direction)}
                              strokeWidth={3}
                              type="monotone"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="market-slide-range">
                        <span>{formatShortDate(item.series?.[0]?.date)}</span>
                        <span>{formatShortDate(item.series?.[item.series.length - 1]?.date)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="market-carousel-footer">
        <div aria-hidden="true" className="market-carousel-dots">
          {items.map((item, index) => (
            <span
              className={index === activeIndex ? "market-carousel-dot is-active" : "market-carousel-dot"}
              key={item.id}
            />
          ))}
        </div>

        <span className="market-slide-counter">
          {activeIndex + 1} / {items.length}
        </span>
      </div>
    </section>
  );
}

function TrendIcon({ direction }) {
  if (direction === "up") {
    return (
      <svg className="market-trend-icon" fill="none" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 10.5 6.8 6.7 9.3 9.2 13 5.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
        <path d="M10.4 5.5H13v2.6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      </svg>
    );
  }

  if (direction === "down") {
    return (
      <svg className="market-trend-icon" fill="none" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 5.5 6.8 9.3 9.3 6.8 13 10.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
        <path d="M10.4 10.5H13V7.9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      </svg>
    );
  }

  return (
    <svg className="market-trend-icon" fill="none" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 8h10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

function ArrowIcon({ direction = "right" }) {
  return (
    <svg
      fill="none"
      height="18"
      style={direction === "left" ? { transform: "scaleX(-1)" } : undefined}
      viewBox="0 0 18 18"
      width="18"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M4.5 9h9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="m9.75 5.25 3.75 3.75-3.75 3.75" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

function resolveChartColor(direction) {
  if (direction === "up") return "#2f6b5f";
  if (direction === "down") return "#9f3b3b";
  return "#24588f";
}

function describeDirection(direction) {
  if (direction === "up") return "alcista";
  if (direction === "down") return "bajista";
  return "estable";
}

function formatChangeLabel(item) {
  const absoluteChange = Math.abs(Number(item?.changeAbs) || 0);
  const percentChange = Math.abs(Number(item?.changePct) || 0);

  if (absoluteChange < 0.005 && percentChange < 0.005) {
    return "Sin cambio reciente";
  }

  const prefix = item.direction === "down" ? "-" : "+";
  const decimals = Number.isInteger(item?.displayDecimals) ? item.displayDecimals : 2;
  const absoluteLabel =
    item.unitLabel === "CLP"
      ? `${formatNumber(absoluteChange, decimals)} CLP`
      : new Intl.NumberFormat("es-CL", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(absoluteChange);

  return `${prefix}${absoluteLabel} (${prefix}${formatNumber(percentChange, 2)}%)`;
}

function formatUpdatedAt(value) {
  const rawValue = String(value ?? "").trim();
  const candidate = toDisplayDate(value);

  if (!candidate) {
    return "sin hora";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return new Intl.DateTimeFormat("es-CL", {
      day: "2-digit",
      month: "short",
    })
      .format(candidate)
      .replace(",", "");
  }

  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(candidate)
    .replace(",", "");
}

function formatShortDate(value) {
  if (!value) return "";

  const candidate = toDisplayDate(value);

  if (!candidate) {
    return value;
  }

  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
  })
    .format(candidate)
    .replace(",", "");
}

function formatNumber(value, decimals = 2) {
  return new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value) || 0);
}

function modulo(value, total) {
  return ((value % total) + total) % total;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toDisplayDate(value) {
  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  const normalizedText = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00Z` : text;
  const candidate = new Date(normalizedText);

  if (Number.isNaN(candidate.getTime())) {
    return null;
  }

  return candidate;
}
