import { sanitizeFirebaseCompatibleText } from "@/lib/firebase-safe";

function parseUsdAmount(value) {
  const normalized = String(value ?? "")
    .replace(/[$,]/g, "")
    .trim();

  if (!normalized) {
    return 0;
  }

  return Number(normalized) || 0;
}

function toIsoDateFromUs(value) {
  const [month = "", day = "", year = ""] = String(value ?? "")
    .trim()
    .split("/");

  if (!month || !day || !year) {
    return "";
  }

  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeImportMatchText(value) {
  return sanitizeFirebaseCompatibleText(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buildExpenseImportMatchKey({ amount, currency = "USD", movementDate, name }) {
  const normalizedAmount = (Number(amount) || 0).toFixed(2);
  const normalizedCurrency = String(currency ?? "USD").trim().toUpperCase() || "USD";
  const normalizedDate = String(movementDate ?? "").trim();
  const normalizedName = normalizeImportMatchText(name);

  return [normalizedDate, normalizedCurrency, normalizedAmount, normalizedName].join("|");
}

export function buildExpenseImportSourceFingerprint(matchKey, occurrenceIndex) {
  return `${matchKey}::${Number(occurrenceIndex) || 1}`;
}

export function parseSchwabPostedExpenseTransactions(rawText) {
  const payload = JSON.parse(rawText);

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.PostedTransactions)) {
    throw new Error("El archivo no tiene el formato esperado de Charles Schwab.");
  }

  const occurrenceMap = new Map();
  const transactions = [];

  for (const [index, transaction] of payload.PostedTransactions.entries()) {
    const amount = parseUsdAmount(transaction?.Withdrawal);
    const movementDate = toIsoDateFromUs(transaction?.Date);
    const rawDescription = String(transaction?.Description ?? "").trim();
    const normalizedName = sanitizeFirebaseCompatibleText(rawDescription);

    if (!amount || !movementDate || !normalizedName) {
      continue;
    }

    const sourceMatchKey = buildExpenseImportMatchKey({
      amount,
      currency: "USD",
      movementDate,
      name: normalizedName,
    });
    const occurrenceIndex = (occurrenceMap.get(sourceMatchKey) ?? 0) + 1;
    const sourceFingerprint = buildExpenseImportSourceFingerprint(sourceMatchKey, occurrenceIndex);

    occurrenceMap.set(sourceMatchKey, occurrenceIndex);

    transactions.push({
      id: `schwab_import_${index}_${occurrenceIndex}`,
      amount,
      currency: "USD",
      movementDate,
      name: normalizedName,
      rawDescription,
      type: String(transaction?.Type ?? "").trim() || "Movimiento",
      sourceFingerprint,
      sourceMatchKey,
      occurrenceIndex,
      wasSanitized: rawDescription !== normalizedName,
    });
  }

  return {
    fromDate: toIsoDateFromUs(payload?.FromDate),
    toDate: toIsoDateFromUs(payload?.ToDate),
    transactions,
  };
}
