"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Badge as MantineBadge, Button as MantineButton, Group, Loader, Paper, Tabs as MantineTabs, Text } from "@mantine/core";
import {
  addDays as addCalendarDays,
  addMonths as addCalendarMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfMonth as getEndOfMonth,
  endOfWeek as getEndOfWeek,
  format as formatDateValue,
  getDaysInMonth,
  isValid as isValidDate,
  parseISO,
  setDate as setDayOfMonth,
  startOfMonth as getStartOfMonth,
  startOfWeek as getStartOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { get, onValue, push, ref, set } from "firebase/database";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ExpenseImportModal from "@/components/expense-import-modal";
import ExpensesTable from "@/components/expenses-table";
import IncomesTable from "@/components/incomes-table";
import IncomeScheduleModal from "@/components/income-schedule-modal";
import ReconciliationTable from "@/components/reconciliation-table";
import { getFirebaseAuth, getFirebaseDatabase } from "@/lib/firebase";
import { getFirebaseTextWarning, sanitizeFirebaseCompatibleText } from "@/lib/firebase-safe";
import { formatCompactMoneyAmount, formatMoneyAmount } from "@/lib/money";
import { buildRecurringDatesWithRRule } from "@/lib/recurrence";
import { buildExpenseImportMatchKey, parseSchwabPostedExpenseTransactions } from "@/lib/schwab-expense-import";
import {
  validateAdjustmentRecord,
  validateAnalysisSettingsRecord,
  validateBudgetRecord,
  validateExpenseRecord,
  validateIncomeRecord,
} from "@/lib/validation";

const defaultCredentials = { email: "ssfamiliausa@gmail.com", password: "" };
const tabs = [
  { id: "summary", label: "Resumen" },
  { id: "expenses", label: "Gastos" },
  { id: "incomes", label: "Ingresos" },
  { id: "reconciliation", label: "Cuadre" },
  { id: "budgets", label: "Presupuesto" },
  { id: "cashflow", label: "Tabla" },
  { id: "charts", label: "Graficos" },
  { id: "settings", label: "Ajustes" },
];
const expenseFrequencies = ["Unico", "Mensual", "Semanal", "Bi-semanal"];
const expenseCurrencies = [
  { value: "USD", label: "USD - Dolar Estadounidense" },
  { value: "CLP", label: "CLP - Peso Chileno" },
];
const incomeFrequencies = ["Mensual", "Semanal", "Bi-semanal", "Unico"];
const incomeCurrencies = expenseCurrencies;
const spanishDateLocale = es;
const fixedExpenseCategories = sortLabelsAlphabetically([
  "Ahorro - Inversion",
  "Arriendo",
  "Creditos",
  "Cuentas",
  "Deporte",
  "Suscripciones",
]);
const variableExpenseCategories = sortLabelsAlphabetically([
  "Auto",
  "Cosas de Casa",
  "Delivery",
  "Minimarket",
  "Otros",
  "Panoramas",
  "Regalos para alguien",
  "Ropa",
  "Salidas a comer",
  "Salud",
  "Supermercado",
  "Transporte Publico",
  "Uber",
  "Viajes",
]);
const expenseCategories = sortLabelsAlphabetically([...new Set([...fixedExpenseCategories, ...variableExpenseCategories])]);
const expenseCategoryGroups = Object.fromEntries([
  ...fixedExpenseCategories.map((category) => [category, "fixed"]),
  ...variableExpenseCategories.map((category) => [category, "variable"]),
]);

export default function HomePage() {
  const [credentials, setCredentials] = useState(defaultCredentials);
  const [authState, setAuthState] = useState("checking");
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("summary");
  const [cashflowResolution, setCashflowResolution] = useState("weekly");
  const [balanceTrendResolution, setBalanceTrendResolution] = useState("daily");
  const [budgetOverviewMonth, setBudgetOverviewMonth] = useState(localDate().slice(0, 7));
  const [scheduleModalIncomeId, setScheduleModalIncomeId] = useState("");
  const [scheduleOccurrenceDate, setScheduleOccurrenceDate] = useState("");
  const [scheduleAdjustedDate, setScheduleAdjustedDate] = useState("");
  const [expenseImportOpened, setExpenseImportOpened] = useState(false);
  const [expenseImportFileName, setExpenseImportFileName] = useState("");
  const [expenseImportSummary, setExpenseImportSummary] = useState(null);
  const [expenseImportRows, setExpenseImportRows] = useState([]);
  const [expenseImportError, setExpenseImportError] = useState("");
  const [snapshotTree, setSnapshotTree] = useState({});
  const [selectedVersionKey, setSelectedVersionKey] = useState("");
  const [loadedVersionKey, setLoadedVersionKey] = useState("");
  const [draft, setDraft] = useState(emptyWorkspace());
  const [expenseForm, setExpenseForm] = useState(defaultExpenseForm());
  const [budgetForm, setBudgetForm] = useState(defaultBudgetForm());
  const [incomeForm, setIncomeForm] = useState(defaultIncomeForm());
  const [adjustmentForm, setAdjustmentForm] = useState(defaultAdjustmentForm());
  const [settingsForm, setSettingsForm] = useState(defaultAnalysisSettings());
  const [editingExpenseId, setEditingExpenseId] = useState("");
  const [editingBudgetId, setEditingBudgetId] = useState("");
  const [editingIncomeId, setEditingIncomeId] = useState("");
  const [editingAdjustmentId, setEditingAdjustmentId] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [dataError, setDataError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [expenseSort, setExpenseSort] = useState({ key: "movementDate", direction: "desc" });
  const [incomeSort, setIncomeSort] = useState({ key: "startDate", direction: "desc" });
  const [adjustmentSort, setAdjustmentSort] = useState({ key: "date", direction: "desc" });
  const [cashflowTooltip, setCashflowTooltip] = useState(null);
  const [cashflowModelCache, setCashflowModelCache] = useState({ daily: null, weekly: null, monthly: null });
  const cashflowTopScrollRef = useRef(null);
  const cashflowTopScrollSpacerRef = useRef(null);
  const cashflowScrollRef = useRef(null);
  const currentDayColumnRef = useRef(null);
  const expenseNameWarning = useMemo(() => getFirebaseTextWarning(expenseForm.name), [expenseForm.name]);
  const budgetNameWarning = useMemo(() => getFirebaseTextWarning(budgetForm.name), [budgetForm.name]);
  const incomeNameWarning = useMemo(() => getFirebaseTextWarning(incomeForm.name), [incomeForm.name]);
  const displayedTab = useDeferredValue(activeTab);
  const isTabTransitionPending = displayedTab !== activeTab;

  useEffect(() => {
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthState(nextUser ? "authenticated" : "anonymous");
      setAuthError("");
    });
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setSnapshotTree({});
      setSelectedVersionKey("");
      setLoadedVersionKey("");
      setDraft(emptyWorkspace());
      setExpenseForm(defaultExpenseForm());
      setEditingExpenseId("");
      setEditingBudgetId("");
      setBudgetForm(defaultBudgetForm());
      setIncomeForm(defaultIncomeForm());
      setAdjustmentForm(defaultAdjustmentForm());
      setSettingsForm(defaultAnalysisSettings());
      setEditingIncomeId("");
      setEditingAdjustmentId("");
      setScheduleModalIncomeId("");
      setScheduleOccurrenceDate("");
      setScheduleAdjustedDate("");
      setExpenseImportOpened(false);
      setExpenseImportFileName("");
      setExpenseImportSummary(null);
      setExpenseImportRows([]);
      setExpenseImportError("");
      setIsInitializing(false);
      return;
    }

    let active = true;

    const initialize = async () => {
      setIsInitializing(true);

      try {
        const database = getFirebaseDatabase();
        const userRef = ref(database, `users/${user.uid}`);
        const userSnapshot = await get(userRef);

        if (!userSnapshot.exists()) {
          await set(userRef, createInitialUserData(user, localDate()));
        } else {
          const currentData = userSnapshot.val() ?? {};
          const today = localDate();

          if (!currentData.profile) {
            await set(ref(database, `users/${user.uid}/profile`), createUserProfile(user));
          }

          if (!currentData.cashflowSnapshots || !Object.keys(currentData.cashflowSnapshots).length) {
            await set(
              ref(database, `users/${user.uid}/cashflowSnapshots/${today}`),
              createInitialUserData(user, today).cashflowSnapshots[today],
            );
          }
        }
      } catch (firebaseError) {
        if (active) {
          setDataError(firebaseError.message);
        }
      } finally {
        if (active) {
          setIsInitializing(false);
        }
      }
    };

    initialize();

    return () => {
      active = false;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      return;
    }

    const database = getFirebaseDatabase();
    const snapshotsRef = ref(database, `users/${user.uid}/cashflowSnapshots`);

    return onValue(
      snapshotsRef,
      (snapshot) => {
        setSnapshotTree(snapshot.val() ?? {});
        setDataError("");
      },
      (firebaseError) => {
        setDataError(firebaseError.message);
      },
    );
  }, [user?.uid]);

  const recentVersions = useMemo(() => extractRecentVersions(snapshotTree).slice(0, 5), [snapshotTree]);

  useEffect(() => {
    if (!recentVersions.length) {
      setSelectedVersionKey("");
      setLoadedVersionKey("");
      setDraft(emptyWorkspace());
      return;
    }

    if (!selectedVersionKey) {
      setSelectedVersionKey(recentVersions[0].key);
      return;
    }

    const selectedVersion = recentVersions.find((version) => version.key === selectedVersionKey);

    if (selectedVersion && loadedVersionKey !== selectedVersionKey) {
      const nextWorkspace = normalizeWorkspace(selectedVersion.payload);
      setDraft(nextWorkspace);
      setLoadedVersionKey(selectedVersionKey);
      setExpenseForm(defaultExpenseForm());
      setBudgetForm(defaultBudgetForm());
      setIncomeForm(defaultIncomeForm());
      setAdjustmentForm(defaultAdjustmentForm());
      setSettingsForm(nextWorkspace.analysisSettings ?? defaultAnalysisSettings());
      setEditingExpenseId("");
      setEditingBudgetId("");
      setEditingIncomeId("");
      setEditingAdjustmentId("");
      setScheduleModalIncomeId("");
      setScheduleOccurrenceDate("");
      setScheduleAdjustedDate("");
      setExpenseImportOpened(false);
      setExpenseImportFileName("");
      setExpenseImportSummary(null);
      setExpenseImportRows([]);
      setExpenseImportError("");
      setSaveState("idle");
      setDataError("");
      setSuccessMessage("");
    }
  }, [loadedVersionKey, recentVersions, selectedVersionKey]);

  const selectedVersion =
    recentVersions.find((version) => version.key === selectedVersionKey) ?? recentVersions[0] ?? null;

  const expenseEntries = useMemo(() => Object.entries(draft.expenses).map(([id, value]) => ({ id, ...value })), [draft.expenses]);
  const expenseCategorySuggestions = useMemo(() => buildExpenseCategorySuggestionMap(expenseEntries), [expenseEntries]);
  const budgetEntries = useMemo(() => Object.entries(draft.budgets ?? {}).map(([id, value]) => ({ id, ...value })), [draft.budgets]);
  const incomeEntries = useMemo(() => Object.entries(draft.incomes).map(([id, value]) => ({ id, ...value })), [draft.incomes]);
  const adjustmentEntries = useMemo(() => Object.entries(draft.adjustments ?? {}).map(([id, value]) => ({ id, ...value })), [draft.adjustments]);
  const expenses = useMemo(() => sortCollection(expenseEntries, expenseSort, getExpenseSortValue), [expenseEntries, expenseSort]);
  const budgets = useMemo(
    () =>
      [...budgetEntries].sort((left, right) => {
        const result = compareSortValues(dateToTimestamp(left.startDate), dateToTimestamp(right.startDate), "asc");
        if (result !== 0) return result;
        return compareSortValues(left.name, right.name, "asc");
      }),
    [budgetEntries],
  );
  const incomes = useMemo(() => sortCollection(incomeEntries, incomeSort, getIncomeSortValue), [incomeEntries, incomeSort]);
  const adjustments = useMemo(
    () => sortCollection(adjustmentEntries, adjustmentSort, getAdjustmentSortValue),
    [adjustmentEntries, adjustmentSort],
  );

  const hasUnsavedChanges = JSON.stringify(sanitizeWorkspace(draft)) !== JSON.stringify(sanitizeWorkspace(selectedVersion?.payload));
  const todayKey = localDate();
  const analysisSettings = draft.analysisSettings ?? defaultAnalysisSettings();
  const summaryIndicators = useMemo(
    () =>
      buildSummaryIndicatorsModel({
        expenses,
        incomes,
        adjustments,
        currentDateKey: todayKey,
        analysisSettings,
      }),
    [adjustments, analysisSettings, expenses, incomes, todayKey],
  );
  const budgetComparisonModel = useMemo(
    () =>
      buildBudgetComparisonModel({
        budgets,
        expenses,
        incomes,
        currentDateKey: todayKey,
        analysisSettings,
      }),
    [analysisSettings, budgets, expenses, incomes, todayKey],
  );
  const budgetMonthlyOverview = useMemo(
    () =>
      buildBudgetMonthlyOverviewModel({
        budgets,
        expenses,
        incomes,
        currentDateKey: todayKey,
        analysisSettings,
        selectedMonthKey: budgetOverviewMonth,
      }),
    [analysisSettings, budgetOverviewMonth, budgets, expenses, incomes, todayKey],
  );
  const balanceTrendModel = useMemo(
    () =>
      buildBalanceTrendModel({
        budgets,
        expenses,
        incomes,
        adjustments,
        currentDateKey: todayKey,
        analysisSettings,
      }),
    [adjustments, analysisSettings, budgets, expenses, incomes, todayKey],
  );
  const cashflowBaseModel = useMemo(
    () =>
      buildCashflowModel({
        expenses,
        incomes,
        adjustments,
        currentDateKey: todayKey,
        analysisSettings,
      }),
    [adjustments, analysisSettings, expenses, incomes, todayKey],
  );
  const weeklyCashflowModel = useMemo(() => buildCashflowResolutionModel(cashflowBaseModel, "weekly"), [cashflowBaseModel]);
  const cashflowModel = useMemo(() => {
    if (cashflowResolution === "daily") {
      return cashflowModelCache.daily ?? cashflowBaseModel;
    }

    if (cashflowResolution === "weekly") {
      return cashflowModelCache.weekly ?? weeklyCashflowModel;
    }

    return cashflowModelCache.monthly ?? buildCashflowResolutionModel(cashflowBaseModel, "monthly");
  }, [cashflowBaseModel, cashflowModelCache, cashflowResolution, weeklyCashflowModel]);
  const draftRecordCount = expenses.length + budgets.length + incomes.length + adjustments.length;
  const scheduleModalIncome = useMemo(
    () => incomes.find((income) => income.id === scheduleModalIncomeId) ?? incomeEntries.find((income) => income.id === scheduleModalIncomeId) ?? null,
    [incomeEntries, incomes, scheduleModalIncomeId],
  );
  const scheduleOccurrenceOptions = useMemo(
    () => buildIncomeSchedulePreviewItems({ income: scheduleModalIncome, analysisSettings, currentDateKey: todayKey }),
    [analysisSettings, scheduleModalIncome, todayKey],
  );
  const scheduleOverrideRecords = useMemo(() => getIncomeScheduleOverrideRecords(scheduleModalIncome), [scheduleModalIncome]);
  const selectedScheduleOccurrence =
    scheduleOccurrenceOptions.find((item) => item.originalDate === scheduleOccurrenceDate) ??
    scheduleOverrideRecords.find((item) => item.originalDate === scheduleOccurrenceDate) ??
    null;

  useEffect(() => {
    if (!budgetMonthlyOverview.monthOptions.length) return;
    if (budgetMonthlyOverview.selectedMonthKey === budgetOverviewMonth) return;
    setBudgetOverviewMonth(budgetMonthlyOverview.selectedMonthKey);
  }, [budgetMonthlyOverview.monthOptions.length, budgetMonthlyOverview.selectedMonthKey, budgetOverviewMonth]);

  useEffect(() => {
    if (displayedTab !== "cashflow") {
      setCashflowTooltip(null);
      return;
    }

    const container = cashflowScrollRef.current;
    const target = currentDayColumnRef.current;

    if (!container || !target) return;

    const frame = requestAnimationFrame(() => {
      const nextLeft = Math.max(0, target.offsetLeft - container.clientWidth / 2 + target.clientWidth / 2);
      container.scrollTo({ left: nextLeft, behavior: "smooth" });
    });

    return () => cancelAnimationFrame(frame);
  }, [cashflowModel.dates.length, cashflowModel.todayKey, cashflowResolution, displayedTab]);

  useEffect(() => {
    if (displayedTab !== "cashflow") {
      return;
    }

    const mainScroller = cashflowScrollRef.current;
    const topScroller = cashflowTopScrollRef.current;
    const topSpacer = cashflowTopScrollSpacerRef.current;

    if (!mainScroller || !topScroller || !topSpacer) {
      return;
    }

    let syncingFromMain = false;
    let syncingFromTop = false;

    const syncWidth = () => {
      topSpacer.style.width = `${mainScroller.scrollWidth}px`;
      topScroller.scrollLeft = mainScroller.scrollLeft;
    };

    const handleMainScroll = () => {
      if (syncingFromTop) {
        return;
      }

      syncingFromMain = true;
      topScroller.scrollLeft = mainScroller.scrollLeft;
      syncingFromMain = false;
    };

    const handleTopScroll = () => {
      if (syncingFromMain) {
        return;
      }

      syncingFromTop = true;
      mainScroller.scrollLeft = topScroller.scrollLeft;
      syncingFromTop = false;
    };

    syncWidth();
    mainScroller.addEventListener("scroll", handleMainScroll);
    topScroller.addEventListener("scroll", handleTopScroll);
    window.addEventListener("resize", syncWidth);

    let resizeObserver = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(syncWidth);
      resizeObserver.observe(mainScroller);

      if (mainScroller.firstElementChild) {
        resizeObserver.observe(mainScroller.firstElementChild);
      }
    }

    return () => {
      mainScroller.removeEventListener("scroll", handleMainScroll);
      topScroller.removeEventListener("scroll", handleTopScroll);
      window.removeEventListener("resize", syncWidth);
      resizeObserver?.disconnect();
    };
  }, [cashflowModel.dates.length, cashflowModel.rows.length, displayedTab]);

  useEffect(() => {
    setCashflowModelCache({
      daily: cashflowBaseModel,
      weekly: weeklyCashflowModel,
      monthly: null,
    });

    if (typeof window === "undefined") {
      setCashflowModelCache({
        daily: cashflowBaseModel,
        weekly: weeklyCashflowModel,
        monthly: buildCashflowResolutionModel(cashflowBaseModel, "monthly"),
      });
      return;
    }

    let cancelled = false;
    const warmMonthlyModel = () => {
      if (cancelled) return;

      setCashflowModelCache({
        daily: cashflowBaseModel,
        weekly: weeklyCashflowModel,
        monthly: buildCashflowResolutionModel(cashflowBaseModel, "monthly"),
      });
    };
    const timeoutId = window.setTimeout(warmMonthlyModel, 160);
    const idleId =
      "requestIdleCallback" in window ? window.requestIdleCallback(warmMonthlyModel, { timeout: 1000 }) : null;

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);

      if (idleId !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [cashflowBaseModel, weeklyCashflowModel]);

  useEffect(() => {
    if (!scheduleModalIncome) {
      if (scheduleModalIncomeId) {
        setScheduleModalIncomeId("");
      }
      setScheduleOccurrenceDate("");
      setScheduleAdjustedDate("");
      return;
    }

    const hasSelectedOccurrence =
      scheduleOccurrenceOptions.some((item) => item.originalDate === scheduleOccurrenceDate) ||
      scheduleOverrideRecords.some((item) => item.originalDate === scheduleOccurrenceDate);

    if (hasSelectedOccurrence) {
      return;
    }

    const nextOccurrence =
      scheduleOccurrenceOptions.find((item) => item.date >= todayKey || item.originalDate >= todayKey) ??
      scheduleOccurrenceOptions[0] ??
      scheduleOverrideRecords[0] ??
      null;

    setScheduleOccurrenceDate(nextOccurrence?.originalDate ?? "");
    setScheduleAdjustedDate(nextOccurrence?.adjustedDate || nextOccurrence?.date || nextOccurrence?.originalDate || "");
  }, [scheduleModalIncome, scheduleModalIncomeId, scheduleOccurrenceDate, scheduleOccurrenceOptions, scheduleOverrideRecords, todayKey]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return undefined;
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthState("loading");

    try {
      const auth = getFirebaseAuth();
      await signInWithEmailAndPassword(auth, credentials.email.trim(), credentials.password);
    } catch (firebaseError) {
      setAuthState("anonymous");
      setAuthError(firebaseError.message);
    }
  };

  const handleLogout = async () => {
    try {
      const auth = getFirebaseAuth();
      await signOut(auth);
    } catch (firebaseError) {
      setAuthError(firebaseError.message);
    }
  };

  const saveExpenseToDraft = (event) => {
    event.preventDefault();
    const nextExpense = {
      ...expenseForm,
      name: sanitizeFirebaseCompatibleText(expenseForm.name),
    };
    const error = validateExpense(nextExpense);

    if (error) {
      setDataError(error);
      return;
    }

    const expenseId = editingExpenseId || localId("expense");

    setDraft((current) => ({
      ...current,
      expenses: {
        ...current.expenses,
        [expenseId]: {
          name: nextExpense.name,
          amount: Number(nextExpense.amount),
          currency: nextExpense.currency,
          category: nextExpense.category,
          frequency: nextExpense.frequency,
          movementDate: nextExpense.movementDate,
          endDate: nextExpense.isRecurringIndefinite ? "" : nextExpense.endDate,
          isRecurringIndefinite: Boolean(nextExpense.isRecurringIndefinite),
          importSource: current.expenses?.[expenseId]?.importSource ?? null,
          createdAt: current.expenses?.[expenseId]?.createdAt ?? Date.now(),
        },
      },
    }));

    setExpenseForm(defaultExpenseForm());
    setEditingExpenseId("");
    setSaveState("idle");
    setDataError("");
    setSuccessMessage("");
  };

  const saveBudgetToDraft = (event) => {
    event.preventDefault();
    const budgetId = editingBudgetId || localId("budget");
    const nextBudget = {
      name: sanitizeFirebaseCompatibleText(budgetForm.name),
      amount: Number(budgetForm.amount),
      currency: budgetForm.currency,
      category: normalizeExpenseCategory(budgetForm.linkedCategories?.[0]),
      frequency: budgetForm.frequency,
      startDate: budgetForm.startDate,
      endDate: budgetForm.isRecurringIndefinite ? "" : budgetForm.endDate,
      isRecurringIndefinite: Boolean(budgetForm.isRecurringIndefinite),
      linkedCategories: sortLabelsAlphabetically([...new Set((budgetForm.linkedCategories ?? []).map(normalizeExpenseCategory))]),
      createdAt: draft.budgets?.[budgetId]?.createdAt ?? Date.now(),
    };
    const error = validateBudget(nextBudget);

    if (error) {
      setDataError(error);
      return;
    }

    const nextBudgets = {
      ...(draft.budgets ?? {}),
      [budgetId]: nextBudget,
    };
    const collectionError = validateBudgetCollection(nextBudgets);

    if (collectionError) {
      setDataError(collectionError);
      return;
    }

    setDraft((current) => ({
      ...current,
      budgets: nextBudgets,
    }));

    setBudgetForm(defaultBudgetForm());
    setEditingBudgetId("");
    setSaveState("idle");
    setDataError("");
    setSuccessMessage("");
  };

  const saveIncomeToDraft = (event) => {
    event.preventDefault();
    const nextIncome = {
      ...incomeForm,
      name: sanitizeFirebaseCompatibleText(incomeForm.name),
    };
    const error = validateIncome(nextIncome);

    if (error) {
      setDataError(error);
      return;
    }

    const incomeId = editingIncomeId || localId("income");

    setDraft((current) => ({
      ...current,
      incomes: {
        ...current.incomes,
        [incomeId]: {
          name: nextIncome.name,
          amount: Number(nextIncome.amount),
          currency: nextIncome.currency,
          frequency: nextIncome.frequency,
          startDate: nextIncome.startDate,
          endDate: nextIncome.isRecurringIndefinite ? "" : nextIncome.endDate,
          isRecurringIndefinite: Boolean(nextIncome.isRecurringIndefinite),
          isReimbursement: Boolean(nextIncome.isReimbursement),
          reimbursementCategory: nextIncome.isReimbursement ? nextIncome.reimbursementCategory : "",
          scheduleOverrides: current.incomes?.[incomeId]?.scheduleOverrides ?? {},
          createdAt: current.incomes?.[incomeId]?.createdAt ?? Date.now(),
        },
      },
    }));

    setIncomeForm(defaultIncomeForm());
    setEditingIncomeId("");
    setSaveState("idle");
    setDataError("");
    setSuccessMessage("");
  };

  const saveAdjustmentToDraft = (event) => {
    event.preventDefault();
    const error = validateAdjustment(adjustmentForm);

    if (error) {
      setDataError(error);
      return;
    }

    const adjustmentId = editingAdjustmentId || localId("adjustment");

    setDraft((current) => ({
      ...current,
      adjustments: {
        ...(current.adjustments ?? {}),
        [adjustmentId]: {
          date: adjustmentForm.date,
          amount: Number(adjustmentForm.amount),
          createdAt: current.adjustments?.[adjustmentId]?.createdAt ?? Date.now(),
        },
      },
    }));

    setAdjustmentForm(defaultAdjustmentForm());
    setEditingAdjustmentId("");
    setSaveState("idle");
    setDataError("");
    setSuccessMessage("");
  };

  const editExpense = (expenseId) => {
    const expense = draft.expenses[expenseId];
    if (!expense) return;

    setExpenseForm({
      name: expense.name ?? expense.merchantName ?? expense.detail ?? "",
      amount: String(expense.amount ?? ""),
      currency: expense.currency ?? "USD",
      category: normalizeExpenseCategory(expense.category),
      frequency: expense.frequency ?? "Unico",
      movementDate: expense.movementDate ?? expense.date ?? localDate(),
      endDate: expense.endDate ?? "",
      isRecurringIndefinite: Boolean(expense.isRecurringIndefinite),
    });
    setEditingExpenseId(expenseId);
    setActiveTab("expenses");
  };

  const editBudget = (budgetId) => {
    const budget = draft.budgets?.[budgetId];
    if (!budget) return;

    setBudgetForm({
      name: budget.name ?? "",
      amount: String(budget.amount ?? ""),
      currency: budget.currency ?? "USD",
      frequency: budget.frequency ?? "Mensual",
      startDate: budget.startDate ?? localDate(),
      endDate: budget.endDate ?? "",
      isRecurringIndefinite: Boolean(budget.isRecurringIndefinite),
      linkedCategories: getBudgetCategories(budget),
    });
    setEditingBudgetId(budgetId);
    setActiveTab("budgets");
  };

  const editIncome = (incomeId) => {
    const income = draft.incomes[incomeId];
    if (!income) return;

    setIncomeForm({
      name: income.name ?? "",
      amount: String(income.amount ?? ""),
      currency: income.currency ?? "USD",
      frequency: income.frequency ?? "Mensual",
      startDate: income.startDate ?? localDate(),
      endDate: income.endDate ?? "",
      isRecurringIndefinite: Boolean(income.isRecurringIndefinite),
      isReimbursement: Boolean(income.isReimbursement),
      reimbursementCategory: income.reimbursementCategory ?? "",
    });
    setEditingIncomeId(incomeId);
    setActiveTab("incomes");
  };

  const openIncomeScheduleModal = (incomeId) => {
    if (!draft.incomes?.[incomeId]) {
      return;
    }

    setScheduleModalIncomeId(incomeId);
    setScheduleOccurrenceDate("");
    setScheduleAdjustedDate("");
    setActiveTab("incomes");
  };

  const closeIncomeScheduleModal = () => {
    setScheduleModalIncomeId("");
    setScheduleOccurrenceDate("");
    setScheduleAdjustedDate("");
  };

  const resetExpenseImportWizard = () => {
    setExpenseImportFileName("");
    setExpenseImportSummary(null);
    setExpenseImportRows([]);
    setExpenseImportError("");
  };

  const openExpenseImportModal = () => {
    setExpenseImportOpened(true);
    setExpenseImportError("");
    setActiveTab("expenses");
  };

  const closeExpenseImportModal = () => {
    setExpenseImportOpened(false);
  };

  const loadExpensesFromJsonFile = async (file) => {
    setExpenseImportError("");
    setSuccessMessage("");

    try {
      const rawText = await file.text();
      const parsedImport = parseSchwabPostedExpenseTransactions(rawText);
      const nextRows = buildExpenseImportRows({
        existingSuggestions: expenseCategorySuggestions,
        existingExpenses: expenseEntries,
        transactions: parsedImport.transactions,
      });

      if (!nextRows.length) {
        throw new Error("El archivo no trae PostedTransactions con retiros definitivos para importar como gasto.");
      }

      setExpenseImportFileName(file.name);
      setExpenseImportSummary({
        fromDate: parsedImport.fromDate,
        toDate: parsedImport.toDate,
        transactionCount: nextRows.length,
      });
      setExpenseImportRows(nextRows);
      setExpenseImportOpened(true);
      setDataError("");
    } catch (error) {
      resetExpenseImportWizard();
      setExpenseImportFileName(file?.name ?? "");
      setExpenseImportError(error?.message ?? "No se pudo procesar el JSON.");
      setExpenseImportOpened(true);
    }
  };

  const updateExpenseImportCategory = (rowId, category) => {
    setExpenseImportRows((currentRows) => currentRows.map((row) => (row.id === rowId ? { ...row, category } : row)));
  };

  const importExpenseRowsToDraft = () => {
    const rowsToCreate = expenseImportRows.filter(
      (row) => !row.isDuplicate && expenseCategories.includes(String(row.category ?? "")),
    );
    const rowsToUpdate = expenseImportRows.filter(
      (row) =>
        row.isDuplicate &&
        row.matchedExpenseId &&
        expenseCategories.includes(String(row.category ?? "")) &&
        String(row.category ?? "") !== String(row.existingCategory ?? ""),
    );

    if (!rowsToCreate.length && !rowsToUpdate.length) {
      setExpenseImportError("No hay cambios listos para aplicar. Asigna categoria a filas nuevas o ajusta una categoria ya importada.");
      return;
    }

    const importStartedAt = Date.now();

    setDraft((current) => {
      const nextExpenses = { ...(current.expenses ?? {}) };

      rowsToUpdate.forEach((row) => {
        const currentExpense = nextExpenses[row.matchedExpenseId];

        if (!currentExpense) {
          return;
        }

        nextExpenses[row.matchedExpenseId] = {
          ...currentExpense,
          category: row.category,
        };
      });

      rowsToCreate.forEach((row, index) => {
        const expenseId = localId("expense");

        nextExpenses[expenseId] = {
          name: row.name,
          amount: row.amount,
          currency: row.currency,
          category: row.category,
          frequency: "Unico",
          movementDate: row.movementDate,
          endDate: "",
          isRecurringIndefinite: false,
          importSource: {
            provider: "schwab-json",
            fingerprint: row.sourceFingerprint,
            matchKey: row.sourceMatchKey,
            occurrenceIndex: row.occurrenceIndex,
            sourceType: row.type,
            sourceDate: row.movementDate,
            importedAt: importStartedAt + index,
          },
          createdAt: importStartedAt + index,
        };
      });

      return {
        ...current,
        expenses: nextExpenses,
      };
    });

    setExpenseImportOpened(false);
    resetExpenseImportWizard();
    setSaveState("idle");
    setDataError("");
    setSuccessMessage(
      buildExpenseImportSuccessMessage(rowsToCreate.length, rowsToUpdate.length),
    );
  };

  const selectIncomeScheduleOccurrence = (occurrenceDate) => {
    const nextOccurrence =
      scheduleOccurrenceOptions.find((item) => item.originalDate === occurrenceDate) ??
      scheduleOverrideRecords.find((item) => item.originalDate === occurrenceDate) ??
      null;

    setScheduleOccurrenceDate(occurrenceDate);
    setScheduleAdjustedDate(nextOccurrence?.adjustedDate || nextOccurrence?.date || nextOccurrence?.originalDate || "");
  };

  const saveIncomeScheduleOverride = () => {
    if (!scheduleModalIncomeId || !scheduleOccurrenceDate) {
      setDataError("Selecciona el ingreso y el pago que quieres ajustar.");
      return;
    }

    if (!scheduleAdjustedDate) {
      setDataError("Selecciona la nueva fecha para el pago.");
      return;
    }

    if (scheduleAdjustedDate === scheduleOccurrenceDate) {
      setDataError("La nueva fecha debe ser distinta a la fecha programada. Si quieres volver al calendario normal, desactiva el ajuste.");
      return;
    }

    setDraft((current) => {
      const currentIncome = current.incomes?.[scheduleModalIncomeId];
      if (!currentIncome) {
        return current;
      }

      return {
        ...current,
        incomes: {
          ...current.incomes,
          [scheduleModalIncomeId]: {
            ...currentIncome,
            scheduleOverrides: {
              ...(currentIncome.scheduleOverrides ?? {}),
              [scheduleOccurrenceDate]: {
                adjustedDate: scheduleAdjustedDate,
                isActive: true,
                updatedAt: Date.now(),
              },
            },
          },
        },
      };
    });

    setSaveState("idle");
    setDataError("");
    setSuccessMessage("Se guardo el ajuste puntual del calendario de pago en la proyeccion activa.");
  };

  const toggleIncomeScheduleOverride = (incomeId, occurrenceDate) => {
    setDraft((current) => {
      const currentIncome = current.incomes?.[incomeId];
      const currentOverride = currentIncome?.scheduleOverrides?.[occurrenceDate];

      if (!currentIncome || !currentOverride) {
        return current;
      }

      return {
        ...current,
        incomes: {
          ...current.incomes,
          [incomeId]: {
            ...currentIncome,
            scheduleOverrides: {
              ...(currentIncome.scheduleOverrides ?? {}),
              [occurrenceDate]: {
                ...currentOverride,
                isActive: !currentOverride.isActive,
                updatedAt: Date.now(),
              },
            },
          },
        },
      };
    });

    setSaveState("idle");
    setDataError("");
    setSuccessMessage("Se actualizo el estado del ajuste puntual en la proyeccion activa.");
  };

  const editAdjustment = (adjustmentId) => {
    const adjustment = draft.adjustments?.[adjustmentId];
    if (!adjustment) return;

    setAdjustmentForm({
      date: adjustment.date ?? localDate(),
      amount: String(adjustment.amount ?? ""),
    });
    setEditingAdjustmentId(adjustmentId);
    setActiveTab("reconciliation");
  };

  const deleteExpense = (expenseId) => {
    setDraft((current) => {
      const nextExpenses = { ...current.expenses };
      delete nextExpenses[expenseId];
      return { ...current, expenses: nextExpenses };
    });
    setSaveState("idle");
    setSuccessMessage("");
  };

  const deleteBudget = (budgetId) => {
    setDraft((current) => {
      const nextBudgets = { ...(current.budgets ?? {}) };
      delete nextBudgets[budgetId];
      return { ...current, budgets: nextBudgets };
    });
    setSaveState("idle");
    setSuccessMessage("");
  };

  const deleteIncome = (incomeId) => {
    setDraft((current) => {
      const nextIncomes = { ...current.incomes };
      delete nextIncomes[incomeId];
      return { ...current, incomes: nextIncomes };
    });
    setSaveState("idle");
    setSuccessMessage("");
  };

  const deleteAdjustment = (adjustmentId) => {
    setDraft((current) => {
      const nextAdjustments = { ...(current.adjustments ?? {}) };
      delete nextAdjustments[adjustmentId];
      return { ...current, adjustments: nextAdjustments };
    });
    setSaveState("idle");
    setSuccessMessage("");
  };

  const showCashflowTooltip = (event, row, date) => {
    const details = row.details?.[date.key] ?? buildEmptyCashflowDetails(row.label, date.key);
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.min(rect.left, Math.max(16, window.innerWidth - 320));
    const top = Math.min(rect.bottom + 10, window.innerHeight - 180);

    setCashflowTooltip({
      date: date.key,
      dateLabel: date.fullLabel ?? formatDateLabel(date.key),
      left,
      top,
      title: row.label,
      lines: details.lines,
      total: details.total,
    });
  };

  const saveSettingsToDraft = (event) => {
    event.preventDefault();
    const nextSettings = {
      startDate: String(settingsForm.startDate ?? "").trim(),
      endDate: String(settingsForm.endDate ?? "").trim(),
      chartStartMonth: String(settingsForm.chartStartMonth ?? "").trim(),
      chartEndMonth: String(settingsForm.chartEndMonth ?? "").trim(),
    };
    const error = validateAnalysisSettings(nextSettings);

    if (error) {
      setDataError(error);
      return;
    }

    setDraft((current) => ({
      ...current,
      analysisSettings: nextSettings,
    }));

    setSaveState("idle");
    setDataError("");
    setSuccessMessage("");
  };

  const handleGlobalSave = async () => {
    await saveVersion("cambios", draft, "Todos los cambios se guardaron como nueva entrada.");
  };

  const handleTabChange = (value) => {
    startTransition(() => {
      setActiveTab(value ?? "summary");
    });
  };

  const discardChanges = () => {
    const nextWorkspace = normalizeWorkspace(selectedVersion?.payload);
    setDraft(nextWorkspace);
    setExpenseForm(defaultExpenseForm());
    setBudgetForm(defaultBudgetForm());
    setIncomeForm(defaultIncomeForm());
    setAdjustmentForm(defaultAdjustmentForm());
    setSettingsForm(nextWorkspace.analysisSettings ?? defaultAnalysisSettings());
    setEditingExpenseId("");
    setEditingBudgetId("");
    setEditingIncomeId("");
    setEditingAdjustmentId("");
    setScheduleModalIncomeId("");
    setScheduleOccurrenceDate("");
    setScheduleAdjustedDate("");
    setExpenseImportOpened(false);
    setExpenseImportFileName("");
    setExpenseImportSummary(null);
    setExpenseImportRows([]);
    setExpenseImportError("");
    setSaveState("idle");
    setDataError("");
    setSuccessMessage("");
  };

  const saveVersion = async (sectionLabel, workspaceOverride = draft, successText = "") => {
    const sanitized = sanitizeWorkspace(workspaceOverride);
    const error = validateWorkspace(sanitized);

    if (error || !user?.uid) {
      setDataError(error || "No hay sesion activa.");
      return;
    }

    setSaveState("saving");
    setDataError("");
    setSuccessMessage("");

    try {
      const database = getFirebaseDatabase();
      const snapshotDate = localDate();
      const versionsRef = ref(database, `users/${user.uid}/cashflowSnapshots/${snapshotDate}/versions`);
      const newVersionRef = push(versionsRef);
      const versionPayload = createVersionPayload(snapshotDate, sanitized, user, selectedVersion);

      await set(newVersionRef, versionPayload);

      setSnapshotTree((current) => ({
        ...current,
        [snapshotDate]: {
          ...(current[snapshotDate] ?? {}),
          versions: {
            ...(current[snapshotDate]?.versions ?? {}),
            [newVersionRef.key]: versionPayload,
          },
        },
      }));

      setSelectedVersionKey(buildKey(snapshotDate, newVersionRef.key));
      setLoadedVersionKey("");
      setSaveState("saved");
      setSuccessMessage(successText || `La lista de ${sectionLabel} se guardo como nueva entrada.`);
    } catch (firebaseError) {
      setSaveState("error");
      setDataError(firebaseError.message);
    }
  };

  if (authState !== "authenticated") {
    return (
      <main className="login-shell">
        <section className="login-card">
          <form className="login-form" onSubmit={handleLogin}>
            <h1>Acceso</h1>

            <label>
              Usuario
              <input
                autoComplete="email"
                name="email"
                onChange={(event) => setCredentials((current) => ({ ...current, email: event.target.value }))}
                type="email"
                value={credentials.email}
              />
            </label>

            <label>
              Contrasena
              <input
                autoComplete="current-password"
                name="password"
                onChange={(event) => setCredentials((current) => ({ ...current, password: event.target.value }))}
                type="password"
                value={credentials.password}
              />
            </label>

            <button className="primary-button" disabled={authState === "loading"} type="submit">
              {authState === "loading" ? "Entrando..." : "Entrar"}
            </button>

            {authError ? <p className="error-text">{authError}</p> : null}
          </form>
        </section>
      </main>
    );
  }

  if (isInitializing) {
    return (
      <main className="login-shell">
        <section className="login-card loading-card">
          <h1>Preparando base de datos</h1>
          <p className="muted-text">Creando la estructura minima para la nueva interfaz.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="topbar topbar-hero">
        <div className="topbar-copy">
          <p className="eyebrow">Web App Flujo De Caja</p>
          <h1>Cash Flow Pulento</h1>
          <div className="topbar-meta">
            <span className="hero-chip">{draftRecordCount} registros proyectados</span>
          </div>
        </div>

        <div className="topbar-side">
          <div className="topbar-panel topbar-history">
            <label className="history-control">
              <span className="history-label">Entradas finales recientes</span>
              <select onChange={(event) => setSelectedVersionKey(event.target.value)} value={selectedVersionKey}>
                {recentVersions.map((version) => (
                  <option key={version.key} value={version.key}>
                    {labelVersion(version)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="topbar-panel topbar-actions">
            <span className="user-chip">{user?.email}</span>

            <button
              className={hasUnsavedChanges ? "status-chip pending action-chip action-chip-primary" : "status-chip action-chip action-chip-primary"}
              disabled={!hasUnsavedChanges || saveState === "saving"}
              onClick={handleGlobalSave}
              type="button"
            >
              {saveState === "saving" ? "Guardando entrada final..." : hasUnsavedChanges ? "Guardar entrada final" : "Sin cambios pendientes"}
            </button>

            <button className="secondary-button action-chip action-chip-secondary" onClick={handleLogout} type="button">
              Cerrar sesion
            </button>
          </div>
        </div>
      </section>

      <section className="tabs-card">
        <MantineTabs
          classNames={{
            list: "mantine-tabs-bar",
            root: "mantine-tabs-root",
            tab: "mantine-tab-button",
          }}
          keepMounted={false}
          onChange={handleTabChange}
          value={activeTab}
          variant="outline"
        >
          <MantineTabs.List aria-label="Pestanas principales">
            {tabs.map((tab) => (
              <MantineTabs.Tab key={tab.id} value={tab.id}>
                {tab.label}
              </MantineTabs.Tab>
            ))}
          </MantineTabs.List>
        </MantineTabs>

        <section className="save-feedback-shell">
          {false ? <Paper className="save-bar" p="md" radius="lg" shadow="sm" withBorder>
            <div className="save-bar-copy">
              <p className="eyebrow">Guardado General</p>
              <h2>Proyeccion activa</h2>
              <Text c="dimmed" size="sm">
                Todas las pestanas editan la misma proyeccion. Guarda una sola vez cuando quieras dejar una nueva entrada final.
              </Text>
              <div className="save-bar-meta">
                <span className="save-meta-chip">Version cargada: {selectedVersion ? labelVersion(selectedVersion) : "Sin historial"}</span>
                <span className="save-meta-chip">Bloques: {budgets.length}</span>
                <span className="save-meta-chip">Estado: {hasUnsavedChanges ? "Pendiente" : "Sin cambios"}</span>
              </div>
            </div>

            <Group className="save-bar-actions" gap="sm">
              <MantineBadge color={hasUnsavedChanges ? "yellow" : "teal"} radius="sm" size="lg" variant="light">
                {hasUnsavedChanges ? "Cambios pendientes" : "Todo guardado"}
              </MantineBadge>
              {isTabTransitionPending ? <Loader color="blue" size="sm" /> : null}
              <MantineButton disabled={!hasUnsavedChanges || saveState === "saving"} onClick={discardChanges} variant="default">
                Descartar
              </MantineButton>
              <MantineButton disabled={!hasUnsavedChanges} loading={saveState === "saving"} onClick={handleGlobalSave}>
                Guardar entrada final
              </MantineButton>
            </Group>
          </Paper> : null}
          {successMessage ? <p className="success-text">{successMessage}</p> : null}
          {dataError ? <p className="error-text">{dataError}</p> : null}
        </section>

        <div className="tab-panel">
          {displayedTab === "summary" ? (
            <section className="summary-panel">
              <div className="summary-grid">
                <article className="summary-card summary-card-balance">
                  <span>Saldo al dia de hoy</span>
                  <strong>{money(summaryIndicators.todayBalance, "USD")}</strong>
                  <p className="summary-card-detail">Cierre estimado al {formatDateLabel(todayKey)}.</p>
                </article>
                <article className="summary-card summary-card-positive">
                  <span>Gastos fijos de {summaryIndicators.currentMonthLabel}</span>
                  <strong>{money(summaryIndicators.fixedExpensesMonthTotal, "USD")}</strong>
                  <p className="summary-card-detail">Incluye todo lo programado dentro del mes actual.</p>
                </article>
                <article className="summary-card summary-card-warning">
                  <span>Gastos variables de {summaryIndicators.currentMonthLabel} al dia</span>
                  <strong>{money(summaryIndicators.variableExpensesMonthToDate, "USD")}</strong>
                  <p className="summary-card-detail">Acumulado hasta la fecha de consulta.</p>
                </article>
                <article className="summary-card summary-card-soft">
                  <span>Ultimo ingreso</span>
                  <strong>{summaryIndicators.lastIncome ? money(summaryIndicators.lastIncome.totalAmount, "USD") : "Sin datos"}</strong>
                  <p className="summary-card-detail">
                    {summaryIndicators.lastIncome
                      ? `${summaryIndicators.lastIncome.label} · ${formatDateLabel(summaryIndicators.lastIncome.date)}`
                      : "No hay ingresos registrados hasta hoy."}
                  </p>
                </article>
                <article className="summary-card summary-card-neutral">
                  <span>Proximo ingreso</span>
                  <strong>{summaryIndicators.nextIncome ? money(summaryIndicators.nextIncome.totalAmount, "USD") : "Sin fecha"}</strong>
                  <p className="summary-card-detail">
                    {summaryIndicators.nextIncome
                      ? `${summaryIndicators.nextIncome.label} · ${formatDateLabel(summaryIndicators.nextIncome.date)}`
                      : "No hay ingresos futuros programados."}
                  </p>
                </article>
                <article className="summary-card summary-card-emphasis">
                  <span>Dias para el proximo ingreso</span>
                  <strong>{summaryIndicators.nextIncome ? formatDaysUntilIncome(summaryIndicators.daysUntilNextIncome) : "Sin fecha"}</strong>
                  <p className="summary-card-detail">
                    {summaryIndicators.nextIncome
                      ? `Contados desde hoy hasta ${formatDateLabel(summaryIndicators.nextIncome.date)}.`
                      : "Agrega un ingreso para proyectar esta metrica."}
                  </p>
                </article>
              </div>

              <div className="summary-detail-grid">
                <section className="panel-card blank-panel summary-note">
                  <div className="panel-heading">
                    <h2>Proximos gastos</h2>
                    <p>
                      Desde {formatDateLabel(summaryIndicators.upcomingExpenseWindowStart)} hasta{" "}
                      {formatDateLabel(summaryIndicators.upcomingExpenseWindowEnd)}.
                    </p>
                  </div>

                  {summaryIndicators.upcomingExpenses.length ? (
                    <div className="summary-list">
                      {summaryIndicators.upcomingExpenses.map((expense) => (
                        <article className="summary-list-item" key={expense.key}>
                          <div className="summary-list-copy">
                            <strong>{expense.name}</strong>
                            <span>{expense.category}</span>
                          </div>
                          <div className="summary-list-meta">
                            <span>{formatDateLabel(expense.date)}</span>
                            <strong>{money(expense.amount, expense.currency)}</strong>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-text">No hay gastos programados en las proximas dos semanas.</p>
                  )}
                </section>

                <section className="panel-card blank-panel summary-note">
                  <div className="panel-heading">
                    <h2>Alertas de saldo</h2>
                    <p>Primera fecha proyectada en que el saldo queda bajo cada umbral.</p>
                  </div>

                  <div className="summary-threshold-grid">
                    {summaryIndicators.thresholdAlerts.map((alert) => (
                      <article className="summary-threshold-item" key={alert.key}>
                        <span className="summary-meta-label">{alert.label}</span>
                        <strong>
                          {alert.state === "future" ? formatDateLabel(alert.date) : alert.state === "current" ? "Hoy" : "No proyectado"}
                        </strong>
                        <p className="summary-card-detail">
                          {alert.state === "none"
                            ? `Sin caidas hasta ${formatDateLabel(summaryIndicators.projectionEndKey)}.`
                            : `Saldo estimado: ${money(alert.balance, "USD")}`}
                        </p>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            </section>
          ) : null}

          {displayedTab === "expenses" ? (
            <section className="workspace-stack expenses-stack">
              <div className="expense-tab-header">
                <div>
                  <h2>Gestion de Gastos</h2>
                  <p className="section-copy">Registra aqui lo que ya paso. Para proyectar gastos repetitivos, crea bloques en Presupuesto.</p>
                </div>
                <MantineButton onClick={openExpenseImportModal} variant="light">
                  Importar desde JSON
                </MantineButton>
              </div>

              <form className="panel-card panel-frame entry-form expense-entry-form" onSubmit={saveExpenseToDraft}>
                <div className="expense-form-title">
                  <p className="form-kicker">Registro manual</p>
                  <h3>{editingExpenseId ? "Modificar Gasto" : "Registrar Nuevo Gasto"}</h3>
                </div>

                <div className="expense-form-grid">
                  <label className="expense-field expense-field-full">
                    Nombre:
                    <input name="name" onChange={(e) => setExpenseForm((c) => ({ ...c, name: e.target.value }))} value={expenseForm.name} />
                    {expenseNameWarning ? (
                      <span className="field-warning">
                        Firebase no acepta {expenseNameWarning.charactersLabel}. Se guardara como: {expenseNameWarning.sanitizedValue || "sin texto valido"}.
                      </span>
                    ) : null}
                  </label>
                  <label className="expense-field">
                    Monto:
                    <input inputMode="decimal" name="amount" onChange={(e) => setExpenseForm((c) => ({ ...c, amount: e.target.value }))} value={expenseForm.amount} />
                  </label>
                  <label className="expense-field">
                    Moneda:
                    <select name="currency" onChange={(e) => setExpenseForm((c) => ({ ...c, currency: e.target.value }))} value={expenseForm.currency}>
                      {expenseCurrencies.map((currencyOption) => (
                        <option key={currencyOption.value} value={currencyOption.value}>
                          {currencyOption.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="expense-field">
                    Categoria:
                    <select name="category" onChange={(e) => setExpenseForm((c) => ({ ...c, category: e.target.value }))} value={expenseForm.category}>
                      <option value="" disabled>
                        -- Selecciona Categoria --
                      </option>
                      {expenseCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="expense-field">
                    Fecha Movimiento:
                    <input
                      name="movementDate"
                      onChange={(e) => setExpenseForm((c) => ({ ...c, movementDate: e.target.value }))}
                      type="date"
                      value={expenseForm.movementDate}
                    />
                  </label>
                </div>

                <div className="expense-advanced-panel">
                  <p className="expense-advanced-copy">
                    Si quieres que este gasto se repita automaticamente, configuralo aqui. Para planificar tendencias por categoria, usa Presupuesto.
                  </p>

                  <div className="expense-legacy-box">
                    <div className="expense-form-grid expense-advanced-grid">
                      <label className="expense-field">
                        Frecuencia:
                        <select name="frequency" onChange={(e) => setExpenseForm((c) => ({ ...c, frequency: e.target.value }))} value={expenseForm.frequency}>
                          {expenseFrequencies.map((frequency) => (
                            <option key={frequency} value={frequency}>
                              {frequency}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="expense-field">
                        Fecha Fin (si aplica):
                        <input
                          disabled={expenseForm.isRecurringIndefinite}
                          name="endDate"
                          onChange={(e) => setExpenseForm((c) => ({ ...c, endDate: e.target.value }))}
                          type="date"
                          value={expenseForm.endDate}
                        />
                      </label>
                    </div>

                    <label className="expense-checkbox">
                      <input
                        checked={expenseForm.isRecurringIndefinite}
                        name="isRecurringIndefinite"
                        onChange={(e) => setExpenseForm((c) => ({ ...c, isRecurringIndefinite: e.target.checked, endDate: e.target.checked ? "" : c.endDate }))}
                        type="checkbox"
                      />
                      Gasto recurrente sin fin
                    </label>
                  </div>
                </div>

                <div className="button-row">
                  <button className="primary-button" type="submit">
                    {editingExpenseId ? "Actualizar gasto" : "Anadir gasto"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setExpenseForm(defaultExpenseForm());
                      setEditingExpenseId("");
                    }}
                    type="button"
                  >
                    Limpiar
                  </button>
                </div>

                <div className="save-hint-row">
                  <button className="secondary-button" onClick={discardChanges} type="button">
                    Descartar cambios
                  </button>
                  <p className="save-hint-copy">El guardado final se hace arriba, desde Guardar entrada final.</p>
                </div>

                {successMessage ? <p className="success-text">{successMessage}</p> : null}
                {dataError ? <p className="error-text">{dataError}</p> : null}
              </form>

              <section className="panel-card panel-frame panel-table">
                <div className="panel-heading">
                  <h2>Lista de gastos</h2>
                  <p>Las entradas quedan visibles como lista editable antes de guardarlas como nueva version. La recurrencia sigue disponible como modo legacy.</p>
                </div>

                {expenses.length ? (
                  <ExpensesTable
                    expenseSort={expenseSort}
                    expenses={expenses}
                    formatDateLabel={formatDateLabel}
                    formatMoneyLabel={money}
                    onDeleteExpense={deleteExpense}
                    onEditExpense={editExpense}
                    onSortChange={setExpenseSort}
                  />
                ) : (
                  <p className="muted-text">Todavia no hay gastos en la lista.</p>
                )}
              </section>

              <ExpenseImportModal
                categories={expenseCategories}
                error={expenseImportError}
                fileName={expenseImportFileName}
                formatDateLabel={formatDateLabel}
                onCategoryChange={updateExpenseImportCategory}
                onClose={closeExpenseImportModal}
                onConfirmImport={importExpenseRowsToDraft}
                onFileSelect={loadExpensesFromJsonFile}
                onReset={resetExpenseImportWizard}
                opened={expenseImportOpened}
                rows={expenseImportRows}
                summary={expenseImportSummary}
              />
            </section>
          ) : null}

          {displayedTab === "budgets" ? (
            <section className="workspace-stack budgets-stack">
              <div className="budget-tab-header">
                <h2>Presupuesto</h2>
                <p className="section-copy">Define bloques por categoria con fecha y frecuencia para comparar cada gasto real contra su presupuesto exacto.</p>
              </div>

              <form className="panel-card panel-frame entry-form budget-entry-form" onSubmit={saveBudgetToDraft}>
                <div className="budget-form-title">
                  <p className="form-kicker">Planeacion</p>
                  <h3>{editingBudgetId ? "Modificar Presupuesto" : "Crear Bloque de Presupuesto"}</h3>
                  <p className="budget-form-copy">
                    Mantener fecha y frecuencia ayuda a que la tabla y los graficos conserven la resolucion exacta de cada bloque.
                  </p>
                </div>

                <div className="budget-form-grid">
                  <label className="budget-field budget-field-full">
                    Nombre:
                    <input name="name" onChange={(e) => setBudgetForm((c) => ({ ...c, name: e.target.value }))} value={budgetForm.name} />
                    {budgetNameWarning ? (
                      <span className="field-warning">
                        Firebase no acepta {budgetNameWarning.charactersLabel}. Se guardara como: {budgetNameWarning.sanitizedValue || "sin texto valido"}.
                      </span>
                    ) : null}
                  </label>
                  <label className="budget-field">
                    Monto:
                    <input inputMode="decimal" name="amount" onChange={(e) => setBudgetForm((c) => ({ ...c, amount: e.target.value }))} value={budgetForm.amount} />
                  </label>
                  <label className="budget-field">
                    Moneda:
                    <select name="currency" onChange={(e) => setBudgetForm((c) => ({ ...c, currency: e.target.value }))} value={budgetForm.currency}>
                      {expenseCurrencies.map((currencyOption) => (
                        <option key={currencyOption.value} value={currencyOption.value}>
                          {currencyOption.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="budget-field">
                    Frecuencia:
                    <select name="frequency" onChange={(e) => setBudgetForm((c) => ({ ...c, frequency: e.target.value }))} value={budgetForm.frequency}>
                      {expenseFrequencies.map((frequency) => (
                        <option key={frequency} value={frequency}>
                          {frequency}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="budget-field">
                    Fecha Inicio:
                    <input name="startDate" onChange={(e) => setBudgetForm((c) => ({ ...c, startDate: e.target.value }))} type="date" value={budgetForm.startDate} />
                  </label>
                  <label className="budget-field">
                    Fecha Fin (si aplica):
                    <input
                      disabled={budgetForm.isRecurringIndefinite}
                      name="endDate"
                      onChange={(e) => setBudgetForm((c) => ({ ...c, endDate: e.target.value }))}
                      type="date"
                      value={budgetForm.endDate}
                    />
                  </label>
                </div>

                <label className="budget-checkbox">
                  <input
                    checked={budgetForm.isRecurringIndefinite}
                    name="isRecurringIndefinite"
                    onChange={(e) => setBudgetForm((c) => ({ ...c, isRecurringIndefinite: e.target.checked, endDate: e.target.checked ? "" : c.endDate }))}
                    type="checkbox"
                  />
                  Presupuesto recurrente sin fin
                </label>

                <section className="budget-category-picker">
                  <div className="budget-category-header">
                    <div>
                      <strong>Categorias asociadas</strong>
                      <p>Todo gasto real en estas categorias se comparara automaticamente contra este bloque.</p>
                    </div>
                    <span>{budgetForm.linkedCategories.length} seleccionadas</span>
                  </div>

                  <div className="budget-category-groups">
                    <div className="budget-category-group">
                      <h4>Gastos fijos</h4>
                      <div className="category-chip-grid">
                        {fixedExpenseCategories.map((category) => (
                          <button
                            className={budgetForm.linkedCategories.includes(category) ? "category-chip active" : "category-chip"}
                            key={`fixed-${category}`}
                            onClick={() => toggleBudgetCategory(category, setBudgetForm)}
                            type="button"
                          >
                            {category}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="budget-category-group">
                      <h4>Gastos variables</h4>
                      <div className="category-chip-grid">
                        {variableExpenseCategories.map((category) => (
                          <button
                            className={budgetForm.linkedCategories.includes(category) ? "category-chip active" : "category-chip"}
                            key={`variable-${category}`}
                            onClick={() => toggleBudgetCategory(category, setBudgetForm)}
                            type="button"
                          >
                            {category}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <div className="button-row">
                  <button className="primary-button" type="submit">
                    {editingBudgetId ? "Actualizar presupuesto" : "Anadir presupuesto"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setBudgetForm(defaultBudgetForm());
                      setEditingBudgetId("");
                    }}
                    type="button"
                  >
                    Limpiar
                  </button>
                </div>

                <div className="save-hint-row">
                  <button className="secondary-button" onClick={discardChanges} type="button">
                    Descartar cambios
                  </button>
                  <p className="save-hint-copy">El guardado final se hace arriba, desde Guardar entrada final.</p>
                </div>

                {successMessage ? <p className="success-text">{successMessage}</p> : null}
                {dataError ? <p className="error-text">{dataError}</p> : null}
              </form>

              <section className="panel-card panel-frame budget-list-panel">
                <div className="panel-heading">
                  <h2>Asignacion mensual por categoria</h2>
                  <p>Revisa cuanto ingreso del mes ya esta asignado a categorias y como se compara cada una contra el gasto real.</p>
                </div>

                <div className="budget-monthly-shell">
                  <div className="budget-monthly-toolbar">
                    <label className="history-control budget-month-control">
                      <span className="history-label">Mes a revisar</span>
                      <select
                        name="budgetOverviewMonth"
                        onChange={(event) => startTransition(() => setBudgetOverviewMonth(event.target.value))}
                        value={budgetMonthlyOverview.selectedMonthKey}
                      >
                        {budgetMonthlyOverview.monthOptions.map((month) => (
                          <option key={month.key} value={month.key}>
                            {month.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="budget-monthly-context">
                      <strong>{budgetMonthlyOverview.monthLabel}</strong>
                      <span>{budgetMonthlyOverview.rangeLabel}</span>
                    </div>
                  </div>

                  <p className="budget-monthly-note">
                    Se muestran solo categorias con movimientos reales en el mes seleccionado. Si un bloque cubre varias categorias,
                    el monto se reparte entre ellas en esta vista.
                  </p>

                  <div className="budget-monthly-summary">
                    <article className="summary-card summary-card-balance">
                      <span>Ingreso total del mes</span>
                      <strong>{money(budgetMonthlyOverview.summary.totalIncome, "USD")}</strong>
                      <p className="summary-card-detail">
                        Base usada para calcular los porcentajes presupuestados y reales del mes.
                      </p>
                    </article>

                    <article className="summary-card summary-card-soft">
                      <span>Presupuesto ya asociado</span>
                      <strong>{money(budgetMonthlyOverview.summary.associatedBudgetTotal, "USD")}</strong>
                      <p className="summary-card-detail">
                        {formatPercentLabel(budgetMonthlyOverview.summary.associatedBudgetShare)} del ingreso ya fue repartido entre categorias.
                      </p>
                    </article>

                    <article
                      className={
                        budgetMonthlyOverview.summary.unassignedAmount >= 0
                          ? "summary-card summary-card-positive"
                          : "summary-card summary-card-warning"
                      }
                    >
                      <span>{budgetMonthlyOverview.summary.unassignedAmount >= 0 ? "Falta por asociar" : "Sobreasignado"}</span>
                      <strong>{money(Math.abs(budgetMonthlyOverview.summary.unassignedAmount), "USD")}</strong>
                      <p className="summary-card-detail">
                        {budgetMonthlyOverview.summary.unassignedAmount >= 0
                          ? "Ingreso del mes que todavia no esta cubierto por categorias presupuestadas."
                          : "El presupuesto asociado a categorias supera los ingresos de este mes."}
                      </p>
                    </article>
                  </div>

                  {budgetMonthlyOverview.categories.length ? (
                    <div className="budget-monthly-category-grid">
                      {budgetMonthlyOverview.categories.map((category) => (
                        <article
                          className={
                            category.hasBudget
                              ? category.actualAmount > category.plannedAmount
                                ? "budget-monthly-category-card budget-monthly-category-card-warning"
                                : "budget-monthly-category-card"
                              : "budget-monthly-category-card budget-monthly-category-card-unassigned"
                          }
                          key={category.key}
                        >
                          <div className="budget-monthly-category-head">
                            <div>
                              <p className="budget-card-eyebrow">Categoria activa del mes</p>
                              <h3>{category.name}</h3>
                              <p className="budget-card-period">
                                {category.budgetNames.length
                                  ? summarizeOccurrenceGroupLabel(category.budgetNames.map((name) => ({ name })), "Bloque asociado")
                                  : "Sin bloque presupuestado en este mes"}
                              </p>
                            </div>
                            <MantineBadge
                              color={category.hasBudget ? (category.actualAmount > category.plannedAmount ? "orange" : "teal") : "gray"}
                              radius="sm"
                              size="lg"
                              variant="light"
                            >
                              {category.movementCount} mov.
                            </MantineBadge>
                          </div>

                          <div className="budget-monthly-metrics">
                            <div>
                              <span>Presupuesto asociado</span>
                              <strong>{money(category.plannedAmount, "USD")}</strong>
                            </div>
                            <div>
                              <span>Real del mes</span>
                              <strong>{money(category.actualAmount, "USD")}</strong>
                            </div>
                            <div>
                              <span>% del ingreso presupuestado</span>
                              <strong>{formatPercentLabel(category.plannedShare)}</strong>
                            </div>
                            <div>
                              <span>% del ingreso real</span>
                              <strong>{formatPercentLabel(category.actualShare)}</strong>
                            </div>
                          </div>

                          <p className="budget-monthly-category-copy">
                            {category.hasBudget
                              ? category.actualAmount > category.plannedAmount
                                ? `Va ${money(category.actualAmount - category.plannedAmount, "USD")} sobre lo asignado a esta categoria.`
                                : `Todavia quedan ${money(category.plannedAmount - category.actualAmount, "USD")} dentro de lo asociado a esta categoria.`
                              : "Esta categoria tuvo movimientos, pero aun no tiene presupuesto asociado dentro de este mes."}
                          </p>

                          <div className="budget-chip-row">
                            {category.budgetNames.length ? (
                              category.budgetNames.map((name) => (
                                <span className="budget-category-chip" key={`${category.key}-${name}`}>
                                  {name}
                                </span>
                              ))
                            ) : (
                              <span className="budget-category-chip">Sin bloque</span>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-text">No hay gastos ni reembolsos categorizados en este mes. Cuando existan movimientos, apareceran aqui sus porcentajes.</p>
                  )}

                  {budgetMonthlyOverview.monthlyBudgets.length ? (
                    <div className="budget-monthly-blocks">
                      <div className="panel-heading">
                        <h3>Bloques configurados para {budgetMonthlyOverview.monthLabel}</h3>
                        <p>Esta lista se mantiene para que sigas pudiendo modificar o quitar bloques desde la misma pestaña.</p>
                      </div>

                      <div className="budget-monthly-block-list">
                        {budgetMonthlyOverview.monthlyBudgets.map((budget) => (
                          <article className="budget-monthly-block-row" key={budget.id}>
                            <div className="budget-monthly-block-copy">
                              <strong>{budget.name || "Sin nombre"}</strong>
                              <span>
                                {money(budget.plannedAmount, budget.currency)} en {budget.periodCount}{" "}
                                {budget.periodCount === 1 ? "periodo" : "periodos"} de este mes
                              </span>
                              <p>{budget.scheduleLabel}</p>
                              <div className="budget-chip-row">
                                {getBudgetCategories(budget).map((category) => (
                                  <span className="budget-category-chip" key={`${budget.id}-${category}`}>
                                    {category}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="table-actions">
                              <MantineButton onClick={() => editBudget(budget.id)} size="xs" variant="default">
                                Modificar
                              </MantineButton>
                              <MantineButton color="red" onClick={() => deleteBudget(budget.id)} size="xs" variant="light">
                                Quitar
                              </MantineButton>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : budgets.length ? (
                    <p className="muted-text">No hay bloques que arranquen en este mes. Cambia el selector para revisar otro periodo.</p>
                  ) : (
                    <p className="muted-text">Todavia no hay bloques de presupuesto. Crea el primero para empezar a distribuir ingresos por categoria.</p>
                  )}
                </div>
              </section>
            </section>
          ) : null}

          {displayedTab === "incomes" ? (
            <section className="workspace-stack incomes-stack">
              <div className="income-tab-header">
                <h2>Gestion de Ingresos</h2>
                <p className="section-copy">
                  Si un pago puntual cambia por feriado o calendario especial, ajustalo desde la lista sin tocar la regla base del ingreso.
                </p>
              </div>

              <form className="panel-card panel-frame entry-form income-entry-form" onSubmit={saveIncomeToDraft}>
                <div className="income-form-title">
                  <p className="form-kicker">Entrada base</p>
                  <h3>{editingIncomeId ? "Modificar Ingreso" : "Registrar Nuevo Ingreso"}</h3>
                </div>

                <div className="income-form-grid">
                  <label className="income-field">
                    Nombre:
                    <input name="name" onChange={(e) => setIncomeForm((c) => ({ ...c, name: e.target.value }))} value={incomeForm.name} />
                    {incomeNameWarning ? (
                      <span className="field-warning">
                        Firebase no acepta {incomeNameWarning.charactersLabel}. Se guardara como: {incomeNameWarning.sanitizedValue || "sin texto valido"}.
                      </span>
                    ) : null}
                  </label>
                  <label className="income-field">
                    Monto Neto:
                    <input inputMode="decimal" name="amount" onChange={(e) => setIncomeForm((c) => ({ ...c, amount: e.target.value }))} value={incomeForm.amount} />
                  </label>
                  <label className="income-field">
                    Moneda:
                    <select name="currency" onChange={(e) => setIncomeForm((c) => ({ ...c, currency: e.target.value }))} value={incomeForm.currency}>
                      {incomeCurrencies.map((currencyOption) => (
                        <option key={currencyOption.value} value={currencyOption.value}>
                          {currencyOption.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="income-field">
                    Frecuencia:
                    <select name="frequency" onChange={(e) => setIncomeForm((c) => ({ ...c, frequency: e.target.value }))} value={incomeForm.frequency}>
                      {incomeFrequencies.map((frequency) => (
                        <option key={frequency} value={frequency}>
                          {frequency}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="income-field">
                    Fecha Inicio / Unica:
                    <input name="startDate" onChange={(e) => setIncomeForm((c) => ({ ...c, startDate: e.target.value }))} type="date" value={incomeForm.startDate} />
                  </label>
                  <label className="income-field">
                    Fecha Fin (si aplica):
                    <input
                      disabled={incomeForm.isRecurringIndefinite}
                      name="endDate"
                      onChange={(e) => setIncomeForm((c) => ({ ...c, endDate: e.target.value }))}
                      type="date"
                      value={incomeForm.endDate}
                    />
                  </label>
                </div>

                <div className="income-checkbox-group">
                  <label className="income-checkbox">
                    <input
                      checked={incomeForm.isRecurringIndefinite}
                      name="isRecurringIndefinite"
                      onChange={(e) => setIncomeForm((c) => ({ ...c, isRecurringIndefinite: e.target.checked, endDate: e.target.checked ? "" : c.endDate }))}
                      type="checkbox"
                    />
                    Ingreso recurrente sin fin
                  </label>

                  <label className="income-checkbox">
                    <input
                      checked={incomeForm.isReimbursement}
                      name="isReimbursement"
                      onChange={(e) => setIncomeForm((c) => ({ ...c, isReimbursement: e.target.checked, reimbursementCategory: e.target.checked ? c.reimbursementCategory : "" }))}
                      type="checkbox"
                    />
                    Es un reembolso
                  </label>
                </div>

                {incomeForm.isReimbursement ? (
                  <label className="income-field income-reimbursement-field">
                    Categoria que se ajusta:
                    <select
                      name="reimbursementCategory"
                      onChange={(e) => setIncomeForm((c) => ({ ...c, reimbursementCategory: e.target.value }))}
                      value={incomeForm.reimbursementCategory}
                    >
                      <option value="" disabled>
                        -- Selecciona Categoria --
                      </option>
                      {expenseCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <div className="button-row income-button-row">
                  <button className="primary-button" type="submit">
                    {editingIncomeId ? "Actualizar ingreso" : "Agregar Ingreso"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setIncomeForm(defaultIncomeForm());
                      setEditingIncomeId("");
                    }}
                    type="button"
                  >
                    Limpiar
                  </button>
                </div>

                <div className="save-hint-row income-button-row">
                  <button className="secondary-button" onClick={discardChanges} type="button">
                    Descartar cambios
                  </button>
                  <p className="save-hint-copy">El guardado final se hace arriba, desde Guardar entrada final.</p>
                </div>

                {successMessage ? <p className="success-text">{successMessage}</p> : null}
                {dataError ? <p className="error-text">{dataError}</p> : null}
              </form>

              <section className="panel-card panel-frame panel-table">
                <div className="panel-heading">
                  <h2>Lista de ingresos</h2>
                  <p>Los reembolsos ajustan la categoria indicada y no se suman como ingreso real.</p>
                </div>

                {incomes.length ? (
                  <IncomesTable
                    formatDateLabel={formatDateLabel}
                    formatMoneyLabel={money}
                    formatTimestampLabel={formatTimestampLabel}
                    incomeSort={incomeSort}
                    incomes={incomes}
                    onDeleteIncome={deleteIncome}
                    onEditIncome={editIncome}
                    onManageSchedule={openIncomeScheduleModal}
                    onSortChange={setIncomeSort}
                  />
                ) : (
                  <p className="muted-text">Todavia no hay ingresos en la lista.</p>
                )}
              </section>

              <IncomeScheduleModal
                adjustedDate={scheduleAdjustedDate}
                formatDateLabel={formatDateLabel}
                income={scheduleModalIncome}
                occurrenceOptions={scheduleOccurrenceOptions}
                onAdjustedDateChange={setScheduleAdjustedDate}
                onClose={closeIncomeScheduleModal}
                onOccurrenceChange={selectIncomeScheduleOccurrence}
                onSave={saveIncomeScheduleOverride}
                onSelectOverride={selectIncomeScheduleOccurrence}
                onToggleOverride={(occurrenceDate) => toggleIncomeScheduleOverride(scheduleModalIncomeId, occurrenceDate)}
                opened={Boolean(scheduleModalIncomeId)}
                overrideRecords={scheduleOverrideRecords}
                selectedOccurrence={selectedScheduleOccurrence}
                selectedOccurrenceDate={scheduleOccurrenceDate}
              />
            </section>
          ) : null}

          {displayedTab === "reconciliation" ? (
            <section className="workspace-stack reconciliation-stack">
              <div className="reconciliation-tab-header">
                <h2>Gestion de Cuadre</h2>
              </div>

              <form className="panel-card panel-frame entry-form reconciliation-entry-form" onSubmit={saveAdjustmentToDraft}>
                <div className="reconciliation-form-title">
                  <p className="form-kicker">Correccion manual</p>
                  <h3>{editingAdjustmentId ? "Modificar Ajuste de Cuadre" : "Registrar Ajuste de Cuadre"}</h3>
                </div>

                <div className="reconciliation-form-grid">
                  <label className="reconciliation-field">
                    Fecha Ajuste:
                    <input name="date" onChange={(e) => setAdjustmentForm((c) => ({ ...c, date: e.target.value }))} type="date" value={adjustmentForm.date} />
                  </label>
                  <label className="reconciliation-field">
                    Ajuste:
                    <input inputMode="decimal" name="amount" onChange={(e) => setAdjustmentForm((c) => ({ ...c, amount: e.target.value }))} value={adjustmentForm.amount} />
                  </label>
                </div>

                <p className="reconciliation-helper">
                  Usa valores negativos o positivos para cuadrar la diferencia entre el flujo registrado y el saldo real de tu cuenta.
                </p>

                <div className="button-row reconciliation-button-row">
                  <button className="primary-button" type="submit">
                    {editingAdjustmentId ? "Actualizar cuadre" : "Agregar cuadre"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setAdjustmentForm(defaultAdjustmentForm());
                      setEditingAdjustmentId("");
                    }}
                    type="button"
                  >
                    Limpiar
                  </button>
                </div>

                <div className="save-hint-row reconciliation-button-row">
                  <button className="secondary-button" onClick={discardChanges} type="button">
                    Descartar cambios
                  </button>
                  <p className="save-hint-copy">El guardado final se hace arriba, desde Guardar entrada final.</p>
                </div>

                {successMessage ? <p className="success-text">{successMessage}</p> : null}
                {dataError ? <p className="error-text">{dataError}</p> : null}
              </form>

              <section className="panel-card panel-frame panel-table">
                <div className="panel-heading">
                  <h2>Lista de cuadres</h2>
                  <p>Estos ajustes corrigen el saldo del flujo de caja sin sumarse como ingreso ni clasificarse como gasto.</p>
                </div>

                {adjustments.length ? (
                  <ReconciliationTable
                    adjustments={adjustments}
                    adjustmentSort={adjustmentSort}
                    formatDateLabel={formatDateLabel}
                    formatMoneyLabel={money}
                    onDeleteAdjustment={deleteAdjustment}
                    onEditAdjustment={editAdjustment}
                    onSortChange={setAdjustmentSort}
                  />
                ) : (
                  <p className="muted-text">Todavia no hay ajustes de cuadre en la lista.</p>
                )}
              </section>
            </section>
          ) : null}

          {displayedTab === "settings" ? (
            <section className="workspace-stack settings-stack">
              <div className="settings-tab-header">
                <h2>Ajustes de Analisis</h2>
              </div>

              <form className="panel-card panel-frame entry-form settings-entry-form" onSubmit={saveSettingsToDraft}>
                <div className="settings-form-title">
                  <p className="form-kicker">Ventana de analisis</p>
                  <h3>Rango del flujo de caja y graficos</h3>
                </div>

                <div className="settings-form-grid">
                  <label className="settings-field">
                    Fecha base:
                    <input
                      name="startDate"
                      onChange={(e) => setSettingsForm((current) => ({ ...current, startDate: e.target.value }))}
                      type="date"
                      value={settingsForm.startDate}
                    />
                  </label>
                  <label className="settings-field">
                    Fecha de fin:
                    <input
                      name="endDate"
                      onChange={(e) => setSettingsForm((current) => ({ ...current, endDate: e.target.value }))}
                      type="date"
                      value={settingsForm.endDate}
                    />
                  </label>
                  <label className="settings-field">
                    Mes inicial del grafico:
                    <input
                      name="chartStartMonth"
                      onChange={(e) => setSettingsForm((current) => ({ ...current, chartStartMonth: e.target.value }))}
                      type="month"
                      value={settingsForm.chartStartMonth}
                    />
                  </label>
                  <label className="settings-field">
                    Mes final del grafico:
                    <input
                      name="chartEndMonth"
                      onChange={(e) => setSettingsForm((current) => ({ ...current, chartEndMonth: e.target.value }))}
                      type="month"
                      value={settingsForm.chartEndMonth}
                    />
                  </label>
                </div>

                <p className="settings-helper">
                  El flujo de caja usa el rango diario completo, y los graficos usan meses completos entre el mes inicial y el mes final. Por ejemplo: abril 2026 hasta enero 2027.
                </p>

                <div className="button-row settings-button-row">
                  <button className="primary-button" type="submit">
                    Aplicar a proyeccion
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setSettingsForm(draft.analysisSettings ?? defaultAnalysisSettings())}
                    type="button"
                  >
                    Restaurar
                  </button>
                </div>

                <div className="save-hint-row settings-button-row">
                  <button className="secondary-button" onClick={discardChanges} type="button">
                    Descartar cambios
                  </button>
                  <p className="save-hint-copy">El guardado final se hace arriba, desde Guardar entrada final.</p>
                </div>

                {successMessage ? <p className="success-text">{successMessage}</p> : null}
                {dataError ? <p className="error-text">{dataError}</p> : null}
              </form>
            </section>
          ) : null}

          {displayedTab === "cashflow" ? (
            <section className="panel-card cashflow-panel">
              <div className="panel-heading">
                <h2>Flujo de caja detallado</h2>
                <p>{getCashflowResolutionCopy(cashflowResolution)}</p>
              </div>

              <div className="cashflow-toolbar">
                <div className="cashflow-month-label">{cashflowModel.rangeLabel}</div>

                <div className="cashflow-resolution-shell">
                  <MantineTabs
                    classNames={{
                      list: "cashflow-resolution-list",
                      root: "cashflow-resolution-root",
                      tab: "cashflow-resolution-tab",
                    }}
                    keepMounted={false}
                    onChange={(value) => setCashflowResolution(value ?? "weekly")}
                    value={cashflowResolution}
                    variant="pills"
                  >
                    <MantineTabs.List aria-label="Resolucion de tabla">
                      <MantineTabs.Tab value="daily">Diaria</MantineTabs.Tab>
                      <MantineTabs.Tab value="weekly">Semanal</MantineTabs.Tab>
                      <MantineTabs.Tab value="monthly">Mensual</MantineTabs.Tab>
                    </MantineTabs.List>
                  </MantineTabs>
                  <span className="cashflow-resolution-note">
                    {cashflowResolution === "weekly"
                      ? "Predeterminado. La semana inicia el lunes."
                      : cashflowResolution === "daily"
                        ? "Cada columna representa un dia."
                        : "Cada columna representa un mes."}
                  </span>
                </div>
              </div>

              <div className="cashflow-top-scroll-shell" aria-hidden="true">
                <div className="cashflow-top-scroll-spacer" />
                <div className="cashflow-top-scroll-track" ref={cashflowTopScrollRef}>
                  <div className="cashflow-top-scroll-content" ref={cashflowTopScrollSpacerRef} />
                </div>
              </div>

              <div className="cashflow-grid" onMouseLeave={() => setCashflowTooltip(null)}>
                <div className="cashflow-label-pane">
                  <table className="cashflow-label-table">
                    <thead>
                      <tr>
                        <th className="cashflow-concept-head">Categoria / Concepto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashflowModel.rows.map((row) => (
                        <tr className={row.className} key={`label-${row.key}`}>
                          <th className="cashflow-row-label">{row.label}</th>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="cashflow-table-wrap" ref={cashflowScrollRef}>
                  <table className="cashflow-data-table">
                    <thead>
                      <tr>
                        {cashflowModel.dates.map((date) => (
                          <th
                            className={date.key === cashflowModel.todayKey ? "cashflow-day-head today-column" : "cashflow-day-head"}
                            key={date.key}
                            ref={date.key === cashflowModel.todayKey ? currentDayColumnRef : null}
                          >
                            <span>{date.shortLabel}</span>
                            <span>{date.yearLabel}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cashflowModel.rows.map((row) => (
                        <tr className={row.className} key={row.key}>
                          {cashflowModel.dates.map((date) => (
                          <td
                            className={date.key === cashflowModel.todayKey ? "today-column" : ""}
                            key={`${row.key}-${date.key}`}
                            onMouseEnter={(event) => showCashflowTooltip(event, row, date)}
                          >
                            {formatCashflowAmount(row.values?.[date.key] ?? 0)}
                          </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {cashflowTooltip ? (
                <div className="cashflow-tooltip" style={{ left: `${cashflowTooltip.left}px`, top: `${cashflowTooltip.top}px` }}>
                  <strong>{cashflowTooltip.title}</strong>
                  <span>{cashflowTooltip.dateLabel}</span>
                  {cashflowTooltip.lines.length ? (
                    <div className="cashflow-tooltip-lines">
                      {cashflowTooltip.lines.map((line, index) => (
                        <p key={`${cashflowTooltip.title}-${cashflowTooltip.date}-${index}`}>{line}</p>
                      ))}
                    </div>
                  ) : (
                    <p>Sin movimientos registrados.</p>
                  )}
                  <p className="cashflow-tooltip-total">Total: {formatCashflowAmount(cashflowTooltip.total)}</p>
                </div>
              ) : null}
            </section>
          ) : null}

          {displayedTab === "charts" ? (
            <section className="workspace-stack charts-stack">
              <section className="panel-card panel-frame chart-panel">
                <div className="chart-toolbar">
                  <div className="panel-heading">
                    <h2>Saldos diarios</h2>
                    <p>{balanceTrendModel.rangeLabel}</p>
                  </div>

                  <div className="cashflow-resolution-shell">
                    <MantineTabs
                      classNames={{
                        list: "cashflow-resolution-list",
                        root: "cashflow-resolution-root",
                        tab: "cashflow-resolution-tab",
                      }}
                      onChange={(value) => startTransition(() => setBalanceTrendResolution(value ?? "daily"))}
                      value={balanceTrendResolution}
                    >
                      <MantineTabs.List>
                        <MantineTabs.Tab value="daily">Diaria</MantineTabs.Tab>
                        <MantineTabs.Tab value="weekly">Semanal</MantineTabs.Tab>
                        <MantineTabs.Tab value="monthly">Mensual</MantineTabs.Tab>
                      </MantineTabs.List>
                    </MantineTabs>
                    <span className="cashflow-resolution-note">{getBalanceTrendResolutionCopy(balanceTrendResolution)}</span>
                  </div>
                </div>

                {balanceTrendModel.dailyPoints.length ? (
                  <>
                    <div className="chart-legend">
                      <span><i className="legend-swatch actual-balance" /> Saldo final estimado</span>
                      <span><i className="legend-swatch budget-balance" /> Saldo presupuestado a la fecha</span>
                    </div>
                    <p className="chart-scroll-copy">{getBalanceTrendScrollCopy(balanceTrendResolution)}</p>
                    <BalanceTrendChart model={balanceTrendModel} resolution={balanceTrendResolution} todayKey={todayKey} />
                  </>
                ) : (
                  <p className="placeholder-copy">No hay datos suficientes para construir la serie diaria del periodo seleccionado.</p>
                )}
              </section>

              <section className="panel-card panel-frame chart-panel">
                <div className="panel-heading">
                  <h2>Gasto no presupuestado</h2>
                  <p>{budgetComparisonModel.chartWindowLabel}</p>
                </div>

                {budgetComparisonModel.chartPoints.length ? (
                  <UnbudgetedBarTrendChart points={budgetComparisonModel.chartPoints} />
                ) : (
                  <p className="placeholder-copy">Todavia no hay datos para mostrar esta serie.</p>
                )}
              </section>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function toggleBudgetCategory(category, setBudgetForm) {
  setBudgetForm((current) => ({
    ...current,
    linkedCategories: current.linkedCategories.includes(category)
      ? current.linkedCategories.filter((item) => item !== category)
      : sortLabelsAlphabetically([...current.linkedCategories, category]),
  }));
}

function BalanceTrendChart({ model, resolution, todayKey }) {
  if (!model?.dailyPoints?.length) return null;

  const axisTicks = useMemo(() => buildBalanceTrendTicks(model.dailyPoints, resolution), [model.dailyPoints, resolution]);
  const width = useMemo(() => resolveBalanceTrendChartWidth(model.dailyPoints.length, resolution), [model.dailyPoints.length, resolution]);
  const xTickFormatter = useMemo(() => (value) => formatBalanceTrendTick(value, resolution), [resolution]);
  const minTickGap = resolution === "monthly" ? 10 : resolution === "weekly" ? 20 : 28;

  return (
    <div className="chart-sync-shell">
      <div className="chart-axis-pane">
        <ResponsiveContainer height="100%" width="100%">
          <LineChart data={model.dailyPoints} margin={{ top: 16, right: 8, left: 0, bottom: 8 }}>
            <YAxis
              domain={model.yDomain}
              tick={{ fill: "#5a6f88", fontSize: 11 }}
              tickFormatter={formatCompactCurrency}
              width={72}
            />
            <Line dataKey="estimatedBalance" dot={false} isAnimationActive={false} stroke="transparent" strokeWidth={0} />
            <Line dataKey="budgetBalance" dot={false} isAnimationActive={false} stroke="transparent" strokeWidth={0} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-plot-scroll">
        <div className="chart-scroll-content chart-scroll-content-linear" style={{ width: `${width}px`, height: "360px" }}>
          <ResponsiveContainer height="100%" width="100%">
            <LineChart data={model.dailyPoints} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="rgba(87, 112, 144, 0.16)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              interval={resolution === "daily" ? "preserveStartEnd" : 0}
              minTickGap={minTickGap}
              tick={{ fill: "#5a6f88", fontSize: 11 }}
              tickFormatter={xTickFormatter}
              ticks={resolution === "daily" ? undefined : axisTicks}
            />
            <YAxis domain={model.yDomain} hide />
            <Tooltip content={<BalanceChartTooltip />} />
            {model.dailyPoints.some((point) => point.date === todayKey) ? (
              <ReferenceLine label={{ fill: "#163e68", fontSize: 11, value: "Hoy" }} stroke="#163e68" strokeDasharray="4 4" x={todayKey} />
            ) : null}
            <Line
              activeDot={{ r: 4 }}
              dataKey="budgetBalance"
              dot={false}
              name="Saldo presupuestado a la fecha"
              stroke="#8a929d"
              strokeWidth={3}
              type="linear"
            />
            <Line
              activeDot={{ r: 4 }}
              dataKey="estimatedBalance"
              dot={false}
              name="Saldo final estimado"
              stroke="#111111"
              strokeWidth={3}
              type="linear"
            />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function UnbudgetedBarTrendChart({ points }) {
  if (!points.length) return null;

  const width = Math.max(640, points.length * 94);

  return (
    <div className="chart-sync-shell">
      <div className="chart-axis-pane chart-axis-pane-bars">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={points} margin={{ top: 16, right: 8, left: 0, bottom: 8 }}>
            <YAxis tick={{ fill: "#5a6f88", fontSize: 11 }} tickFormatter={formatCompactCurrency} width={72} />
            <Bar dataKey="unbudgeted" fill="transparent" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-plot-scroll">
        <div className="chart-scroll-content chart-scroll-content-bars chart-scroll-content-linear" style={{ width: `${width}px`, height: "320px" }}>
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={points} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="rgba(87, 112, 144, 0.16)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="key" tick={{ fill: "#5a6f88", fontSize: 11 }} tickFormatter={formatMonthTick} />
            <YAxis hide />
            <Tooltip content={<UnbudgetedChartTooltip />} />
            <Bar dataKey="unbudgeted" fill="url(#unbudgetedGradient)" name="Gasto no presupuestado" radius={[10, 10, 0, 0]} />
            <defs>
              <linearGradient id="unbudgetedGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#d28a3f" />
                <stop offset="100%" stopColor="#b6651d" />
              </linearGradient>
            </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function BalanceChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const estimated = payload.find((entry) => entry.dataKey === "estimatedBalance")?.value ?? 0;
  const budget = payload.find((entry) => entry.dataKey === "budgetBalance")?.value ?? 0;

  return (
    <div className="chart-tooltip">
      <strong>{formatDateLabel(label)}</strong>
      <p>Saldo final estimado: {money(estimated, "USD")}</p>
      <p>Saldo presupuestado a la fecha: {money(budget, "USD")}</p>
      <p>Diferencia: {money(estimated - budget, "USD")}</p>
    </div>
  );
}

function UnbudgetedChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="chart-tooltip">
      <strong>{point.fullLabel}</strong>
      <p>Gasto no presupuestado: {money(point.unbudgeted, "USD")}</p>
    </div>
  );
}

function createInitialUserData(user, snapshotDate) {
  return {
    profile: createUserProfile(user),
    cashflowSnapshots: {
      [snapshotDate]: {
        versions: {
          [localId("version")]: createVersionPayload(snapshotDate, emptyWorkspace(), user),
        },
      },
    },
  };
}

function createUserProfile(user) {
  return { uid: user.uid, email: user.email ?? "", currency: "USD", createdAt: Date.now() };
}

function createVersionPayload(snapshotDate, payload, user, sourceVersion = null) {
  const savedAt = Date.now();
  return {
    snapshotDate,
    savedAt,
    createdByUid: user?.uid ?? "",
    createdByEmail: user?.email ?? "",
    sourceSnapshotDate: sourceVersion?.snapshotDate ?? null,
    sourceVersionId: sourceVersion?.versionId ?? null,
    payload: { ...sanitizeWorkspace(payload), updatedAt: savedAt },
  };
}

function emptyWorkspace() {
  return { expenses: {}, budgets: {}, incomes: {}, adjustments: {}, analysisSettings: defaultAnalysisSettings(), updatedAt: Date.now() };
}

function defaultExpenseForm() {
  return {
    name: "",
    amount: "",
    currency: "USD",
    category: "Otros",
    frequency: "Unico",
    movementDate: localDate(),
    endDate: "",
    isRecurringIndefinite: false,
  };
}

function defaultBudgetForm() {
  return {
    name: "",
    amount: "",
    currency: "USD",
    frequency: "Mensual",
    startDate: localDate(),
    endDate: "",
    isRecurringIndefinite: true,
    linkedCategories: [],
  };
}

function defaultIncomeForm() {
  return {
    name: "",
    amount: "",
    currency: "USD",
    frequency: "Mensual",
    startDate: localDate(),
    endDate: "",
    isRecurringIndefinite: true,
    isReimbursement: false,
    reimbursementCategory: "",
  };
}

function defaultAdjustmentForm() {
  return {
    date: localDate(),
    amount: "",
  };
}

function defaultAnalysisSettings() {
  const defaults = defaultChartMonthRange("2026-01-01", "2030-12-31");
  return {
    startDate: "2026-01-01",
    endDate: "2030-12-31",
    chartStartMonth: defaults.chartStartMonth,
    chartEndMonth: defaults.chartEndMonth,
  };
}

function sanitizeExpenseImportSource(source) {
  const fingerprint = String(source?.fingerprint ?? "").trim();
  const matchKey = String(source?.matchKey ?? "").trim();

  if (!fingerprint && !matchKey) {
    return null;
  }

  return {
    provider: String(source?.provider ?? "").trim() || "schwab-json",
    fingerprint,
    matchKey,
    occurrenceIndex: Number(source?.occurrenceIndex) || 1,
    sourceType: String(source?.sourceType ?? "").trim(),
    sourceDate: String(source?.sourceDate ?? "").trim(),
    importedAt: Number(source?.importedAt) || 0,
  };
}

function sanitizeIncomeScheduleOverrides(overrides) {
  return Object.fromEntries(
    Object.entries(overrides ?? {})
      .map(([originalDate, value]) => {
        const normalizedOriginalDate = String(originalDate ?? "").trim();
        const normalizedAdjustedDate = String(value?.adjustedDate ?? "").trim();

        if (!isValidDate(parseDateKey(normalizedOriginalDate)) || !isValidDate(parseDateKey(normalizedAdjustedDate))) {
          return null;
        }

        return [
          normalizedOriginalDate,
          {
            adjustedDate: normalizedAdjustedDate,
            isActive: value?.isActive !== false,
            updatedAt: Number(value?.updatedAt) || 0,
          },
        ];
      })
      .filter(Boolean),
  );
}

function sortLabelsAlphabetically(items) {
  return [...items].sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" }));
}

function normalizeExpenseCategory(category) {
  const normalizedCategory = String(category ?? "").trim();

  if (!normalizedCategory) {
    return "Otros";
  }

  if (normalizedCategory === "Ahorros" || normalizedCategory === "Inversiones") {
    return "Ahorro - Inversion";
  }

  if (normalizedCategory === "Gastos Comunes") {
    return "Cuentas";
  }

  if (normalizedCategory === "Vega") {
    return "Supermercado";
  }

  return expenseCategories.includes(normalizedCategory) ? normalizedCategory : "Otros";
}

function getBudgetCategories(budget) {
  const rawCategories = budget?.linkedCategories?.length ? budget.linkedCategories : [budget?.category];
  const categories = rawCategories.map(normalizeExpenseCategory).filter(Boolean);

  return sortLabelsAlphabetically([...new Set(categories)]).slice(0, 12);
}

function localId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hasWorkspaceShape(value) {
  return Boolean(value && typeof value === "object" && "expenses" in value && "incomes" in value);
}

function hasWorkspaceContent(workspace) {
  return Boolean(
    Object.keys(workspace?.expenses ?? {}).length ||
      Object.keys(workspace?.budgets ?? {}).length ||
      Object.keys(workspace?.incomes ?? {}).length ||
      Object.keys(workspace?.adjustments ?? {}).length,
  );
}

function normalizeWorkspace(source) {
  if (!source) return emptyWorkspace();
  const candidate = source.payload ?? source;

  if (candidate.entries) {
    return convertLegacyEntries(candidate.entries, candidate.createdAt ?? candidate.savedAt);
  }

  return sanitizeWorkspace({
    expenses: candidate.expenses ?? {},
    budgets: candidate.budgets ?? {},
    incomes: candidate.incomes ?? {},
    adjustments: candidate.adjustments ?? {},
    analysisSettings: candidate.analysisSettings ?? defaultAnalysisSettings(),
    updatedAt: candidate.updatedAt ?? candidate.savedAt ?? candidate.createdAt ?? Date.now(),
  });
}

function sanitizeWorkspace(workspace) {
  return {
    expenses: Object.fromEntries(
      Object.entries(workspace?.expenses ?? {}).map(([id, value]) => [
        id,
        {
          name: String(value?.name ?? value?.merchantName ?? value?.detail ?? "").trim(),
          amount: Number(value?.amount) || 0,
          currency: value?.currency === "CLP" ? "CLP" : "USD",
          category: normalizeExpenseCategory(value?.category),
          frequency: expenseFrequencies.includes(String(value?.frequency ?? "")) ? String(value?.frequency) : "Unico",
          movementDate: String(value?.movementDate ?? value?.date ?? localDate()),
          endDate: String(value?.endDate ?? "").trim(),
          isRecurringIndefinite: Boolean(value?.isRecurringIndefinite),
          importSource: sanitizeExpenseImportSource(value?.importSource),
          createdAt: Number(value?.createdAt) || Date.now(),
        },
      ]),
    ),
    budgets: Object.fromEntries(
      Object.entries(workspace?.budgets ?? {}).map(([id, value]) => [
        id,
        (() => {
          const categories = getBudgetCategories(value);

          return {
          name: String(value?.name ?? "").trim(),
          amount: Number(value?.amount) || 0,
          currency: value?.currency === "CLP" ? "CLP" : "USD",
          category: categories[0] ?? fixedExpenseCategories[0] ?? expenseCategories[0] ?? "Otros",
          frequency: expenseFrequencies.includes(String(value?.frequency ?? "")) ? String(value?.frequency) : "Mensual",
          startDate: String(value?.startDate ?? localDate()),
          endDate: String(value?.endDate ?? "").trim(),
          isRecurringIndefinite: Boolean(value?.isRecurringIndefinite),
          linkedCategories: categories.length ? categories : [fixedExpenseCategories[0] ?? expenseCategories[0] ?? "Otros"],
          createdAt: Number(value?.createdAt) || Date.now(),
          };
        })(),
      ]),
    ),
    incomes: Object.fromEntries(
      Object.entries(workspace?.incomes ?? {}).map(([id, value]) => [
        id,
        {
          name: String(value?.name ?? "").trim(),
          amount: Number(value?.amount) || 0,
          currency: value?.currency === "CLP" ? "CLP" : "USD",
          frequency: incomeFrequencies.includes(String(value?.frequency ?? value?.recurrence ?? "")) ? String(value?.frequency ?? value?.recurrence) : "Unico",
          startDate: String(value?.startDate ?? localDate(new Date(Number(value?.createdAt) || Date.now()))),
          endDate: String(value?.endDate ?? "").trim(),
          isRecurringIndefinite: Boolean(value?.isRecurringIndefinite),
          isReimbursement: Boolean(value?.isReimbursement),
          reimbursementCategory: value?.isReimbursement ? normalizeExpenseCategory(value?.reimbursementCategory) : "",
          scheduleOverrides: sanitizeIncomeScheduleOverrides(value?.scheduleOverrides),
          createdAt: Number(value?.createdAt) || Date.now(),
        },
      ]),
    ),
    adjustments: Object.fromEntries(
      Object.entries(workspace?.adjustments ?? {}).map(([id, value]) => [
        id,
        {
          date: String(value?.date ?? localDate()),
          amount: Number(value?.amount) || 0,
          createdAt: Number(value?.createdAt) || Date.now(),
        },
      ]),
    ),
    analysisSettings: sanitizeAnalysisSettings(workspace?.analysisSettings),
    updatedAt: Number(workspace?.updatedAt) || Date.now(),
  };
}

function convertLegacyEntries(entries, updatedAt = Date.now()) {
  const workspace = emptyWorkspace();
  for (const [id, value] of Object.entries(entries ?? {})) {
    if (value?.type === "income") {
      workspace.incomes[id] = {
        name: String(value?.description ?? "").trim(),
        amount: Number(value?.amount) || 0,
        currency: "USD",
        frequency: "Unico",
        startDate: localDate(new Date(Number(value?.createdAt) || Date.now())),
        endDate: "",
        isRecurringIndefinite: false,
        isReimbursement: false,
        reimbursementCategory: "",
        createdAt: Number(value?.createdAt) || Date.now(),
      };
    } else {
      workspace.expenses[id] = {
        name: String(value?.description ?? "").trim(),
        amount: Number(value?.amount) || 0,
        currency: "USD",
        category: "Otros",
        frequency: "Unico",
        movementDate: localDate(new Date(Number(value?.createdAt) || Date.now())),
        endDate: "",
        isRecurringIndefinite: false,
        createdAt: Number(value?.createdAt) || Date.now(),
      };
    }
  }
  workspace.updatedAt = Number(updatedAt) || Date.now();
  return workspace;
}

function extractRecentVersions(snapshotTree) {
  const versions = [];
  for (const [snapshotDate, snapshotValue] of Object.entries(snapshotTree ?? {})) {
    if (snapshotValue?.versions) {
      for (const [versionId, version] of Object.entries(snapshotValue.versions)) {
        versions.push({
          key: buildKey(snapshotDate, versionId),
          snapshotDate,
          versionId,
          savedAt: Number(version?.savedAt) || 0,
          payload: normalizeWorkspace(version),
        });
      }
    } else if (snapshotValue) {
      versions.push({
        key: buildKey(snapshotDate, `legacy_${snapshotValue.createdAt ?? 0}`),
        snapshotDate,
        versionId: `legacy_${snapshotValue.createdAt ?? 0}`,
        savedAt: Number(snapshotValue?.createdAt) || 0,
        payload: normalizeWorkspace(snapshotValue),
      });
    }
  }
  return versions.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

function getLatestVersion(snapshotTree) {
  return extractRecentVersions(snapshotTree)[0] ?? null;
}

function buildKey(snapshotDate, versionId) {
  return `${snapshotDate}__${versionId}`;
}

function validateExpense(expense) {
  return validateExpenseRecord(expense, {
    categories: expenseCategories,
    frequencies: expenseFrequencies,
  });
}

function validateBudget(budget) {
  return validateBudgetRecord(budget, {
    categories: expenseCategories,
    frequencies: expenseFrequencies,
  });
}

function validateIncome(income) {
  return validateIncomeRecord(income, {
    categories: expenseCategories,
    frequencies: incomeFrequencies,
  });
}

function validateAdjustment(adjustment) {
  return validateAdjustmentRecord(adjustment);
}

function validateAnalysisSettings(settings) {
  return validateAnalysisSettingsRecord(settings);
}

function validateBudgetCollection(budgets) {
  const budgetList = Object.entries(budgets ?? {}).map(([id, value]) => ({ id, ...value }));

  for (let index = 0; index < budgetList.length; index += 1) {
    const current = budgetList[index];
    const currentRange = getBudgetActiveRange(current);
    const currentCategories = getBudgetCategories(current);

    for (let compareIndex = index + 1; compareIndex < budgetList.length; compareIndex += 1) {
      const candidate = budgetList[compareIndex];
      const candidateCategories = getBudgetCategories(candidate);
      const sharedCategories = currentCategories.filter((category) => candidateCategories.includes(category));

      if (!sharedCategories.length) continue;

      if (budgetRangesOverlap(currentRange, getBudgetActiveRange(candidate))) {
        return `La categoria ${sharedCategories[0]} ya pertenece a otro presupuesto activo. Ajusta las categorias o el rango para evitar cruces.`;
      }
    }
  }

  return "";
}

function validateWorkspace(workspace) {
  for (const expense of Object.values(workspace.expenses ?? {})) {
    const error = validateExpense(expense);
    if (error) return error;
  }
  for (const budget of Object.values(workspace.budgets ?? {})) {
    const error = validateBudget(budget);
    if (error) return error;
  }
  for (const income of Object.values(workspace.incomes ?? {})) {
    const error = validateIncome(income);
    if (error) return error;
  }
  for (const adjustment of Object.values(workspace.adjustments ?? {})) {
    const error = validateAdjustment(adjustment);
    if (error) return error;
  }
  const budgetCollectionError = validateBudgetCollection(workspace.budgets ?? {});
  if (budgetCollectionError) return budgetCollectionError;
  const settingsError = validateAnalysisSettings(workspace.analysisSettings ?? defaultAnalysisSettings());
  if (settingsError) return settingsError;
  return "";
}

function buildExpenseCategorySuggestionKey(value) {
  return sanitizeFirebaseCompatibleText(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildExpenseCategorySuggestionMap(expenses) {
  const categoryBuckets = new Map();

  for (const expense of expenses ?? []) {
    const category = expenseCategories.includes(String(expense?.category ?? "")) ? String(expense.category) : "";
    const suggestionKey = buildExpenseCategorySuggestionKey(expense?.name ?? expense?.merchantName ?? expense?.detail ?? "");

    if (!category || !suggestionKey) {
      continue;
    }

    const bucket = categoryBuckets.get(suggestionKey) ?? new Map();

    bucket.set(category, (bucket.get(category) ?? 0) + 1);
    categoryBuckets.set(suggestionKey, bucket);
  }

  return new Map(
    [...categoryBuckets.entries()].map(([suggestionKey, bucket]) => [
      suggestionKey,
      [...bucket.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "es", { sensitivity: "base" }))[0]?.[0] ?? "",
    ]),
  );
}

function buildExpenseImportExistingMaps(expenses) {
  const fingerprintMap = new Map();
  const matchQueues = new Map();

  for (const expense of expenses ?? []) {
    const movementDate = String(expense?.movementDate ?? expense?.date ?? "").trim();
    const name = String(expense?.name ?? expense?.merchantName ?? expense?.detail ?? "").trim();
    const matchKey =
      String(expense?.importSource?.matchKey ?? "").trim() ||
      buildExpenseImportMatchKey({
        amount: expense?.amount,
        currency: expense?.currency,
        movementDate,
        name,
      });
    const fingerprint = String(expense?.importSource?.fingerprint ?? "").trim();

    if (fingerprint) {
      fingerprintMap.set(fingerprint, expense);
    }

    if (!matchKey) {
      continue;
    }

    const queue = matchQueues.get(matchKey) ?? [];

    queue.push(expense);
    matchQueues.set(matchKey, queue);
  }

  return { fingerprintMap, matchQueues };
}

function buildExpenseImportRows({ existingSuggestions, existingExpenses, transactions }) {
  const { fingerprintMap, matchQueues } = buildExpenseImportExistingMaps(existingExpenses);

  return (transactions ?? []).map((transaction) => {
    const suggestedCategory = existingSuggestions.get(buildExpenseCategorySuggestionKey(transaction.name)) ?? "";
    const matchedExpense =
      fingerprintMap.get(transaction.sourceFingerprint) ?? (matchQueues.get(transaction.sourceMatchKey) ?? [])[transaction.occurrenceIndex - 1] ?? null;

    return {
      ...transaction,
      category: matchedExpense?.category ?? suggestedCategory,
      existingCategory: matchedExpense?.category ?? "",
      matchedExpenseId: matchedExpense?.id ?? "",
      suggestedCategory,
      isDuplicate: Boolean(matchedExpense),
    };
  });
}

function buildExpenseImportSuccessMessage(createdCount, updatedCount) {
  const parts = [];

  if (createdCount) {
    parts.push(`${createdCount} gasto${createdCount === 1 ? "" : "s"} nuevo${createdCount === 1 ? "" : "s"}`);
  }

  if (updatedCount) {
    parts.push(`${updatedCount} categoria${updatedCount === 1 ? "" : "s"} actualizada${updatedCount === 1 ? "" : "s"}`);
  }

  if (!parts.length) {
    return "No hubo cambios para aplicar desde el JSON.";
  }

  return `${parts.join(" y ")} aplicad${parts.length === 1 && createdCount === 1 && !updatedCount ? "o" : "os"} desde el JSON a la proyeccion activa.`;
}

function sortCollection(items, sortState, valueGetter) {
  return [...items].sort((left, right) => {
    const result = compareSortValues(valueGetter(left, sortState.key), valueGetter(right, sortState.key), sortState.direction);
    if (result !== 0) return result;
    return (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0);
  });
}

function compareSortValues(leftValue, rightValue, direction) {
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
  }

  const normalizedLeft = String(leftValue);
  const normalizedRight = String(rightValue);
  const comparison = normalizedLeft.localeCompare(normalizedRight, "es", { sensitivity: "base", numeric: true });
  return direction === "asc" ? comparison : comparison * -1;
}

function getExpenseSortValue(expense, key) {
  switch (key) {
    case "movementDate":
      return dateToTimestamp(expense.movementDate ?? expense.date);
    case "name":
      return normalizeSortText(expense.name ?? expense.merchantName ?? expense.detail);
    case "category":
      return normalizeSortText(expense.category);
    case "frequency":
      return normalizeSortText(expense.frequency);
    case "endDate":
      return expense.isRecurringIndefinite ? null : dateToTimestamp(expense.endDate);
    case "status":
      return normalizeSortText(expense.isRecurringIndefinite ? "Recurrente sin fin" : expense.endDate ? "Con termino" : "Unico");
    case "currency":
      return normalizeSortText(expense.currency);
    case "amount":
      return Number(expense.amount) || 0;
    default:
      return null;
  }
}

function getIncomeSortValue(income, key) {
  switch (key) {
    case "startDate":
      return dateToTimestamp(income.startDate) ?? (Number(income.createdAt) || 0);
    case "name":
      return normalizeSortText(income.name);
    case "type":
      return normalizeSortText(income.isReimbursement ? "Reembolso" : "Ingreso real");
    case "reimbursementCategory":
      return normalizeSortText(income.isReimbursement ? income.reimbursementCategory : "No aplica");
    case "frequency":
      return normalizeSortText(income.frequency);
    case "endDate":
      return income.isRecurringIndefinite ? null : dateToTimestamp(income.endDate);
    case "status":
      return normalizeSortText(income.isRecurringIndefinite ? "Recurrente sin fin" : income.endDate ? "Con termino" : "Unico");
    case "currency":
      return normalizeSortText(income.currency);
    case "amount":
      return Number(income.amount) || 0;
    default:
      return null;
  }
}

function getAdjustmentSortValue(adjustment, key) {
  switch (key) {
    case "date":
      return dateToTimestamp(adjustment.date);
    case "type":
      return normalizeSortText("Cuadre");
    case "amount":
      return Number(adjustment.amount) || 0;
    case "impact":
      return normalizeSortText(Number(adjustment.amount) < 0 ? "Reduce saldo" : Number(adjustment.amount) > 0 ? "Aumenta saldo" : "Sin efecto");
    default:
      return null;
  }
}

function buildIncomeOccurrenceEntries({ income, displayEnd }) {
  if (!income) {
    return [];
  }

  const scheduleOverrides = sanitizeIncomeScheduleOverrides(income.scheduleOverrides);
  const generationEnd = maxDateKey(displayEnd, ...Object.keys(scheduleOverrides));
  const occurrenceDates = buildRecurringDates({
    startDate: income.startDate,
    frequency: income.frequency,
    endDate: income.endDate,
    isRecurringIndefinite: income.isRecurringIndefinite,
    displayEnd: generationEnd,
  });

  return occurrenceDates
    .map((originalDate) => {
      const override = scheduleOverrides[originalDate];
      const isOverrideActive = Boolean(override?.isActive);
      const adjustedDate = isOverrideActive ? override.adjustedDate : originalDate;

      return {
        adjustedDate: override?.adjustedDate ?? "",
        date: adjustedDate,
        isAdjusted: isOverrideActive && adjustedDate !== originalDate,
        isOverrideActive,
        originalDate,
      };
    })
    .sort((left, right) => {
      const dateResult = compareSortValues(left.date, right.date, "asc");
      if (dateResult !== 0) return dateResult;
      return compareSortValues(left.originalDate, right.originalDate, "asc");
    });
}

function buildIncomeSchedulePreviewItems({ income, analysisSettings, currentDateKey }) {
  if (!income) {
    return [];
  }

  const previewEnd = maxDateKey(analysisSettings?.endDate, localDate(addCalendarMonths(new Date(), 18)));
  const occurrences = buildIncomeOccurrenceEntries({
    income,
    displayEnd: previewEnd,
  });

  if (occurrences.length <= 48) {
    return occurrences;
  }

  const pivotIndex = occurrences.findIndex((item) => item.date >= currentDateKey || item.originalDate >= currentDateKey);
  const startIndex = Math.max(0, (pivotIndex === -1 ? occurrences.length - 24 : pivotIndex) - 6);

  return occurrences.slice(startIndex, startIndex + 48);
}

function getIncomeScheduleOverrideRecords(income) {
  return Object.entries(sanitizeIncomeScheduleOverrides(income?.scheduleOverrides))
    .map(([originalDate, value]) => ({
      adjustedDate: value.adjustedDate,
      isActive: Boolean(value.isActive),
      isAdjusted: value.adjustedDate !== originalDate && Boolean(value.isActive),
      originalDate,
      updatedAt: value.updatedAt,
    }))
    .sort((left, right) => compareSortValues(left.originalDate, right.originalDate, "asc"));
}

function buildSummaryIndicatorsModel({ expenses, incomes, adjustments, currentDateKey, analysisSettings }) {
  const todayDate = parseDateKey(currentDateKey);
  const safeCurrentDateKey = isValidDate(todayDate) ? currentDateKey : localDate();
  const safeCurrentDate = isValidDate(todayDate) ? todayDate : parseDateKey(safeCurrentDateKey);
  const monthKey = String(safeCurrentDateKey).slice(0, 7);
  const monthEndKey = localDate(getEndOfMonth(safeCurrentDate));
  const upcomingExpenseWindowStart = localDate(addCalendarDays(safeCurrentDate, 1));
  const upcomingExpenseWindowEnd = localDate(addCalendarDays(safeCurrentDate, 14));
  const projectionEndKey = maxDateKey(
    resolveSummaryForecastEnd({ expenses, incomes, adjustments, currentDateKey: safeCurrentDateKey, analysisSettings }),
    monthEndKey,
    upcomingExpenseWindowEnd,
  );
  const dailyBalanceChanges = {};
  const incomeGroupsByDate = {};
  const upcomingExpenses = [];
  let fixedExpensesMonthTotal = 0;
  let variableExpensesMonthToDate = 0;

  for (const expense of expenses) {
    const amount = Number(expense.amount) || 0;
    const category = expenseCategories.includes(String(expense.category ?? "")) ? expense.category : "Otros";
    const group = getExpenseCategoryGroup(category);
    const occurrenceDates = buildRecurringDates({
      startDate: expense.movementDate ?? expense.date,
      frequency: expense.frequency,
      endDate: expense.endDate,
      isRecurringIndefinite: expense.isRecurringIndefinite,
      displayEnd: projectionEndKey,
    });

    for (const date of occurrenceDates) {
      increaseDateValue(dailyBalanceChanges, date, -amount);

      if (date > safeCurrentDateKey && date <= upcomingExpenseWindowEnd) {
        upcomingExpenses.push({
          amount,
          category,
          currency: expense.currency ?? "USD",
          date,
          key: `${expense.id}-${date}`,
          name: expense.name || "Gasto",
        });
      }

      if (String(date).slice(0, 7) !== monthKey) {
        continue;
      }

      if (group === "fixed") {
        fixedExpensesMonthTotal += amount;
      }

      if (group === "variable" && date <= safeCurrentDateKey) {
        variableExpensesMonthToDate += amount;
      }
    }
  }

  for (const income of incomes) {
    const amount = Number(income.amount) || 0;
    const occurrences = buildIncomeOccurrenceEntries({
      income,
      displayEnd: projectionEndKey,
    });

    for (const occurrence of occurrences) {
      const date = occurrence.date;
      increaseDateValue(dailyBalanceChanges, date, amount);

      if (income.isReimbursement) {
        const category = expenseCategories.includes(String(income.reimbursementCategory ?? "")) ? income.reimbursementCategory : "Otros";
        const group = getExpenseCategoryGroup(category);

        if (String(date).slice(0, 7) === monthKey) {
          if (group === "fixed") {
            fixedExpensesMonthTotal -= amount;
          }

          if (group === "variable" && date <= safeCurrentDateKey) {
            variableExpensesMonthToDate -= amount;
          }
        }

        continue;
      }

      if (!incomeGroupsByDate[date]) {
        incomeGroupsByDate[date] = { date, items: [], totalAmount: 0 };
      }

      incomeGroupsByDate[date].items.push({
        amount,
        key: `${income.id}-${occurrence.originalDate}-${date}`,
        name: income.name || "Ingreso",
      });
      incomeGroupsByDate[date].totalAmount += amount;
    }
  }

  for (const adjustment of adjustments) {
    increaseDateValue(dailyBalanceChanges, adjustment.date, Number(adjustment.amount) || 0);
  }

  const todayBalance = Object.entries(dailyBalanceChanges)
    .filter(([date]) => date <= safeCurrentDateKey)
    .reduce((sum, [, amount]) => sum + (Number(amount) || 0), 0);

  const incomeTimeline = Object.values(incomeGroupsByDate)
    .map((group) => ({
      ...group,
      label: summarizeOccurrenceGroupLabel(group.items, "Ingreso"),
    }))
    .sort((left, right) => compareSortValues(left.date, right.date, "asc"));

  let lastIncome = null;
  let nextIncome = null;

  for (const group of incomeTimeline) {
    if (group.date <= safeCurrentDateKey) {
      lastIncome = group;
      continue;
    }

    nextIncome = group;
    break;
  }

  const futureDates = Object.keys(dailyBalanceChanges)
    .filter((date) => date > safeCurrentDateKey)
    .sort((left, right) => compareSortValues(left, right, "asc"));
  const thresholdAlerts = [
    { key: "negative", label: "Saldo < 0", test: (value) => value < 0 },
    { key: "lt100", label: "Saldo < $100", test: (value) => value < 100 },
    { key: "lt500", label: "Saldo < $500", test: (value) => value < 500 },
    { key: "lt1000", label: "Saldo < $1,000", test: (value) => value < 1000 },
  ].map((threshold) => {
    if (threshold.test(todayBalance)) {
      return {
        ...threshold,
        balance: todayBalance,
        date: safeCurrentDateKey,
        state: "current",
      };
    }

    let projectedBalance = todayBalance;

    for (const date of futureDates) {
      projectedBalance += dailyBalanceChanges[date] ?? 0;

      if (threshold.test(projectedBalance)) {
        return {
          ...threshold,
          balance: projectedBalance,
          date,
          state: "future",
        };
      }
    }

    return {
      ...threshold,
      balance: null,
      date: "",
      state: "none",
    };
  });

  upcomingExpenses.sort((left, right) => {
    const dateResult = compareSortValues(left.date, right.date, "asc");
    if (dateResult !== 0) return dateResult;
    const amountResult = compareSortValues(right.amount, left.amount, "asc");
    if (amountResult !== 0) return amountResult;
    return compareSortValues(left.name, right.name, "asc");
  });

  return {
    currentMonthLabel: formatMonthLabel(monthKey),
    daysUntilNextIncome: nextIncome ? differenceInCalendarDays(parseDateKey(nextIncome.date), safeCurrentDate) : null,
    fixedExpensesMonthTotal,
    lastIncome,
    nextIncome,
    projectionEndKey,
    thresholdAlerts,
    todayBalance,
    upcomingExpenseWindowEnd,
    upcomingExpenseWindowStart,
    upcomingExpenses,
    variableExpensesMonthToDate,
  };
}

function resolveSummaryForecastEnd({ expenses, incomes, adjustments, currentDateKey, analysisSettings }) {
  const baseDate = parseDateKey(currentDateKey);
  const baselineEnd = localDate(isValidDate(baseDate) ? addCalendarMonths(baseDate, 60) : new Date());
  const incomeOverrideDates = [];

  for (const income of incomes ?? []) {
    for (const [originalDate, value] of Object.entries(sanitizeIncomeScheduleOverrides(income?.scheduleOverrides))) {
      incomeOverrideDates.push(originalDate, value.adjustedDate);
    }
  }

  return maxDateKey(
    baselineEnd,
    currentDateKey,
    analysisSettings?.endDate,
    ...(adjustments ?? []).map((adjustment) => adjustment.date),
    ...(expenses ?? []).flatMap((expense) => [expense.movementDate ?? expense.date, expense.endDate]),
    ...(incomes ?? []).flatMap((income) => [income.startDate, income.endDate]),
    ...incomeOverrideDates,
  );
}

function summarizeOccurrenceGroupLabel(items, fallbackLabel) {
  const names = [...new Set((items ?? []).map((item) => String(item?.name ?? "").trim()).filter(Boolean))];

  if (!names.length) {
    return fallbackLabel;
  }

  if (names.length === 1) {
    return names[0];
  }

  return `${names[0]} + ${names.length - 1} mas`;
}

function buildBudgetComparisonModel({ budgets, expenses, incomes = [], currentDateKey, analysisSettings }) {
  const settings = sanitizeAnalysisSettings(analysisSettings);
  const chartSettings = getChartMonthSettings(settings);
  const currentMonthKey = String(currentDateKey ?? "").slice(0, 7);
  const monthParts = getMonthRangePartsFromMonths(chartSettings.chartStartMonth, chartSettings.chartEndMonth);
  const monthMap = Object.fromEntries(monthParts.map((part) => [part.key, { ...part, budgeted: 0, actual: 0, unbudgeted: 0 }]));
  const budgetDisplayEnd = maxDateKey(
    settings.endDate,
    currentDateKey,
    ...budgets.map((budget) => budget.endDate || budget.startDate || currentDateKey),
  );
  const periodsByBudget = {};
  const periodsByCategory = Object.fromEntries(expenseCategories.map((category) => [category, []]));
  let currentUnbudgeted = 0;

  for (const budget of budgets) {
    const periods = buildBudgetPeriods({
      budget,
      displayEnd: budgetDisplayEnd,
    });

    periodsByBudget[budget.id] = periods;

    for (const period of periods) {
      if (monthMap[period.monthKey]) {
        monthMap[period.monthKey].budgeted += period.plannedAmount;
      }

      for (const category of getBudgetCategories(budget)) {
        if (!periodsByCategory[category]) {
          periodsByCategory[category] = [];
        }
        periodsByCategory[category].push(period);
      }
    }
  }

  for (const category of Object.keys(periodsByCategory)) {
    periodsByCategory[category].sort((left, right) => compareSortValues(left.startKey, right.startKey, "asc"));
  }

  for (const expense of expenses) {
    const occurrenceDates = buildRecurringDates({
      startDate: expense.movementDate ?? expense.date,
      frequency: expense.frequency,
      endDate: expense.endDate,
      isRecurringIndefinite: expense.isRecurringIndefinite,
      displayEnd: budgetDisplayEnd,
    });
    const amount = Number(expense.amount) || 0;
    const category = expenseCategories.includes(String(expense.category ?? "")) ? expense.category : "Otros";

    for (const date of occurrenceDates) {
      const monthKey = String(date).slice(0, 7);
      const matchedPeriod = findBudgetPeriodForDate(periodsByCategory[category] ?? [], date);

      if (matchedPeriod) {
        matchedPeriod.actualAmount += amount;
        if (date <= currentDateKey) {
          matchedPeriod.actualToDateAmount += amount;
        }
        if (monthMap[monthKey]) {
          monthMap[monthKey].actual += amount;
        }
        continue;
      }

      if (monthMap[monthKey]) {
        monthMap[monthKey].unbudgeted += amount;
      }
      if (monthKey === currentMonthKey && date <= currentDateKey) {
        currentUnbudgeted += amount;
      }
    }
  }

  for (const income of incomes) {
    if (!income.isReimbursement) continue;

    const occurrenceDates = buildIncomeOccurrenceEntries({
      income,
      displayEnd: budgetDisplayEnd,
    });
    const amount = -(Number(income.amount) || 0);
    const category = expenseCategories.includes(String(income.reimbursementCategory ?? "")) ? income.reimbursementCategory : "Otros";

    for (const occurrence of occurrenceDates) {
      const date = occurrence.date;
      const monthKey = String(date).slice(0, 7);
      const matchedPeriod = findBudgetPeriodForDate(periodsByCategory[category] ?? [], date);

      if (matchedPeriod) {
        matchedPeriod.actualAmount += amount;
        if (date <= currentDateKey) {
          matchedPeriod.actualToDateAmount += amount;
        }
        if (monthMap[monthKey]) {
          monthMap[monthKey].actual += amount;
        }
        continue;
      }

      if (monthMap[monthKey]) {
        monthMap[monthKey].unbudgeted += amount;
      }
      if (monthKey === currentMonthKey && date <= currentDateKey) {
        currentUnbudgeted += amount;
      }
    }
  }

  const currentBudgets = budgets
    .map((budget) => ({
      id: budget.id,
      name: budget.name ?? "",
      currency: budget.currency ?? "USD",
      frequency: budget.frequency ?? "Mensual",
      linkedCategories: getBudgetCategories(budget),
      scheduleLabel: buildBudgetScheduleLabel(budget),
      ...pickBudgetSnapshot(periodsByBudget[budget.id] ?? [], currentDateKey),
    }))
    .sort((left, right) => {
      const rankResult = budgetSnapshotStatusRank(left.status) - budgetSnapshotStatusRank(right.status);
      if (rankResult !== 0) return rankResult;
      const rangeResult = compareSortValues(left.rangeSortKey, right.rangeSortKey, "asc");
      if (rangeResult !== 0) return rangeResult;
      return compareSortValues(left.name, right.name, "asc");
    });

  const summary = currentBudgets.reduce(
    (result, budget) => {
      if (budget.status !== "active") return result;
      result.activeBudgetCount += 1;
      result.budgetedCurrent += budget.plannedAmount;
      result.actualCurrent += budget.actualAmount;
      return result;
    },
    { activeBudgetCount: 0, budgetedCurrent: 0, actualCurrent: 0 },
  );

  const monthlyPoints = monthParts.map((part) => ({
    key: part.key,
    shortLabel: part.shortLabel,
    yearLabel: part.yearLabel,
    fullLabel: part.fullLabel,
    budgeted: monthMap[part.key]?.budgeted ?? 0,
    actual: monthMap[part.key]?.actual ?? 0,
    unbudgeted: monthMap[part.key]?.unbudgeted ?? 0,
  }));
  const chartPoints = monthlyPoints;

  return {
    summary: {
      ...summary,
      differenceCurrent: summary.budgetedCurrent - summary.actualCurrent,
      unbudgetedCurrent: currentUnbudgeted,
    },
    currentBudgets,
    monthlyPoints,
    chartPoints,
    chartWindowLabel: chartPoints.length
      ? `Ventana ${chartPoints[0].fullLabel} - ${chartPoints[chartPoints.length - 1].fullLabel}`
      : "Sin datos para el rango actual.",
  };
}

function buildBudgetMonthlyOverviewModel({ budgets, expenses, incomes = [], currentDateKey, analysisSettings, selectedMonthKey }) {
  const settings = sanitizeAnalysisSettings(analysisSettings);
  const chartSettings = getChartMonthSettings(settings);
  const monthParts = getMonthRangePartsFromMonths(chartSettings.chartStartMonth, chartSettings.chartEndMonth);
  const currentMonthKey = String(currentDateKey ?? localDate()).slice(0, 7);
  const resolvedMonthKey = monthParts.some((part) => part.key === selectedMonthKey)
    ? selectedMonthKey
    : monthParts.find((part) => part.key === currentMonthKey)?.key ?? monthParts[0]?.key ?? currentMonthKey;
  const monthStartKey = firstDayOfMonth(resolvedMonthKey);
  const monthEndKey = lastDayOfMonth(resolvedMonthKey);
  const plannedByCategory = Object.fromEntries(expenseCategories.map((category) => [category, 0]));
  const actualByCategory = Object.fromEntries(expenseCategories.map((category) => [category, 0]));
  const movementCountByCategory = Object.fromEntries(expenseCategories.map((category) => [category, 0]));
  const budgetNamesByCategory = Object.fromEntries(expenseCategories.map((category) => [category, new Set()]));
  const monthlyBudgets = [];
  let totalIncome = 0;
  let totalActual = 0;
  let associatedBudgetTotal = 0;

  for (const budget of budgets) {
    const monthlyPeriods = buildBudgetPeriods({ budget, displayEnd: monthEndKey }).filter((period) => period.monthKey === resolvedMonthKey);
    if (!monthlyPeriods.length) continue;

    const plannedAmount = monthlyPeriods.reduce((sum, period) => sum + period.plannedAmount, 0);
    const linkedCategories = getBudgetCategories(budget);

    monthlyBudgets.push({
      currency: budget.currency ?? "USD",
      frequency: budget.frequency ?? "Mensual",
      id: budget.id,
      linkedCategories,
      name: budget.name ?? "",
      periodCount: monthlyPeriods.length,
      plannedAmount,
      scheduleLabel: buildBudgetScheduleLabel(budget),
    });

    associatedBudgetTotal += plannedAmount;

    if (!linkedCategories.length) {
      continue;
    }

    const distributedAmount = plannedAmount / linkedCategories.length;

    for (const category of linkedCategories) {
      plannedByCategory[category] += distributedAmount;
      budgetNamesByCategory[category].add(budget.name || "Sin nombre");
    }
  }

  for (const expense of expenses) {
    const category = expenseCategories.includes(String(expense.category ?? "")) ? expense.category : "Otros";
    const occurrenceDates = buildRecurringDates({
      startDate: expense.movementDate ?? expense.date,
      frequency: expense.frequency,
      endDate: expense.endDate,
      isRecurringIndefinite: expense.isRecurringIndefinite,
      displayEnd: monthEndKey,
    });

    for (const date of occurrenceDates) {
      if (String(date).slice(0, 7) !== resolvedMonthKey) continue;

      const amount = Number(expense.amount) || 0;
      actualByCategory[category] += amount;
      movementCountByCategory[category] += 1;
      totalActual += amount;
    }
  }

  for (const income of incomes) {
    const occurrences = buildIncomeOccurrenceEntries({
      income,
      displayEnd: monthEndKey,
    });

    for (const occurrence of occurrences) {
      const date = occurrence.date;
      if (String(date).slice(0, 7) !== resolvedMonthKey) continue;

      const amount = Number(income.amount) || 0;

      if (income.isReimbursement) {
        const category = expenseCategories.includes(String(income.reimbursementCategory ?? "")) ? income.reimbursementCategory : "Otros";
        actualByCategory[category] -= amount;
        movementCountByCategory[category] += 1;
        totalActual -= amount;
        continue;
      }

      totalIncome += amount;
    }
  }

  const categories = expenseCategories
    .filter((category) => movementCountByCategory[category] > 0)
    .map((category) => ({
      actualAmount: actualByCategory[category],
      actualShare: resolveIncomeSharePercent(actualByCategory[category], totalIncome),
      budgetNames: sortLabelsAlphabetically(Array.from(budgetNamesByCategory[category])),
      hasBudget: plannedByCategory[category] > 0,
      key: category,
      movementCount: movementCountByCategory[category],
      name: category,
      plannedAmount: plannedByCategory[category],
      plannedShare: resolveIncomeSharePercent(plannedByCategory[category], totalIncome),
    }))
    .sort((left, right) => {
      if (right.actualAmount !== left.actualAmount) {
        return right.actualAmount - left.actualAmount;
      }

      if (right.plannedAmount !== left.plannedAmount) {
        return right.plannedAmount - left.plannedAmount;
      }

      return compareSortValues(left.name, right.name, "asc");
    });

  monthlyBudgets.sort((left, right) => {
    const amountResult = right.plannedAmount - left.plannedAmount;
    if (amountResult !== 0) return amountResult;
    return compareSortValues(left.name, right.name, "asc");
  });

  const unassignedAmount = totalIncome - associatedBudgetTotal;

  return {
    categories,
    monthLabel: formatMonthLabel(resolvedMonthKey),
    monthOptions: monthParts.map((part) => ({
      key: part.key,
      label: part.fullLabel,
    })),
    monthlyBudgets,
    rangeLabel: `${formatDateLabel(monthStartKey)} - ${formatDateLabel(monthEndKey)}`,
    selectedMonthKey: resolvedMonthKey,
    summary: {
      associatedBudgetShare: resolveIncomeSharePercent(associatedBudgetTotal, totalIncome),
      associatedBudgetTotal,
      categoryCount: categories.length,
      totalActual,
      totalIncome,
      unassignedAmount,
    },
  };
}

function resolveIncomeSharePercent(value, totalIncome) {
  const numericValue = Number(value) || 0;
  const numericIncome = Number(totalIncome) || 0;

  if (!numericIncome) {
    return 0;
  }

  return (numericValue / numericIncome) * 100;
}

function buildBudgetPeriods({ budget, displayEnd }) {
  const periods = buildRecurringDates({
    startDate: budget.startDate,
    frequency: budget.frequency,
    endDate: budget.endDate,
    isRecurringIndefinite: budget.isRecurringIndefinite,
    displayEnd,
  });

  return periods.map((startKey) => ({
    id: `${budget.id}_${startKey}`,
    startKey,
    endKey: getBudgetPeriodEndKey({ budget, startKey, displayEnd }),
    monthKey: String(startKey).slice(0, 7),
    plannedAmount: Number(budget.amount) || 0,
    actualAmount: 0,
    actualToDateAmount: 0,
  }));
}

function getBudgetPeriodEndKey({ budget, startKey, displayEnd }) {
  const hardEnd = !budget.isRecurringIndefinite && budget.endDate ? minDateKey(budget.endDate, displayEnd) : displayEnd;

  if (budget.frequency === "Unico") {
    return minDateKey(startKey, hardEnd);
  }

  if (!budget.isRecurringIndefinite && !budget.endDate) {
    return startKey;
  }

  const nextStart = nextRecurringDate(parseDateKey(startKey), budget.frequency);
  if (!nextStart) {
    return minDateKey(startKey, hardEnd);
  }

  return minDateKey(localDate(addDays(nextStart, -1)), hardEnd);
}

function findBudgetPeriodForDate(periods, date) {
  return periods.find((period) => period.startKey <= date && date <= period.endKey) ?? null;
}

function pickBudgetSnapshot(periods, currentDateKey) {
  if (!periods.length) {
    return {
      status: "empty",
      statusLabel: "Sin periodos",
      rangeLabel: "Sin rango disponible",
      rangeSortKey: "9999-12-31",
      plannedAmount: 0,
      actualAmount: 0,
      differenceAmount: 0,
    };
  }

  const activePeriod = periods.find((period) => period.startKey <= currentDateKey && currentDateKey <= period.endKey);
  if (activePeriod) {
    return createBudgetSnapshot(activePeriod, "active", "Periodo actual", activePeriod.actualToDateAmount);
  }

  const nextPeriod = periods.find((period) => period.startKey > currentDateKey);
  if (nextPeriod) {
    return createBudgetSnapshot(nextPeriod, "upcoming", "Proximo periodo", 0);
  }

  const lastPeriod = periods[periods.length - 1];
  return createBudgetSnapshot(lastPeriod, "ended", "Ultimo periodo", lastPeriod.actualAmount);
}

function createBudgetSnapshot(period, status, statusLabel, actualAmount) {
  return {
    status,
    statusLabel,
    rangeLabel: formatPeriodLabel(period.startKey, period.endKey),
    rangeSortKey: period.startKey,
    plannedAmount: period.plannedAmount,
    actualAmount,
    differenceAmount: period.plannedAmount - actualAmount,
  };
}

function budgetSnapshotStatusRank(status) {
  switch (status) {
    case "active":
      return 0;
    case "upcoming":
      return 1;
    case "ended":
      return 2;
    default:
      return 3;
  }
}

function buildBudgetScheduleLabel(budget) {
  const startLabel = formatDateLabel(budget.startDate);
  if (budget.isRecurringIndefinite) {
    return `${budget.frequency} desde ${startLabel}, sin fecha de termino.`;
  }
  if (budget.endDate) {
    return `${budget.frequency} desde ${startLabel} hasta ${formatDateLabel(budget.endDate)}.`;
  }
  return `${budget.frequency} con inicio en ${startLabel}.`;
}

function formatPeriodLabel(startKey, endKey) {
  if (!startKey) return "Sin rango";
  if (!endKey || startKey === endKey) return formatDateLabel(startKey);
  return `${formatDateLabel(startKey)} - ${formatDateLabel(endKey)}`;
}

function getBudgetActiveRange(budget) {
  return {
    startKey: budget.startDate,
    endKey: budget.isRecurringIndefinite ? null : budget.endDate || budget.startDate,
  };
}

function budgetRangesOverlap(left, right) {
  const leftEnd = left.endKey ?? "9999-12-31";
  const rightEnd = right.endKey ?? "9999-12-31";
  return left.startKey <= rightEnd && right.startKey <= leftEnd;
}

function getMonthRangePartsFromMonths(startMonthKey, endMonthKey) {
  const startDate = parseDateKey(firstDayOfMonth(startMonthKey));
  const endDate = parseDateKey(firstDayOfMonth(endMonthKey));
  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) return [];

  return eachMonthOfInterval({ start: getStartOfMonth(startDate), end: getStartOfMonth(endDate) })
    .slice(0, 240)
    .map((monthDate) => ({
      key: formatDateValue(monthDate, "yyyy-MM"),
      shortLabel: capitalizeLabel(formatDateValue(monthDate, "MMM", { locale: spanishDateLocale }).replace(".", "")),
      yearLabel: formatDateValue(monthDate, "yyyy"),
      fullLabel: capitalizeLabel(formatDateValue(monthDate, "MMMM yyyy", { locale: spanishDateLocale })),
    }));
}

function defaultChartMonthRange(startDateKey, endDateKey) {
  const startMonth = String(startDateKey ?? "").slice(0, 7) || localDate().slice(0, 7);
  const endMonth = String(endDateKey ?? "").slice(0, 7) || startMonth;
  const cappedEndMonth = minMonthKey(endMonth, addMonthsToMonthKey(startMonth, 11));

  return {
    chartStartMonth: startMonth,
    chartEndMonth: cappedEndMonth,
  };
}

function getChartMonthSettings(settings) {
  const sanitized = sanitizeAnalysisSettings(settings);
  return {
    chartStartMonth: sanitized.chartStartMonth,
    chartEndMonth: sanitized.chartEndMonth,
  };
}

function toChartAnalysisSettings(settings) {
  const sanitized = sanitizeAnalysisSettings(settings);
  return {
    ...sanitized,
    startDate: firstDayOfMonth(sanitized.chartStartMonth),
    endDate: lastDayOfMonth(sanitized.chartEndMonth),
  };
}

function firstDayOfMonth(monthKey) {
  return `${monthKey}-01`;
}

function lastDayOfMonth(monthKey) {
  const monthDate = parseDateKey(firstDayOfMonth(monthKey));
  if (!isValidDate(monthDate)) return firstDayOfMonth(monthKey);
  return localDate(getEndOfMonth(monthDate));
}

function addMonthsToMonthKey(monthKey, monthsToAdd) {
  const monthDate = parseDateKey(firstDayOfMonth(monthKey));
  if (!isValidDate(monthDate)) return monthKey;
  return formatDateValue(addCalendarMonths(monthDate, Number(monthsToAdd || 0)), "yyyy-MM");
}

function minMonthKey(...values) {
  const months = values.filter(Boolean).sort();
  return months[0] ?? "";
}

function isValidMonthKey(value) {
  return /^\d{4}-\d{2}$/.test(String(value ?? ""));
}

function buildBalanceTrendModel({ budgets, expenses, incomes, adjustments, currentDateKey, analysisSettings }) {
  const chartRange = toChartAnalysisSettings(analysisSettings);
  const budgetExpenses = budgets.map((budget) => ({
    id: budget.id,
    name: budget.name,
    amount: budget.amount,
    currency: budget.currency,
    category: getBudgetCategories(budget)[0] ?? "Otros",
    frequency: budget.frequency,
    movementDate: budget.startDate,
    endDate: budget.endDate,
    isRecurringIndefinite: budget.isRecurringIndefinite,
    createdAt: budget.createdAt,
  }));
  const estimatedModel = buildCashflowModel({
    expenses,
    incomes,
    adjustments,
    currentDateKey,
    analysisSettings: chartRange,
  });
  const budgetModel = buildCashflowModel({
    expenses: budgetExpenses,
    incomes,
    adjustments,
    currentDateKey,
    analysisSettings: chartRange,
  });
  const estimatedRow = estimatedModel.rows.find((row) => row.key === "closingBalance");
  const budgetRow = budgetModel.rows.find((row) => row.key === "closingBalance");
  const dailyPoints = estimatedModel.dates.map((date) => ({
    key: date.key,
    date: date.key,
    shortLabel: date.shortLabel,
    estimatedBalance: estimatedRow?.values?.[date.key] ?? 0,
    budgetBalance: budgetRow?.values?.[date.key] ?? 0,
  }));

  return {
    dailyPoints,
    yDomain: resolveBalanceChartDomain(dailyPoints),
    rangeLabel: `${formatMonthLabel(chartRange.chartStartMonth)} - ${formatMonthLabel(chartRange.chartEndMonth)}`,
  };
}

function buildCashflowModel({ expenses, incomes, adjustments, currentDateKey, analysisSettings }) {
  const settings = sanitizeAnalysisSettings(analysisSettings);
  const dates = getDateRangeParts(settings.startDate, settings.endDate);
  const displayStart = dates[0]?.key ?? settings.startDate;
  const displayEnd = dates[dates.length - 1]?.key ?? settings.endDate;

  const incomeByDate = {};
  const incomeDetailsByDate = {};
  const adjustmentByDate = {};
  const adjustmentDetailsByDate = {};
  const fixedTotalByDate = {};
  const fixedDetailsByDate = {};
  const variableTotalByDate = {};
  const variableDetailsByDate = {};
  const categoryValues = Object.fromEntries(expenseCategories.map((category) => [category, {}]));
  const categoryDetails = Object.fromEntries(expenseCategories.map((category) => [category, {}]));
  const dailyImpactByDate = {};

  const registerCategoryImpact = (date, category, amount, line) => {
    increaseDateValue(dailyImpactByDate, date, amount);
    const group = getExpenseCategoryGroup(category);

    if (date < displayStart || date > displayEnd) {
      return;
    }

    increaseDateValue(categoryValues[category], date, amount);
    appendDateLine(categoryDetails[category], date, line);

    if (group === "fixed") {
      increaseDateValue(fixedTotalByDate, date, amount);
      appendDateLine(fixedDetailsByDate, date, line);
    } else {
      increaseDateValue(variableTotalByDate, date, amount);
      appendDateLine(variableDetailsByDate, date, line);
    }
  };

  for (const expense of expenses) {
    const occurrenceDates = buildRecurringDates({
      startDate: expense.movementDate ?? expense.date,
      frequency: expense.frequency,
      endDate: expense.endDate,
      isRecurringIndefinite: expense.isRecurringIndefinite,
      displayEnd,
    });

    for (const date of occurrenceDates) {
      const amount = -(Number(expense.amount) || 0);
      const category = expenseCategories.includes(String(expense.category ?? "")) ? expense.category : "Otros";
      const line = formatCashflowLine({
        amount,
        currency: expense.currency,
        label: expense.name || "Gasto",
        date,
      });
      registerCategoryImpact(date, category, amount, line);
    }
  }

  for (const income of incomes) {
    const occurrenceDates = buildIncomeOccurrenceEntries({
      income,
      displayEnd,
    });

    for (const occurrence of occurrenceDates) {
      const date = occurrence.date;
      const amount = Number(income.amount) || 0;
      const scheduleLabel = occurrence.isAdjusted ? ` [ajuste ${occurrence.originalDate} -> ${occurrence.date}]` : "";

      if (income.isReimbursement) {
        const category = expenseCategories.includes(String(income.reimbursementCategory ?? "")) ? income.reimbursementCategory : "Otros";
        const line = formatCashflowLine({
          amount,
          currency: income.currency,
          label: `Reembolso ${income.name || "sin nombre"}${scheduleLabel}`,
          date,
        });
        registerCategoryImpact(date, category, amount, line);
        continue;
      }

      increaseDateValue(dailyImpactByDate, date, amount);
      if (date < displayStart || date > displayEnd) continue;

      increaseDateValue(incomeByDate, date, amount);
      appendDateLine(
        incomeDetailsByDate,
        date,
        formatCashflowLine({
          amount,
          currency: income.currency,
          label: `${income.name || "Ingreso"}${scheduleLabel}`,
          date,
        }),
      );
    }
  }

  for (const adjustment of adjustments) {
    const date = adjustment.date;
    const amount = Number(adjustment.amount) || 0;
    increaseDateValue(dailyImpactByDate, date, amount);

    if (date < displayStart || date > displayEnd) continue;

    increaseDateValue(adjustmentByDate, date, amount);
    appendDateLine(
      adjustmentDetailsByDate,
      date,
      formatCashflowLine({
        amount,
        currency: "USD",
        label: "Cuadre manual",
        date,
      }),
    );
  }

  const openingBalanceByDate = {};
  const openingDetailsByDate = {};
  const netFlowByDate = {};
  const netFlowDetailsByDate = {};
  const closingBalanceByDate = {};
  const closingDetailsByDate = {};

  let runningBalance = Object.entries(dailyImpactByDate)
    .filter(([date]) => date < displayStart)
    .reduce((sum, [, amount]) => sum + (Number(amount) || 0), 0);

  for (const date of dates.map((item) => item.key)) {
    const opening = runningBalance;
    const income = incomeByDate[date] ?? 0;
    const fixedTotal = fixedTotalByDate[date] ?? 0;
    const variableTotal = variableTotalByDate[date] ?? 0;
    const netFlow = income + fixedTotal + variableTotal;
    const adjustment = adjustmentByDate[date] ?? 0;
    const closing = opening + netFlow + adjustment;

    openingBalanceByDate[date] = opening;
    netFlowByDate[date] = netFlow;
    closingBalanceByDate[date] = closing;

    openingDetailsByDate[date] = {
      lines: opening ? [`Saldo acumulado hasta ayer: ${formatCashflowAmount(opening)}`] : ["Sin arrastre previo."],
      total: opening,
    };

    const flowLines = [
      ...(incomeDetailsByDate[date] ?? []),
      ...(fixedDetailsByDate[date] ?? []),
      ...(variableDetailsByDate[date] ?? []),
    ];

    netFlowDetailsByDate[date] = {
      lines: flowLines.length ? flowLines : ["Sin movimientos de flujo."],
      total: netFlow,
    };

    closingDetailsByDate[date] = {
      lines: [
        `Saldo inicial: ${formatCashflowAmount(opening)}`,
        `Flujo neto: ${formatCashflowAmount(netFlow)}`,
        `Cuadre: ${formatCashflowAmount(adjustment)}`,
      ],
      total: closing,
    };

    runningBalance = closing;
  }

  const rows = [
    makeCashflowRow("openingBalance", "Saldo Inicial", openingBalanceByDate, openingDetailsByDate, "cashflow-balance-row"),
    makeCashflowRow("incomeNet", "Ingreso Total Neto", incomeByDate, buildRowDetails(incomeDetailsByDate, incomeByDate, "Sin ingresos reales."), "cashflow-summary-row"),
    ...fixedExpenseCategories.map((category) =>
      makeCashflowRow(category, category, categoryValues[category], buildRowDetails(categoryDetails[category], categoryValues[category], "Sin movimientos.")),
    ),
    makeCashflowRow("fixedTotal", "Total Gastos Fijos", fixedTotalByDate, buildRowDetails(fixedDetailsByDate, fixedTotalByDate, "Sin gastos fijos."), "cashflow-total-row"),
    ...variableExpenseCategories.map((category) =>
      makeCashflowRow(category, category, categoryValues[category], buildRowDetails(categoryDetails[category], categoryValues[category], "Sin movimientos.")),
    ),
    makeCashflowRow(
      "variableTotal",
      "Total Gastos Variables",
      variableTotalByDate,
      buildRowDetails(variableDetailsByDate, variableTotalByDate, "Sin gastos variables."),
      "cashflow-total-row",
    ),
    makeCashflowRow("netFlow", "Flujo Neto del Periodo", netFlowByDate, netFlowDetailsByDate, "cashflow-total-row"),
    makeCashflowRow(
      "reconciliation",
      "Cuadre",
      adjustmentByDate,
      buildRowDetails(adjustmentDetailsByDate, adjustmentByDate, "Sin ajustes de cuadre."),
      "cashflow-total-row",
    ),
    makeCashflowRow("closingBalance", "Saldo Final Estimado", closingBalanceByDate, closingDetailsByDate, "cashflow-final-row"),
  ];

  return {
    dates,
    rows,
    todayKey: currentDateKey,
    rangeLabel: `${formatDateLabel(settings.startDate)} - ${formatDateLabel(settings.endDate)}`,
  };
}

function buildCashflowResolutionModel(baseModel, resolution) {
  if (!baseModel?.dates?.length || resolution === "daily") {
    return baseModel;
  }

  const periods = buildCashflowPeriods(baseModel.dates, resolution);
  if (!periods.length) {
    return baseModel;
  }

  const rowsByKey = Object.fromEntries(baseModel.rows.map((row) => [row.key, row]));
  const periodSummaries = Object.fromEntries(
    periods.map((period) => {
      const opening = rowsByKey.openingBalance?.values?.[period.startKey] ?? 0;
      const netFlow = sumPeriodValues(period.dateKeys.map((dateKey) => rowsByKey.netFlow?.values?.[dateKey] ?? 0));
      const adjustment = sumPeriodValues(period.dateKeys.map((dateKey) => rowsByKey.reconciliation?.values?.[dateKey] ?? 0));
      const closing = rowsByKey.closingBalance?.values?.[period.endKey] ?? 0;

      return [
        period.key,
        {
          adjustment,
          closing,
          netFlow,
          opening,
        },
      ];
    }),
  );
  const rows = baseModel.rows.map((row) => {
    const values = {};
    const details = {};

    for (const period of periods) {
      const summary = periodSummaries[period.key];

      if (row.key === "openingBalance") {
        values[period.key] = summary.opening;
        details[period.key] = {
          lines: [`Saldo inicial del periodo: ${formatCashflowAmount(summary.opening)}`],
          total: summary.opening,
        };
        continue;
      }

      if (row.key === "closingBalance") {
        values[period.key] = summary.closing;
        details[period.key] = {
          lines: [
            `Saldo inicial del periodo: ${formatCashflowAmount(summary.opening)}`,
            `Flujo neto acumulado: ${formatCashflowAmount(summary.netFlow)}`,
            `Cuadre acumulado: ${formatCashflowAmount(summary.adjustment)}`,
            `Saldo final del periodo: ${formatCashflowAmount(summary.closing)}`,
          ],
          total: summary.closing,
        };
        continue;
      }

      const total = sumPeriodValues(period.dateKeys.map((dateKey) => row.values?.[dateKey] ?? 0));

      values[period.key] = total;
      details[period.key] = {
        lines: collectCashflowPeriodLines(row, period),
        total,
      };
    }

    return {
      ...row,
      details,
      values,
    };
  });
  const todayPeriod = periods.find((period) => period.dateKeys.includes(baseModel.todayKey));

  return {
    ...baseModel,
    dates: periods.map(({ dateKeys, endKey, startKey, ...date }) => date),
    rows,
    todayKey: todayPeriod?.key ?? baseModel.todayKey,
    rangeLabel: formatCashflowRangeLabel(periods, resolution),
  };
}

function buildCashflowPeriods(dates, resolution) {
  const periods = new Map();

  for (const date of dates) {
    const descriptor = getCashflowPeriodDescriptor(date.key, resolution);
    if (!descriptor) continue;

    if (!periods.has(descriptor.key)) {
      periods.set(descriptor.key, {
        ...descriptor,
        dateKeys: [],
      });
    }

    periods.get(descriptor.key).dateKeys.push(date.key);
  }

  return Array.from(periods.values()).map((period) => ({
    ...period,
    endKey: period.dateKeys[period.dateKeys.length - 1],
    startKey: period.dateKeys[0],
  }));
}

function getCashflowPeriodDescriptor(dateKey, resolution) {
  const date = parseDateKey(dateKey);

  if (!isValidDate(date)) {
    return null;
  }

  if (resolution === "monthly") {
    const monthKey = formatDateValue(date, "yyyy-MM");

    return {
      key: monthKey,
      fullLabel: formatMonthLabel(monthKey),
      shortLabel: capitalizeLabel(formatDateValue(date, "MMM", { locale: spanishDateLocale }).replace(".", "")),
      yearLabel: formatDateValue(date, "yyyy"),
    };
  }

  if (resolution === "weekly") {
    const startDate = getStartOfWeek(date, { weekStartsOn: 1 });
    const endDate = getEndOfWeek(date, { weekStartsOn: 1 });

    return {
      key: `week-${localDate(startDate)}`,
      fullLabel: `Semana ${formatDateLabel(localDate(startDate))} - ${formatDateLabel(localDate(endDate))}`,
      shortLabel: `${formatDateValue(startDate, "dd/MM")} - ${formatDateValue(endDate, "dd/MM")}`,
      yearLabel: formatDateValue(startDate, "yyyy"),
    };
  }

  return {
    key: dateKey,
    fullLabel: formatDateLabel(dateKey),
    shortLabel: formatDateValue(date, "dd/MM"),
    yearLabel: formatDateValue(date, "yyyy"),
  };
}

function collectCashflowPeriodLines(row, period) {
  const lines = [];
  let hiddenCount = 0;

  for (const dateKey of period.dateKeys) {
    const rowDetails = row.details?.[dateKey];
    const nextLines = (rowDetails?.lines ?? []).filter((line) => !isGenericCashflowLine(line));

    if (!nextLines.length) {
      continue;
    }

    for (const line of nextLines) {
      if (lines.length < 16) {
        lines.push(line);
      } else {
        hiddenCount += 1;
      }
    }
  }

  if (!lines.length) {
    return buildEmptyCashflowDetails(row.label, period.startKey).lines;
  }

  if (hiddenCount > 0) {
    lines.push(`...y ${hiddenCount} movimientos mas.`);
  }

  return lines;
}

function isGenericCashflowLine(line) {
  return [
    "Sin ajustes de cuadre.",
    "Sin arrastre previo.",
    "Sin gastos fijos.",
    "Sin gastos variables.",
    "Sin ingresos reales.",
    "Sin movimientos.",
    "Sin movimientos de flujo.",
    "Sin movimientos registrados.",
  ].includes(line);
}

function sumPeriodValues(values) {
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function formatCashflowRangeLabel(periods, resolution) {
  if (!periods.length) {
    return "";
  }

  const firstPeriod = periods[0];
  const lastPeriod = periods[periods.length - 1];
  const prefix = resolution === "weekly" ? "Semanal" : "Mensual";

  return `${prefix} | ${formatDateLabel(firstPeriod.startKey)} - ${formatDateLabel(lastPeriod.endKey)}`;
}

function getCashflowResolutionCopy(resolution) {
  if (resolution === "daily") {
    return "Vista diaria del rango configurado. El dia de hoy queda resaltado y la tabla se centra automaticamente cuando entra en el rango.";
  }

  if (resolution === "monthly") {
    return "Vista mensual resumida del rango configurado. Ideal para revisar tendencias largas sin perder contexto.";
  }

  return "Vista semanal del rango configurado. Por defecto cada semana comienza en lunes para que la navegacion sea mas liviana y fluida.";
}

function makeCashflowRow(key, label, values, details, className = "") {
  return {
    key,
    label,
    values,
    details,
    className,
  };
}

function buildRowDetails(linesByDate, totalsByDate, emptyLabel) {
  const details = {};

  for (const date of new Set([...Object.keys(linesByDate ?? {}), ...Object.keys(totalsByDate ?? {})])) {
    details[date] = {
      lines: linesByDate?.[date]?.length ? linesByDate[date] : [emptyLabel],
      total: totalsByDate?.[date] ?? 0,
    };
  }

  return details;
}

function buildEmptyCashflowDetails(label, date) {
  if (label === "Saldo Inicial") {
    return { lines: ["Sin arrastre previo."], total: 0 };
  }

  return { lines: ["Sin movimientos registrados."], total: 0 };
}

function getDateRangeParts(startDateKey, endDateKey) {
  const startDate = parseDateKey(startDateKey);
  const endDate = parseDateKey(endDateKey);
  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) return [];

  return eachDayOfInterval({ start: startDate, end: endDate })
    .slice(0, 10000)
    .map((date) => ({
      fullLabel: formatDateLabel(localDate(date)),
      key: localDate(date),
      shortLabel: formatDateValue(date, "dd/MM"),
      yearLabel: formatDateValue(date, "yyyy"),
    }));
}

function buildRecurringDates({ startDate, frequency, endDate, isRecurringIndefinite, displayEnd }) {
  return buildRecurringDatesWithRRule({
    startDate,
    frequency,
    endDate,
    isRecurringIndefinite,
    displayEnd,
  });
}

function addDays(date, days) {
  return addCalendarDays(date, Number(days) || 0);
}

function addMonthsPreservingDay(date, desiredDay) {
  const nextMonthStart = getStartOfMonth(addCalendarMonths(date, 1));
  return setDayOfMonth(nextMonthStart, Math.min(Number(desiredDay) || 1, getDaysInMonth(nextMonthStart)));
}

function nextRecurringDate(date, frequency) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  if (frequency === "Semanal") {
    return addDays(date, 7);
  }

  if (frequency === "Bi-semanal") {
    return addDays(date, 14);
  }

  if (frequency === "Mensual") {
    return addMonthsPreservingDay(date, date.getDate());
  }

  return null;
}

function parseDateKey(value) {
  return parseISO(String(value ?? ""));
}

function minDateKey(...values) {
  const dates = values.filter(Boolean).sort();
  return dates[0] ?? "";
}

function maxDateKey(...values) {
  const dates = values.filter(Boolean).sort();
  return dates[dates.length - 1] ?? localDate();
}

function getExpenseCategoryGroup(category) {
  return expenseCategoryGroups[category] ?? "variable";
}

function increaseDateValue(target, date, amount) {
  target[date] = (target[date] ?? 0) + (Number(amount) || 0);
}

function appendDateLine(target, date, line) {
  if (!target[date]) {
    target[date] = [];
  }

  target[date].push(line);
}

function formatCashflowLine({ amount, label, date }) {
  return `${formatCashflowAmount(amount)} - ${label} (${date})`;
}

function formatCashflowAmount(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function sanitizeAnalysisSettings(settings) {
  const candidate = settings ?? {};
  const startDate = String(candidate.startDate ?? "2026-01-01");
  const endDate = String(candidate.endDate ?? "2030-12-31");
  const chartDefaults = defaultChartMonthRange(startDate, endDate);
  const chartStartMonth = String(candidate.chartStartMonth ?? chartDefaults.chartStartMonth);
  const chartEndMonth = String(candidate.chartEndMonth ?? chartDefaults.chartEndMonth);

  if (
    !startDate ||
    !endDate ||
    startDate > endDate ||
    !isValidMonthKey(chartStartMonth) ||
    !isValidMonthKey(chartEndMonth) ||
    chartStartMonth > chartEndMonth
  ) {
    return defaultAnalysisSettings();
  }

  return { startDate, endDate, chartStartMonth, chartEndMonth };
}

function normalizeSortText(value) {
  const text = String(value ?? "").trim();
  return text ? text.toLocaleLowerCase("es") : null;
}

function capitalizeLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dateToTimestamp(value) {
  if (!value) return null;
  const date = parseDateKey(value);
  if (!isValidDate(date)) return null;
  return date.getTime();
}

function localDate(date = new Date()) {
  const normalizedDate = date instanceof Date ? date : new Date(date);
  return formatDateValue(isValidDate(normalizedDate) ? normalizedDate : new Date(), "yyyy-MM-dd");
}

function money(value, currency) {
  return formatMoneyAmount(value, currency || "USD", "es-CL");
}

function formatDaysUntilIncome(days) {
  if (days == null) return "Sin fecha";
  if (days <= 0) return "Hoy";
  if (days === 1) return "1 dia";
  return `${days} dias`;
}

function formatCompactCurrency(value) {
  return formatCompactMoneyAmount(value, "USD");
}

function formatPercentLabel(value) {
  const numericValue = Number(value) || 0;

  if (Math.abs(numericValue) < 0.05) {
    return "0%";
  }

  return `${new Intl.NumberFormat("es-CL", {
    maximumFractionDigits: 1,
    minimumFractionDigits: Math.abs(numericValue % 1) < 0.05 ? 0 : 1,
  }).format(numericValue)}%`;
}

function formatMonthLabel(monthKey) {
  if (!isValidMonthKey(monthKey)) return monthKey;
  const date = parseDateKey(firstDayOfMonth(monthKey));
  if (!isValidDate(date)) return monthKey;
  return capitalizeLabel(formatDateValue(date, "MMMM yyyy", { locale: spanishDateLocale }));
}

function formatMonthTick(monthKey) {
  if (!isValidMonthKey(monthKey)) return monthKey;
  const date = parseDateKey(firstDayOfMonth(monthKey));
  if (!isValidDate(date)) return monthKey;
  const monthLabel = capitalizeLabel(formatDateValue(date, "MMM", { locale: spanishDateLocale }).replace(".", ""));
  return `${monthLabel} ${formatDateValue(date, "yy")}`;
}

function formatBalanceTrendTick(dateKey, resolution = "daily") {
  if (!dateKey) return "";
  const date = parseDateKey(dateKey);
  if (!isValidDate(date)) return dateKey;

  if (resolution === "monthly") {
    return formatDateValue(date, "d MMMM yyyy", { locale: spanishDateLocale });
  }

  if (resolution === "weekly") {
    return capitalizeLabel(formatDateValue(date, "eee d MMM", { locale: spanishDateLocale }).replaceAll(".", ""));
  }

  const isMonthStart = date.getDate() === 1;

  return isMonthStart
    ? capitalizeLabel(formatDateValue(date, "dd MMM", { locale: spanishDateLocale }).replace(".", ""))
    : formatDateValue(date, "dd");
}

function resolveBalanceChartDomain(points) {
  const values = points.flatMap((point) => [point.estimatedBalance, point.budgetBalance]).filter((value) => Number.isFinite(Number(value)));
  if (!values.length) return [0, 1];

  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);

  if (minValue === maxValue) {
    const padding = Math.max(Math.abs(minValue) * 0.08, 50);
    return [minValue - padding, maxValue + padding];
  }

  const padding = Math.max((maxValue - minValue) * 0.08, 50);
  minValue -= padding;
  maxValue += padding;

  return [Math.floor(minValue), Math.ceil(maxValue)];
}

function labelVersion(version) {
  const timestamp = new Date(Number(version.savedAt));
  if (!isValidDate(timestamp)) return String(version.snapshotDate ?? "Sin fecha");
  return `${version.snapshotDate} | ${formatDateValue(timestamp, "Pp", { locale: spanishDateLocale })}`;
}

function toUsdAmount(expense) {
  return Number(expense.amount) || 0;
}

function formatDateLabel(value) {
  if (!value) return "Sin fecha";
  const date = parseDateKey(value);
  if (!isValidDate(date)) return value;
  return formatDateValue(date, "P", { locale: spanishDateLocale });
}

function buildBalanceTrendTicks(points, resolution) {
  if (!points?.length || resolution === "daily") return [];

  const availableDates = new Set(points.map((point) => point.date));
  const ticks = [];
  let previousPeriodKey = "";

  for (const point of points) {
    const descriptor = getCashflowPeriodDescriptor(point.date, resolution);
    if (!descriptor) continue;

    if (descriptor.key !== previousPeriodKey) {
      const referenceDate =
        resolution === "monthly"
          ? firstDayOfMonth(descriptor.key)
          : localDate(getStartOfWeek(parseDateKey(point.date), { weekStartsOn: 1 }));

      ticks.push(availableDates.has(referenceDate) ? referenceDate : point.date);
      previousPeriodKey = descriptor.key;
    }
  }

  return ticks;
}

function resolveBalanceTrendChartWidth(pointCount, resolution) {
  const safePointCount = Math.max(0, Number(pointCount) || 0);

  if (resolution === "monthly") {
    return Math.max(860, Math.round(safePointCount * 4));
  }

  if (resolution === "weekly") {
    return Math.max(900, Math.round(safePointCount * 9));
  }

  return Math.max(960, safePointCount * 18);
}

function getBalanceTrendResolutionCopy(resolution) {
  if (resolution === "weekly") {
    return "El eje X toma los lunes como referencia semanal, pero la curva sigue trazada con todos los dias.";
  }

  if (resolution === "monthly") {
    return "El eje X marca el dia 1 de cada mes y comprime la vista, manteniendo intacto el detalle diario de la serie.";
  }

  return "Cada marca del eje X sigue el ritmo diario original del flujo proyectado.";
}

function getBalanceTrendScrollCopy(resolution) {
  if (resolution === "weekly") {
    return "Desliza lateralmente para recorrer la serie diaria con referencias semanales en el eje X.";
  }

  if (resolution === "monthly") {
    return "Desliza lateralmente para recorrer la serie diaria comprimida, con referencias mensuales en el eje X.";
  }

  return "Desliza lateralmente para recorrer todos los dias del periodo seleccionado.";
}

function formatTimestampLabel(value) {
  if (!value) return "Sin fecha";
  const date = new Date(Number(value));
  if (!isValidDate(date)) return "Sin fecha";
  return formatDateValue(date, "P", { locale: spanishDateLocale });
}

