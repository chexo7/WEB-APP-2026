import { add, dinero, toDecimal } from "dinero.js";
import { CLP, USD } from "dinero.js/currencies";

const currencyMap = {
  CLP,
  USD,
};

function getCurrencyDefinition(currencyCode = "USD") {
  return currencyMap[String(currencyCode ?? "").toUpperCase()] ?? USD;
}

function toMinorUnits(value, currencyDefinition) {
  const numericValue = Number(value) || 0;
  const factor = 10 ** currencyDefinition.exponent;

  return Math.round(numericValue * factor);
}

export function createMoneyAmount(value, currencyCode = "USD") {
  const currencyDefinition = getCurrencyDefinition(currencyCode);

  return dinero({
    amount: toMinorUnits(value, currencyDefinition),
    currency: currencyDefinition,
  });
}

export function toMoneyNumber(value, currencyCode = "USD") {
  return Number(toDecimal(createMoneyAmount(value, currencyCode)));
}

export function sumMoneyValues(values, currencyCode = "USD") {
  const currencyDefinition = getCurrencyDefinition(currencyCode);
  const initialAmount = dinero({
    amount: 0,
    currency: currencyDefinition,
  });

  const totalAmount = values.reduce(
    (accumulator, value) =>
      add(
        accumulator,
        dinero({
          amount: toMinorUnits(value, currencyDefinition),
          currency: currencyDefinition,
        }),
      ),
    initialAmount,
  );

  return Number(toDecimal(totalAmount));
}

export function formatMoneyAmount(value, currencyCode = "USD", locale = "es-CL") {
  const currencyDefinition = getCurrencyDefinition(currencyCode);
  const normalizedAmount = toMoneyNumber(value, currencyDefinition.code);

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyDefinition.code,
    maximumFractionDigits: currencyDefinition.exponent,
  }).format(normalizedAmount);
}

export function formatCompactMoneyAmount(value, currencyCode = "USD") {
  const currencyDefinition = getCurrencyDefinition(currencyCode);
  const normalizedAmount = toMoneyNumber(value, currencyDefinition.code);

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyDefinition.code,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(normalizedAmount);
}
